import { rmSync } from 'node:fs';
import { openDb } from '../database/connection';
import { TopupsCore } from '../topups/topups.core';
import { UsersCore } from '../users/users.core';
import { WebhooksCore } from '../webhooks/webhooks.core';

// Deliberately NOT DB_PATH: this script deletes the file it writes, so it must never point at the real database.
const path = process.env.DEMO_DB_PATH ?? './data/demo.db';
for (const f of [path, `${path}-wal`, `${path}-shm`]) rmSync(f, { force: true });
const db = openDb(path);
const clock = () => new Date('2026-11-26T09:00:00Z');
const users = new UsersCore(db);
const topups = new TopupsCore(db, clock);
const webhooks = new WebhooksCore(db, clock);

users.create('demo-ngn', 'NGN');
users.create('demo-usd', 'USD');
const rows: [string, string, number, 'NGN' | 'USD'][] = [
  ['demo-ngn', 'prv_match_001', 500000, 'NGN'],
  ['demo-usd', 'prv_match_002', 2500, 'USD'],
  ['demo-ngn', 'prv_ours_only_003', 120000, 'NGN'],
  ['demo-ngn', 'prv_amount_004', 750000, 'NGN'],
];
let n = 0;
for (const [user, ref, amount, currency] of rows) {
  topups.create(user, amount, currency, { providerRef: ref });
  const ev = { eventId: `demo_evt_${++n}`, type: 'payment.succeeded' as const, providerRef: ref };
  webhooks.handle(ev, JSON.stringify(ev));
}
console.log(`Seeded ${path}`);
