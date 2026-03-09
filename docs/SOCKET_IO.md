# Socket.IO Architecture — notification-service

Socket.IO powers real-time in-app notifications in the backend. It lives in **notification-service** only.

## Setup (`bin/notification-service.js`)

- Same HTTP server hosts both Express REST API and Socket.IO
- `socket.io` v4.8.3, CORS: `origin: "*"`, methods `["GET", "POST"]`
- `onlineUsers` is a `Map`: `tenantId:userId` → `Set(socketIds)` for tracking who is connected

## Authentication

- JWT from `socket.handshake.auth.token`
- Decoded payload supplies `userId`, `tenantId` → stored on `socket.user`
- Missing or invalid token → connection rejected

## Rooms

On connect, each socket joins:

- `tenant:${tenantId}` — all connections for that tenant
- `user:${userId}` — all connections for that user

Emits target `user:${userId}` for per-user notifications.

## Events

| Direction | Event | Purpose |
|-----------|-------|---------|
| Server → Client | `unreadCount` | On connect, sends `{ count }` |
| Server → Client | `notification` | New notification payload |
| Server → Client | `badgeIncrement` | Increment unread badge by 1 |
| Server → Client | `badgeDecrement` | Decrement unread badge by 1 |
| Server → Client | `badgeReset` | Mark all read, unread = 0 |
| Client → Server | `markAsRead` | `{ notificationId }` — mark single as read |
| Client → Server | `markAllAsRead` | Mark all as read |

## Flow

1. **Startup**  
   `setSocketIO(io)` and `setOnlineUsers(onlineUsers)` inject the Socket.IO server and online-users map into the RabbitMQ module so listeners can emit.

2. **Trigger**  
   RabbitMQ consumers receive:
   - `batch.completed` → `batchCompleted.listener.js`
   - `members.subscription.current.updated.v1` → `subscriptionCreated.listener.js`
   - `members.subscription.resigned.v1` → `subscriptionResigned.listener.js`
   - `members.subscription.resignation.undone.v1` → `subscriptionResignationUndone.listener.js`

3. **Dispatcher** (`services/notificationDispatcher.js`)
   - Persists notification in `NotificationHistory`
   - Checks `onlineUsers.has(userKey)`
   - **Online** → `io.to("user:${userId}").emit("notification", payload)` + `badgeIncrement`
   - **Offline** → sends push via Firebase (FCM)

4. **Read actions**  
   `markAsRead` / `markAllAsRead` update MongoDB and emit `badgeDecrement` or `badgeReset` to `user:${userId}`.

## Data flow

```
RabbitMQ event (batch.completed / membership updated)
        ↓
Listener (batchCompleted / subscriptionCreated)
        ↓
notificationDispatcher.dispatchNotification()
        ↓
[Online?]  → io.to(`user:${userId}`).emit("notification")
[Offline?] → Firebase push
```

## Client usage

Connect with JWT in auth:

```javascript
import { io } from "socket.io-client";

const socket = io("https://your-notification-service-url", {
  auth: { token: "<JWT>" },
});

socket.on("notification", (payload) => { /* handle */ });
socket.on("unreadCount", ({ count }) => { /* handle */ });
socket.on("badgeIncrement", ({ count }) => { /* handle */ });
socket.on("badgeDecrement", ({ count }) => { /* handle */ });
socket.on("badgeReset", () => { /* handle */ });

socket.emit("markAsRead", { notificationId });
socket.emit("markAllAsRead");
```

## Notes

- **Redis adapter**: `@socket.io/redis-adapter` is installed but not used. Add it when scaling to multiple notification-service instances.
- **Single-instance**: Current design assumes one process; room broadcasts work only within that process.

---

## Troubleshooting: WebSocket connection failed

**Error:**  
`WebSocket connection to 'wss://projectshell-vm.northeurope.cloudapp.azure.com/socket.io/?EIO=4&transport=websocket' failed`

### Cause

1. **Wrong URL path**  
   The client is connecting to `/socket.io/` at the root. It must connect to the notification-service path so the gateway can proxy to the correct backend.

2. **Missing WebSocket upgrade in nginx**  
   The gateway must pass `Upgrade` and `Connection: upgrade` for WebSocket to work.

3. **Wrong upstream (default.conf)**  
   The notification-service block uses `proxy_pass http://reporting-service:4010/` — this is likely a typo and should point to `notification-service:4010`.

### Fixes

**1. Client env**

Set the full notification-service URL (including path):

```bash
REACT_APP_NOTIFICATION_SERVICE_URL=https://projectshell-vm.northeurope.cloudapp.azure.com/notification-service/api
```

With that, Socket.IO will connect to:  
`wss://projectshell-vm.northeurope.cloudapp.azure.com/notification-service/api/socket.io/`

**2. Gateway (nginx) for notification-service**

Add a dedicated location for Socket.IO with WebSocket upgrade headers. Ensure `proxy_pass` points to `notification-service:4010` (the default.conf currently uses `reporting-service:4010` — likely a typo).

```nginx
# Socket.IO — add this BEFORE the /notification-service/api/ block
npm

location ^~ /notification-service/api/ {
    # ... existing api config (proxy_pass to notification-service:4010)
}
```

**3. Verify client URL**

In `NotificationContext.js`, the client uses `process.env.REACT_APP_NOTIFICATION_SERVICE_URL`. Ensure the built app has the correct value (paths matter for env vars in React).

**4. Optional: polling fallback**

If WebSocket still fails behind proxies, add polling as a fallback:

```javascript
socket = io(process.env.REACT_APP_NOTIFICATION_SERVICE_URL, {
  auth: { token },
  transports: ["websocket", "polling"],  // was ["websocket"] only
});
```
