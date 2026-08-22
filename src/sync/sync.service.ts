import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CronJob } from 'cron';
import { SchedulerRegistry } from '@nestjs/schedule';
import { OauthAccountsRepository } from '../auth/oauth-accounts.repository';
import { MailProviderFactory } from '../providers/mail-provider.factory';
import { ProviderName } from '../providers/mail-provider.interface';
import { EmailsRepository } from './emails.repository';
import { SyncStateRepository } from './sync-state.repository';

export interface SyncSummary {
  accountId: number;
  accountEmail: string;
  provider: string;
  scanned: number;
  inserted: number;
  cursor: string | null;
}

@Injectable()
export class SyncService implements OnModuleInit {
  private readonly logger = new Logger('SyncService');
  private readonly maxPagesPerRun = 50;
  private inFlight: Promise<SyncSummary[]> | null = null;

  constructor(
    private readonly providerFactory: MailProviderFactory,
    private readonly accountsRepo: OauthAccountsRepository,
    private readonly syncStateRepo: SyncStateRepository,
    private readonly emailsRepo: EmailsRepository,
    private readonly scheduler: SchedulerRegistry,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.syncStateRepo.clearSyncInProgress();
    const minutes = this.config.get<number>('syncIntervalMinutes') ?? 15;
    const job = new CronJob(`*/${minutes} * * * *`, () => {
      this.syncAll().catch((err) =>
        this.logger.error(`Scheduled sync failed: ${(err as Error).message}`),
      );
    });
    this.scheduler.addCronJob('sent-mail-sync', job);
    job.start();
    this.logger.log(`Scheduled sent-mail sync every ${minutes} minutes`);
  }

  async status() {
    const accounts = await this.accountsRepo.findAll();
    const states = await this.syncStateRepo.all();
    const byAccount = new Map(states.map((s) => [s.accountId, s]));
    const counts = await this.emailsRepo.countByAccount();
    return accounts.map((a) => ({
      id: a.id,
      provider: a.provider,
      accountEmail: a.accountEmail,
      sync: byAccount.get(a.id) ?? null,
      emailCount: counts.get(a.id) ?? 0,
    }));
  }

  syncAll(): Promise<SyncSummary[]> {
    if (this.inFlight) {
      this.logger.warn('Sync already in progress; returning existing run');
      return this.inFlight;
    }
    this.inFlight = this.runSyncAll().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async runSyncAll(): Promise<SyncSummary[]> {
    const accounts = await this.accountsRepo.findAll();
    const summaries: SyncSummary[] = [];
    for (const account of accounts) {
      try {
        summaries.push(await this.syncAccount(account.id));
      } catch (err) {
        this.logger.error(
          `Sync failed for ${account.accountEmail}: ${(err as Error).message}`,
        );
      }
    }
    return summaries;
  }

  async syncAccount(accountId: number): Promise<SyncSummary> {
    const account = await this.accountsRepo.getById(accountId);
    if (!account) {
      throw new NotFoundException(`Account ${accountId} not found`);
    }
    const provider = this.providerFactory.get(account.provider as ProviderName);
    const state = await this.syncStateRepo.get(accountId);
    const after = state?.cursor ?? null;
    let pageToken: string | null = null;
    let maxSentAt: Date | null = after ? new Date(after) : null;
    let scanned = 0;
    let inserted = 0;

    await this.syncStateRepo.upsert(accountId, { syncInProgress: true });
    try {
      for (let page = 0; page < this.maxPagesPerRun; page++) {
        const result = await provider.listSentPage(account, {
          after,
          pageToken,
        });
        if (result.items.length) {
          inserted += await this.emailsRepo.upsertBatch(account, result.items);
          scanned += result.items.length;
          for (const item of result.items) {
            if (!maxSentAt || item.sentAt > maxSentAt) {
              maxSentAt = item.sentAt;
            }
          }
        }
        if (!result.nextPageToken) {
          break;
        }
        pageToken = result.nextPageToken;
      }
      const newCursor = maxSentAt ? maxSentAt.toISOString() : after;
      await this.syncStateRepo.upsert(accountId, {
        cursor: newCursor,
        lastSyncedAt: new Date(),
        lastError: null,
        syncInProgress: false,
      });
      return {
        accountId,
        accountEmail: account.accountEmail,
        provider: account.provider,
        scanned,
        inserted,
        cursor: newCursor,
      };
    } catch (err) {
      await this.syncStateRepo.upsert(accountId, {
        syncInProgress: false,
        lastError: (err as Error).message,
      });
      throw err;
    }
  }
}
