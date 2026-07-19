const { dispatchNotification } = require("../../services/notificationDispatcher");
const { getSocketIO, getOnlineUsers } = require("../index");
const logger = require("../../config/logger.js");

module.exports = async function handleCertificateIssued(payload) {
  const data = payload?.data || payload;
  const tenantId = data?.tenantId ?? payload?.tenantId;
  const userId = data?.userId;

  if (!userId || !tenantId) {
    logger.debug(
      { userId, tenantId, certificateId: data?.certificateId },
      "Skipping certificate issued notification: userId or tenantId missing (no portal account for this attendee)"
    );
    return;
  }

  const io = getSocketIO();
  const onlineUsers = getOnlineUsers();

  await dispatchNotification(
    {
      tenantId,
      userId,
      title: "Certificate issued",
      body: "Your certificate is now available.",
      metadata: {
        type: "EVENT_CERTIFICATE_ISSUED",
        sourceEventId: payload?.eventId || null,
        sourceEventType: payload?.eventType || null,
        certificateId: data?.certificateId,
        registrationId: data?.registrationId,
        profileId: data?.profileId,
      },
    },
    io,
    onlineUsers
  );
};
