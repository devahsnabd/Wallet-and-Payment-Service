import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { Env } from './config/env';
import { setupSwagger } from './common/openapi';

async function bootstrap() {
  // rawBody: true keeps the exact request bytes on req.rawBody, which the webhook HMAC needs.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableShutdownHooks(); // lets providers (the SQLite handle) clean up on SIGTERM/SIGINT
  // Swagger UI at /docs and JSON at /docs-json; off in production.
  if (process.env.NODE_ENV !== 'production') setupSwagger(app);
  const port = app.get(ConfigService<Env, true>).get('PORT', { infer: true });
  await app.listen(port);
  console.log(`wallet-service listening on :${port}`);
}
void bootstrap();
