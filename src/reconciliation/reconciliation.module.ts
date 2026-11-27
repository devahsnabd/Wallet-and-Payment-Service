import { Module } from '@nestjs/common';
import { TopupsModule } from '../topups/topups.module';
import { ReconciliationController } from './reconciliation.controller';

@Module({ imports: [TopupsModule], controllers: [ReconciliationController] })
export class ReconciliationModule {}
