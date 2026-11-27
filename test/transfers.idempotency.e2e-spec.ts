import { TestCtx, assertLedgerSound, balance, createTestApp, createUser, fund } from './helpers/test-app';

describe('POST /transfers idempotency and validation', () => {
  let t: TestCtx;
  const body = { fromUserId: 'alice', toUserId: 'bob', amountMinor: 3000, currency: 'NGN' };
  const transferCount = () => (t.db.prepare("SELECT COUNT(*) AS n FROM ledger_transactions WHERE kind = 'transfer'").get() as { n: number }).n;

  beforeEach(async () => {
    t = await createTestApp();
    await createUser(t, 'alice', 'NGN');
    await createUser(t, 'bob', 'NGN');
    await createUser(t, 'dollar', 'USD');
    await fund(t, 'alice', 10000);
  });
  afterEach(async () => { assertLedgerSound(t.db); await t.close(); });

  it('returns exactly the first response when the same key and body are retried', async () => {
    const first = await t.http.post('/transfers').set('Idempotency-Key', 'k1').send(body);
    const retry = await t.http.post('/transfers').set('Idempotency-Key', 'k1').send(body);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body).toEqual(first.body);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(transferCount()).toBe(1);
    expect(await balance(t, 'alice')).toBe(7000);
    expect(await balance(t, 'bob')).toBe(3000);
  });

  it('treats JSON key order as irrelevant for the same body', async () => {
    const first = await t.http.post('/transfers').set('Idempotency-Key', 'k1').send(body);
    const reordered = { currency: 'NGN', amountMinor: 3000, toUserId: 'bob', fromUserId: 'alice' };
    const retry = await t.http.post('/transfers').set('Idempotency-Key', 'k1').send(reordered);
    expect(retry.body).toEqual(first.body);
    expect(transferCount()).toBe(1);
  });

  it('returns 409 when the same key is reused with a different body', async () => {
    await t.http.post('/transfers').set('Idempotency-Key', 'k1').send(body);
    const res = await t.http.post('/transfers').set('Idempotency-Key', 'k1').send({ ...body, amountMinor: 3001 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(transferCount()).toBe(1);
  });

  it('collapses simultaneous identical requests into one transfer with identical responses', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => t.http.post('/transfers').set('Idempotency-Key', 'burst').send(body)),
    );
    for (const r of results) {
      expect(r.status).toBe(201);
      expect(r.body).toEqual(results[0].body);
    }
    expect(transferCount()).toBe(1);
    expect(await balance(t, 'alice')).toBe(7000);
  });

  it('replays a refusal for the same key rather than re-evaluating it', async () => {
    const big = { ...body, amountMinor: 50000 };
    const first = await t.http.post('/transfers').set('Idempotency-Key', 'k-big').send(big);
    expect(first.status).toBe(422);
    expect(first.body.error.code).toBe('INSUFFICIENT_FUNDS');
    await fund(t, 'alice', 100000);
    const retry = await t.http.post('/transfers').set('Idempotency-Key', 'k-big').send(big);
    expect(retry.status).toBe(422);
    expect(retry.body).toEqual(first.body);
    expect(transferCount()).toBe(0);
  });

  it.each([
    ['missing Idempotency-Key', undefined, body, 400, 'IDEMPOTENCY_KEY_REQUIRED'],
    ['float amount', 'k', { ...body, amountMinor: 10.5 }, 400, 'VALIDATION_ERROR'],
    ['negative amount', 'k', { ...body, amountMinor: -5 }, 400, 'VALIDATION_ERROR'],
    ['zero amount', 'k', { ...body, amountMinor: 0 }, 400, 'VALIDATION_ERROR'],
    ['string amount', 'k', { ...body, amountMinor: '100' }, 400, 'VALIDATION_ERROR'],
    ['unsupported currency', 'k', { ...body, currency: 'EUR' }, 400, 'VALIDATION_ERROR'],
    ['unknown extra field', 'k', { ...body, note: 'x' }, 400, 'VALIDATION_ERROR'],
    ['same wallet', 'k', { ...body, toUserId: 'alice' }, 422, 'SAME_WALLET'],
    ['unknown recipient', 'k', { ...body, toUserId: 'nobody' }, 404, 'USER_NOT_FOUND'],
    ['cross-currency recipient', 'k', { ...body, toUserId: 'dollar' }, 422, 'CURRENCY_MISMATCH'],
    ['currency differs from wallets', 'k', { ...body, currency: 'USD' }, 422, 'CURRENCY_MISMATCH'],
    ['overdraw', 'k', { ...body, amountMinor: 10001 }, 422, 'INSUFFICIENT_FUNDS'],
  ])('rejects: %s', async (_name, key, payload, status, code) => {
    const req = t.http.post('/transfers');
    if (key) req.set('Idempotency-Key', key);
    const res = await req.send(payload as object);
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
    expect(transferCount()).toBe(0);
  });
});
