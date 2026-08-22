import { Injectable } from '@nestjs/common';
import type { OauthAccount } from '../db/schema';
import { normalizeEmail } from '../common/email-normalizer';
import { MailProviderBase } from './mail-provider.base';
import {
  ExchangedTokens,
  ListPageOptions,
  ListPageResult,
  MailRecipient,
  SentMessage,
} from './mail-provider.interface';

const SCOPES = 'Mail.Read offline_access User.Read';

interface GraphRecipient {
  emailAddress?: { name?: string | null; address?: string | null };
}

interface GraphMessage {
  id: string;
  subject?: string | null;
  from?: GraphRecipient | null;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  bodyPreview?: string | null;
  sentDateTime?: string | null;
}

interface GraphListResponse {
  value?: GraphMessage[];
  '@odata.nextLink'?: string;
}

interface GraphMe {
  id?: string;
  mail?: string | null;
  userPrincipalName?: string | null;
}

@Injectable()
export class OutlookProvider extends MailProviderBase {
  readonly name = 'outlook' as const;

  private get clientId(): string {
    return this.config.getOrThrow<string>('microsoft.clientId');
  }

  private get clientSecret(): string {
    return this.config.getOrThrow<string>('microsoft.clientSecret');
  }

  getAuthUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES,
      response_mode: 'query',
      state,
      prompt: 'select_account',
    });
    return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
  }

  async exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<ExchangedTokens> {
    const data = await this.formUrlEncoded(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        scope: SCOPES,
      },
    );
    const accessToken = data.access_token as string;
    const me = (await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).then((r) => r.json())) as GraphMe;
    return {
      accountEmail: me.mail ?? me.userPrincipalName ?? '',
      providerUserId: me.id ?? '',
      accessToken,
      refreshToken: data.refresh_token as string,
      expiresIn: data.expires_in as number | undefined,
      scopes: SCOPES,
    };
  }

  protected refreshScopes(): string[] {
    return SCOPES.split(' ');
  }

  protected async refreshAccessToken(refreshToken: string) {
    const data = await this.formUrlEncoded(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: SCOPES,
      },
    );
    return {
      accessToken: data.access_token as string,
      refreshToken: (data.refresh_token as string | undefined) ?? undefined,
      expiresIn: data.expires_in as number | undefined,
    };
  }

  async listSentPage(
    account: OauthAccount,
    opts: ListPageOptions,
  ): Promise<ListPageResult> {
    let url: string;
    if (opts.pageToken) {
      url = opts.pageToken;
    } else {
      const u = new URL(
        'https://graph.microsoft.com/v1.0/me/mailFolders/SentItems/messages',
      );
      u.searchParams.set(
        '$select',
        'id,subject,from,toRecipients,ccRecipients,bodyPreview,sentDateTime',
      );
      u.searchParams.set('$top', '100');
      if (opts.after) {
        const iso = new Date(opts.after).toISOString();
        u.searchParams.set('$filter', `sentDateTime gt ${iso}`);
      }
      url = u.toString();
    }

    const data = (await this.fetchJson(url, account)) as GraphListResponse;
    const nextPageToken = data['@odata.nextLink'] ?? null;
    const items = (data.value ?? [])
      .map((m) => this.mapMessage(m))
      .filter((x): x is SentMessage => x !== null);
    return { items, nextPageToken };
  }

  private mapMessage(msg: GraphMessage): SentMessage | null {
    const sentAt = new Date(msg.sentDateTime ?? Date.now());
    return {
      providerMessageId: msg.id,
      from: this.mapRecipient(msg.from),
      to: (msg.toRecipients ?? []).map((r) => this.mapRecipient(r)),
      cc: (msg.ccRecipients ?? []).map((r) => this.mapRecipient(r)),
      subject: msg.subject ?? '',
      snippet: msg.bodyPreview ?? '',
      sentAt: Number.isNaN(sentAt.getTime()) ? new Date() : sentAt,
    };
  }

  private mapRecipient(r: GraphRecipient | null | undefined): MailRecipient {
    const address = r?.emailAddress?.address ?? '';
    return {
      name: r?.emailAddress?.name ?? null,
      address,
      normalizedEmail: normalizeEmail(address),
    };
  }
}
