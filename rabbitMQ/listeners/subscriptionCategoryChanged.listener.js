const { dispatchNotification } = require("../../services/notificationDispatcher");
const { getSocketIO, getOnlineUsers } = require("../index");
const logger = require("../../config/logger.js");

function formatEffectiveDate(isoOrDate) {
  if (isoOrDate == null || isoOrDate === "") return "";
  const d =
    isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return String(isoOrDate);
  try {
    return d.toLocaleDateString("en-IE", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return d.toISOString().split("T")[0];
  }
}

/**
 * membership.events → members.subscription.category.changed.v1
 */
module.exports = async function handleSubscriptionCategoryChanged(payload) {
  const data = payload?.data || payload;
  const tenantId = data?.tenantId ?? payload?.tenantId;
  const userId = data?.userId;

  if (!userId || !tenantId) {
    logger.debug(
      { userId, tenantId, subscriptionId: data?.subscriptionId },
      "Skipping category-changed notification: userId or tenantId missing"
    );
    return;
  }

  const oldCategory =
    data?.previousMembershipCategory != null &&
    String(data.previousMembershipCategory).trim() !== ""
      ? String(data.previousMembershipCategory).trim()
      : "Unknown";
  const newCategory =
    data?.membershipCategory != null &&
    String(data.membershipCategory).trim() !== ""
      ? String(data.membershipCategory).trim()
      : "Unknown";

  const effectiveRaw =
    data?.effectiveDate != null && data.effectiveDate !== ""
      ? data.effectiveDate
      : data?.subscriptionStartDate;
  const effectiveDate = formatEffectiveDate(effectiveRaw);

  const io = getSocketIO();
  const onlineUsers = getOnlineUsers();

  const title = "Change of Membership Category";
  const body = `Your membership category has been changed from ${oldCategory} to ${newCategory}, effective from ${effectiveDate}. Please contact us if you need any assistance.`;

  await dispatchNotification(
    {
      tenantId,
      userId,
      title,
      body,
      metadata: {
        type: "MEMBERSHIP_CATEGORY_CHANGED",
        subscriptionId: data?.subscriptionId,
        profileId: data?.profileId,
        applicationId: data?.applicationId,
        previousMembershipCategory: data?.previousMembershipCategory,
        membershipCategory: data?.membershipCategory,
        effectiveDate: effectiveRaw || null,
        source: data?.source || null,
      },
    },
    io,
    onlineUsers
  );
};
