import { Inject, Injectable } from '@nestjs/common';
import { count, desc, eq, inArray, ilike, or, sql } from 'drizzle-orm';
import { DATABASE } from '../db/db.module';
import type { Db } from '../db/db.module';
import { emailRecipients, emails, OauthAccount } from '../db/schema';
import { SentMessage } from '../providers/mail-provider.interface';

@Injectable()
export class EmailsRepository {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  async upsertBatch(
    account: OauthAccount,
    items: SentMessage[],
  ): Promise<number> {
    let inserted = 0;
    for (const item of items) {
      const rows = await this.db
        .insert(emails)
        .values({
          accountId: account.id,
          provider: account.provider,
          providerMessageId: item.providerMessageId,
          fromAddress: item.from.address,
          fromName: item.from.name,
          subject: item.subject,
          snippet: item.snippet,
          sentAt: item.sentAt,
        })
        .onConflictDoNothing({
          target: [emails.provider, emails.providerMessageId],
        })
        .returning({ id: emails.id });
      if (!rows.length) {
        continue;
      }
      inserted += 1;
      const emailId = rows[0].id;
      const recipientRows = [
        ...item.to.map((r) => ({
          emailId,
          accountId: account.id,
          type: 'to' as const,
          normalizedEmail: r.normalizedEmail,
          rawAddress: r.address,
          name: r.name,
        })),
        ...item.cc.map((r) => ({
          emailId,
          accountId: account.id,
          type: 'cc' as const,
          normalizedEmail: r.normalizedEmail,
          rawAddress: r.address,
          name: r.name,
        })),
      ].filter((r) => r.normalizedEmail.length > 0);
      if (recipientRows.length) {
        await this.db.insert(emailRecipients).values(recipientRows);
      }
    }
    return inserted;
  }

  async findByNormalizedEmail(normalizedEmail: string, limit = 100) {
    return this.db
      .select({
        emailId: emails.id,
        providerMessageId: emails.providerMessageId,
        provider: emails.provider,
        subject: emails.subject,
        snippet: emails.snippet,
        sentAt: emails.sentAt,
        accountId: emails.accountId,
        recipientName: emailRecipients.name,
        recipientRawAddress: emailRecipients.rawAddress,
        recipientType: emailRecipients.type,
      })
      .from(emailRecipients)
      .innerJoin(emails, eq(emailRecipients.emailId, emails.id))
      .where(eq(emailRecipients.normalizedEmail, normalizedEmail))
      .orderBy(desc(emails.sentAt))
      .limit(limit);
  }

  async recent(limit = 50) {
    const emailRows = await this.db
      .select()
      .from(emails)
      .orderBy(desc(emails.sentAt))
      .limit(limit);
    if (!emailRows.length) {
      return [];
    }
    const ids = emailRows.map((e) => e.id);
    const recipientRows = await this.db
      .select()
      .from(emailRecipients)
      .where(inArray(emailRecipients.emailId, ids))
      .orderBy(emailRecipients.id);
    const byEmail = new Map<number, (typeof recipientRows)[number][]>();
    for (const r of recipientRows) {
      const list = byEmail.get(r.emailId) ?? [];
      list.push(r);
      byEmail.set(r.emailId, list);
    }
    return emailRows.map((e) => ({
      ...e,
      recipients: byEmail.get(e.id) ?? [],
    }));
  }

  async countByAccount(): Promise<Map<number, number>> {
    const rows = await this.db
      .select({ accountId: emails.accountId, count: count(emails.id) })
      .from(emails)
      .groupBy(emails.accountId);
    return new Map(rows.map((r) => [r.accountId, r.count]));
  }

  async search(query: string, limit = 8) {
    const pattern = `%${query.replace(/[%_\\]/g, '\\$&')}%`;
    const rows = await this.db
      .select({
        normalizedEmail: emailRecipients.normalizedEmail,
        rawAddress: sql<string>`min(${emailRecipients.rawAddress})`.as('raw_address'),
        name: sql<string | null>`min(${emailRecipients.name})`.as('name'),
        count: sql<number>`count(*)`.mapWith(Number).as('cnt'),
        lastSentAt: sql<string | null>`max(${emails.sentAt})`.as('last_sent_at'),
      })
      .from(emailRecipients)
      .innerJoin(emails, eq(emailRecipients.emailId, emails.id))
      .where(
        or(
          ilike(emailRecipients.normalizedEmail, pattern),
          ilike(emailRecipients.rawAddress, pattern),
          ilike(emailRecipients.name, pattern),
        ),
      )
      .groupBy(emailRecipients.normalizedEmail)
      .orderBy(desc(sql`max(${emails.sentAt})`))
      .limit(limit);
    return rows.map((r) => ({
      normalizedEmail: r.normalizedEmail,
      rawAddress: r.rawAddress,
      name: r.name,
      count: Number(r.count),
      lastSentAt: r.lastSentAt ? new Date(r.lastSentAt as unknown as string).toISOString() : null,
    }));
  }
}
