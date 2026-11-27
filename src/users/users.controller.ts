import {Body, Controller, Get, HttpCode, Param, Post} from '@nestjs/common';
import {ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags} from '@nestjs/swagger';
import {z} from 'zod';
import {zCurrency} from '../common/money';
import {ERROR_SCHEMA, toOpenApi} from '../common/openapi';
import {ZodPipe} from '../common/zod.pipe';
import {UsersService} from './users.service';

const CreateUser = z.object({id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), currency: zCurrency}).strict();

@ApiTags('Users and wallets')
@Controller()
export class UsersController {
    constructor(private readonly users: UsersService) {
    }

    /**
     *
     * @param body
     */
    @Post('users')
    @HttpCode(201)
    @ApiOperation({summary: 'Create a user and their single-currency wallet'})
    @ApiBody({schema: {...toOpenApi(CreateUser), example: {id: 'alice', currency: 'NGN'}}})
    @ApiResponse({status: 201, description: 'User created'})
    @ApiResponse({status: 400, description: 'VALIDATION_ERROR', schema: ERROR_SCHEMA})
    @ApiResponse({status: 409, description: 'USER_EXISTS', schema: ERROR_SCHEMA})
    create(@Body(new ZodPipe(CreateUser)) body: z.infer<typeof CreateUser>) {
        return this.users.create(body.id, body.currency);
    }

    /**
     *
     * @param userId
     */
    @Get('wallets/:userId')
    @ApiOperation({summary: 'Wallet balance, derived from the ledger (credits minus debits)'})
    @ApiParam({name: 'userId', example: 'alice'})
    @ApiOkResponse({description: 'Balance in minor units', schema: {type: 'object', properties: {userId: {type: 'string'}, currency: {type: 'string'}, balanceMinor: {type: 'integer', example: 5000}}}})
    @ApiResponse({status: 404, description: 'USER_NOT_FOUND', schema: ERROR_SCHEMA})
    wallet(@Param('userId') userId: string) {
        return this.users.wallet(userId);
    }
}
