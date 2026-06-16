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

  if (
    data?.skipMembershipProcessedNotification === true ||
    data?.skipMembershipApprovedNotification === true
  ) {
    logger.debug(
      { userId, tenantId },
      "Skipping Membership Processed notification (reactivation / current.updated without welcome)"
    );
    return;
  }

  const io = getSocketIO();
  const onlineUsers = getOnlineUsers();

  await dispatchNotification(
    {
      tenantId,
      userId,
      title: "Membership Processed",
      body: "Your membership application has been processed. Welcome to the membership!",
      metadata: {
        type: "APPLICATION_PROCESSED_SUBSCRIPTION_CREATED",
        sourceEventId: payload?.eventId || null,
        sourceEventType: payload?.eventType || null,
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
