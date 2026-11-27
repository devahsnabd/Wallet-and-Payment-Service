import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { parseEnv } from './config/env';
import { InfraModule } from './database/infra.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { TopupsModule } from './topups/topups.module';
import { TransfersModule } from './transfers/transfers.module';
import { UsersModule } from './users/users.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    // Loads .env (if present) and validates every variable at startup.
    ConfigModule.forRoot({ isGlobal: true, validate: (raw) => parseEnv(raw) }),
    InfraModule, UsersModule, TransfersModule, TopupsModule, WebhooksModule, ReconciliationModule],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
