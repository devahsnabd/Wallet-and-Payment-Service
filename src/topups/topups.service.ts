import { Inject, Injectable } from '@nestjs/common';
import { Currency } from '../common/money';
import { Db } from '../database/connection';
import { CLOCK, Clock, DB_HANDLE } from '../database/infra.module';
import { LocalTopup, TopupsCore } from './topups.core';

@Injectable()
export class TopupsService {
  private readonly core: TopupsCore;
  constructor(@Inject(DB_HANDLE) db: Db, @Inject(CLOCK) clock: Clock) {
    this.core = new TopupsCore(db, clock);
  }
  create(userId: string, amountMinor: number, currency: Currency) {
    return this.core.create(userId, amountMinor, currency);
  }
  succeededOn(date: string): LocalTopup[] {
    return this.core.succeededOn(date);
  }
}
