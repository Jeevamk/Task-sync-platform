-- Runs once, the first time the Postgres volume is created.
-- The app database (tasksync) is created by POSTGRES_DB; n8n gets its own database.
CREATE DATABASE n8n;
