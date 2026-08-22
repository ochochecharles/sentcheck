import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DATABASE } from '../db/db.module';
import type { Db } from '../db/db.module';
import { syncStates, SyncState } from '../db/schema';

export interface SyncStatePatch {
  cursor?: string | null;
  lastSyncedAt?: Date;
  lastError?: string | null;
  syncInProgress?: boolean;
}

@Injectable()
export class SyncStateRepository {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  async get(accountId: number): Promise<SyncState | undefined> {
    const rows = await this.db
      .select()
      .from(syncStates)
      .where(eq(syncStates.accountId, accountId))
      .limit(1);
    return rows[0];
  }

  async all(): Promise<SyncState[]> {
    return this.db.select().from(syncStates);
  }

  async upsert(accountId: number, patch: SyncStatePatch): Promise<void> {
    const existing = await this.get(accountId);
    if (existing) {
      await this.db
        .update(syncStates)
        .set(patch)
        .where(eq(syncStates.accountId, accountId));
      return;
    }
    await this.db.insert(syncStates).values({ accountId, ...patch });
  }

  async clearSyncInProgress(): Promise<void> {
    await this.db
      .update(syncStates)
      .set({ syncInProgress: false })
      .where(eq(syncStates.syncInProgress, true));
  }
}
