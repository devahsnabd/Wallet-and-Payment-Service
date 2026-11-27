import { PipeTransform } from '@nestjs/common';
import { ZodType } from 'zod';
import { AppError } from './app-error';

export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
      throw new AppError('VALIDATION_ERROR', 400, detail);
    }
    return parsed.data;
  }
}
