import * as Joi from 'joi';

/** Environment variables checked at startup. The app refuses to start if a required value is missing. */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),

  /** Public address of this API (ngrok locally, the Vercel URL in production). */
  PUBLIC_BASE_URL: Joi.string().uri().required(),
  /** Where the coordinator web app runs (used after "Connect" redirects). Optional until Step 7. */
  WEB_APP_URL: Joi.string().uri().allow('').optional(),

  DATABASE_URL: Joi.string().uri({ scheme: ['postgresql', 'postgres'] }).required(),
  DIRECT_URL: Joi.string().uri({ scheme: ['postgresql', 'postgres'] }).required(),

  /** 32-byte key (64 hex characters) that encrypts every customer's Trello/Slack token in the database. */
  TOKEN_ENCRYPTION_KEY: Joi.string().hex().length(64).required(),

  /** Login */
  JWT_SECRET: Joi.string().min(32).required(),
  GOOGLE_OAUTH_CLIENT_ID: Joi.string().allow('').optional(),
  /** Local testing only: allows POST /auth/dev-login without Google. Never true in production. */
  ALLOW_DEV_LOGIN: Joi.boolean().default(false),

  /** Trello app (yours). Each customer connects with their own token. */
  TRELLO_API_KEY: Joi.string().required(),
  TRELLO_APP_SECRET: Joi.string().required(),

  /** Slack app (yours, with public distribution). Each customer installs it with "Add to Slack". */
  SLACK_CLIENT_ID: Joi.string().required(),
  SLACK_CLIENT_SECRET: Joi.string().required(),
  SLACK_SIGNING_SECRET: Joi.string().allow('').optional(),

  /** Google service account that writes every customer's sheet (they share their sheet with this email). */
  GOOGLE_SERVICE_ACCOUNT_EMAIL: Joi.string().email().required(),
  /** The private_key from the JSON key file. Keep the \n characters; they are converted. */
  GOOGLE_PRIVATE_KEY: Joi.string().required(),

  /** Outbox */
  INTERNAL_API_KEY: Joi.string().min(16).required(),
  CRON_SECRET: Joi.string().allow('').optional(),
  OUTBOX_POLL_MS: Joi.number().integer().min(0).default(0),
  SHEET_SYNC_SECRET: Joi.string().allow('').optional(),

  /** Optional: also forward every event to your own n8n workflow (signed). */
  N8N_BASE_URL: Joi.string().uri().allow('').optional(),
  N8N_EVENT_WEBHOOK_URL: Joi.string().uri().allow('').optional(),
  N8N_EVENT_SIGNING_SECRET: Joi.string().allow('').optional(),
});
