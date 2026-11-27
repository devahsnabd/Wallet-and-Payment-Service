import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { Db, clearingAccountId, immediate, openDb, walletAccountId } from '../src/database/connection';
import { Ledger } from '../src/ledger/ledger.core';
import { UsersCore } from '../src/users/users.core';
import { TestCtx, assertLedgerSound, balance, createTestApp, createUser, fund, ledgerAccountBalance } from './helpers/test-app';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Starts n workers (each with its own DB connection), releases them together, collects results. */
async function raceTransfers(dbPath: string, n: number, amountMinor: number, from = 'alice') {
  const barrier = new SharedArrayBuffer(8);
  const flags = new Int32Array(barrier);
  const workers = Array.from({ length: n }, (_, i) => {
    const w = new Worker(join(__dirname, 'helpers/transfer.worker.js'), {
      workerData: { dbPath, key: `race-${i}`, fromUserId: from, toUserId: `sink${i % 3}`, amountMinor, currency: 'NGN', barrier },
    });
    return new Promise<{ status: number; body: any }>((resolve, reject) => {
      w.once('message', resolve);
      w.once('error', reject);
    });
  });
  while (Atomics.load(flags, 0) < n) await sleep(10); // wait until every worker is connected and parked
  Atomics.store(flags, 1, 1);
  Atomics.notify(flags, 1);
  return Promise.all(workers);
}

describe('concurrent transfers never overdraw', () => {
  let dir: string;
  let dbPath: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wallet-race-'));
    dbPath = join(dir, 'race.db');
    db = openDb(dbPath);
    const users = new UsersCore(db);
    users.create('alice', 'NGN');
    for (const s of ['sink0', 'sink1', 'sink2']) users.create(s, 'NGN');
    // Give alice 100 directly through the ledger.
    immediate(db, () =>
      new Ledger(db).post(
        { kind: 'topup', ref: 'seed', entries: [{ debitAccountId: clearingAccountId('NGN'), creditAccountId: walletAccountId('alice'), amountMinor: 100, currency: 'NGN' }] },
        new Date().toISOString(),
      ),
    );
  });
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

  it('8 simultaneous transfers of 80 from a balance of 100: exactly one succeeds', async () => {
    const results = await raceTransfers(dbPath, 8, 80);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const refused = results.filter((r) => r.status === 422);
    expect(refused).toHaveLength(7);
    for (const r of refused) expect(r.body.error.code).toBe('INSUFFICIENT_FUNDS');
    expect(ledgerAccountBalance(db, walletAccountId('alice'))).toBe(20);
    assertLedgerSound(db);
  });

  it('20 simultaneous transfers of 10 from a balance of 100: exactly ten succeed and the wallet ends at 0', async () => {
    const results = await raceTransfers(dbPath, 20, 10);
    expect(results.filter((r) => r.status === 201)).toHaveLength(10);
    expect(results.filter((r) => r.status === 422)).toHaveLength(10);
    expect(ledgerAccountBalance(db, walletAccountId('alice'))).toBe(0);
    assertLedgerSound(db);
  });

  it('the database itself refuses an overdraw even if application code forgets to check', () => {
    expect(() =>
      immediate(db, () =>
        db.prepare('INSERT INTO ledger_transactions (kind, created_at) VALUES (?, ?)').run('rogue', 'now') &&
        db.prepare('INSERT INTO ledger_entries (txn_id, debit_account_id, credit_account_id, amount_minor, currency) VALUES (1, ?, ?, 101, ?)')
          .run(walletAccountId('alice'), walletAccountId('sink0'), 'NGN'),
      ),
    ).toThrow(/NEGATIVE_BALANCE/);
  });
});

describe('concurrent HTTP requests', () => {
  let t: TestCtx;
  beforeEach(async () => {
    t = await createTestApp();
    await createUser(t, 'alice', 'NGN');
    await createUser(t, 'bob', 'NGN');
    await fund(t, 'alice', 100);
  });
  afterEach(async () => { assertLedgerSound(t.db); await t.close(); });

  it('two parallel requests of 80 with different keys: one 201, one 422', async () => {
    const send = (k: string) => t.http.post('/transfers').set('Idempotency-Key', k).send({ fromUserId: 'alice', toUserId: 'bob', amountMinor: 80, currency: 'NGN' });
    const [a, b] = await Promise.all([send('a'), send('b')]);
    expect([a.status, b.status].sort()).toEqual([201, 422]);
    expect(await balance(t, 'alice')).toBe(20);
    expect(await balance(t, 'bob')).toBe(80);
  });
});
