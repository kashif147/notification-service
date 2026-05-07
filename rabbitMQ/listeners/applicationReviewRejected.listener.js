const { dispatchNotification } = require("../../services/notificationDispatcher");
const { getSocketIO, getOnlineUsers } = require("../index");
const logger = require("../../config/logger.js");

module.exports = async function handleApplicationReviewRejected(payload) {
  const data = payload?.data || payload;
  const tenantId = data?.tenantId ?? payload?.tenantId;
  const userId = data?.userId;

  if (!userId || !tenantId) {
    logger.debug(
      { userId, tenantId, applicationId: data?.applicationId },
      "applicationReviewRejected: Skipping notification — userId or tenantId missing"
    );
    return;
  }

  const io = getSocketIO();
  const onlineUsers = getOnlineUsers();

  const reason = data?.reason;
  const body = reason
    ? `Your membership application was not approved. Reason: ${reason}`
    : "Your membership application was not approved.";

  await dispatchNotification(
    {
      tenantId,
      userId,
      title: "Application update",
      body,
      metadata: {
        type: "APPLICATION_REVIEW_REJECTED",
        sourceEventId: payload?.eventId || null,
        sourceEventType: payload?.eventType || null,
        applicationId: data?.applicationId,
        reason: reason ?? null,
      },
    },
    io,
    onlineUsers
  );
};
