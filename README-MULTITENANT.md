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
| No login | **Sign in with Google** on the site (`task-sync-FE`, page `/login/`, which calls `/auth/google`), or local **dev login**; every `/orgs/:orgId/...` route checks membership. Scripts and MCP clients use **access tokens** (`/auth/tokens`) |
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
   | `MONGODB_URI` | Atlas → your cluster → **Connect → Drivers** (`mongodb+srv://…/taskvane`), or `mongodb://localhost:27017/taskvane` locally. Replaces `DATABASE_URL` / `DIRECT_URL` (delete those) |
   | `MONGODB_DB` | Optional database name (defaults to the one in `MONGODB_URI`, else `taskvane`) |
   | `TOKEN_ENCRYPTION_KEY` | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `JWT_SECRET` | Generate the same way |
   | `ALLOW_DEV_LOGIN=true` | Local only |
   | `GOOGLE_OAUTH_CLIENT_ID` | Google Cloud Console → **Credentials** → your OAuth client (Web application). The site's Sign in button uses the **same** ID (Part B) |
   | `WEB_APP_URL` | The site's address (`task-sync-FE`), e.g. `http://localhost:3001` locally. The API only accepts browser requests from it (CORS), so sign-in fails without it |
   | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | Slack app → **Basic Information → App Credentials** |
   | `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` | From the service account JSON (`client_email`, `private_key`). Put the key in **double quotes**, keep the `\n` |

   You can delete `TRELLO_TOKEN` and `SLACK_BOT_TOKEN` (customers connect their own now).
   Keep `TRELLO_API_KEY` and `TRELLO_APP_SECRET` (your app).

5. **Database**: point `MONGODB_URI` at an Atlas cluster or a local MongoDB. Nothing to migrate: the API creates
   its collections and indexes when it starts.
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
   `chat:write, chat:write.public, commands, users:read, users:read.email, im:write, channels:read, groups:read, channels:manage, channels:join`
   (`channels:manage` and `channels:join` are for `slackChannelId: "new"`; workspaces connected before must click **Add to Slack** again.)
3. **Manage Distribution → Activate Public Distribution** (needed so *other* workspaces can install it).
   Slack shows a short checklist (HTTPS redirect URL, no hard-coded tokens) — tick it and activate.

**Google** — customers either share their own sheet with `GOOGLE_SERVICE_ACCOUNT_EMAIL`, or use **Connect Google** and
`sheet: "new"` (Taskvane creates the sheet in the customer's Drive). For Connect Google, in Google Cloud Console:

1. **APIs & Services → Library**: enable **Google Sheets API** and **Google Drive API**.
2. **OAuth consent screen**: add the scope `https://www.googleapis.com/auth/drive.file` (plus `openid`, `email`).
   While the app is in *Testing*, only the listed test users can connect.
3. **Credentials → your OAuth client (Web application) → Authorized redirect URIs**: add
   `<PUBLIC_BASE_URL>/connect/google/callback`.
4. Put the client's secret in `.env` as `GOOGLE_OAUTH_CLIENT_SECRET` (the client ID is `GOOGLE_OAUTH_CLIENT_ID`).

**Sign in with Google** (the site's `/login/` page). Same OAuth client, in Google Cloud Console:

1. **Credentials → your OAuth client → Authorized JavaScript origins**: add every address the site runs on, without a
   path or `/` at the end: `http://localhost:3001` and `http://localhost` (local), and the live site, e.g.
   `https://taskvane.vercel.app`. No redirect URI is needed for this.
2. **OAuth consent screen**: `openid`, `email` and `profile` are enough. While the app is in *Testing*, only the listed
   test users can sign in; **Publish** it to let anyone sign in.
3. On the **site** (`task-sync-FE`), set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` to the client ID (only the ID, never the secret).
4. On the **API**, set `WEB_APP_URL` to the site's address.

Users then only click **Sign in with Google**: they never see the client ID, the secret or Vercel.

---

## Part C — Try it as a customer (with Swagger, no web app yet)

Open `<PUBLIC_BASE_URL>/docs` (or `http://localhost:3000/docs`).

1. **Sign in** — open the site's `/login/` page (`http://localhost:3001/login/` locally) → **Sign in with Google** →
   copy the token. Or, locally with `ALLOW_DEV_LOGIN=true`: `POST /auth/dev-login` → *Try it out* →
   `{ "email": "you@gmail.com", "name": "Your Name" }` → copy `token`.
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
| Sign in page: *Could not reach the Taskvane API* | Set `WEB_APP_URL` on the API to the site's exact address, then restart/redeploy the API |
| Google: *origin_mismatch* | Add the site's address to **Authorized JavaScript origins** (Part B) |
| `Google sign-in could not be verified` | The site's `NEXT_PUBLIC_GOOGLE_CLIENT_ID` differs from the API's `GOOGLE_OAUTH_CLIENT_ID` |
| Vercel: `500 FUNCTION_INVOCATION_FAILED` | Open the project's **Logs** tab (not Build Logs) and the failed request. `Startup failed: …` names a missing setting or the database. *No exports found in module src/main.js* means `main.ts` lost its `export default handler` |
| Vercel: `503 The API could not start` | Startup failed (see **Logs** for `Startup failed: …`). Usually a missing environment variable, or Atlas Network Access not allowing `0.0.0.0/0` |

## Deploying (Vercel)

Set **all** `.env` values in Vercel → Project → Settings → Environment Variables, with:
`PUBLIC_BASE_URL=https://<your-app>.vercel.app`, `ALLOW_DEV_LOGIN=false`, `NODE_ENV=production`, and your Atlas
`MONGODB_URI` (`mongodb+srv://…`). In Atlas → **Network Access**, allow `0.0.0.0/0` (Vercel has no fixed IP addresses).
Then add the Vercel address to Trello **Allowed origins** and the Slack **Redirect URL** (Part B).
There is no migrate step: the API creates its indexes when it starts.

For **Sign in with Google**, also set `WEB_APP_URL` to the live site's address and add that address to the OAuth
client's **Authorized JavaScript origins** (Part B). On the site's own Vercel project, set `NEXT_PUBLIC_API_URL` (this
API's address) and `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.

After changing environment variables, **redeploy** (Deployments → ⋯ → Redeploy): a deployment keeps the values it was
built with. Then open `https://<your-app>.vercel.app/health`: `"status": "ok"` and `"database": { "status": "up" }`.

How it runs on Vercel: `src/main.ts` exports a request handler (`export default handler`), which Vercel calls for every
request. The app starts on the first request of each function instance and is reused while the instance stays warm.
Locally (no `VERCEL` variable) the same file listens on `PORT` as usual. No Dockerfile is needed.
