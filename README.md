# SentCheck

A self-hosted web app that indexes everything you send from Gmail and Outlook, so you never cold-DM the same person twice. Paste an email address and SentCheck tells you whether you've already contacted that exact address — with a strict, normalized email match (case, `+tags`, and Gmail dot-variants all collapse to the same key).

## Features

- **Unified sent index** — pulls full Sent folder (Gmail `in:sent` / Graph `SentItems`), then incremental sync every `SYNC_INTERVAL_MINUTES`.
- **Strict normalized match** — case-insensitive, `+tag` stripped, Gmail dots collapsed, no fuzzy/domain matching.
- **Typeahead search** — `Check before you DM` is a debounced typeahead (200ms, `ILIKE` on name/email, deduped, `ArrowUp`/`ArrowDown` + `Enter` to select, auto-check on pick).
- **Mobile-responsive** — sticky header, typeahead dropdown, and recent-sends table collapsing to cards on ≤640px; safe-area insets, 44px touch targets, iOS `16px` input guard.
- **Dark / light mode** — toggle in header, persists to `localStorage`, respects `prefers-color-scheme`, `color-scheme` + `theme-color` meta update.

## Stack

- **NestJS** (Node 24) — `api` global prefix, static assets from `public/` at `/`
- **PostgreSQL 16** via Docker (`5434:5432`, `docker-compose.yml:11`)
- **Drizzle ORM**
- Google Gmail API + Microsoft Graph (both OAuth2, raw REST)
- Vanilla JS + CSS variables (themed `public/style.css:1-43`, `public/app.js:1-435`)

## Prerequisites

- Node 24+, npm, Docker + Docker Compose

## Quick start

1. **Start Postgres**

   ```bash
   docker compose up -d
   ```

2. **Install + configure**

   ```bash
   npm install
   cp .env.example .env
   # edit .env: set TOKEN_ENCRYPTION_KEY (64 hex chars = 32 bytes):
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   # and paste your OAuth credentials (see below)
   ```

3. **Create the schema**

   ```bash
   npm run db:push
   ```

4. **Run**

   ```bash
   npm run start:dev
   ```

   Open http://localhost:3000, click **Connect Gmail** / **Connect Outlook**, then **Sync now**.

> `.env` is gitignored (` .gitignore:4`). Never commit it — ` .env.example` is the template.

## OAuth setup (one-time, manual)

Redirect base is `http://localhost:3000` — callbacks are under `/api/auth/...` because the app uses `app.setGlobalPrefix('api')` (`src/main.ts:9`). The URI you register must **exactly** match `GOOGLE_REDIRECT_URI` / `MICROSOFT_REDIRECT_URI` in `.env`.

### Gmail (Google Cloud Console)

1. Go to https://console.cloud.google.com → create a project.
2. **APIs & Services → Enabled APIs** → enable **Gmail API**.
3. **OAuth consent screen** → External (or Internal if you use a Workspace account). Add your email as a test user.
4. **Credentials → Create credentials → OAuth client ID → Web application**.
   - Authorized redirect URI: `http://localhost:3000/api/auth/gmail/callback`
5. Copy the **Client ID** and **Client Secret** into `.env`:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/gmail/callback
   ```

Scopes requested: `gmail.readonly`, `userinfo.email` (read-only access to sent mail).

### Outlook (Microsoft Azure / Entra)

1. Go to https://portal.azure.com → **Microsoft Entra ID → App registrations → New registration**.
   - Redirect URI: `http://localhost:3000/api/auth/outlook/callback` (Web platform)
2. Under **Certificates & secrets** → create a **New client secret**.
3. Under **API permissions** → add **Microsoft Graph → Delegated → `Mail.Read`** (and `User.Read`, already default).
4. Copy the **Application (client) ID** and the **client secret** into `.env`:
   ```
   MICROSOFT_CLIENT_ID=...
   MICROSOFT_CLIENT_SECRET=...
   MICROSOFT_REDIRECT_URI=http://localhost:3000/api/auth/outlook/callback
   ```

Scopes requested: `Mail.Read`, `offline_access`, `User.Read`.

> For personal (consumer) Microsoft accounts this works with the default `common` authority. For a single-tenant workspace, change the authority URLs in `src/providers/outlook.provider.ts` from `common` to your tenant ID.

## How it works

- On first **Sync**, SentCheck pulls the **full Sent folder** (Gmail `in:sent` / Graph `SentItems`), paginated.
- Then it runs automatically every `SYNC_INTERVAL_MINUTES` (default 15) and fetches only mail sent since the last cursor, upserting by provider message ID (idempotent).
- OAuth tokens are stored **encrypted** (AES-256-GCM) with your `TOKEN_ENCRYPTION_KEY` and auto-refresh when they expire.
- **Typeahead** queries `GET /api/search?q=` (min 2 chars, `ILIKE` on `email_recipients.normalized_email` / `raw_address` / `name`, `GROUP BY normalized_email`, ordered by `max(sent_at)` — `src/sync/emails.repository.ts:113-143`), debounced + aborted on next keystroke.

### Matching rules (strict)

- **Case-insensitive**: `Alice@Acme.com` ≡ `alice@acme.com`
- **`+tags` stripped**: `alice+newsletter@acme.com` ≡ `alice@acme.com`
- **Gmail dot-variant collapsed**: `a.li.ce@gmail.com` ≡ `alice@gmail.com` (also `googlemail.com` → `gmail.com`)
- **No fuzzy/domain matching**: `bob@acme.com` is _not_ flagged because you emailed `alice@acme.com`.

## API

| Method | Path                           | Description                                                                                                        |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| POST   | `/api/check`                   | `{ "email": "..." }` → verdict + prior sends                                                                       |
| GET    | `/api/history?email=`          | Same check, GET variant                                                                                            |
| GET    | `/api/search?q=&limit=`        | Typeahead — `q` min 2 chars, `limit` 1–20 (default 8) → `[{normalizedEmail, rawAddress, name, count, lastSentAt}]` |
| GET    | `/api/sends/recent`            | Latest indexed sends (`?limit=` up to 500)                                                                         |
| GET    | `/api/auth/accounts`           | Connected accounts                                                                                                 |
| GET    | `/api/auth/:provider`          | Start OAuth flow (`gmail` \| `outlook`)                                                                            |
| GET    | `/api/auth/:provider/callback` | OAuth callback                                                                                                     |
| POST   | `/api/auth/disconnect`         | `{ "provider", "accountEmail" }`                                                                                   |
| GET    | `/api/sync/status`             | Per-account sync state + indexed counts                                                                            |
| POST   | `/api/sync/run`                | Trigger a sync immediately                                                                                         |

UI is served statically at `/` (`src/main.ts:12`), API under `/api`.

## Environment variables

See `.env.example:1-17`. Required:

| Name                                                                         | Example                                                 | Notes                                                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------- |
| `PORT`                                                                       | `3000`                                                  |                                                                            |
| `DATABASE_URL`                                                               | `postgres://postgres:postgres@localhost:5434/sentcheck` | matches `docker-compose.yml:11`                                            |
| `TOKEN_ENCRYPTION_KEY`                                                       | `64 hex chars`                                          | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI`          | `http://localhost:3000/api/auth/gmail/callback`         | must match Google console                                                  |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` / `MICROSOFT_REDIRECT_URI` | `http://localhost:3000/api/auth/outlook/callback`       | must match Entra                                                           |
| `SYNC_INTERVAL_MINUTES`                                                      | `15`                                                    |                                                                            |

## Project layout

```
src/
  auth/       OAuth flows, account + token storage
  providers/  Gmail + Outlook clients (list sent mail, token refresh)
  sync/       backfill + incremental sync, email/recipient repositories (search in emails.repository.ts)
  check/      /check, /history, /search, /sends/recent endpoints
  common/     encryption + email normalization helpers
  db/         Drizzle schema + pool
  config/     typed environment config
public/
  index.html  header with theme toggle + typeahead combobox
  style.css   CSS variables dark/light, responsive table→cards
  app.js      theme + typeahead + check + accounts/sync logic
```
