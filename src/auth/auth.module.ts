import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OauthAccountsRepository } from './oauth-accounts.repository';

@Module({
  imports: [ProvidersModule],
  controllers: [AuthController],
  providers: [AuthService, OauthAccountsRepository],
  exports: [OauthAccountsRepository],
})
export class AuthModule {}
