-- CreateEnum
CREATE TYPE "Role" AS ENUM ('DEV', 'QA', 'COORDINATOR');

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'COORDINATOR');

-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('TRELLO', 'SLACK');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'ASSIGNED', 'IN_PROGRESS', 'READY_FOR_TESTING', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TaskEventType" AS ENUM ('CREATED', 'ASSIGNED', 'UNASSIGNED', 'STATUS_CHANGED', 'NOTE_ADDED', 'BLOCKED', 'UNBLOCKED', 'QA_PASSED', 'QA_FAILED', 'DUE_CHANGED', 'TITLE_CHANGED', 'DESCRIPTION_CHANGED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('TRELLO', 'SHEET', 'SLACK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "google_sub" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'COORDINATOR',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("user_id","organization_id")
);

-- CreateTable
CREATE TABLE "connections" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "provider" "Provider" NOT NULL,
    "external_id" TEXT NOT NULL,
    "external_name" TEXT NOT NULL,
    "bot_user_id" TEXT,
    "encrypted_token" TEXT NOT NULL,
    "scopes" TEXT,
    "connected_by" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_states" (
    "state" TEXT NOT NULL,
    "organization_id" UUID NOT NULL,
    "provider" "Provider" NOT NULL,
    "user_email" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "oauth_states_pkey" PRIMARY KEY ("state")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "trello_board_id" TEXT NOT NULL,
    "trello_webhook_id" TEXT,
    "list_map" JSONB NOT NULL DEFAULT '{}',
    "sheet_id" TEXT NOT NULL,
    "slack_channel_id" TEXT NOT NULL,
    "coordinator_id" UUID,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "trello_member_id" TEXT,
    "slack_user_id" TEXT,
    "role" "Role" NOT NULL DEFAULT 'DEV',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "task_key" TEXT NOT NULL,
    "trello_card_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "assignee_id" UUID,
    "progress_notes" TEXT,
    "blocker" TEXT,
    "due_date" DATE,
    "priority" TEXT,
    "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "picked_up_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ,
    "ready_for_testing_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "reopen_count" INTEGER NOT NULL DEFAULT 0,
    "sheet_row" INTEGER,
    "slack_thread_ts" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_events" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "type" "TaskEventType" NOT NULL,
    "field" TEXT,
    "old_value" TEXT,
    "new_value" TEXT,
    "actor_id" UUID,
    "source" "EventSource" NOT NULL,
    "reason" TEXT,
    "violation" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_events" (
    "source" "EventSource" NOT NULL,
    "external_id" TEXT NOT NULL,
    "processed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("source","external_id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ,
    "last_error" TEXT,
    "progress" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_errors" (
    "id" UUID NOT NULL,
    "project_id" UUID,
    "task_id" UUID,
    "step" TEXT NOT NULL,
    "error" TEXT NOT NULL,
    "payload" JSONB,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_errors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_sub_key" ON "users"("google_sub");

-- CreateIndex
CREATE INDEX "connections_provider_external_id_idx" ON "connections"("provider", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "connections_organization_id_provider_key" ON "connections"("organization_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "projects_trello_board_id_key" ON "projects"("trello_board_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_sheet_id_key" ON "projects"("sheet_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_organization_id_email_key" ON "team_members"("organization_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_organization_id_trello_member_id_key" ON "team_members"("organization_id", "trello_member_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_organization_id_slack_user_id_key" ON "team_members"("organization_id", "slack_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_trello_card_id_key" ON "tasks"("trello_card_id");

-- CreateIndex
CREATE INDEX "tasks_project_id_status_idx" ON "tasks"("project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_project_id_task_key_key" ON "tasks"("project_id", "task_key");

-- CreateIndex
CREATE INDEX "task_events_task_id_created_at_idx" ON "task_events"("task_id", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_status_next_attempt_at_idx" ON "outbox_events"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "sync_errors_resolved_created_at_idx" ON "sync_errors"("resolved", "created_at");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_coordinator_id_fkey" FOREIGN KEY ("coordinator_id") REFERENCES "team_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "team_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "team_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_errors" ADD CONSTRAINT "sync_errors_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
