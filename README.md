# Taskvane

Taskvane keeps **Trello**, a **Google Sheet** and **Slack** in step for a team.
Work happens in Trello as usual. Every change is recorded and shown automatically:

- the **Google Sheet** gets one row per task (status, assignee, dates, cycle times) and a full change **History**;
- **Slack** gets one thread per task, with an update for every move, assignment and note;
- the **team rules** (who may move a card where) are checked, and broken rules are flagged to the coordinator.

> This page is the **user guide**: how to set Taskvane up for your team and use it day to day.
> To install or run the backend itself, see **[README-MULTITENANT.md](README-MULTITENANT.md)** (developer setup, `.env`, deploying).

---

## Contents

1. [How it works](#1-how-it-works)
2. [Before you start](#2-before-you-start)
3. [Set up your team (one time)](#3-set-up-your-team-one-time)
   - [Step 1: Log in](#step-1-log-in)
   - [Step 2: Create your organization](#step-2-create-your-organization)
   - [Step 3: Connect Trello](#step-3-connect-trello)
   - [Step 4: Add Taskvane to Slack](#step-4-add-taskvane-to-slack)
   - [Step 5: Prepare the Google Sheet](#step-5-prepare-the-google-sheet)
   - [Step 6: Pick the Slack channel](#step-6-pick-the-slack-channel)
   - [Step 7: Add your team members](#step-7-add-your-team-members)
   - [Step 8: Create a project](#step-8-create-a-project)
4. [Daily use](#4-daily-use)
5. [Creating cards from outside Trello](#5-creating-cards-from-outside-trello)
6. [Team rules (who may move what)](#6-team-rules-who-may-move-what)
7. [What you see in the sheet](#7-what-you-see-in-the-sheet)
8. [What you see in Slack](#8-what-you-see-in-slack)
9. [Managing projects and the team](#9-managing-projects-and-the-team)
10. [Troubleshooting](#10-troubleshooting)
11. [API reference](#11-api-reference)

---

## 1. How it works

```text
            you move / edit a card
                     │
                     ▼
   ┌──────────┐   webhook   ┌──────────────────┐        ┌──────────────────────┐
   │  Trello  │ ──────────▶ │  Taskvane API   │ ─────▶ │ Google Sheet         │
   │  board   │             │  • records task  │        │  Tasks + History     │
   └──────────┘ ◀────────── │  • checks rules  │        └──────────────────────┘
        ▲     creates cards │  • keeps history │        ┌──────────────────────┐
        │                   └──────────────────┘ ─────▶ │ Slack channel        │
        │                          ▲                    │  one thread per task │
  Sheet "Import" tab ──────────────┘                    └──────────────────────┘
  or POST …/cards (API)
```

**Words used in this guide**

| Word | Meaning |
| --- | --- |
| **Organization** | Your team or company in Taskvane. It has its own Trello, Slack, sheet and team list. Organizations never see each other's data. |
| **Project** | One Trello board, linked to one Google Sheet and one Slack channel. An organization can have many projects. |
| **Team member** | A person in your organization's team list, with a role: `COORDINATOR`, `DEV` or `QA`. |
| **Task** | A Trello card that Taskvane tracks. It gets a key like `TASK-12`. |
| **Status lists** | The 5 Trello lists that mean a status: **To Do → Assigned → In Progress → Ready for Testing → Completed**. |

---

## 2. Before you start

You need:

| What | Notes |
| --- | --- |
| The Taskvane address | e.g. `https://your-app.vercel.app` (or an ngrok address while testing). Below it is written `<API>`. |
| A Trello account | It must be able to see (and change) the board you want to sync. |
| Slack admin rights, or permission to install apps | Only for Step 4. |
| A Google account | To own the sheet and share it with Taskvane. |

There is no web app yet, so all steps below use the **interactive API page** at **`<API>/docs`**:

1. Open `<API>/docs`.
2. Click an endpoint (for example `POST /orgs`), then **Try it out**.
3. Fill the parameters and the request body, then click **Execute**.
4. The response appears under it.

> Every example below can also be sent with `curl` or Postman. Add the header
> `Authorization: Bearer <your token>` to every request after Step 1.

---

## 3. Set up your team (one time)

### Step 1: Log in

| Where | Endpoint |
| --- | --- |
| Testing / local | `POST /auth/dev-login` (only when the server has `ALLOW_DEV_LOGIN=true` and is not in production) |
| Production | `POST /auth/google` with a Google sign-in ID token (used by the web app) |

Dev login body:

```json
{ "email": "you@company.com", "name": "Your Name" }
```

Response:

```json
{ "token": "eyJhbGciOi…", "user": { "id": "…", "email": "you@company.com", "name": "Your Name" } }
```

Copy the **`token`**. On the `/docs` page, click **Authorize** (top right), paste the token and click **Authorize**.
Every request you make on the page now sends it. The token is valid for **7 days**; log in again if you get `401 Unauthorized`.

`GET /auth/me` shows who you are and which organizations you belong to.

### Step 2: Create your organization

`POST /orgs`

```json
{ "name": "Acme Dev Team" }
```

Copy the **`id`** from the response. This is your **`orgId`**; almost every other request needs it.

> ⚠️ **Create the organization once.** The team list, Trello, Slack and projects all belong to one organization.
> If you create a second organization by accident and add the team to one and the project to the other,
> Taskvane will not recognise your team on that board (every move is then flagged as "not allowed").
> `GET /orgs` lists your organizations, so you can check which `orgId` you are using.

### Step 3: Connect Trello

1. `POST /orgs/{orgId}/connections/trello/start`
2. Open the **`authorizeUrl`** from the response in your browser.
3. Log in to Trello if asked, then click **Allow**.
4. The page shows **✅ Trello connected**. You can close it.

Taskvane now acts in Trello **as this Trello account**: it reads the boards this account can see, registers the
webhook, and creates cards. Use an account that is a member of every board you want to sync.

> The connect link works **once** and only for **10 minutes**. If it expired, start again from step 1.

### Step 4: Add Taskvane to Slack

1. `POST /orgs/{orgId}/connections/slack/start`
2. Open the **`authorizeUrl`** in your browser.
3. Pick your Slack workspace (top right) and click **Allow**.
4. The page shows **✅ Taskvane was added to the Slack workspace …**

Check both connections with `GET /orgs/{orgId}`:

```json
{
  "id": "a656f57d-…",
  "name": "Acme Dev Team",
  "connections": {
    "trello": { "connected": true, "account": "Athira Shivaram (@athirashivaram)", "since": "…" },
    "slack":  { "connected": true, "account": "Acme workspace", "since": "…" }
  },
  "googleSheets": { "shareWith": "tasksync@your-project.iam.gserviceaccount.com", "howTo": "Share your tracker sheet with this email as Editor" },
  "projects": 0,
  "teamMembers": 0
}
```

Note the **`googleSheets.shareWith`** email: you need it in the next step.

### Step 5: Prepare the Google Sheet

1. Create a new Google Sheet (one sheet per project), e.g. **Website Revamp – Tracker**.
2. Add a tab named exactly **`Tasks`**. In **row 1**, put the column headers you want.
   Only **`Task ID`** is required. Taskvane fills these columns when they exist (any order, extra columns are fine):

   `Task ID | Trello Card ID | Title | Description | Status | Assignee | Labels / Priority | Due Date | Created At | Picked Up At | Started At | Ready for Testing At | Completed At | Reopen Count | Progress Notes | Trello URL | Last Updated | Last Updated By`

   Columns with other names (your own notes, formulas such as cycle time) are **never overwritten**.
3. Add a tab named **`History`** (recommended). Row 1:

   `Timestamp | Task ID | Field | Old Value | New Value | Changed By | Source`

   Without it, the project still works but no change history is written to the sheet.
4. Click **Share** and add the **`shareWith`** email from Step 4 as **Editor**. Untick "Notify people".
5. Keep the sheet's link; you need it in Step 8.

> Want to create cards from the sheet too? See [Section 5](#option-a-from-the-google-sheet-import-tab).

### Step 6: Pick the Slack channel

`GET /orgs/{orgId}/slack/channels` lists the channels of the connected workspace:

```json
[ { "id": "C0123456789", "name": "proj-website", "is_private": false, "is_member": true } ]
```

Copy the **`id`** of the channel where updates should go.

- **Public channel**: nothing else to do.
- **Private channel**: first open it in Slack and type `/invite @Taskvane`, otherwise the project cannot post there.

### Step 7: Add your team members

Taskvane needs the team list to know **who** moved a card (for the rules, Slack mentions and the "Assignee" column).
Add every person who works on your boards:

`POST /orgs/{orgId}/team`

```json
{
  "name": "Athira",
  "email": "athira@company.com",
  "role": "COORDINATOR",
  "trello": "@athirashivaram"
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `name` | yes | Shown in the sheet and in Slack. |
| `email` | yes | Use the **same email as their Slack account**: the Slack user is found by it, so they get `@mentions`. Sending the same email again **updates** the member. |
| `role` | yes | `COORDINATOR`, `DEV` or `QA`. See [Team rules](#6-team-rules-who-may-move-what). |
| `trello` | strongly recommended | Their Trello **username**, with or without `@` (Trello → profile picture → Profile shows `@username`), or the member ID. Without it, their moves in Trello are not recognised. |
| `slackUserId` | no | Leave empty; it is found by email. |

The response's **`notes`** say what was matched, e.g. *"Trello: Athira Shivaram (@athirashivaram)"*,
*"Slack: found by email"*. Read them: an unmatched Trello or Slack account is the most common setup mistake.

- At least **one `COORDINATOR`** is needed: coordinators may make any normal move and are the only ones who can import cards from the sheet.
- `GET /orgs/{orgId}/team` lists the team.

### Step 8: Create a project

`POST /orgs/{orgId}/projects`

**Option A: use an existing board**

```json
{
  "name": "Website Revamp",
  "trelloBoard": "https://trello.com/b/AbC12xYz/website-revamp",
  "sheet": "https://docs.google.com/spreadsheets/d/1Qqwr…/edit",
  "slackChannelId": "C0123456789"
}
```

`GET /orgs/{orgId}/trello/boards` lists the boards the connected Trello account can see, if you need the link.

**Option B: let Taskvane create a new board** with all 5 lists and your team on it:

```json
{
  "name": "Website Revamp",
  "trelloBoard": "new",
  "newBoardName": "Website Revamp",
  "sheet": "https://docs.google.com/spreadsheets/d/1Qqwr…/edit",
  "slackChannelId": "C0123456789",
  "extraLists": ["Backlog", "Ideas"]
}
```

**All options**

| Field | Notes |
| --- | --- |
| `name` | Project name (required). |
| `trelloBoard` | Board link, short code or ID, or `"new"` (required). |
| `sheet` | Sheet link or ID (required). One sheet can be used by one project only. |
| `slackChannelId` | From Step 6 (required). |
| `lists` | Only if your lists have other names, e.g. `{ "IN_PROGRESS": "Doing", "COMPLETED": "Done" }`. Statuses: `TODO`, `ASSIGNED`, `IN_PROGRESS`, `READY_FOR_TESTING`, `COMPLETED`. |
| `createMissingLists` | `true` = create any status list the board is missing instead of failing. Always on for `"new"`. |
| `extraLists` | Extra lists such as `["Backlog"]`, created at the **left** of the board if missing. Cards in them are **not tracked** (no sheet row, no Slack). Works for new and existing boards. |
| `newBoardName`, `trelloWorkspaceId` | Only with `"new"`: the board name (default: project name) and the Trello workspace to create it in. |

What happens:

1. **Checks first, nothing is changed yet**: the board is visible and not used by another project, the sheet is shared and has a `Tasks` tab with `Task ID`, the bot can post in the channel.
2. **Board setup**: the board is created (Option B), the 5 status lists are found (or created), extra lists are added.
3. **Webhook**: Trello is told to send every change on the board to Taskvane.
4. **Import**: every open card in the status lists becomes a task: a **Tasks** row and a **Slack** message each.

Response:

```json
{
  "project": { "id": "…", "name": "Website Revamp", "board": "Website Revamp", "boardUrl": "https://trello.com/b/…",
               "sheet": "Website Revamp – Tracker", "slackChannel": "#proj-website" },
  "webhook": { "id": "…", "callback": "<API>/webhooks/trello" },
  "imported": { "imported": 4, "skipped": 0 },
  "warnings": ["Created the extra list \"Backlog\" on the board (cards there are not tracked)"]
}
```

Always read **`warnings`**. If `webhook` is `null`, see [Troubleshooting](#10-troubleshooting).

**Setup is done.** 🎉 From now on, just work in Trello.

---

## 4. Daily use

Work in Trello as you normally do. Each action below is picked up within a few seconds:

| You do this in Trello | Taskvane does this |
| --- | --- |
| **Create a card** in a status list | New task `TASK-n`; new **Tasks** row; new **Slack** message (the start of that task's thread). |
| **Add a member** to the card | Assignee is set; Slack: *"👤 @Athira is now working on this"*. If the card was in **To Do**, it is **moved to Assigned** automatically. |
| **Remove the member** | Assignee is cleared; Slack note. |
| **Move the card** to another status list | Status changes; the matching time column is filled (*Picked Up At*, *Started At*, *Ready for Testing At*, *Completed At*); Slack thread update. |
| Move to **In Progress** with nobody assigned | The person who moved it **becomes the assignee**. |
| Move to **Ready for Testing** | Slack also posts *"🧪 Ready for testing — QA, please pick it up."* to the channel. |
| Move to **Completed** | Slack: *"✅ Completed. Nice work …!"*, also posted to the channel. |
| Move a card **backwards** (e.g. Ready for Testing → In Progress) | Counted as **reopened**: *Reopen Count* +1, *"🔁 Reopened"* in Slack (also to the channel). Reopening a completed card clears *Completed At*. |
| **Comment** on the card | Saved as the task's **Progress Notes**; Slack: *"📝 Progress note from …"*. |
| Change the **title**, **description** or **due date** | Sheet row updated; Slack note; History row. |
| **Archive** the card | Status becomes Archived; Slack note. |
| Move a card into an **extra list** (e.g. Backlog) or any list that is not a status list | Ignored: not tracked. |

Every change also adds a row to the **History** tab: when, which task, what changed, from what to what, by whom, and where (Trello, Sheet, …).

> **Trello is the source of truth.** Edit tasks in Trello. Changes typed directly into the **Tasks** tab are
> overwritten by the next update from Trello (your own extra columns are kept).

---

## 5. Creating cards from outside Trello

### Option A: from the Google Sheet (Import tab)

Good for adding many tasks at once. Only **coordinators** can do this.

**One-time setup per sheet**

1. In the sheet: **Extensions → Apps Script**.
2. Replace the code with the content of [`apps-script/Import.gs`](apps-script/Import.gs) and click **Save**.
3. **Project Settings** (gear icon) → **Script properties** → add:
   | Property | Value |
   | --- | --- |
   | `API_URL` | `<API>` (no `/` at the end) |
   | `SYNC_SECRET` | The `SHEET_SYNC_SECRET` value (ask whoever runs the backend) |
4. Reload the sheet. A **Taskvane** menu appears. Click **Taskvane → Set up Import tab** (allow the permissions the first time).

**Each time**

1. In the **Import** tab, fill one row per card:

   | Column | Notes |
   | --- | --- |
   | `Title` | Required. |
   | `Description` | Optional. |
   | `List` | List name. Empty = **Assigned** if there is an assignee, otherwise **To Do**. |
   | `Assignee` | Team member **name or email** (must be in the team list, with a Trello username). |
   | `Due Date` | `2026-11-20` = due at 18:00 India time. |
   | `Labels` | Comma-separated label names that exist on the board, e.g. `High, Frontend`. |
   | `Status`, `Trello Card`, `Row Key` | **Filled by Taskvane**. Do not edit. |

2. Click **Taskvane → Create Trello cards**.
3. Each row's **Status** shows `created` (with the card link), `already created`, or the error for that row.
   Rows with errors can be fixed and sent again; rows already created are never created twice.

### Option B: with the API

`POST /orgs/{orgId}/projects/{projectId}/cards`

```json
{
  "title": "Fix login button",
  "description": "The login button does nothing on Safari.",
  "list": "To Do",
  "memberIds": ["5f1b2c3d4e5f6a7b8c9d0e1f"],
  "dueDate": "2026-11-20",
  "labels": ["High", "Frontend"],
  "position": "top"
}
```

| Field | Notes |
| --- | --- |
| `title` | Required. |
| `description` | Optional. |
| `list` | List name. Empty = **Assigned** when `memberIds` are given, otherwise **To Do**. |
| `memberIds` | Trello member IDs. Get them from `GET /orgs/{orgId}/projects/{projectId}/board-members`. They must be on the board. |
| `dueDate` | `2026-11-20` (due 18:00 India time) or an exact time with a zone: `2026-11-20T10:00:00Z`. |
| `labels` | Label names that exist on the board. |
| `position` | `top` or `bottom` (default). |

Response (`201`):

```json
{ "id": "6734a1b2…", "url": "https://trello.com/c/AbCd1234", "list": "To Do",
  "members": ["Athira Shivaram"], "labels": ["High", "Frontend"], "due": "2026-11-20T12:30:00.000Z" }
```

A wrong list, member, label or date returns `400` with the valid choices in the message.
The card then syncs like any card created in Trello (sheet row and Slack within seconds).

---

## 6. Team rules (who may move what)

Allowed moves between status lists:

| From → To | Who may do it |
| --- | --- |
| To Do → Assigned | Coordinator, Dev |
| To Do → In Progress | Coordinator, Dev |
| Assigned → To Do | Coordinator, the assignee |
| Assigned → In Progress | Coordinator, the assignee |
| In Progress → Ready for Testing | Coordinator, the assignee |
| In Progress → Assigned | Coordinator, the assignee |
| Ready for Testing → Completed | Coordinator, QA |
| Ready for Testing → In Progress | Coordinator, QA |
| Completed → In Progress | Coordinator, QA |

Any other move (for example To Do → Completed), or a move by someone **not in the team list**, breaks the rules.

Trello cannot block a move, so Taskvane **applies it anyway and flags it**: the Slack update ends with
*"⚠️ This move is not allowed by the team rules — coordinator, please check."* and the History records it.

> If **every** move is flagged, the person moving cards is not recognised. Check that they are in the team list
> **of the same organization as the project**, with the right Trello username (Step 7).

---

## 7. What you see in the sheet

**Tasks tab**: one row per task, found by `Task ID`, updated in place.

| Column | Filled with |
| --- | --- |
| Task ID | `TASK-1`, `TASK-2`, … |
| Trello Card ID, Trello URL | The card |
| Title, Description, Labels / Priority, Due Date | From the card |
| Status | To Do / Assigned / In Progress / Ready for Testing / Completed / Archived |
| Assignee | Team member name |
| Created At, Picked Up At, Started At, Ready for Testing At, Completed At | When the task first reached that point (India time) |
| Reopen Count | How many times it went backwards |
| Progress Notes | The latest Trello comment |
| Last Updated, Last Updated By | e.g. `2026-11-12 22:55`, `Athira (Trello)` |

**History tab**: one new row per change: `Timestamp | Task ID | Field | Old Value | New Value | Changed By | Source`.

**Import tab** (optional): see [Section 5](#option-a-from-the-google-sheet-import-tab).

---

## 8. What you see in Slack

Each task gets **one message** in the project's channel, and every later update is a **reply in its thread**:

```text
TASK-7 · Fix login button
Status: In Progress · Assignee: @Athira
Open Trello card
   └─ 👤 @Athira is now working on this (assigned by Athira).
   └─ Athira moved this from Assigned → In Progress (via Trello)
   └─ 📝 Progress note from Athira: "Root cause found, fixing now"
   └─ Athira moved this from In Progress → Ready for Testing (via Trello)
      🧪 Ready for testing — QA, please pick it up.          ← also shown in the channel
```

Important updates (**Ready for Testing**, **Completed**, **Reopened**) are also posted to the channel, so nobody misses them.
People are `@mentioned` when their team email matches their Slack account.

---

## 9. Managing projects and the team

| Task | Request |
| --- | --- |
| List projects | `GET /orgs/{orgId}/projects` |
| Project details | `GET /orgs/{orgId}/projects/{projectId}` |
| Who is on the board (Trello member IDs) | `GET /orgs/{orgId}/projects/{projectId}/board-members` |
| Import open cards again (known cards are skipped) | `POST /orgs/{orgId}/projects/{projectId}/import` |
| Re-register the Trello webhook (e.g. the API address changed) | `POST /orgs/{orgId}/projects/{projectId}/webhook` |
| Stop syncing a project (data is kept) | `DELETE /orgs/{orgId}/projects/{projectId}` |
| Add or update a team member | `POST /orgs/{orgId}/team` (same email = update) |
| Remove a team member (kept in history) | `DELETE /orgs/{orgId}/team/{memberId}` |
| Disconnect Trello or Slack | `DELETE /orgs/{orgId}/connections/trello` or `…/slack` |

**Adding lists later**: Trello lists you add by hand are simply not tracked, which is what you want for lists like
*Backlog*. To rename a **status** list, rename it in Trello; the link is by list ID, so it keeps working.

**Changing the Slack channel or the sheet** of an existing project is not possible yet: stop the project and create it again
(the cards are imported again; the old sheet keeps its rows).

---

## 10. Troubleshooting

| What you see | Why, and the fix |
| --- | --- |
| `401 Unauthorized` on `/orgs/...` | Not logged in or the token expired. Log in again (Step 1) and click **Authorize**. |
| `403` on an organization | You are not a member of that organization. Check the `orgId` with `GET /orgs`. |
| `Connect Trello first` / `Add Taskvane to Slack first` | Do Step 3 / Step 4 for **this** organization. |
| `This connect link expired` | Connect links last 10 minutes and work once. Start the step again. |
| `Google Sheets 403 … share the sheet with …` | Share the sheet with the `shareWith` email as **Editor** (Step 5). |
| `The sheet needs a "Tasks" tab` / `needs a "Task ID" header` | Fix the tab name and row 1 (Step 5). Names must match exactly. |
| `This sheet is already used by a project` | Use a separate sheet per project. |
| `Slack channel not found` / `Invite the bot …` | Private channel: type `/invite @Taskvane` in it, then try again. |
| `The board is missing these lists` | Rename the lists in Trello, send `"lists": { … }` with your names, or send `"createMissingLists": true`. |
| Warning: `Trello webhook not registered yet` | Trello could not reach the API address. Make sure it is online, then `POST …/projects/{projectId}/webhook`. |
| Cards change in Trello but nothing happens | The webhook is missing or points to an old address (ngrok addresses change on restart): `POST …/projects/{projectId}/webhook`. Cards in non-status lists are ignored on purpose. |
| Every Slack update says *"This move is not allowed by the team rules"* | The person moving cards is not recognised: add them to the team **of the project's organization** with their Trello username (Step 7). |
| Slack shows the full Trello name (e.g. "Athira Shivaram") instead of the team name | Same cause as above: that Trello account is not in this organization's team list. |
| Assignee stays empty | The Trello member on the card is not in the team list, or has no Trello username there. |
| No `@mention` in Slack | The team email does not match their Slack email. Update the member (Step 7). |
| Sheet import: `… is not in the team list` / `Only a coordinator …` | The Google account clicking **Create Trello cards** must be a `COORDINATOR` in the team (same email). |
| Sheet import: `Missing or invalid X-Sync-Secret` | `SYNC_SECRET` in the Apps Script properties is wrong. |
| Sheet or Slack updates arrive late | Failed deliveries are retried automatically (up to 8 times, with growing gaps). Finished steps are never repeated, so there are no duplicates. |

---

## 11. API reference

The full, always up-to-date reference with request and response examples is at **`<API>/docs`**.

| Area | Endpoints |
| --- | --- |
| Login | `POST /auth/dev-login`, `POST /auth/google`, `GET /auth/me` |
| Organizations | `POST /orgs`, `GET /orgs`, `GET /orgs/{orgId}` |
| Connections | `GET /orgs/{orgId}/connections`, `POST …/connections/trello/start`, `POST …/connections/slack/start`, `DELETE …/connections/{provider}` |
| Pickers | `GET /orgs/{orgId}/trello/boards`, `GET /orgs/{orgId}/slack/channels` |
| Team | `GET /orgs/{orgId}/team`, `POST /orgs/{orgId}/team`, `DELETE /orgs/{orgId}/team/{memberId}` |
| Projects | `GET/POST /orgs/{orgId}/projects`, `GET/DELETE …/projects/{projectId}`, `GET …/board-members`, `POST …/webhook`, `POST …/import` |
| Cards | `POST /orgs/{orgId}/projects/{projectId}/cards` |
| Sheet import (Apps Script) | `POST /webhooks/sheets/import` (header `X-Sync-Secret`) |
| Trello (called by Trello only) | `POST /webhooks/trello` (signed by Trello; manual calls get `401`) |
| Health | `GET /health` |

---

## For developers

Installing, `.env`, running locally with Docker and ngrok, and deploying to Vercel: **[README-MULTITENANT.md](README-MULTITENANT.md)**.

Quick start:

```bash
npm install
cp .env.example .env          # fill it in (see README-MULTITENANT.md, Part A)
docker compose up -d          # PostgreSQL (+ optional n8n)
npx prisma migrate dev
npm run start:dev             # API on http://localhost:3000, docs at /docs
npm run prisma:studio         # browse the database at http://localhost:5555
npm test                      # self-tests
```
