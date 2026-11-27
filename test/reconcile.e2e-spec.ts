import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProviderReport, reconcile } from '../src/reconciliation/reconcile';
import { TestCtx, assertLedgerSound, createTestApp, createTopup, createUser, refund, succeed } from './helpers/test-app';

const DAY = '2026-11-26';

describe('daily reconciliation', () => {
  let t: TestCtx;
  beforeEach(async () => {
    t = await createTestApp();
    await createUser(t, 'alice', 'NGN');
    await createUser(t, 'dollar', 'USD');
    t.setNow(`${DAY}T10:00:00Z`);
  });
  afterEach(async () => { assertLedgerSound(t.db); await t.close(); });

  it('lists payments missing on either side and amount mismatches, end to end', async () => {
    const matched = await createTopup(t, 'alice', 500000);
    const oursOnly = await createTopup(t, 'alice', 120000);
    const mismatch = await createTopup(t, 'alice', 750000);
    const usdMismatch = await createTopup(t, 'dollar', 2500, 'USD');
    const pending = await createTopup(t, 'alice', 999); // never confirmed, so not "successful"
    const otherDay = await createTopup(t, 'alice', 1234);
    for (const r of [matched, oursOnly, mismatch, usdMismatch]) await succeed(t, r);
    t.setNow('2026-11-27T00:30:00Z');
    await succeed(t, otherDay); // credited the next day, outside the report window

    const report = {
      date: DAY,
      payments: [
        { providerRef: matched, amountMinor: 500000, currency: 'NGN', status: 'succeeded' },
        { providerRef: mismatch, amountMinor: 705000, currency: 'NGN', status: 'succeeded' },
        { providerRef: usdMismatch, amountMinor: 2500, currency: 'NGN', status: 'succeeded' }, // wrong currency
        { providerRef: 'prv_theirs_only', amountMinor: 90000, currency: 'NGN', status: 'succeeded' },
        { providerRef: pending, amountMinor: 999, currency: 'NGN', status: 'failed' }, // provider failed it too
      ],
    };
    const res = await t.http.post('/reconciliation').send(report);
    expect(res.status).toBe(200);
    expect(res.body.matched).toBe(1);
    expect(res.body.missingLocally).toEqual([{ providerRef: 'prv_theirs_only', amountMinor: 90000, currency: 'NGN' }]);
    expect(res.body.missingAtProvider).toEqual([{ providerRef: oursOnly, amountMinor: 120000, currency: 'NGN' }]);
    expect(res.body.amountMismatches).toEqual([
      { providerRef: mismatch, ourAmountMinor: 750000, providerAmountMinor: 705000, ourCurrency: 'NGN', providerCurrency: 'NGN' },
      { providerRef: usdMismatch, ourAmountMinor: 2500, providerAmountMinor: 2500, ourCurrency: 'USD', providerCurrency: 'NGN' },
    ]);
  });

  it('compares gross amounts: a refund does not create a mismatch', async () => {
    const ref = await createTopup(t, 'alice', 5000);
    await succeed(t, ref);
    await refund(t, ref, 'rf_1', 1000);
    const res = await t.http.post('/reconciliation').send({ date: DAY, payments: [{ providerRef: ref, amountMinor: 5000, currency: 'NGN', status: 'succeeded' }] });
    expect(res.body).toMatchObject({ matched: 1, missingLocally: [], missingAtProvider: [], amountMismatches: [] });
  });

  it('rejects a malformed report with 400', async () => {
    expect((await t.http.post('/reconciliation').send({ date: 'yesterday', payments: [] })).status).toBe(400);
  });
});

describe('reconcile() against the shipped fixture', () => {
  it('finds one of each discrepancy and one match per currency', () => {
    const report = ProviderReport.parse(JSON.parse(readFileSync(join(__dirname, '../fixtures/provider-report.json'), 'utf8')));
    const local = [
      { providerRef: 'prv_match_001', amountMinor: 500000, currency: 'NGN', creditedAt: `${DAY}T09:00:00Z` },
      { providerRef: 'prv_match_002', amountMinor: 2500, currency: 'USD', creditedAt: `${DAY}T09:00:00Z` },
      { providerRef: 'prv_ours_only_003', amountMinor: 120000, currency: 'NGN', creditedAt: `${DAY}T09:00:00Z` },
      { providerRef: 'prv_amount_004', amountMinor: 750000, currency: 'NGN', creditedAt: `${DAY}T09:00:00Z` },
    ];
    const r = reconcile(DAY, local, report);
    expect(r.matched).toBe(2);
    expect(r.missingLocally.map((x) => x.providerRef)).toEqual(['prv_theirs_only_005']);
    expect(r.missingAtProvider.map((x) => x.providerRef)).toEqual(['prv_ours_only_003']);
    expect(r.amountMismatches.map((x) => x.providerRef)).toEqual(['prv_amount_004']);
  });
});
