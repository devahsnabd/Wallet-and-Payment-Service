import { Inject, Injectable } from '@nestjs/common';
import { Currency } from '../common/money';
import { Db } from '../database/connection';
import { DB_HANDLE } from '../database/infra.module';
import { UsersCore } from './users.core';

/** Nest-facing wrapper; the logic lives in the framework-free UsersCore. */
@Injectable()
export class UsersService {
  private readonly core: UsersCore;
  constructor(@Inject(DB_HANDLE) db: Db) {
    this.core = new UsersCore(db);
  }
  create(id: string, currency: Currency) {
    return this.core.create(id, currency);
  }
  wallet(id: string) {
    return this.core.wallet(id);
  }
}
