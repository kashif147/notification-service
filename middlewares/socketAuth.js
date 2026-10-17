const jwt = require("jsonwebtoken");

/**
 * Socket.IO handshake authentication.
 *
 * The ProjectShell JWT is read ONLY from the Socket.IO auth payload (`socket.handshake.auth.token`,
 * sent in the CONNECT packet). `socket.handshake.query.token` is ignored: a query parameter puts
 * the bearer token into the request URL and therefore into access logs. It is not rejected yet, so
 * a client that still sends both keeps working on its auth payload.
 *
 * Verification is unchanged (`jwt.verify` with JWT_SECRET, so signature and expiry are checked).
 * Identity: userId from `sub` / `id` (as before); tenantId ONLY from the ProjectShell `tenantId`
 * claim - never Entra `tid` / `extension_tenantId`, never anything the client sends. Socket.IO runs
 * this for every new connection, so every reconnect is authenticated again. No token value is ever
 * logged or put into an error.
 */
function verifySocketToken(token, secret) {
  if (typeof token !== "string" || token === "") return { error: "Unauthorized" };
  let decoded;
  try {
    decoded = jwt.verify(token, secret);
  } catch {
    return { error: "Invalid token" };
  }
  const userId = decoded.sub || decoded.id;
  const tenantId = decoded.tenantId;
  if (!userId || !tenantId) return { error: "Invalid token: missing userId or tenantId" };
  return { user: { userId, tenantId } };
}

/** io.use(...) middleware; `getSecret` defaults to the service's JWT_SECRET. */
function createSocketAuthMiddleware({ getSecret = () => process.env.JWT_SECRET } = {}) {
  return (socket, next) => {
    const result = verifySocketToken(socket.handshake?.auth?.token, getSecret());
    if (result.error) return next(new Error(result.error));
    socket.user = result.user;
    return next();
  };
}

/** The rooms an authenticated socket joins (unchanged): its organisation and its user. */
const socketRooms = ({ userId, tenantId }) => [`tenant:${tenantId}`, `user:${userId}`];

module.exports = { createSocketAuthMiddleware, verifySocketToken, socketRooms };
