import { Injectable } from '@nestjs/common';
import { GmailProvider } from './gmail.provider';
import { OutlookProvider } from './outlook.provider';
import { MailProvider, ProviderName } from './mail-provider.interface';

@Injectable()
export class MailProviderFactory {
  private readonly providers: Record<ProviderName, MailProvider>;

  constructor(gmail: GmailProvider, outlook: OutlookProvider) {
    this.providers = { gmail, outlook };
  }

  get(name: ProviderName): MailProvider {
    return this.providers[name];
  }

  all(): MailProvider[] {
    return Object.values(this.providers);
  }
}
