import { Controller, Get, Post } from '@nestjs/common';
import { SyncService } from './sync.service';

@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Get('status')
  status() {
    return this.syncService.status();
  }

  @Post('run')
  run() {
    return this.syncService.syncAll();
  }
}
