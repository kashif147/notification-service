const { dispatchNotification } = require("../../services/notificationDispatcher");
const { getSocketIO, getOnlineUsers } = require("../index");
const logger = require("../../config/logger.js");

module.exports = async function handleSubscriptionResignationUndone(payload) {
  const data = payload?.data || payload;
  const tenantId = data?.tenantId ?? payload?.tenantId;
  const userId = data?.userId;

  if (!userId || !tenantId) {
    logger.debug(
      { userId, tenantId },
      "Skipping notification: userId or tenantId missing"
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
      body: "Your membership resignation has been undone. Welcome back!",
      metadata: {
        type: "SUBSCRIPTION_RESIGNATION_UNDONE",
        subscriptionId: data?.subscriptionId,
        profileId: data?.profileId,
      },
    },
    io,
    onlineUsers
  );
};
