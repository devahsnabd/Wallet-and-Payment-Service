import {Body, Controller, Headers, Post, Res} from '@nestjs/common';
import {ApiBody, ApiHeader, ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {Response} from 'express';
import {z} from 'zod';
import {AppError} from '../common/app-error';
import {zAmountMinor, zCurrency} from '../common/money';
import {ERROR_SCHEMA, toOpenApi} from '../common/openapi';
import {ZodPipe} from '../common/zod.pipe';
import {TransfersService} from './transfers.service';

const idStr = z.string().min(1).max(64);
const TransferBody = z
    .object({fromUserId: idStr, toUserId: idStr, amountMinor: zAmountMinor, currency: zCurrency})
    .strict();

@ApiTags('Transfers')
@Controller('transfers')
export class TransfersController {
    constructor(private readonly transfers: TransfersService) {
    }

    /**
     *
     * @param key
     * @param body
     * @param res
     */
    @Post()
    @ApiOperation({summary: 'Move money between two wallets of the same currency. Idempotent, and never overdraws.'})
    @ApiHeader({name: 'Idempotency-Key', required: true, description: 'Same key and body returns exactly the first response (header Idempotent-Replayed: true on replays); same key with a different body is 409'})
    @ApiBody({schema: {...toOpenApi(TransferBody), example: {fromUserId: 'alice', toUserId: 'bob', amountMinor: 3000, currency: 'NGN'}}})
    @ApiResponse({status: 201, description: 'Transfer recorded as one balanced ledger transaction'})
    @ApiResponse({status: 400, description: 'VALIDATION_ERROR or IDEMPOTENCY_KEY_REQUIRED', schema: ERROR_SCHEMA})
    @ApiResponse({status: 404, description: 'USER_NOT_FOUND', schema: ERROR_SCHEMA})
    @ApiResponse({status: 409, description: 'IDEMPOTENCY_KEY_REUSED (same key, different body)', schema: ERROR_SCHEMA})
    @ApiResponse({status: 422, description: 'INSUFFICIENT_FUNDS, CURRENCY_MISMATCH or SAME_WALLET', schema: ERROR_SCHEMA})
    create(
        @Headers('idempotency-key') key: string | undefined,
        @Body(new ZodPipe(TransferBody)) body: z.infer<typeof TransferBody>,
        // passthrough: Nest still serialises the return value; we only set the status and a header.
        @Res({passthrough: true}) res: Response,
    ) {
        if (!key || key.length > 255) {
            throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 400, 'Idempotency-Key header is required (1 to 255 characters)');
        }
        const result = this.transfers.execute(key, body);
        if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
        res.status(result.status);
        return result.body;
    }
}
