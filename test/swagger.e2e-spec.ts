import { buildSwaggerDocument } from '../src/common/openapi';
import { TestCtx, createTestApp } from './helpers/test-app';

describe('OpenAPI document', () => {
  let t: TestCtx;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(() => t.close());

  it('documents every endpoint with request schemas generated from the zod validators', () => {
    const doc = buildSwaggerDocument(t.app) as any;
    for (const [path, method] of [['/users', 'post'], ['/wallets/{userId}', 'get'], ['/transfers', 'post'], ['/topups', 'post'], ['/webhooks/provider', 'post'], ['/reconciliation', 'post']]) {
      expect(doc.paths[path]?.[method]).toBeDefined();
    }
    const transfer = doc.paths['/transfers'].post;
    expect(transfer.parameters.map((p: any) => p.name)).toContain('Idempotency-Key');
    const body = transfer.requestBody.content['application/json'].schema;
    expect(body.properties.amountMinor.type).toBe('integer');
    expect(body.properties.currency.enum).toEqual(['NGN', 'USD']);
    expect(body.additionalProperties).toBe(false);
    expect(doc.paths['/webhooks/provider'].post.parameters.map((p: any) => p.name)).toContain('X-Signature');
  });
});
