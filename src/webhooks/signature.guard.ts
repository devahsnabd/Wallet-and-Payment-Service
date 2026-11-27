import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AppError } from '../common/app-error';
import { WEBHOOK_SECRET } from '../database/infra.module';
import { verifySignature } from './signature';

@Injectable()
export class SignatureGuard implements CanActivate {
  constructor(@Inject(WEBHOOK_SECRET) private readonly secret: string) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();
    if (!verifySignature(req.rawBody, req.header('x-signature'), this.secret)) {
      throw new AppError('INVALID_SIGNATURE', 401, 'Webhook signature is missing or invalid');
    }
    return true;
  }
}
