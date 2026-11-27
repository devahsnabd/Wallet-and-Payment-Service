import {Body, Controller, HttpCode, Post, Req, UseGuards} from '@nestjs/common';
import {ApiBody, ApiHeader, ApiOkResponse, ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {Request} from 'express';
import {ERROR_SCHEMA, toOpenApi} from '../common/openapi';
import {ZodPipe} from '../common/zod.pipe';
import {SignatureGuard} from './signature.guard';
import {WebhookEvent} from './webhooks.core';
import {WebhooksService} from './webhooks.service';

@ApiTags('Provider webhook')
@Controller('webhooks')
export class WebhooksController {
    constructor(private readonly webhooks: WebhooksService) {
    }

    /**
     *
     * @param event
     * @param req
     */
    @Post('provider')
    @HttpCode(200)
    @UseGuards(SignatureGuard)
    @ApiOperation({summary: 'Receive a provider event (succeeded, failed, refunded). Duplicates and out-of-order events are safe.'})
    @ApiHeader({name: 'X-Signature', required: true, description: 'Hex HMAC-SHA256 of the exact raw request body, keyed with the shared webhook secret'})
    @ApiBody({schema: {...toOpenApi(WebhookEvent), example: {eventId: 'evt_1', type: 'payment.succeeded', providerRef: 'prv_abc123'}}})
    @ApiOkResponse({description: 'Acknowledged. outcome says what happened (credited, duplicate_event, refund_parked_until_success, ...)'})
    @ApiResponse({status: 400, description: 'VALIDATION_ERROR (signed but malformed)', schema: ERROR_SCHEMA})
    @ApiResponse({status: 401, description: 'INVALID_SIGNATURE', schema: ERROR_SCHEMA})
    receive(@Body(new ZodPipe(WebhookEvent)) event: WebhookEvent, @Req() req: Request & { rawBody?: Buffer }) {
        const outcome = this.webhooks.handle(event, req.rawBody!.toString('utf8'));
        return {received: true, outcome};
    }
}
