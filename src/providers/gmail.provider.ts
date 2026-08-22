import { Injectable } from '@nestjs/common';
import type { OauthAccount } from '../db/schema';
import { normalizeEmail, splitAddressHeader } from '../common/email-normalizer';
import { MailProviderBase } from './mail-provider.base';
import {
  ExchangedTokens,
  ListPageOptions,
  ListPageResult,
  MailRecipient,
  SentMessage,
} from './mail-provider.interface';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

const DETAILS_CONCURRENCY = 4;

interface GmailListResponse {
  messages?: Array<{ id: string }>;
  nextPageToken?: string;
}

interface GmailMessageResponse {
  id: string;
  snippet?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
  };
}

@Injectable()
export class GmailProvider extends MailProviderBase {
  readonly name = 'gmail' as const;

  private get clientId(): string {
    return this.config.getOrThrow<string>('gmail.clientId');
  }

  private get clientSecret(): string {
    return this.config.getOrThrow<string>('gmail.clientSecret');
  }

  getAuthUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<ExchangedTokens> {
    const data = await this.formUrlEncoded(
      'https://oauth2.googleapis.com/token',
      {
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      },
    );
    const accessToken = data.access_token as string;
    const userinfo = (await fetch(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    ).then((r) => r.json())) as { email?: string; sub?: string };
    return {
      accountEmail: userinfo.email ?? '',
      providerUserId: userinfo.sub ?? '',
      accessToken,
      refreshToken: data.refresh_token as string,
      expiresIn: data.expires_in as number | undefined,
      scopes: SCOPES,
    };
  }

  protected refreshScopes(): string[] {
    return [SCOPES];
  }

  protected async refreshAccessToken(refreshToken: string) {
    const data = await this.formUrlEncoded(
      'https://oauth2.googleapis.com/token',
      {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      },
    );
    return {
      accessToken: data.access_token as string,
      expiresIn: data.expires_in as number | undefined,
    };
  }

  async listSentPage(
    account: OauthAccount,
    opts: ListPageOptions,
  ): Promise<ListPageResult> {
    const url = new URL(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages',
    );
    const query = ['in:sent'];
    if (opts.after) {
      const epoch = Math.floor(new Date(opts.after).getTime() / 1000);
      query.push(`after:${epoch}`);
    }
    url.searchParams.set('q', query.join(' '));
    url.searchParams.set('maxResults', '500');
    if (opts.pageToken) {
      url.searchParams.set('pageToken', opts.pageToken);
    }

    const listData = (await this.fetchJson(
      url.toString(),
      account,
    )) as GmailListResponse;
    const ids = (listData.messages ?? []).map((m) => m.id);
    const nextPageToken = listData.nextPageToken ?? null;
    const items = await this.fetchDetails(ids, account);
    return { items, nextPageToken };
  }

  private async fetchDetails(
    ids: string[],
    account: OauthAccount,
  ): Promise<SentMessage[]> {
    const results = new Array<SentMessage | null>(ids.length).fill(null);
    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(DETAILS_CONCURRENCY, ids.length) },
      async () => {
        while (cursor < ids.length) {
          const index = cursor++;
          results[index] = await this.fetchOne(ids[index], account);
        }
      },
    );
    await Promise.all(workers);
    return results.filter((x): x is SentMessage => x !== null);
  }

  private async fetchOne(
    id: string,
    account: OauthAccount,
  ): Promise<SentMessage | null> {
    try {
      const url = new URL(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`,
      );
      url.searchParams.set('format', 'metadata');
      for (const h of ['From', 'To', 'Cc', 'Subject', 'Date']) {
        url.searchParams.append('metadataHeaders', h);
      }
      const data = (await this.fetchJson(
        url.toString(),
        account,
      )) as GmailMessageResponse;
      const headers = new Map<string, string>();
      for (const h of data.payload?.headers ?? []) {
        headers.set(h.name.toLowerCase(), h.value);
      }
      const from = splitAddressHeader(headers.get('from'))[0];
      const to = splitAddressHeader(headers.get('to'));
      const cc = splitAddressHeader(headers.get('cc'));
      const sentAt = new Date(headers.get('date') ?? Date.now());
      return {
        providerMessageId: data.id,
        from: this.toRecipient(from),
        to: to.map((r) => this.toRecipient(r)),
        cc: cc.map((r) => this.toRecipient(r)),
        subject: headers.get('subject') ?? '',
        snippet: data.snippet ?? '',
        sentAt: Number.isNaN(sentAt.getTime()) ? new Date() : sentAt,
      };
    } catch (err) {
      if ((err as { status?: number }).status === 404) {
        return null;
      }
      throw err;
    }
  }

  private toRecipient(
    r: { name: string | null; address: string } | undefined,
  ): MailRecipient {
    const address = r?.address ?? '';
    return {
      name: r?.name ?? null,
      address,
      normalizedEmail: normalizeEmail(address),
    };
  }
}
