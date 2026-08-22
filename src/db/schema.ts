import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

export const oauthAccounts = pgTable(
  'oauth_accounts',
  {
    id: serial('id').primaryKey(),
    provider: varchar('provider', { length: 20 }).notNull(),
    accountEmail: varchar('account_email', { length: 255 }).notNull(),
    providerUserId: varchar('provider_user_id', { length: 255 }),
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token').notNull(),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    scopes: text('scopes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex('oauth_accounts_provider_email_unique').on(
      t.provider,
      t.accountEmail,
    ),
  ],
);

export const syncStates = pgTable(
  'sync_states',
  {
    id: serial('id').primaryKey(),
    accountId: integer('account_id')
      .notNull()
      .references(() => oauthAccounts.id, { onDelete: 'cascade' }),
    cursor: text('cursor'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastError: text('last_error'),
    syncInProgress: boolean('sync_in_progress').notNull().default(false),
  },
  (t) => [uniqueIndex('sync_states_account_unique').on(t.accountId)],
);

export const emails = pgTable(
  'emails',
  {
    id: serial('id').primaryKey(),
    accountId: integer('account_id')
      .notNull()
      .references(() => oauthAccounts.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 20 }).notNull(),
    providerMessageId: varchar('provider_message_id', {
      length: 255,
    }).notNull(),
    fromAddress: varchar('from_address', { length: 255 }),
    fromName: varchar('from_name', { length: 255 }),
    subject: text('subject'),
    snippet: text('snippet'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    syncedAt: timestamp('synced_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex('emails_provider_msg_unique').on(
      t.provider,
      t.providerMessageId,
    ),
    index('emails_sent_at_idx').on(t.sentAt),
  ],
);

export const emailRecipients = pgTable(
  'email_recipients',
  {
    id: serial('id').primaryKey(),
    emailId: integer('email_id')
      .notNull()
      .references(() => emails.id, { onDelete: 'cascade' }),
    accountId: integer('account_id')
      .notNull()
      .references(() => oauthAccounts.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 10 }).notNull(),
    normalizedEmail: varchar('normalized_email', { length: 255 }).notNull(),
    rawAddress: varchar('raw_address', { length: 255 }),
    name: varchar('name', { length: 255 }),
  },
  (t) => [
    index('email_recipients_norm_email_idx').on(t.normalizedEmail),
    index('email_recipients_account_idx').on(t.accountId),
  ],
);

export type OauthAccount = typeof oauthAccounts.$inferSelect;
export type SyncState = typeof syncStates.$inferSelect;
export type Email = typeof emails.$inferSelect;
export type EmailRecipient = typeof emailRecipients.$inferSelect;
