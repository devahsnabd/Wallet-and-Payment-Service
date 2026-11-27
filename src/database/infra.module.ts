import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Env } from '../config/env';
import { Db, openDb } from './connection';

export const DB_HANDLE = Symbol('DB_HANDLE');
export const CLOCK = Symbol('CLOCK');
export const WEBHOOK_SECRET = Symbol('WEBHOOK_SECRET');

export type Clock = () => Date;

/** Closes the SQLite handle when the app shuts down (needs app.enableShutdownHooks() in main.ts). */
class DatabaseShutdown implements OnApplicationShutdown {
  constructor(@Inject(DB_HANDLE) private readonly db: Db) {}
  onApplicationShutdown(): void {
    if (this.db.open) this.db.close();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DB_HANDLE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const path = config.get('DB_PATH', { infer: true });
        if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
        return openDb(path);
      },
    },
    { provide: CLOCK, useValue: (() => new Date()) as Clock },
    {
      provide: WEBHOOK_SECRET,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => config.get('PROVIDER_WEBHOOK_SECRET', { infer: true }),
    },
    DatabaseShutdown,
  ],
  exports: [DB_HANDLE, CLOCK, WEBHOOK_SECRET],
})
export class InfraModule {}
