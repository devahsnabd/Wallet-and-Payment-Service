import { sign } from '../src/webhooks/signature';
import { SECRET, TestCtx, balance, createTestApp, createTopup, createUser, eventId } from './helpers/test-app';

describe('webhook signature verification', () => {
  let t: TestCtx;
  let ref: string;
  const events = () => (t.db.prepare('SELECT COUNT(*) AS n FROM webhook_events').get() as { n: number }).n;

  beforeEach(async () => {
    t = await createTestApp();
    await createUser(t, 'alice', 'NGN');
    ref = await createTopup(t, 'alice', 5000);
  });
  afterEach(() => t.close());

  const payload = () => JSON.stringify({ eventId: eventId(), type: 'payment.succeeded', providerRef: ref });
  const post = (raw: string, sig?: string) => {
    const r = t.http.post('/webhooks/provider').set('Content-Type', 'application/json');
    if (sig !== undefined) r.set('X-Signature', sig);
    return r.send(raw);
  };

  it('rejects a wrong signature with 401 and changes nothing', async () => {
    const raw = payload();
    const res = await post(raw, sign(raw, 'some-other-secret'));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
    expect(await balance(t, 'alice')).toBe(0);
    expect(events()).toBe(0);
  });

  it('rejects a missing signature header', async () => {
    expect((await post(payload())).status).toBe(401);
    expect(events()).toBe(0);
  });

  it('rejects a body that was altered after signing', async () => {
    const raw = payload();
    const sig = sign(raw, SECRET);
    const tampered = raw.replace('payment.succeeded', 'payment.failed');
    expect((await post(tampered, sig)).status).toBe(401);
    expect(events()).toBe(0);
  });

  it('rejects non-hex and wrong-length signatures without throwing', async () => {
    const raw = payload();
    expect((await post(raw, 'not-hex!!')).status).toBe(401);
    expect((await post(raw, 'abcd')).status).toBe(401);
  });

  it('signs the raw bytes: a differently formatted but equivalent JSON body needs its own signature', async () => {
    const compact = payload();
    const spaced = JSON.stringify(JSON.parse(compact), null, 2);
    expect((await post(spaced, sign(compact, SECRET))).status).toBe(401);
    expect((await post(spaced, sign(spaced, SECRET))).status).toBe(200);
  });

  it('accepts a correct signature', async () => {
    const raw = payload();
    const res = await post(raw, sign(raw, SECRET));
    expect(res.status).toBe(200);
    expect(await balance(t, 'alice')).toBe(5000);
  });
});
