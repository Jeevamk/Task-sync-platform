# Taskvane — Multi-tenant version (0.3.0)

Each **organization** (customer team) now connects **its own** Trello, Slack and Google Sheet.
Nothing customer-specific lives in code or `.env` any more.

## What changed

| Before (0.2) | Now (0.3) |
| --- | --- |
| One Trello token, one Slack bot token in `.env` | Each organization clicks **Connect Trello** / **Add to Slack**; tokens are stored **encrypted** (AES-256-GCM) per organization |
| `config/project.json` + `setup:project` script | `POST /orgs/:orgId/projects` checks the board, the sheet sharing and the Slack channel, registers the webhook and imports the cards |
| Team list in a JSON file | `POST /orgs/:orgId/team` — Slack ID found by email, Trello ID by username |
| n8n WF1 wrote the sheet and posted to Slack (your credentials only) | The **backend** delivers to each organization's own sheet and Slack. Each finished step is remembered, so a retry never writes twice. n8n is **optional** (forward events to your own automations) |
| No login | Google sign-in (`/auth/google`) or local **dev login**; every `/orgs/:orgId/...` route checks membership |
| — | Interactive API docs at **`/docs`** |

New tables: `organizations`, `users`, `memberships`, `connections` (encrypted tokens), `oauth_states`.
`projects` and `team_members` now belong to an organization.

---

## Part A — Upgrade your local project

1. Stop the backend (Ctrl+C).
2. Copy the new files over your project (**keep your `.env`**). Delete the old files that no longer exist:
   ```powershell
   Remove-Item -Force scripts\setup-project.js, scripts\trello-webhook.js -ErrorAction SilentlyContinue
   Remove-Item -Recurse -Force config -ErrorAction SilentlyContinue
   ```
3. Install packages:
   ```powershell
   npm install
   ```
4. Update `.env` — compare with `.env.example`. New values:

   | Variable | Where it comes from |
   | --- | --- |
   | `TOKEN_ENCRYPTION_KEY` | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `JWT_SECRET` | Generate the same way |
   | `ALLOW_DEV_LOGIN=true` | Local only |
   | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | Slack app → **Basic Information → App Credentials** |
   | `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` | From the service account JSON (`client_email`, `private_key`). Put the key in **double quotes**, keep the `\n` |

   You can delete `TRELLO_TOKEN` and `SLACK_BOT_TOKEN` (customers connect their own now).
   Keep `TRELLO_API_KEY` and `TRELLO_APP_SECRET` (your app).

5. **Reset the local database** (test data only) and create the new tables:
   ```powershell
   docker compose up -d
   npx prisma migrate reset --force
   npm run prisma:migrate -- --name multi-tenant
   ```
6. Check:
   ```powershell
   npm test            # signature, unit and app-level self-tests
   npm run start:dev
   ```
   Open `http://localhost:3000/docs` — you should see the **Taskvane API** page.

---

## Part B — One-time settings in YOUR Trello and Slack apps

Replace `<PUBLIC_BASE_URL>` with your ngrok address now (later your Vercel address).

**Trello** (trello.com/power-ups/admin → your Power-Up → **API key**)
- Under **Allowed origins**, add `<PUBLIC_BASE_URL>` (e.g. `https://escapable-smugly-yelp.ngrok-free.dev`).
  Trello only sends the user back to addresses listed here.

**Slack** (api.slack.com/apps → Taskvane)
1. **OAuth & Permissions → Redirect URLs → Add** `<PUBLIC_BASE_URL>/connect/slack/callback` → **Save URLs**.
2. **OAuth & Permissions → Bot Token Scopes**: make sure these exist:
   `chat:write, chat:write.public, commands, users:read, users:read.email, im:write, channels:read, groups:read`
3. **Manage Distribution → Activate Public Distribution** (needed so *other* workspaces can install it).
   Slack shows a short checklist (HTTPS redirect URL, no hard-coded tokens) — tick it and activate.

**Google** — nothing to change: customers share their sheet with `GOOGLE_SERVICE_ACCOUNT_EMAIL`.

---

## Part C — Try it as a customer (with Swagger, no web app yet)

Open `<PUBLIC_BASE_URL>/docs` (or `http://localhost:3000/docs`).

1. **Log in** — `POST /auth/dev-login` → *Try it out* → `{ "email": "you@gmail.com", "name": "Your Name" }` → copy `token`.
   Click **Authorize** (top right) → paste the token → Authorize.
2. **Create your organization** — `POST /orgs` → `{ "name": "Acme Dev Team" }` → copy `id` (this is `orgId`).
3. **Connect Trello** — `POST /orgs/{orgId}/connections/trello/start` → open the `authorizeUrl` in the browser → **Allow**
   → the page says *✅ Trello connected*.
4. **Add to Slack** — `POST /orgs/{orgId}/connections/slack/start` → open `authorizeUrl` → pick the workspace → **Allow**
   → *✅ Taskvane was added to the Slack workspace …*
5. **Check** — `GET /orgs/{orgId}` → both connected, and `googleSheets.shareWith` shows the email to share the sheet with.
6. **Sheet** — copy the tracker template (tabs `Tasks`, `History`, …), **Share** it with that email as **Editor**.
7. **Pick a channel** — `GET /orgs/{orgId}/slack/channels` → copy the `id` of your channel.
   (Private channel? First type `/invite @Taskvane` in it.)
8. **Team** — `POST /orgs/{orgId}/team` for each person, e.g.
   `{ "name": "Jeeva", "email": "you@gmail.com", "role": "COORDINATOR", "trello": "your-trello-username" }`.
   The response's `notes` show what was matched in Trello and Slack.
9. **Project** — `POST /orgs/{orgId}/projects`:
   ```json
   {
     "name": "Website Revamp",
     "trelloBoard": "https://trello.com/b/AbC12xYz/website-revamp",
     "sheet": "https://docs.google.com/spreadsheets/d/1Qqwr…/edit",
     "slackChannelId": "C0123456789"
   }
   ```
   It checks the board, the lists, the sheet sharing and the channel; registers the Trello webhook; imports the cards.
   Each imported card gets a **Tasks** row and a **Slack** message.
10. **Move a card in Trello** → the sheet and Slack update, exactly like before — but now with **this organization's** tools.

A second organization (another login, another Trello/Slack/sheet) works the same way and never sees the first one's data.

---

## Sheet Import tab (Apps Script)

Unchanged: `API_URL` = your public address, `SYNC_SECRET` = `SHEET_SYNC_SECRET`.
The editor must be a **COORDINATOR in the team of the organization that owns that sheet**.

## n8n (optional now)

Delivery no longer needs n8n. To also send every event to your own n8n workflow, set
`N8N_EVENT_WEBHOOK_URL` (and `N8N_EVENT_SIGNING_SECRET`). The old WF1 can stay switched off.

---

## Troubleshooting

| Message | Fix |
| --- | --- |
| `Config validation error … "TOKEN_ENCRYPTION_KEY" …` | A new `.env` value is missing (Part A step 4) |
| Trello page: *"Invalid return_url"* | Add `<PUBLIC_BASE_URL>` to the Power-Up's **Allowed origins** (Part B) |
| Slack: *"redirect_uri did not match any configured URIs"* | Add the exact callback URL in Slack → OAuth & Permissions (Part B) |
| Slack: *"This app is not distributed"* when installing in another workspace | Activate public distribution (Part B) |
| `Connect Trello first` / `Add Taskvane to Slack first` | Do Part C steps 3–4 for that organization |
| `Google Sheets 403 … share the sheet with …` | Share the sheet with the service account email as **Editor** |
| `The board is missing these lists` | Rename the lists in Trello, or send `"lists": { "IN_PROGRESS": "Doing" }` |
| `Trello webhook not registered yet` (warning) | The API wasn't reachable at `PUBLIC_BASE_URL`. Start ngrok, then `POST /orgs/{orgId}/projects/{id}/webhook` |
| `This connect link expired` | Links last 10 minutes and work once — start again |
| You changed `TOKEN_ENCRYPTION_KEY` | Stored tokens can't be read: every organization must connect Trello and Slack again |

## Deploying (Vercel)

Set **all** `.env` values in Vercel → Project → Settings → Environment Variables, with:
`PUBLIC_BASE_URL=https://<your-app>.vercel.app`, `ALLOW_DEV_LOGIN=false`, `NODE_ENV=production`, Neon `DATABASE_URL` / `DIRECT_URL`.
Then add the Vercel address to Trello **Allowed origins** and the Slack **Redirect URL** (Part B), and run
`npx prisma migrate deploy` against Neon.
