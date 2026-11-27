import {Body, Controller, HttpCode, Post} from '@nestjs/common';
import {ApiBody, ApiOkResponse, ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {ERROR_SCHEMA, toOpenApi} from '../common/openapi';
import {ZodPipe} from '../common/zod.pipe';
import {TopupsService} from '../topups/topups.service';
import {ProviderReport, reconcile} from './reconcile';

@ApiTags('Reconciliation')
@Controller('reconciliation')
export class ReconciliationController {
    constructor(private readonly topups: TopupsService) {
    }

    /**
     *
     * @param report
     */
    @Post()
    @HttpCode(200)
    @ApiOperation({summary: "Compare our successful top-ups for a UTC day with the provider's report"})
    @ApiBody({schema: {...toOpenApi(ProviderReport), example: {date: '2026-11-26', payments: [{providerRef: 'prv_abc123', amountMinor: 5000, currency: 'NGN', status: 'succeeded'}]}}})
    @ApiOkResponse({description: 'matched count plus missingLocally, missingAtProvider and amountMismatches'})
    @ApiResponse({status: 400, description: 'VALIDATION_ERROR', schema: ERROR_SCHEMA})
    run(@Body(new ZodPipe(ProviderReport)) report: ProviderReport) {
        return reconcile(report.date, this.topups.succeededOn(report.date), report);
    }
}
