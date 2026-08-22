import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProvidersModule } from '../providers/providers.module';
import { EmailsRepository } from './emails.repository';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { SyncStateRepository } from './sync-state.repository';

@Module({
  imports: [AuthModule, ProvidersModule],
  controllers: [SyncController],
  providers: [SyncService, EmailsRepository, SyncStateRepository],
  exports: [EmailsRepository, SyncStateRepository, SyncService],
})
export class SyncModule {}
