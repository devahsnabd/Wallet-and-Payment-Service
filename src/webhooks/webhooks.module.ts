import { Module } from '@nestjs/common';
import { SignatureGuard } from './signature.guard';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({ controllers: [WebhooksController], providers: [SignatureGuard, WebhooksService] })
export class WebhooksModule {}
