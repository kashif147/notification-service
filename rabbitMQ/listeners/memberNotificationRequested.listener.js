const { dispatchNotification } = require("../../services/notificationDispatcher");
const { getSocketIO, getOnlineUsers } = require("../index");
const logger = require("../../config/logger.js");

/**
 * membership.events → members.member.notification.requested.v1
 * Payload: tenantId, userId, title, body, metadata (optional)
 */
module.exports = async function handleMemberNotificationRequested(payload) {
  const data = payload?.data || payload;
  const tenantId = data?.tenantId ?? payload?.tenantId;
  const userId = data?.userId;
  const title = data?.title != null ? String(data.title).trim() : "";
  const body = data?.body != null ? String(data.body).trim() : "";

  if (!title || !body) {
    logger.warn(
      { tenantId, userId },
      "memberNotificationRequested: missing title or body; skip"
    );
    return;
  }

  if (!userId || !tenantId) {
    logger.info(
      { userId, tenantId },
      "memberNotificationRequested: Skipping — userId or tenantId missing"
    );
    return;
  }

  const io = getSocketIO();
  const onlineUsers = getOnlineUsers();

  await dispatchNotification(
    {
      tenantId,
      userId,
      title,
      body,
      metadata: {
        ...(data?.metadata && typeof data.metadata === "object"
          ? data.metadata
          : {}),
        sourceEventId: payload?.eventId || null,
        sourceEventType: payload?.eventType || null,
      },
    },
    io,
    onlineUsers
  );

  logger.info(
    { tenantId, userId, metadataType: data?.metadata?.type },
    "memberNotificationRequested: notification dispatched"
  );
};
