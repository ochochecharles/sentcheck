import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { ProviderName } from '../providers/mail-provider.interface';
import { AuthService } from './auth.service';

class DisconnectDto {
  @IsString()
  @IsNotEmpty()
  provider: string;

  @IsEmail()
  @IsNotEmpty()
  accountEmail: string;
}

function parseProvider(value: string): ProviderName {
  if (value !== 'gmail' && value !== 'outlook') {
    throw new BadRequestException(`Unsupported provider: ${value}`);
  }
  return value;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('accounts')
  accounts() {
    return this.authService.listAccounts();
  }

  @Post('disconnect')
  disconnect(@Body() body: DisconnectDto) {
    return this.authService.disconnect(
      parseProvider(body.provider),
      body.accountEmail,
    );
  }

  @Get(':provider')
  connect(
    @Param('provider') provider: string,
    @Query('redirect') redirect?: string,
  ) {
    const name = parseProvider(provider);
    return { url: this.authService.buildAuthUrl(name, redirect ?? '/') };
  }

  @Get(':provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const name = parseProvider(provider);
    const { redirect } = await this.authService.handleCallback(
      name,
      code,
      state,
    );
    const separator = redirect.includes('?') ? '&' : '?';
    res.redirect(`${redirect}${separator}connected=${name}`);
  }
}
