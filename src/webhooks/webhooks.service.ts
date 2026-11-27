import { Inject, Injectable } from '@nestjs/common';
import { Db } from '../database/connection';
import { CLOCK, Clock, DB_HANDLE } from '../database/infra.module';
import { WebhookEvent, WebhooksCore } from './webhooks.core';

@Injectable()
export class WebhooksService {
  private readonly core: WebhooksCore;
  constructor(@Inject(DB_HANDLE) db: Db, @Inject(CLOCK) clock: Clock) {
    this.core = new WebhooksCore(db, clock);
  }
  handle(event: WebhookEvent, rawPayload: string): string {
    return this.core.handle(event, rawPayload);
  }
}
