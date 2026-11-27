import { Inject, Injectable } from '@nestjs/common';
import { Db } from '../database/connection';
import { CLOCK, Clock, DB_HANDLE } from '../database/infra.module';
import { StoredResponse, TransferRequest, TransfersCore } from './transfers.core';

@Injectable()
export class TransfersService {
  private readonly core: TransfersCore;
  constructor(@Inject(DB_HANDLE) db: Db, @Inject(CLOCK) clock: Clock) {
    this.core = new TransfersCore(db, clock);
  }
  execute(key: string, req: TransferRequest): StoredResponse {
    return this.core.execute(key, req);
  }
}
