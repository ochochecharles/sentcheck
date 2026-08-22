import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import Joi from 'joi';
import configuration from './config/configuration';
import { CommonModule } from './common/common.module';
import { DbModule } from './db/db.module';
import { ProvidersModule } from './providers/providers.module';
import { AuthModule } from './auth/auth.module';
import { SyncModule } from './sync/sync.module';
import { CheckModule } from './check/check.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: Joi.object({
        PORT: Joi.number().port().default(3000),
        DATABASE_URL: Joi.string()
          .pattern(/^postgres(ql)?:\/\//)
          .default('postgres://postgres:postgres@localhost:5434/sentcheck'),
        TOKEN_ENCRYPTION_KEY: Joi.string().hex().length(64).required(),
        GOOGLE_CLIENT_ID: Joi.string().required(),
        GOOGLE_CLIENT_SECRET: Joi.string().required(),
        GOOGLE_REDIRECT_URI: Joi.string().default(
          'http://localhost:3000/api/auth/gmail/callback',
        ),
        MICROSOFT_CLIENT_ID: Joi.string().required(),
        MICROSOFT_CLIENT_SECRET: Joi.string().required(),
        MICROSOFT_REDIRECT_URI: Joi.string().default(
          'http://localhost:3000/api/auth/outlook/callback',
        ),
        SYNC_INTERVAL_MINUTES: Joi.number()
          .integer()
          .min(1)
          .max(1440)
          .default(15),
      }),
      validationOptions: { abortEarly: false },
    }),
    ScheduleModule.forRoot(),
    DbModule,
    CommonModule,
    ProvidersModule,
    AuthModule,
    SyncModule,
    CheckModule,
  ],
})
export class AppModule {}
