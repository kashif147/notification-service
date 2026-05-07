const { dispatchNotification } = require("../../services/notificationDispatcher");
const { getSocketIO, getOnlineUsers } = require("../index");
const logger = require("../../config/logger.js");

module.exports = async function handleSubscriptionResignationUndone(payload) {
  logger.info({ eventType: "SUBSCRIPTION_RESIGNATION_UNDONE", payload }, "subscriptionResignationUndone handler invoked");

  const data = payload?.data || payload;
  const tenantId = data?.tenantId ?? payload?.tenantId;
  const userId = data?.userId;

  if (!userId || !tenantId) {
    logger.info(
      { userId, tenantId },
      "subscriptionResignationUndone: Skipping notification - userId or tenantId missing"
    );
    return;
  }

  const io = getSocketIO();
  const onlineUsers = getOnlineUsers();

  await dispatchNotification(
    {
      tenantId,
      userId,
      title: "Membership Reactivated",
      body: "Your membership has been successfully reactivated. Welcome back. If you need any assistance, please contact us.",
      metadata: {
        type: "SUBSCRIPTION_RESIGNATION_UNDONE",
        sourceEventId: payload?.eventId || null,
        sourceEventType: payload?.eventType || null,
        subscriptionId: data?.subscriptionId,
        profileId: data?.profileId,
      },
    },
    io,
    onlineUsers
  );
};
