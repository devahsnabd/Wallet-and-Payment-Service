import {Body, Controller, HttpCode, Post} from '@nestjs/common';
import {ApiBody, ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {z} from 'zod';
import {zAmountMinor, zCurrency} from '../common/money';
import {ERROR_SCHEMA, toOpenApi} from '../common/openapi';
import {ZodPipe} from '../common/zod.pipe';
import {TopupsService} from './topups.service';

const CreateTopup = z.object({
    userId: z.string().min(1).max(64),
    amountMinor: zAmountMinor,
    currency: zCurrency
}).strict();

@ApiTags('Top-ups')
@Controller('topups')
export class TopupsController {
    constructor(private readonly topups: TopupsService) {
    }

    /**
     *
     * @param body
     */
    @Post()
    @HttpCode(201)
    @ApiOperation({summary: 'Create a pending top-up with a provider reference (no ledger entry until the provider confirms)'})
    @ApiBody({schema: {...toOpenApi(CreateTopup), example: {userId: 'alice', amountMinor: 5000, currency: 'NGN'}}})
    @ApiResponse({status: 201, description: 'Pending top-up and its providerRef'})
    @ApiResponse({status: 400, description: 'VALIDATION_ERROR', schema: ERROR_SCHEMA})
    @ApiResponse({status: 404, description: 'USER_NOT_FOUND', schema: ERROR_SCHEMA})
    @ApiResponse({status: 422, description: 'CURRENCY_MISMATCH', schema: ERROR_SCHEMA})
    create(@Body(new ZodPipe(CreateTopup)) body: z.infer<typeof CreateTopup>) {
        return this.topups.create(body.userId, body.amountMinor, body.currency);
    }
}
