import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { CryptoService } from '../common/crypto.service';
import { ProviderName } from '../providers/mail-provider.interface';
import { MailProviderFactory } from '../providers/mail-provider.factory';
import {
  AccountView,
  NewAccountTokens,
  OauthAccountsRepository,
} from './oauth-accounts.repository';

interface PendingState {
  provider: ProviderName;
  redirect: string;
}

@Injectable()
export class AuthService {
  private readonly stateStore = new Map<string, PendingState>();

  constructor(
    private readonly providerFactory: MailProviderFactory,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
    private readonly repo: OauthAccountsRepository,
  ) {}

  private redirectUriFor(provider: ProviderName): string {
    return this.config.getOrThrow<string>(
      provider === 'gmail' ? 'gmail.redirectUri' : 'microsoft.redirectUri',
    );
  }

  buildAuthUrl(provider: ProviderName, redirect = '/'): string {
    const state = randomBytes(16).toString('hex');
    this.stateStore.set(state, { provider, redirect });
    return this.providerFactory
      .get(provider)
      .getAuthUrl(state, this.redirectUriFor(provider));
  }

  async handleCallback(
    provider: ProviderName,
    code: string,
    state: string,
  ): Promise<{ accountEmail: string; redirect: string }> {
    const entry = this.stateStore.get(state);
    this.stateStore.delete(state);
    if (!entry || entry.provider !== provider) {
      throw new BadRequestException('Invalid or expired OAuth state');
    }
    const exchanged = await this.providerFactory
      .get(provider)
      .exchangeCode(code, this.redirectUriFor(provider));

    const tokens: NewAccountTokens = {
      accountEmail: exchanged.accountEmail,
      providerUserId: exchanged.providerUserId,
      accessToken: this.crypto.encrypt(exchanged.accessToken),
      refreshToken: this.crypto.encrypt(exchanged.refreshToken),
      expiresAt: exchanged.expiresIn
        ? new Date(Date.now() + exchanged.expiresIn * 1000)
        : null,
      scopes: exchanged.scopes,
    };
    const account = await this.repo.upsert(provider, tokens);
    return { accountEmail: account.accountEmail, redirect: entry.redirect };
  }

  listAccounts(): Promise<AccountView[]> {
    return this.repo.findAll();
  }

  async disconnect(
    provider: ProviderName,
    accountEmail: string,
  ): Promise<void> {
    await this.repo.delete(provider, accountEmail);
  }
}
