import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ZodType, z } from 'zod';

/** Turns a zod request schema into an OpenAPI 3.0 schema, so the docs can never drift from the validation. */
export function toOpenApi(schema: ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...json } = z.toJSONSchema(schema, { io: 'input', target: 'openapi-3.0' }) as Record<string, unknown>;
  return json;
}

/** Shape of every error response (see AllExceptionsFilter). */
export const ERROR_SCHEMA = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: { code: { type: 'string', example: 'INSUFFICIENT_FUNDS' }, message: { type: 'string' } },
      required: ['code', 'message'],
    },
  },
  required: ['error'],
};

export function buildSwaggerDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Wallet and payments service')
    .setDescription(
      'Wallets, idempotent transfers, provider top-ups with HMAC-signed webhooks, and daily reconciliation. ' +
        'All amounts are whole minor units (kobo, cents). Errors are `{ error: { code, message } }`.',
    )
    .setVersion('1.0')
    .build();
  return SwaggerModule.createDocument(app, config);
}

/** Serves Swagger UI at /docs and the raw document at /docs-json. */
export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup('docs', app, buildSwaggerDocument(app), { jsonDocumentUrl: 'docs-json' });
}
