import { createHash } from 'node:crypto';
import { AppError } from '../common/app-error';
import { Currency } from '../common/money';
import { Db, immediate, walletAccountId } from '../database/connection';
import type { Clock } from '../database/infra.module';
import { Ledger } from '../ledger/ledger.core';

export interface TransferRequest {
  fromUserId: string;
  toUserId: string;
  amountMinor: number;
  currency: Currency;
}
export interface StoredResponse {
  status: number;
  body: unknown;
  replayed: boolean;
}

const ROUTE = 'POST /transfers';

export class TransfersCore {
  private readonly ledger: Ledger;
  constructor(
    private readonly db: Db,
    private readonly clock: Clock = () => new Date(),
  ) {
    this.ledger = new Ledger(db);
  }

  /**
   * Idempotent transfer.
   *
   * Everything (idempotency lookup, balance check, ledger write, storing the response) happens
   * in ONE write transaction. SQLite allows a single writer, and BEGIN IMMEDIATE takes that lock
   * up front, so:
   *  - two transfers from the same wallet are serialised: the second sees the first one's debit
   *    and is refused if it would overdraw;
   *  - a duplicate request (same key) that arrives while the first is running simply waits for
   *    the lock, then finds the stored response and returns it. There is no "in progress"
   *    state that anyone can observe because the first request commits atomically.
   */
  execute(key: string, req: TransferRequest): StoredResponse {
    const hash = requestHash(req);
    return immediate(this.db, () => {
      const existing = this.db
        .prepare('SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE key = ? AND route = ?')
        .get(key, ROUTE) as { request_hash: string; response_status: number; response_body: string } | undefined;

      if (existing) {
        if (existing.request_hash !== hash) {
          throw new AppError('IDEMPOTENCY_KEY_REUSED', 409, 'Idempotency-Key was already used with a different request body');
        }
        return { status: existing.response_status, body: JSON.parse(existing.response_body), replayed: true };
      }

      let status: number;
      let body: unknown;
      try {
        // Savepoint: if the transfer is refused, none of its writes survive, but we still
        // record the refusal against the key so a retry gets the same answer.
        body = this.db.transaction(() => this.move(req))();
        status = 201;
      } catch (e) {
        if (!(e instanceof AppError)) throw e; // unexpected errors are not stored; the client may retry
        status = e.status;
        body = { error: { code: e.code, message: e.message } };
      }
      this.db
        .prepare('INSERT INTO idempotency_keys (key, route, request_hash, response_status, response_body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(key, ROUTE, hash, status, JSON.stringify(body), this.clock().toISOString());
      return { status, body, replayed: false };
    });
  }

  private move(req: TransferRequest) {
    if (req.fromUserId === req.toUserId) throw new AppError('SAME_WALLET', 422, 'Cannot transfer to the same wallet');
    const user = this.db.prepare('SELECT currency FROM users WHERE id = ?');
    const from = user.get(req.fromUserId) as { currency: string } | undefined;
    const to = user.get(req.toUserId) as { currency: string } | undefined;
    if (!from) throw new AppError('USER_NOT_FOUND', 404, `User ${req.fromUserId} not found`);
    if (!to) throw new AppError('USER_NOT_FOUND', 404, `User ${req.toUserId} not found`);
    if (from.currency !== req.currency || to.currency !== req.currency) {
      throw new AppError('CURRENCY_MISMATCH', 422, 'Both wallets and the transfer must use the same currency');
    }
    const now = this.clock().toISOString();
    const transferId = this.ledger.post(
      {
        kind: 'transfer',
        entries: [
          {
            debitAccountId: walletAccountId(req.fromUserId),
            creditAccountId: walletAccountId(req.toUserId),
            amountMinor: req.amountMinor,
            currency: req.currency,
          },
        ],
      },
      now,
    );
    return { transferId, ...req, createdAt: now };
  }
}

/** Hash over a fixed field order so key ordering in the JSON body cannot matter. */
export function requestHash(r: TransferRequest): string {
  return createHash('sha256')
    .update(JSON.stringify([r.fromUserId, r.toUserId, r.amountMinor, r.currency]))
    .digest('hex');
}
