import { AppError } from '../common/app-error';
import { Db } from '../database/connection';

export interface LedgerEntryInput {
  debitAccountId: string;
  creditAccountId: string;
  amountMinor: number;
  currency: string;
}

/**
 * Double-entry ledger. Each entry debits one account and credits another for the same amount,
 * so the books balance by construction. Balance = credits - debits, always derived.
 */
export class Ledger {
  constructor(private readonly db: Db) {}

  balance(accountId: string): number {
    const row = this.db
      .prepare('SELECT balance_minor AS b FROM account_balances WHERE account_id = ?')
      .get(accountId) as { b: number } | undefined;
    if (!row) throw new AppError('ACCOUNT_NOT_FOUND', 404, `Unknown account ${accountId}`);
    return row.b;
  }

  /**
   * Posts a ledger transaction. MUST be called inside an IMMEDIATE transaction: the balance
   * check below and the insert have to happen under the same write lock, otherwise two
   * concurrent debits could both pass the check.
   */
  post(input: { kind: string; ref?: string; entries: LedgerEntryInput[] }, nowIso: string): number {
    if (!this.db.inTransaction) throw new Error('Ledger.post must run inside a transaction');

    const txn = this.db
      .prepare('INSERT INTO ledger_transactions (kind, idempotency_ref, created_at) VALUES (?, ?, ?)')
      .run(input.kind, input.ref ?? null, nowIso);
    const txnId = Number(txn.lastInsertRowid);

    const account = this.db.prepare('SELECT kind, currency FROM accounts WHERE id = ?');
    const insert = this.db.prepare(
      'INSERT INTO ledger_entries (txn_id, debit_account_id, credit_account_id, amount_minor, currency) VALUES (?, ?, ?, ?, ?)',
    );
    for (const e of input.entries) {
      const debit = account.get(e.debitAccountId) as { kind: string; currency: string } | undefined;
      const credit = account.get(e.creditAccountId) as { kind: string; currency: string } | undefined;
      if (!debit || !credit) throw new AppError('ACCOUNT_NOT_FOUND', 404, 'Unknown ledger account');
      if (debit.currency !== e.currency || credit.currency !== e.currency) {
        throw new AppError('CURRENCY_MISMATCH', 422, 'Ledger entry currency does not match its accounts');
      }
      if (debit.kind === 'user_wallet' && this.balance(e.debitAccountId) < e.amountMinor) {
        throw new AppError('INSUFFICIENT_FUNDS', 422, 'Insufficient funds');
      }
      insert.run(txnId, e.debitAccountId, e.creditAccountId, e.amountMinor, e.currency);
    }
    return txnId;
  }
}
