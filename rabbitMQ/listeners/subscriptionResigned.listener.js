const { dispatchNotification } = require("../../services/notificationDispatcher");
const { getSocketIO, getOnlineUsers } = require("../index");
const logger = require("../../config/logger.js");

module.exports = async function handleSubscriptionResigned(payload) {
  const data = payload?.data || payload;
  const tenantId = data?.tenantId ?? payload?.tenantId;
  const userId = data?.userId;

  if (!userId || !tenantId) {
    logger.debug(
      { userId, tenantId },
      "Skipping notification: userId or tenantId missing (e.g. CRM-only, no portal user)"
    );
    return;
  }

  const io = getSocketIO();
  const onlineUsers = getOnlineUsers();

  await dispatchNotification(
    {
      tenantId,
      userId,
      title: "Membership Resigned",
      body: "Your membership has been resigned.",
      metadata: {
        type: "SUBSCRIPTION_RESIGNED",
        subscriptionId: data?.subscriptionId,
        profileId: data?.profileId,
      },
    },
    io,
    onlineUsers
  );
};
