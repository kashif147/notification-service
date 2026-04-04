const { dispatchNotification } = require("../../services/notificationDispatcher");
const { getSocketIO, getOnlineUsers } = require("../index");
const logger = require("../../config/logger.js");

module.exports = async function handleApplicationReviewApproved(payload) {
  const data = payload?.data || payload;
  const tenantId = data?.tenantId ?? payload?.tenantId;
  const userId = data?.userId;

  if (!userId || !tenantId) {
    logger.debug(
      { userId, tenantId, applicationId: data?.applicationId },
      "applicationReviewApproved: Skipping notification — userId or tenantId missing"
    );
    return;
  }

  const io = getSocketIO();
  const onlineUsers = getOnlineUsers();

  await dispatchNotification(
    {
      tenantId,
      userId,
      title: "Application approved",
      body: "Your membership application has been approved.",
      metadata: {
        type: "APPLICATION_REVIEW_APPROVED",
        applicationId: data?.applicationId,
        profileId: data?.profileId,
      },
    },
    io,
    onlineUsers
  );
};
