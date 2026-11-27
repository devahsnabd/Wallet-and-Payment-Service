import { AppError } from '../common/app-error';
import { Currency } from '../common/money';
import { Db, immediate, walletAccountId } from '../database/connection';
import { Ledger } from '../ledger/ledger.core';

export class UsersCore {
  private readonly ledger: Ledger;
  constructor(private readonly db: Db) {
    this.ledger = new Ledger(db);
  }

  create(id: string, currency: Currency) {
    return immediate(this.db, () => {
      if (this.db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) {
        throw new AppError('USER_EXISTS', 409, `User ${id} already exists`);
      }
      this.db.prepare('INSERT INTO users (id, currency) VALUES (?, ?)').run(id, currency);
      this.db
        .prepare("INSERT INTO accounts (id, kind, user_id, currency) VALUES (?, 'user_wallet', ?, ?)")
        .run(walletAccountId(id), id, currency);
      return { userId: id, currency };
    });
  }

  wallet(id: string) {
    const user = this.db.prepare('SELECT id, currency FROM users WHERE id = ?').get(id) as
      | { id: string; currency: Currency }
      | undefined;
    if (!user) throw new AppError('USER_NOT_FOUND', 404, `User ${id} not found`);
    return { userId: user.id, currency: user.currency, balanceMinor: this.ledger.balance(walletAccountId(id)) };
  }
}
