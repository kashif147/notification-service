const { dispatchNotification } = require("../../services/notificationDispatcher");
const { getSocketIO, getOnlineUsers } = require("../index");
const logger = require("../../config/logger.js");

function formatResignationDateForNotification(raw) {
  if (raw == null || raw === "") return "";
  const d = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = d.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

module.exports = async function handleSubscriptionResigned(payload) {
  logger.info({ eventType: "SUBSCRIPTION_RESIGNED", payload }, "subscriptionResigned handler invoked");

  const data = payload?.data || payload;
  const tenantId = data?.tenantId ?? payload?.tenantId;
  const userId = data?.userId;

  if (!userId || !tenantId) {
    logger.info(
      { userId, tenantId },
      "subscriptionResigned: Skipping notification - userId or tenantId missing (e.g. CRM-only, no portal user)"
    );
    return;
  }

  const io = getSocketIO();
  const onlineUsers = getOnlineUsers();

  const dateRaw =
    data?.dateResigned ??
    data?.resignationDate ??
    data?.resignation?.dateResigned;
  const resignationDateStr = formatResignationDateForNotification(dateRaw);
  const datePhrase = resignationDateStr
    ? resignationDateStr
    : "the agreed resignation date";

  const body = `Your membership has been successfully resigned, effective from ${datePhrase}. If you have any questions or require assistance, please contact Membership department.`;

  await dispatchNotification(
    {
      tenantId,
      userId,
      title: "Membership Resignation Confirmed",
      body,
      metadata: {
        type: "SUBSCRIPTION_RESIGNED",
        subscriptionId: data?.subscriptionId,
        profileId: data?.profileId,
        dateResigned: dateRaw != null ? String(dateRaw) : null,
      },
    },
    io,
    onlineUsers
  );
};
