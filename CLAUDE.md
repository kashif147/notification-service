# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (auto-reload)
npm run dev

# Run the service
npm start
npm run start:dev      # NODE_ENV=development
npm run start:staging  # NODE_ENV=staging
npm run start:prod     # NODE_ENV=production
```

No tests are implemented (`npm test` exits with error). The service runs on port **4010** by default.

## Architecture Overview

This is a **multi-tenant real-time notification microservice** in a larger membership platform. It handles notification delivery through two channels based on user connectivity:

- **Online users**: Socket.IO WebSocket push (real-time, no persistence lag)
- **Offline users**: Firebase Admin SDK (FCM push to registered device tokens)

### Core Notification Flow

All notifications flow through `services/notificationDispatcher.js` (`dispatchNotification()`):

1. Save `NotificationHistory` record to MongoDB (status: `pending`)
2. Check `onlineUsers` Map (maintained by Socket.IO connection events)
3. If online → emit via Socket.IO → update status to `delivered`
4. If offline → query `FCMToken` collection → send via Firebase → update status to `sent` or `failed`

### Event-Driven Consumption (RabbitMQ)

The service listens to two exchanges via `@projectShell/rabbitmq-middleware` (custom package from `github:kashif147/rabbitmq-middleware#gateway`):

- **`batch.events`** exchange → `notification.events` queue
  - `batch.completed` → `rabbitMQ/listeners/batchCompleted.listener.js`
- **`membership.events`** exchange → `notification-service.membership.events` queue
  - `members.subscription.current.updated.v1` → `subscriptionCreated.listener.js`
  - `members.subscription.resigned.v1` → `subscriptionResigned.listener.js`
  - `members.subscription.resignation.undone.v1` → `subscriptionResignationUndone.listener.js`

Listener setup and RabbitMQ exports are in `rabbitMQ/index.js`. All listeners call `dispatchNotification()`.

### Socket.IO Architecture

- **Entry point**: `bin/notification-service.js` — both HTTP server and Socket.IO are set up here
- **Online tracking**: `onlineUsers` Map with key `tenantId:userId`, stored in module scope and exported for use by `notificationDispatcher`
- **Namespaces**: `tenant:{tenantId}` and `user:{userId}` — clients join both on connect
- **Auth**: JWT verified on socket handshake (query param `token`), same JWT logic as HTTP auth middleware
- **Client events received**: `markAsRead`, `markAllAsRead`
- **Server events emitted**: `notification`, `badgeIncrement`, `badgeDecrement`, `badgeReset`, `unreadCount`

### Authentication

`middlewares/auth.js` supports three modes (tried in order):

1. **Gateway-verified** (primary for microservice mesh): Headers `x-jwt-verified: true` + `x-auth-source: gateway` — trusts gateway's pre-validation, extracts user context from `x-user-id`, `x-tenant-id`, etc.
2. **Auth bypass** (legacy/dev): `AUTH_BYPASS_ENABLED=true` env — still validates JWT but skips authorization checks
3. **Bearer JWT** (fallback): Verifies with `JWT_SECRET`, extracts `tenantId`, `sub`/`id`, `userType`, `roles`, `permissions`

### Data Models

- **`FCMToken`**: Stores device tokens per user/tenant. Unique on `fcmToken` field. `isActive` flag used for deactivation (not hard delete).
- **`NotificationHistory`**: Audit log of all notifications. Soft-delete via `deletedAt`. Pre-find middleware auto-excludes deleted records; use `includeDeleted()` static method to bypass.

### External Dependencies

- **Profile Service**: Called via HTTP POST to `PROFILE_SERVICE_URL/api/profile/internal/by-user-ids` for enriching token data. Uses JWT forwarding or `x-internal-request` header fallback.
- **Firebase**: Optional — initialized in `util/firebase.js` with graceful degradation if `FIREBASE_SERVICE_ACCOUNT_JSON` is not set.
- **N8N**: External workflow engine for email/SMS/PDF delivery (not directly invoked from code — triggered via RabbitMQ events or webhooks).

## Required Environment Variables

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

Uses `dotenv-flow` — environment-specific files (`.env.development`, `.env.staging`, `.env.production`) are loaded based on `NODE_ENV`.

## Key Patterns

- **Tenant isolation**: Every MongoDB query includes `tenantId`. Never query without it.
- **Error class**: Use `errors/AppError.js` for operational errors. Set `isOperational: true` so the error handler returns structured JSON vs. crashing.
- **Response formatting**: `middlewares/response.mw.js` attaches `res.success()` and `res.error()` helpers — use these in controllers, not raw `res.json()`.
- **Logging**: Pino logger from `config/logger.js`. HTTP request logging via `pino-http` in `middlewares/logger.mw.js`. Pretty-print is enabled in non-production environments.
