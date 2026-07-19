const { dispatchNotification } = require("../../services/notificationDispatcher");
const { getSocketIO, getOnlineUsers } = require("../index");
const logger = require("../../config/logger.js");

module.exports = async function handleEventRegistrationConfirmed(payload) {
  const data = payload?.data || payload;
  const tenantId = data?.tenantId ?? payload?.tenantId;
  // events-service does not currently resolve/pass a notification-service
  // userId on the registration payload (only profileId) - attendees without a
  // portal login (e.g. non-members registered from the CRM) have no user
  // account to push a socket/FCM notification to. Skip gracefully, same
  // pattern as subscriptionCreated.listener.js's CRM-only-subscription guard.
  const userId = data?.userId;

  if (!userId || !tenantId) {
    logger.debug(
      { userId, tenantId, registrationId: data?.registrationId },
      "Skipping event registration notification: userId or tenantId missing (no portal account for this attendee)"
    );
    return;
  }

  const io = getSocketIO();
  const onlineUsers = getOnlineUsers();

  await dispatchNotification(
    {
      tenantId,
      userId,
      title: "Registration confirmed",
      body: "Your event/course registration has been confirmed.",
      metadata: {
        type: "EVENT_REGISTRATION_CONFIRMED",
        sourceEventId: payload?.eventId || null,
        sourceEventType: payload?.eventType || null,
        registrationId: data?.registrationId,
        profileId: data?.profileId,
        eventId: data?.eventId,
        courseId: data?.courseId,
      },
    },
    io,
    onlineUsers
  );
};
