import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { CheckController } from './check.controller';
import { CheckService } from './check.service';

@Module({
  imports: [SyncModule],
  controllers: [CheckController],
  providers: [CheckService],
})
export class CheckModule {}
