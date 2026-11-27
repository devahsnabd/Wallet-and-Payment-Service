import { z } from 'zod';
import { Db, clearingAccountId, immediate, walletAccountId } from '../database/connection';
import type { Clock } from '../database/infra.module';
import { Ledger } from '../ledger/ledger.core';

export const WebhookEvent = z
  .object({
    eventId: z.string().min(1).max(128),
    type: z.enum(['payment.succeeded', 'payment.failed', 'payment.refunded']),
    providerRef: z.string().min(1).max(128),
    refundId: z.string().min(1).max(128).optional(),
    amountMinor: z.number().int().safe().positive().optional(),
    occurredAt: z.string().optional(),
  })
  .refine((e) => e.type !== 'payment.refunded' || (e.refundId !== undefined && e.amountMinor !== undefined), {
    message: 'payment.refunded requires refundId and amountMinor',
  });
export type WebhookEvent = z.infer<typeof WebhookEvent>;

interface TopupRow {
  id: string;
  user_id: string;
  amount_minor: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed';
}
interface RefundRow {
  refund_id: string;
  amount_minor: number;
}

export class WebhooksCore {
  private readonly ledger: Ledger;
  constructor(
    private readonly db: Db,
    private readonly clock: Clock = () => new Date(),
  ) {
    this.ledger = new Ledger(db);
  }

  /**
   * Applies one provider event. Persisting the event (the dedupe key) and applying its effect
   * happen in one transaction, so a crash can never leave "seen but not applied".
   * No outbound calls are made, so this is fast enough to run before answering the provider.
   */
  handle(event: WebhookEvent, rawPayload: string): string {
    return immediate(this.db, () => {
      const seen = this.db
        .prepare('INSERT OR IGNORE INTO webhook_events (event_id, provider_ref, type, payload, received_at) VALUES (?, ?, ?, ?, ?)')
        .run(event.eventId, event.providerRef, event.type, rawPayload, this.clock().toISOString());
      if (seen.changes === 0) return 'duplicate_event';

      const outcome = this.apply(event);
      this.db.prepare('UPDATE webhook_events SET outcome = ? WHERE event_id = ?').run(outcome, event.eventId);
      return outcome;
    });
  }

  private apply(event: WebhookEvent): string {
    const topup = this.db.prepare('SELECT id, user_id, amount_minor, currency, status FROM topups WHERE provider_ref = ?').get(event.providerRef) as
      | TopupRow
      | undefined;
    // Unknown reference: keep the event for investigation but still answer 200 so the provider stops retrying.
    if (!topup) return 'unknown_reference';

    switch (event.type) {
      case 'payment.succeeded':
        if (topup.status === 'succeeded') return 'already_succeeded';
        if (topup.status === 'failed') return 'ignored_success_after_failure';
        return this.credit(topup);
      case 'payment.failed':
        if (topup.status !== 'pending') return 'ignored_failure_after_' + topup.status;
        this.db.prepare("UPDATE topups SET status = 'failed' WHERE id = ?").run(topup.id);
        return 'marked_failed';
      case 'payment.refunded':
        return this.recordRefund(topup, event.refundId!, event.amountMinor!);
    }
  }

  /** Credits the wallet exactly once: the ledger ref `topup:<id>:credit` is UNIQUE, and status flips from pending in the same transaction. */
  private credit(topup: TopupRow): string {
    const now = this.clock().toISOString();
    this.db.prepare("UPDATE topups SET status = 'succeeded', credited_at = ? WHERE id = ?").run(now, topup.id);
    this.ledger.post(
      {
        kind: 'topup',
        ref: `topup:${topup.id}:credit`,
        entries: [
          { debitAccountId: clearingAccountId(topup.currency), creditAccountId: walletAccountId(topup.user_id), amountMinor: topup.amount_minor, currency: topup.currency },
        ],
      },
      now,
    );
    // Refunds that arrived before the success event were parked; apply them now, in arrival order.
    const parked = this.db
      .prepare("SELECT refund_id, amount_minor FROM refunds WHERE topup_id = ? AND status = 'awaiting_success' ORDER BY received_seq")
      .all(topup.id) as RefundRow[];
    for (const r of parked) this.applyRefund(topup, r);
    return parked.length ? 'credited_and_applied_parked_refunds' : 'credited';
  }

  private recordRefund(topup: TopupRow, refundId: string, amountMinor: number): string {
    if (this.db.prepare('SELECT 1 FROM refunds WHERE refund_id = ?').get(refundId)) return 'duplicate_refund';
    if (topup.status === 'failed') return 'ignored_refund_on_failed_topup';

    const total = (this.db
      .prepare("SELECT COALESCE(SUM(amount_minor), 0) AS t FROM refunds WHERE topup_id = ? AND status <> 'rejected'")
      .get(topup.id) as { t: number }).t;
    const seq = (this.db.prepare('SELECT COALESCE(MAX(received_seq), 0) + 1 AS n FROM refunds').get() as { n: number }).n;
    const insert = this.db.prepare('INSERT INTO refunds (refund_id, topup_id, amount_minor, status, received_seq) VALUES (?, ?, ?, ?, ?)');

    if (total + amountMinor > topup.amount_minor) {
      insert.run(refundId, topup.id, amountMinor, 'rejected', seq);
      return 'refund_exceeds_topup';
    }
    if (topup.status === 'pending') {
      insert.run(refundId, topup.id, amountMinor, 'awaiting_success', seq);
      return 'refund_parked_until_success';
    }
    insert.run(refundId, topup.id, amountMinor, 'awaiting_success', seq);
    this.applyRefund(topup, { refund_id: refundId, amount_minor: amountMinor });
    return 'refund_applied';
  }

  /**
   * Takes refunded money back from the wallet. If the user has already spent some of it, we
   * claw back only what is there (wallets never go negative) and book the rest as a receivable
   * owed by the user, so our books still match what the provider took from us.
   */
  private applyRefund(topup: TopupRow, refund: RefundRow): void {
    const wallet = walletAccountId(topup.user_id);
    const clawBack = Math.min(refund.amount_minor, this.ledger.balance(wallet));
    const shortfall = refund.amount_minor - clawBack;
    const entries = [];
    if (clawBack > 0) {
      entries.push({ debitAccountId: wallet, creditAccountId: clearingAccountId(topup.currency), amountMinor: clawBack, currency: topup.currency });
    }
    if (shortfall > 0) {
      entries.push({
        debitAccountId: `sys:receivable:${topup.currency}`,
        creditAccountId: clearingAccountId(topup.currency),
        amountMinor: shortfall,
        currency: topup.currency,
      });
    }
    this.ledger.post({ kind: 'refund', ref: `refund:${refund.refund_id}`, entries }, this.clock().toISOString());
    this.db
      .prepare("UPDATE refunds SET status = 'applied', clawed_back_minor = ?, shortfall_minor = ? WHERE refund_id = ?")
      .run(clawBack, shortfall, refund.refund_id);
  }
}
