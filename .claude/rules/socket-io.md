# Socket.IO (single-instance — no Redis adapter wired)

Set up in `bin/notification-service.js` (same HTTP server as Express). JWT is verified on
handshake (`socket.handshake.auth.token`); `socket.user = {userId, tenantId}`.

- `onlineUsers`: `Map<"tenantId:userId", Set<socketId>>`, module-scoped in `bin/`, injected into
  `rabbitMQ/index.js` via `setOnlineUsers()`/`setSocketIO()` so listeners (which live under
  `rabbitMQ/`) can reach the socket server without a circular import back into `bin/`.
- Rooms: every socket joins `tenant:${tenantId}` and `user:${userId}`.

**`@socket.io/redis-adapter` and `redis` are installed but not wired up** (see
`docs/SOCKET_IO.md`'s Notes section). This service currently assumes a single process/instance —
room broadcasts only reach sockets connected to *that* process. If this service is ever scaled to
multiple instances, `emitMemberFinanceUpdated`/`dispatchNotification`'s socket emits will
silently miss users connected to a different instance until the adapter is actually adopted.
Don't assume horizontal scaling already works for this service's real-time delivery — check this
file before changing deployment to more than one replica.
