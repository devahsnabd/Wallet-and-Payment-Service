import Database from 'better-sqlite3';
import { CURRENCIES } from '../common/money';
import { SCHEMA } from './schema';

export type Db = Database.Database;

export const clearingAccountId = (currency: string) => `sys:clearing:${currency}`;
export const receivableAccountId = (currency: string) => `sys:receivable:${currency}`;
export const walletAccountId = (userId: string) => `wallet:${userId}`;

export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 10000');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  const seed = db.prepare('INSERT OR IGNORE INTO accounts (id, kind, user_id, currency) VALUES (?, ?, NULL, ?)');
  for (const c of CURRENCIES) {
    seed.run(clearingAccountId(c), 'provider_clearing', c);
    seed.run(receivableAccountId(c), 'refund_receivable', c);
  }
  return db;
}

/** Runs fn inside BEGIN IMMEDIATE: the write lock is taken before anything is read. */
export function immediate<T>(db: Db, fn: () => T): T {
  return db.transaction(fn).immediate();
}
