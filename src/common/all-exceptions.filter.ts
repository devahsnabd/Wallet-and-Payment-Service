import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Response } from 'express';
import { AppError } from './app-error';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Errors');

  catch(err: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (err instanceof AppError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
    } else if (err instanceof HttpException) {
      res.status(err.getStatus()).json({ error: { code: 'BAD_REQUEST', message: err.message } });
    } else {
      this.log.error(err instanceof Error ? err.stack : String(err));
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected error' } });
    }
  }
}
