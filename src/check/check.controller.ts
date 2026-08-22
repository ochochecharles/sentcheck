import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { isValidEmail } from '../common/email-normalizer';
import { EmailsRepository } from '../sync/emails.repository';
import { CheckService } from './check.service';

class CheckBodyDto {
  @IsString()
  @IsNotEmpty()
  email: string;
}

@Controller()
export class CheckController {
  constructor(
    private readonly checkService: CheckService,
    private readonly emailsRepo: EmailsRepository,
  ) {}

  @Post('check')
  check(@Body() body: CheckBodyDto) {
    if (!isValidEmail(body.email)) {
      throw new BadRequestException('Invalid email address');
    }
    return this.checkService.check(body.email);
  }

  @Get('history')
  history(@Query('email') email?: string) {
    if (!email) {
      throw new BadRequestException('email query parameter is required');
    }
    if (!isValidEmail(email)) {
      throw new BadRequestException('Invalid email address');
    }
    return this.checkService.check(email);
  }

  @Get('sends/recent')
  recent(@Query('limit') limit?: string) {
    const n = Math.min(Math.max(parseInt(limit ?? '50', 10) || 50, 1), 500);
    return this.emailsRepo.recent(n);
  }

  @Get('search')
  async search(@Query('q') q?: string, @Query('limit') limit?: string) {
    const query = (q ?? '').trim();
    if (!query || query.length < 2) {
      return [];
    }
    if (query.length > 255) {
      throw new BadRequestException('Search query too long');
    }
    const n = Math.min(Math.max(parseInt(limit ?? '8', 10) || 8, 1), 20);
    return this.emailsRepo.search(query, n);
  }
}
