# Data models, external dependencies, and env vars

## Data models

- **`FCMToken`**: device tokens per user/tenant, unique on `fcmToken`. `isActive: false` marks
  deactivation (never hard-deleted) — flipped automatically by `notificationDispatcher` on an
  invalid/unregistered-token FCM error.
- **`NotificationHistory`**: the audit log of every notification, *and* the storage for any PDF
  attachment (see the payment-mandate-pdf topic). Soft-delete via `deletedAt`; a pre-`find` hook
  auto-excludes deleted rows unless the query explicitly sets `deletedAt`, or you call the
  `includeDeleted()` static.
- **`Template`**: CRM admin grid Save-View state (see the save-view-templates topic) — not
  related to any notification *content* template.

## External dependencies

- **Profile Service**: `PROFILE_SERVICE_URL/api/profile/internal/by-user-ids`, for enriching
  token data. Forwards the JWT, with `x-internal-request` as a fallback header.
- **Firebase**: optional — `util/firebase.js` degrades gracefully if
  `FIREBASE_SERVICE_ACCOUNT_JSON` isn't set (FCM sends become no-op/log instead of crashing
  startup).
- **N8N**: `n8n-workflows/*.json` are exported workflow definitions for channels this service
  does *not* implement directly in code (SES email, Twilio SMS, Azure Blob PDF-letter email) —
  they're triggered via RabbitMQ events or webhooks from outside this repo. Treat them as
  reference/ops artifacts, not code this service executes.
- **communication-service**: `helpers/communicationLetterClient.js` calls out for
  letter-generation needs distinct from the in-house SBO/SD19 PDF prefill.

## Required environment variables

```
PORT                          # Default: 4010
NODE_ENV                      # development | staging | production
MONGO_URI                     # or MONGO_USER + MONGO_PASS + MONGO_DB
RABBIT_URL                    # RabbitMQ connection string
JWT_SECRET                    # JWT signing key
PROFILE_SERVICE_URL           # Internal profile service base URL
FIREBASE_SERVICE_ACCOUNT_JSON # Firebase credentials JSON (optional)
AUTH_BYPASS_ENABLED           # true/false (development only)
ALLOWED_ORIGINS               # Comma-separated additional CORS origins
```

## Key patterns

- **Tenant isolation**: every MongoDB query includes `tenantId`. Never query without it.
- **Error class**: use `errors/AppError.js` for operational errors (`isOperational: true`) so the
  error handler returns structured JSON instead of crashing the process.
- **Response formatting**: `middlewares/response.mw.js` attaches `res.success()`/`res.error()`
  following the platform-standard envelope (see `backend/CLAUDE.md` in the full projectShell
  checkout) — use these in controllers, not raw `res.json()`.
- **Logging**: Pino logger from `config/logger.js`; HTTP request logging via `pino-http` in
  `middlewares/logger.mw.js`, pretty-printed outside production.
