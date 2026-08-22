import { Module } from '@nestjs/common';
import { GmailProvider } from './gmail.provider';
import { OutlookProvider } from './outlook.provider';
import { MailProviderFactory } from './mail-provider.factory';

@Module({
  providers: [GmailProvider, OutlookProvider, MailProviderFactory],
  exports: [GmailProvider, OutlookProvider, MailProviderFactory],
})
export class ProvidersModule {}
