import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export const DATABASE = Symbol('DATABASE');

export type Db = NodePgDatabase<typeof schema>;

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Db => {
        const pool = new Pool({
          connectionString: config.getOrThrow<string>('databaseUrl'),
        });
        return drizzle(pool, { schema });
      },
    },
  ],
  exports: [DATABASE],
})
export class DbModule {}
