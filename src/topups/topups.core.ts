import { randomUUID } from 'node:crypto';
import { AppError } from '../common/app-error';
import { Currency } from '../common/money';
import { Db, immediate } from '../database/connection';
import type { Clock } from '../database/infra.module';

export interface LocalTopup {
  providerRef: string;
  amountMinor: number;
  currency: string;
  creditedAt: string;
}

export class TopupsCore {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock = () => new Date(),
  ) {}

  /** Creates a pending top-up. Nothing touches the ledger until the provider confirms success. */
  create(userId: string, amountMinor: number, currency: Currency, opts: { providerRef?: string } = {}) {
    return immediate(this.db, () => {
      const user = this.db.prepare('SELECT currency FROM users WHERE id = ?').get(userId) as { currency: string } | undefined;
      if (!user) throw new AppError('USER_NOT_FOUND', 404, `User ${userId} not found`);
      if (user.currency !== currency) throw new AppError('CURRENCY_MISMATCH', 422, 'Top-up currency must match the wallet currency');
      const id = `tu_${randomUUID()}`;
      const providerRef = opts.providerRef ?? `prv_${randomUUID().replace(/-/g, '')}`; // opts is for seeding only, not exposed over HTTP
      this.db
        .prepare("INSERT INTO topups (id, user_id, provider_ref, amount_minor, currency, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)")
        .run(id, userId, providerRef, amountMinor, currency, this.clock().toISOString());
      return { topupId: id, providerRef, userId, amountMinor, currency, status: 'pending' as const };
    });
  }

  /** Successful top-ups credited during the given UTC day (YYYY-MM-DD). */
  succeededOn(date: string): LocalTopup[] {
    return this.db
      .prepare(
        "SELECT provider_ref AS providerRef, amount_minor AS amountMinor, currency, credited_at AS creditedAt FROM topups WHERE status = 'succeeded' AND substr(credited_at, 1, 10) = ? ORDER BY credited_at",
      )
      .all(date) as LocalTopup[];
  }
}
