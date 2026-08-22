import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DATABASE } from '../db/db.module';
import type { Db } from '../db/db.module';
import { oauthAccounts, OauthAccount } from '../db/schema';
import { ProviderName } from '../providers/mail-provider.interface';

export interface NewAccountTokens {
  accountEmail: string;
  providerUserId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
  scopes: string;
}

export type AccountView = Omit<OauthAccount, 'accessToken' | 'refreshToken'>;

@Injectable()
export class OauthAccountsRepository {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  async findAll(): Promise<AccountView[]> {
    return this.db
      .select({
        id: oauthAccounts.id,
        provider: oauthAccounts.provider,
        accountEmail: oauthAccounts.accountEmail,
        providerUserId: oauthAccounts.providerUserId,
        tokenExpiresAt: oauthAccounts.tokenExpiresAt,
        scopes: oauthAccounts.scopes,
        createdAt: oauthAccounts.createdAt,
        updatedAt: oauthAccounts.updatedAt,
      })
      .from(oauthAccounts)
      .orderBy(oauthAccounts.createdAt);
  }

  async getById(id: number): Promise<OauthAccount | undefined> {
    const rows = await this.db
      .select()
      .from(oauthAccounts)
      .where(eq(oauthAccounts.id, id))
      .limit(1);
    return rows[0];
  }

  async findByProviderAndEmail(
    provider: ProviderName,
    accountEmail: string,
  ): Promise<OauthAccount | undefined> {
    const rows = await this.db
      .select()
      .from(oauthAccounts)
      .where(
        and(
          eq(oauthAccounts.provider, provider),
          eq(oauthAccounts.accountEmail, accountEmail),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async upsert(
    provider: ProviderName,
    tokens: NewAccountTokens,
  ): Promise<OauthAccount> {
    const values = {
      providerUserId: tokens.providerUserId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
    };
    const existing = await this.findByProviderAndEmail(
      provider,
      tokens.accountEmail,
    );
    if (existing) {
      const rows = await this.db
        .update(oauthAccounts)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(oauthAccounts.id, existing.id))
        .returning();
      return rows[0];
    }
    const rows = await this.db
      .insert(oauthAccounts)
      .values({ provider, accountEmail: tokens.accountEmail, ...values })
      .returning();
    return rows[0];
  }

  async delete(provider: ProviderName, accountEmail: string): Promise<void> {
    await this.db
      .delete(oauthAccounts)
      .where(
        and(
          eq(oauthAccounts.provider, provider),
          eq(oauthAccounts.accountEmail, accountEmail),
        ),
      );
  }
}
