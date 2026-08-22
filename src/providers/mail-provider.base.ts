import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import { CryptoService } from '../common/crypto.service';
import { DATABASE } from '../db/db.module';
import type { Db } from '../db/db.module';
import { oauthAccounts, OauthAccount } from '../db/schema';
import { ExchangedTokens, ProviderName } from './mail-provider.interface';

const TOKEN_REFRESH_LEAD_TIME_MS = 60_000;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 503]);
const MAX_API_RETRIES = 3;
const MAX_RETRY_AFTER_DELAY_MS = 30_000;
const MAX_BACKOFF_STEP_MS = 8_000;
const API_TIMEOUT_MS = 30_000;

export interface RefreshedTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

@Injectable()
export abstract class MailProviderBase {
  abstract readonly name: ProviderName;

  constructor(
    protected readonly config: ConfigService,
    protected readonly crypto: CryptoService,
    @Inject(DATABASE) protected readonly db: Db,
  ) {}

  abstract getAuthUrl(state: string, redirectUri: string): string;

  abstract exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<ExchangedTokens>;

  protected abstract refreshAccessToken(
    refreshToken: string,
  ): Promise<RefreshedTokens>;

  protected abstract refreshScopes(): string[];

  private decryptToken(ciphertext: string): string {
    return this.crypto.decrypt(ciphertext);
  }

  private shouldRefresh(expiresAt: Date | null): boolean {
    if (!expiresAt) {
      return true;
    }
    return expiresAt.getTime() - Date.now() < TOKEN_REFRESH_LEAD_TIME_MS;
  }

  async getAccessToken(account: OauthAccount): Promise<string> {
    const accessToken = this.decryptToken(account.accessToken);
    const refreshToken = this.decryptToken(account.refreshToken);
    if (!this.shouldRefresh(account.tokenExpiresAt)) {
      return accessToken;
    }
    const fresh = await this.refreshAccessToken(refreshToken);
    const newRefresh = fresh.refreshToken ?? refreshToken;
    const newExpiresAt = fresh.expiresIn
      ? new Date(Date.now() + fresh.expiresIn * 1000)
      : account.tokenExpiresAt;
    await this.persistTokens(
      account.id,
      fresh.accessToken,
      newRefresh,
      newExpiresAt,
    );
    return fresh.accessToken;
  }

  private async persistTokens(
    accountId: number,
    accessToken: string,
    refreshToken: string,
    expiresAt: Date | null,
  ): Promise<void> {
    await this.db
      .update(oauthAccounts)
      .set({
        accessToken: this.crypto.encrypt(accessToken),
        refreshToken: this.crypto.encrypt(refreshToken),
        tokenExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(oauthAccounts.id, accountId));
  }

  protected async formUrlEncoded(
    endpoint: string,
    params: Record<string, string>,
  ) {
    const body = new URLSearchParams(params).toString();
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(
        `OAuth token request failed (${res.status}): ${JSON.stringify(data)}`,
      );
    }
    return data;
  }

  async fetchJson(
    url: string,
    account: OauthAccount,
    init?: RequestInit,
  ): Promise<unknown> {
    const attempt = async (token: string) => {
      const res = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(init?.headers ?? {}),
        },
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
      if (!res.ok) {
        const text = await res.text();
        throw Object.assign(
          new Error(`API request failed (${res.status}): ${text}`),
          {
            status: res.status,
            headers: res.headers,
          },
        );
      }
      return res.json() as Promise<unknown>;
    };

    const sendWithAuthRetry = async (): Promise<unknown> => {
      try {
        return await attempt(await this.getAccessToken(account));
      } catch (err) {
        if ((err as { status?: number }).status !== 401) {
          throw err;
        }
        await this.forceRefresh(account);
        const freshToken = this.crypto.decrypt(
          (await this.getAccount(account.id)).accessToken,
        );
        return attempt(freshToken);
      }
    };

    for (let tries = 0; ; tries++) {
      try {
        return await sendWithAuthRetry();
      } catch (err) {
        const status = (err as { status?: number }).status ?? 0;
        if (!RETRYABLE_STATUS_CODES.has(status) || tries >= MAX_API_RETRIES) {
          throw err;
        }
        await sleep(this.retryDelayMs(tries, err));
      }
    }
  }

  private retryDelayMs(tries: number, err: unknown): number {
    const headers = (err as { headers?: Headers }).headers;
    const retryAfterSeconds = Number(headers?.get('retry-after'));
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      return Math.min(retryAfterSeconds * 1000, MAX_RETRY_AFTER_DELAY_MS);
    }
    const step = Math.min(1000 * 2 ** tries, MAX_BACKOFF_STEP_MS);
    return Math.random() * step;
  }

  private async forceRefresh(account: OauthAccount): Promise<void> {
    const refreshToken = this.decryptToken(account.refreshToken);
    const fresh = await this.refreshAccessToken(refreshToken);
    const newRefresh = fresh.refreshToken ?? refreshToken;
    const newExpiresAt = fresh.expiresIn
      ? new Date(Date.now() + fresh.expiresIn * 1000)
      : account.tokenExpiresAt;
    await this.persistTokens(
      account.id,
      fresh.accessToken,
      newRefresh,
      newExpiresAt,
    );
  }

  private async getAccount(accountId: number): Promise<OauthAccount> {
    const rows = await this.db
      .select()
      .from(oauthAccounts)
      .where(eq(oauthAccounts.id, accountId))
      .limit(1);
    return rows[0];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
