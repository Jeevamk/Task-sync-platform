> **Version 0.3.0 — multi-tenant.** Each organization connects its own Trello, Slack and Google Sheet. Start with **[README-MULTITENANT.md](README-MULTITENANT.md)**. The Step 1 notes below are still useful for local setup (Docker, Prisma, ngrok).

# Task Sync Automation — Backend (Step 1: Project setup)

NestJS backend that keeps Trello, Google Sheets and Slack in step.
This is the **Step 1 starter**: project structure, database schema, local services (PostgreSQL, Redis, n8n) and a health check.

When Step 1 is done, `http://localhost:3000/health` shows all three services as `up`.

---

## Part A — Install the tools (once)

| Tool | Version | Check with |
| --- | --- | --- |
| Node.js | 22 LTS | `node -v` |
| Docker Desktop (includes Docker Compose) | latest | `docker compose version` |
| Git | any | `git --version` |
| VS Code (recommended) | any | — |
| ngrok (needed from Step 2) | latest | `ngrok version` |

Windows users: install Docker Desktop with the **WSL 2** option.

---

## Part B — Create the test tools (once)

Use a **test** board, sheet and channel, not a real project.

### B1. Trello board

1. Create a board named **Task Sync – Test**.
2. Create exactly these 5 lists, in this order: `To Do`, `Assigned`, `In Progress`, `Ready for Testing`, `Completed`.
3. Add 3–4 sample cards in **To Do**.
4. Get your API credentials:
   - Open the Trello Power-Up admin page (`trello.com/power-ups/admin`) and create a new Power-Up/integration for your workspace.
   - Copy the **API key** → `TRELLO_API_KEY`
   - Copy the **Secret** → `TRELLO_APP_SECRET` (used to verify webhooks)
   - Click the link to generate a **Token** and allow read/write access → `TRELLO_TOKEN`

### B2. Google Sheet

1. Create a sheet named **Task Sync – Test Tracker**.
2. Create 5 tabs: `Tasks`, `History`, `Team`, `Settings`, `Errors`.
3. In **Tasks**, row 1, add these headers:
   `Task ID | Title | Status | Assignee | Progress Notes | Blocker | Due Date | Started At | Ready for Testing At | Completed At | Reopen Count | Cycle Time (days) | Trello URL | Last Updated | Last Updated By`
4. In **History**, row 1: `Timestamp | Task ID | Field | Old Value | New Value | Changed By | Source`
5. In **Team**, row 1: `Name | Email | Trello Username | Slack User ID | Role`, then add yourself and 1–2 teammates.
6. Copy the sheet ID from the URL (`docs.google.com/spreadsheets/d/<THIS PART>/edit`) and keep it for Step 2.

### B3. Slack app

1. Create a test channel, e.g. `#proj-test`.
2. Go to `api.slack.com/apps` → **Create New App** → **From scratch** → name it **Task Sync**, pick your workspace.
3. **OAuth & Permissions** → **Bot Token Scopes**, add:
   `chat:write`, `chat:write.public`, `commands`, `users:read`, `users:read.email`, `im:write`
4. Click **Install to Workspace** and copy the **Bot User OAuth Token** (`xoxb-…`) → `SLACK_BOT_TOKEN`
5. **Basic Information** → copy the **Signing Secret** → `SLACK_SIGNING_SECRET`
6. In Slack, open `#proj-test` and type `/invite @Task Sync`.

(The `/task` command and buttons are added in Step 5 and Phase 2.)

---

## Part C — Run the backend

```bash
# 1. Install packages
npm install

# 2. Create your env file and fill in the Trello and Slack values from Part B
cp .env.example .env

# 3. Start PostgreSQL, Redis and n8n
docker compose up -d

# 4. Create the database tables
npx prisma migrate dev --name init

# 5. Start the API (auto-reloads on save)
npm run start:dev
```

Open `http://localhost:3000/health`. You should see:

```json
{
  "status": "ok",
  "checks": {
    "database": { "status": "up" },
    "redis": { "status": "up" },
    "n8n": { "status": "up" }
  },
  "time": "..."
}
```

Then open n8n at `http://localhost:5678`, create the owner account, and add three **Credentials**:

- **Trello API** — API key + token from B1
- **Google Sheets** — sign in with the Google account that owns the test sheet
- **Slack** — bot token from B3

Useful extra commands:

```bash
npm run prisma:studio        # browse the database in the browser
npm run start:worker:dev     # start the worker process (no jobs until Step 2)
docker compose logs -f n8n   # see n8n logs
docker compose down          # stop the services (data is kept)
```

---

## Step 1 checklist

- [ ] `node -v` shows 22.x and `docker compose version` works
- [ ] Trello test board has the 5 lists and sample cards
- [ ] Google Sheet has the 5 tabs with headers
- [ ] Slack app installed and invited to `#proj-test`
- [ ] `.env` filled with Trello and Slack values
- [ ] `npx prisma migrate dev` created the tables
- [ ] `GET /health` returns `"status": "ok"`
- [ ] n8n opens and has Trello, Google Sheets and Slack credentials

---

## Project structure

```text
task-sync-backend/
├── prisma/schema.prisma      # all 7 tables from the technical doc
├── src/
│   ├── main.ts               # API process
│   ├── worker.ts             # queue worker process (jobs from Step 2)
│   ├── app.module.ts
│   ├── worker.module.ts
│   ├── config/               # env validation (app refuses to start if a value is missing)
│   ├── prisma/               # PrismaService
│   ├── redis/                # Redis client
│   └── modules/health/       # GET /health
├── docker/postgres/init.sql  # creates the separate n8n database
├── docker-compose.yml        # PostgreSQL, Redis, n8n for local development
├── Dockerfile                # production image (API + worker)
└── .env.example
```

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `database: down` | Is Docker running? Run `docker compose ps`. Check `DATABASE_URL` matches the compose file. |
| `n8n: down` | n8n takes ~30 s on first start. Check `docker compose logs n8n`. |
| Port 5432 already in use | Another PostgreSQL is running. Stop it, or change the port in `docker-compose.yml` and `DATABASE_URL`. |
| App exits with "Config validation error" | A required value in `.env` is missing or wrong; the message names it. |
