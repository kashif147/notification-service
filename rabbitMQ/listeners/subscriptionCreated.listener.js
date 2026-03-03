const { dispatchNotification } = require("../../services/notificationDispatcher");
const { getSocketIO, getOnlineUsers } = require("../index");
const logger = require("../../config/logger.js");

module.exports = async function handleSubscriptionCreated(payload) {
  const data = payload?.data || payload;
  const tenantId = data?.tenantId ?? payload?.tenantId;
  const userId = data?.userId;

  if (!userId || !tenantId) {
    logger.debug(
      { userId, tenantId },
      "Skipping notification: userId or tenantId missing (e.g. CRM-only subscription)"
    );
    return;
  }

  const io = getSocketIO();
  const onlineUsers = getOnlineUsers();

  await dispatchNotification(
    {
      tenantId,
      userId,
      title: "Membership Approved",
      body: "Your membership application has been approved. Welcome to the membership!",
      metadata: {
        type: "APPLICATION_APPROVED_SUBSCRIPTION_CREATED",
        subscriptionId: data?.subscriptionId,
        profileId: data?.profileId,
        applicationId: data?.applicationId,
        memberId: data?.memberId,
      },
    },
    io,
    onlineUsers
  );
};
