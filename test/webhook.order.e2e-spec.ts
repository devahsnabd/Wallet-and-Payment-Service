import { clearingAccountId, receivableAccountId, walletAccountId } from '../src/database/connection';
import {
  TestCtx, assertLedgerSound, balance, createTestApp, createTopup, createUser, eventId, fund, ledgerAccountBalance, refund, succeed, webhook,
} from './helpers/test-app';

describe('provider webhook: ordering, duplicates and refunds', () => {
  let t: TestCtx;
  const creditTxns = () => (t.db.prepare("SELECT COUNT(*) AS n FROM ledger_transactions WHERE kind = 'topup'").get() as { n: number }).n;

  beforeEach(async () => {
    t = await createTestApp();
    await createUser(t, 'alice', 'NGN');
    await createUser(t, 'bob', 'NGN');
  });
  afterEach(async () => { assertLedgerSound(t.db); await t.close(); });

  it('credits exactly once and ignores a duplicate delivery of the same event', async () => {
    const ref = await createTopup(t, 'alice', 5000);
    expect(await balance(t, 'alice')).toBe(0); // pending top-ups do not touch the ledger
    const id = eventId();
    const first = await succeed(t, ref, id);
    const dup = await succeed(t, ref, id);
    expect(first.status).toBe(200);
    expect(dup.status).toBe(200);
    expect(dup.body.outcome).toBe('duplicate_event');
    expect(await balance(t, 'alice')).toBe(5000);
    expect(creditTxns()).toBe(1);
  });

  it('credits once even when the provider re-sends success under a new event id', async () => {
    const ref = await createTopup(t, 'alice', 5000);
    await succeed(t, ref);
    const again = await succeed(t, ref);
    expect(again.body.outcome).toBe('already_succeeded');
    expect(await balance(t, 'alice')).toBe(5000);
    expect(creditTxns()).toBe(1);
  });

  it('handles "refunded" arriving BEFORE "succeeded": same end state as normal order', async () => {
    const ref = await createTopup(t, 'alice', 5000);
    const early = await refund(t, ref, 'rf_1', 2000);
    expect(early.status).toBe(200);
    expect(early.body.outcome).toBe('refund_parked_until_success');
    expect(await balance(t, 'alice')).toBe(0); // nothing credited yet, nothing clawed back

    const late = await succeed(t, ref);
    expect(late.body.outcome).toBe('credited_and_applied_parked_refunds');
    expect(await balance(t, 'alice')).toBe(3000); // 5000 credited, 2000 refunded
    expect(creditTxns()).toBe(1);

    // Normal order for comparison.
    const ref2 = await createTopup(t, 'bob', 5000);
    await succeed(t, ref2);
    await refund(t, ref2, 'rf_2', 2000);
    expect(await balance(t, 'bob')).toBe(await balance(t, 'alice'));
  });

  it('applies a refund once even if it is delivered twice under different event ids', async () => {
    const ref = await fund(t, 'alice', 5000);
    await refund(t, ref, 'rf_1', 1000);
    const dup = await refund(t, ref, 'rf_1', 1000);
    expect(dup.body.outcome).toBe('duplicate_refund');
    expect(await balance(t, 'alice')).toBe(4000);
  });

  it('partial refund after the money was spent: claws back what is left, books the rest as a receivable', async () => {
    const ref = await fund(t, 'alice', 5000);
    const spend = await t.http.post('/transfers').set('Idempotency-Key', 's1').send({ fromUserId: 'alice', toUserId: 'bob', amountMinor: 4000, currency: 'NGN' });
    expect(spend.status).toBe(201);

    const res = await refund(t, ref, 'rf_1', 3000);
    expect(res.status).toBe(200);
    expect(await balance(t, 'alice')).toBe(0); // 1000 was left and is clawed back; never negative
    expect(await balance(t, 'bob')).toBe(4000); // bob is untouched
    expect(ledgerAccountBalance(t.db, receivableAccountId('NGN'))).toBe(-2000); // 2000 owed by the user (asset, debit-normal)
    expect(ledgerAccountBalance(t.db, clearingAccountId('NGN'))).toBe(-2000); // provider still holds 5000 - 3000
    const row = t.db.prepare("SELECT clawed_back_minor AS c, shortfall_minor AS s FROM refunds WHERE refund_id = 'rf_1'").get();
    expect(row).toEqual({ c: 1000, s: 2000 });
  });

  it('rejects refunds that would exceed the original top-up', async () => {
    const ref = await fund(t, 'alice', 5000);
    await refund(t, ref, 'rf_1', 4000);
    const over = await refund(t, ref, 'rf_2', 2000);
    expect(over.body.outcome).toBe('refund_exceeds_topup');
    expect(await balance(t, 'alice')).toBe(1000);
  });

  it('a failed top-up never credits, and a late success does not resurrect it', async () => {
    const ref = await createTopup(t, 'alice', 5000);
    await webhook(t, { eventId: eventId(), type: 'payment.failed', providerRef: ref });
    const late = await succeed(t, ref);
    expect(late.body.outcome).toBe('ignored_success_after_failure');
    expect(await balance(t, 'alice')).toBe(0);
  });

  it('acknowledges an unknown provider reference with 200 so the provider stops retrying', async () => {
    const res = await succeed(t, 'prv_does_not_exist');
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('unknown_reference');
  });

  it('rejects a malformed but correctly signed event with 400', async () => {
    const res = await webhook(t, { eventId: eventId(), type: 'payment.refunded', providerRef: 'x' });
    expect(res.status).toBe(400);
  });

  it('wallet ledger credit uses a unique reference so a second credit is impossible at the database level', async () => {
    const ref = await fund(t, 'alice', 5000);
    const topup = t.db.prepare('SELECT id FROM topups WHERE provider_ref = ?').get(ref) as { id: string };
    expect(() =>
      t.db.prepare('INSERT INTO ledger_transactions (kind, idempotency_ref, created_at) VALUES (?, ?, ?)').run('topup', `topup:${topup.id}:credit`, 'now'),
    ).toThrow(/UNIQUE/);
    expect(ledgerAccountBalance(t.db, walletAccountId('alice'))).toBe(5000);
  });
});
