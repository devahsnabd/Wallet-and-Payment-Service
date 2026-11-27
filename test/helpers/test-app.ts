import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { Db, openDb } from '../../src/database/connection';
import { DEV_WEBHOOK_SECRET } from '../../src/config/env';
import { CLOCK, DB_HANDLE } from '../../src/database/infra.module';
import { sign } from '../../src/webhooks/signature';

export const SECRET = DEV_WEBHOOK_SECRET;

export interface TestCtx {
  app: INestApplication;
  db: Db;
  http: ReturnType<typeof request>;
  setNow(iso: string): void;
  close(): Promise<void>;
}

export async function createTestApp(dbPath = ':memory:'): Promise<TestCtx> {
  const db = openDb(dbPath);
  let now = new Date('2026-11-26T10:00:00Z');
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DB_HANDLE).useValue(db)
    .overrideProvider(CLOCK).useValue(() => now)
    .compile();
  const app = mod.createNestApplication({ rawBody: true });
  await app.init();
  return {
    app,
    db,
    http: request(app.getHttpServer()),
    setNow: (iso) => { now = new Date(iso); },
    close: async () => { await app.close(); }, // shutdown hook closes the DB
  };
}

export const createUser = (t: TestCtx, id: string, currency: 'NGN' | 'USD') => t.http.post('/users').send({ id, currency });

/** Posts a provider webhook signed over the exact bytes sent. */
export function webhook(t: TestCtx, payload: object, secret = SECRET) {
  const raw = JSON.stringify(payload);
  return t.http.post('/webhooks/provider').set('Content-Type', 'application/json').set('X-Signature', sign(raw, secret)).send(raw);
}

let evt = 0;
export const eventId = () => `evt_${++evt}`;

export async function createTopup(t: TestCtx, userId: string, amountMinor: number, currency: 'NGN' | 'USD' = 'NGN') {
  const res = await t.http.post('/topups').send({ userId, amountMinor, currency });
  expect(res.status).toBe(201);
  return res.body.providerRef as string;
}

export const succeed = (t: TestCtx, providerRef: string, id = eventId()) =>
  webhook(t, { eventId: id, type: 'payment.succeeded', providerRef });
export const refund = (t: TestCtx, providerRef: string, refundId: string, amountMinor: number, id = eventId()) =>
  webhook(t, { eventId: id, type: 'payment.refunded', providerRef, refundId, amountMinor });

/** Creates a top-up and confirms it, so the wallet holds the given amount. */
export async function fund(t: TestCtx, userId: string, amountMinor: number, currency: 'NGN' | 'USD' = 'NGN') {
  const ref = await createTopup(t, userId, amountMinor, currency);
  const res = await succeed(t, ref);
  expect(res.status).toBe(200);
  return ref;
}

export const balance = async (t: TestCtx, userId: string) => (await t.http.get(`/wallets/${userId}`)).body.balanceMinor as number;

/** Ledger invariants that must hold after every scenario. */
export function assertLedgerSound(db: Db) {
  const rows = db.prepare('SELECT account_id, kind, currency, balance_minor FROM account_balances').all() as {
    account_id: string; kind: string; currency: string; balance_minor: number;
  }[];
  for (const r of rows) if (r.kind === 'user_wallet') expect(r.balance_minor).toBeGreaterThanOrEqual(0);
  for (const currency of ['NGN', 'USD']) {
    const sum = rows.filter((r) => r.currency === currency).reduce((a, r) => a + r.balance_minor, 0);
    expect(sum).toBe(0); // every entry debits one account and credits another, so all balances sum to zero
  }
}

export const ledgerAccountBalance = (db: Db, id: string) =>
  (db.prepare('SELECT balance_minor AS b FROM account_balances WHERE account_id = ?').get(id) as { b: number }).b;
