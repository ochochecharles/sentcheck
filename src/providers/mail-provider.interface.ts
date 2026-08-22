import type { OauthAccount } from '../db/schema';

export type ProviderName = 'gmail' | 'outlook';

export interface MailRecipient {
  name: string | null;
  address: string;
  normalizedEmail: string;
}

export interface SentMessage {
  providerMessageId: string;
  from: MailRecipient;
  to: MailRecipient[];
  cc: MailRecipient[];
  subject: string;
  snippet: string;
  sentAt: Date;
}

export interface ListPageOptions {
  after?: string | null;
  pageToken?: string | null;
}

export interface ListPageResult {
  items: SentMessage[];
  nextPageToken: string | null;
}

export interface ExchangedTokens {
  accountEmail: string;
  providerUserId: string;
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  scopes: string;
}

export interface MailProvider {
  readonly name: ProviderName;
  getAuthUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<ExchangedTokens>;
  getAccessToken(account: OauthAccount): Promise<string>;
  listSentPage(
    account: OauthAccount,
    opts: ListPageOptions,
  ): Promise<ListPageResult>;
}
