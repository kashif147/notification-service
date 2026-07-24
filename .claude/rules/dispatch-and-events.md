# Core notification flow and RabbitMQ consumption

Two delivery channels for actual notifications, independent of each other — not an either/or
branch:

- **In-app (Socket.IO)**: pushed to the user's room when they have an active connection.
- **Push (Firebase/FCM)**: pushed to *all* of a user's active mobile (`ios`/`android`) device
  tokens whenever any exist — not gated on online/offline. A user with the portal open on their
  phone still gets an FCM push to that same phone. If no mobile tokens exist, it falls back to
  any active token of any platform.

Everything funnels through `services/notificationDispatcher.js`'s `dispatchNotification(event,
io, onlineUsers)`:

1. **Idempotency check**: if `metadata.sourceEventId` is set (virtually always, from a RabbitMQ
   `payload.eventId`), look up an existing `NotificationHistory` row by `{tenantId, userId,
   "metadata.sourceEventId"}`. If found and already `sent`/`delivered`, return early — this is
   what makes RabbitMQ redelivery of the same event safe to call again.
2. Create/update the `NotificationHistory` row.
3. If the user is in the `onlineUsers` map, emit `notification` to `user:${userId}` over
   Socket.IO — attachments are stripped from the socket payload
   (`stripAttachmentsFromMetadata()`, see the payment-mandate-pdf topic).
4. Look up active `FCMToken`s; send Firebase push to all of them (deduped per device,
   invalid/unregistered tokens flipped to `isActive: false` on failure). This happens regardless
   of step 3.
5. `notification.status` becomes `delivered` (any FCM send succeeded), `sent` (delivered to
   socket only, or FCM attempted-and-failed while online), or `failed`.

Callers can pass `metadata.deliverPush: false` to skip Firebase/FCM entirely (e.g. records that
are really just an audit trail, like email-correspondence log entries) while still writing the
`NotificationHistory` row.

## Event-driven consumption (RabbitMQ)

`rabbitMQ/index.js` binds one queue per exchange family and wires each routing key to a
`rabbitMQ/listeners/*.listener.js` module — the full binding list lives there, not duplicated
here. The shape to know:

- `batch.events` → batch import lifecycle (`batchCompleted`,
  `batchProcessQueued/Progress/Completed`)
- `membership.events` → subscription lifecycle (created/resigned/undone/category-changed), plus
  two more targeted ones: `members.member.notification.requested.v1` (generic "please notify this
  user" event other services can publish without knowing notification-service internals) and
  `members.payment-form.approved.v1` (standing-order/salary-deduction/DD-mandate approval)
- `application.events` → `applications.review.processed.v1` / `.rejected.v1` — the processed one
  is where the payment-mandate PDF gets generated and attached (see the payment-mandate-pdf topic)
- `journal.events` → `journal.created.v1` — not a notification, see the finance-realtime topic
- `events.events` → events-service registration confirmations / certificate issuance (consumed
  the same way audit-service and communication-service consume this exchange — see their
  CLAUDE.md files for the publisher side)

All listeners call `dispatchNotification()` except `journalCreated.listener.js` (a different kind
of consumer, see the finance-realtime topic). When adding a new inbound event, follow the
existing listener's shape: extract `payload.data || payload`, resolve `tenantId`/`userId`, build
a `title`/`body`/`metadata` object (with `metadata.sourceEventId = payload.eventId` for
idempotency), call `dispatchNotification`.
