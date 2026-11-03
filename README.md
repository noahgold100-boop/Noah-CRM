# Noah Gold — Contacts

A private relationship CRM for one person. It reads Gmail (read-only), keeps every industry contact up to date, and puts follow-up reminders on Google Calendar. Nothing has to be typed in by hand.

## What it does

- **Creative** and **Business** tabs, each filterable by role and color, with search.
- **Three colors.** Each row's colored dot is the dropdown to change it.
  - Green: keep talking. Calendar reminder 3 weeks after the last communication.
  - Yellow: potential lead. Reminder 2 months after the last communication.
  - Red: not worth your time. No reminder, and any existing one is removed.
- **One sentence on the last conversation** and **one sentence to remember**, written from the email.
- **Every morning** it reads new email (sent and received), updates contacts, adds new industry people (tagged New), and moves the reminder whenever there's new contact. It never creates duplicate reminders.
- **First-run import** reads the last 12 months of email. Everything found waits in one review screen until Noah approves it. Reminders are set only after approval.
- **Hit list.** A researched list of long-shot producers, executives, managers, financiers and festival or lab champions who fit his work. Each entry shows why they fit, the budget and deal scale they work at, notable work, the realistic way in, when to reach out, and sources. If one of them replies with interest, they're marked Very important, added as Green, and get a 3-week reminder. The list re-verifies and adds new names monthly.
- **Calendly (optional).** Paste a token in Settings and booked meetings are logged automatically.

### How it handles data

- Gmail access is read-only. It never sends, replies, labels, archives or deletes.
- It only creates, moves or deletes calendar events it made itself. Each one is tagged with the contact's id, and no other event is ever touched.
- Newsletters, promotions, receipts, automated notifications, notes to self and anyone on the "Never track" list are filtered out before anything is sent to Claude.
- Manual changes always win. Once Noah sets a color, the sync never changes it.
- Only `OWNER_EMAIL` can sign in. Google and Calendly tokens are encrypted at rest.

---

## Deploy (about 20 minutes)

Do every step while signed into **Noah's** accounts, so the app belongs to him.

### 1. GitHub and Vercel
1. Push this folder to a new private GitHub repo.
2. In Vercel, click **Add New → Project** and import the repo. Leave the build settings at their defaults. The first deploy will fail until the variables below are set, which is expected.
3. Go to Vercel → the project → **Storage → Create Database → Neon (Postgres)** and connect it to the project. This adds `DATABASE_URL` for you. The tables are created automatically on first use.

### 2. Google Cloud (sign-in, Gmail, Calendar)
1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project named "Noah CRM".
2. Under **APIs & Services → Library**, enable **Gmail API** and **Google Calendar API**.
3. Under **APIs & Services → OAuth consent screen** (Google Auth Platform):
   - User type: **External**. App name: "Noah CRM". Use Noah's email for support and developer contact.
   - Data access / scopes: add `.../auth/gmail.readonly` and `.../auth/calendar.events`.
   - Audience: add `noahgold100@gmail.com` as a test user, then click **Publish app** to move it to **In production**.
     *This matters. In "Testing", Google expires the sign-in every 7 days. In production with under 100 users, no Google review is required. Noah will see a one-time "Google hasn't verified this app" screen; he clicks Advanced, then "Go to Noah CRM".*
4. Under **Credentials → Create credentials → OAuth client ID**:
   - Type: **Web application**
   - Authorized redirect URIs: `https://YOUR-DOMAIN/api/auth/callback` (and `http://localhost:3000/api/auth/callback` for local development)
   - Copy the Client ID and Client secret.

### 3. Claude API key
At [console.anthropic.com](https://console.anthropic.com), under Noah's account or organization, go to **API keys → Create key**. Add a small monthly spend limit if you like. Typical cost is a few dollars for the first import and cents per day after that.

### 4. Environment variables
In Vercel → **Settings → Environment Variables** (Production), add everything in `.env.example`:

| Name | Value |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | From step 2 |
| `ANTHROPIC_API_KEY` | From step 3 |
| `SESSION_SECRET` | Random, 32+ characters (`openssl rand -base64 48`) |
| `CRON_SECRET` | Random string |
| `OWNER_EMAIL` | `noahgold100@gmail.com` |
| `APP_URL` | `https://YOUR-DOMAIN` (no trailing slash; must match the redirect URI) |

Then **Redeploy**.

### 5. First run (Noah)
1. Open the site and click **Sign in with Google**. Allow Gmail (read) and Calendar.
2. Follow the three setup steps on the home screen:
   1. **Tell the CRM about your work.** Add scripts, credits, school and representation. This sharpens the email sorting and the hit list.
   2. **Import contacts from your email.** It reads 12 months in short steps with progress shown. If the tab is closed, it continues on its own each morning.
   3. **Build your hit list.** Five research steps, about a minute or two each.
3. Click **Review**, fix any colors that are off, and click **Approve**. Reminders appear on his calendar.

From then on, it runs by itself every morning.

---

## Schedules (`vercel.json`)

| Job | When | What |
|---|---|---|
| `/api/cron/daily` | Daily, 13:45 UTC (7:45 am Central) | New email → contacts → calendar. Also continues an unfinished import. |
| `/api/cron/hitlist` | 1st and 2nd of each month | Day 1: re-verify the 10 oldest entries. Day 2: add up to 5 new names. |

On Vercel's free Hobby plan, scheduled jobs run once a day and may start any time within that hour. To check email twice a day, upgrade to Pro and add a second entry, e.g. `"45 23 * * *"`. Vercel's Hobby plan is for non-commercial use, so if this is used for the business, Pro is the appropriate plan.

## Local development

```bash
cp .env.example .env.local   # fill in values; DATABASE_URL must be a Neon connection string
npm install
npm run dev                  # http://localhost:3000
npm test                     # follow-up date rules and email parsing
TEST_PG_URL=postgres://user@localhost:5432/db npm run test:db   # SQL + sync tests against a local Postgres
```

## Troubleshooting

- **"This CRM is private. Signed in as …"** The Google account doesn't match `OWNER_EMAIL`.
- **"Reconnect Google" banner.** Google revoked access (password change, or the consent screen was left in Testing). Click Reconnect.
- **"Google did not return offline access."** Remove the app at [myaccount.google.com/permissions](https://myaccount.google.com/permissions) and sign in again.
- **Reminders not appearing.** Contacts from the import wait for Review. Red contacts never get reminders. Settings shows the last run and any calendar errors.
- **Overdue follow-ups.** When importing old conversations, overdue reminders are spread across the next weekdays, at most three per day, so nothing piles up. Weekend dates move to Monday.

## Project layout

```
app/                    pages and API routes (auth, contacts, review, sync, hit list, settings, cron)
components/             the interface (App, Review, Settings, HitList, AddContact)
lib/sync.ts             reads Gmail → Claude → contacts → calendar
lib/claude.ts           thread classification and web-search research
lib/calendar.ts         reminder create/move/delete (only its own events)
lib/dates.ts            the 3-week / 2-month rules
lib/hitlist.ts          hit list research, verification and priority
lib/gmail.ts            Gmail parsing and the junk filter
tests/                  unit and integration tests
```
