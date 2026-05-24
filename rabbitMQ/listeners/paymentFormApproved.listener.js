const { dispatchNotification } = require("../../services/notificationDispatcher");
const { getSocketIO, getOnlineUsers } = require("../index");
const logger = require("../../config/logger.js");

const TITLES = {
  STANDING_ORDER: "Standing order form approved",
  SALARY_DEDUCTION: "Salary deduction form approved",
  DD_MANDATE: "Direct debit mandate approved",
};

const BODIES = {
  STANDING_ORDER:
    "Your standing order payment instruction has been approved. You can view and download the form from your member portal.",
  SALARY_DEDUCTION:
    "Your salary deduction form has been approved. You can view and download the form from your member portal.",
  DD_MANDATE:
    "Your direct debit mandate has been approved. You can view and download the form from your member portal.",
};

module.exports = async function handlePaymentFormApproved(payload) {
  const data = payload?.data || payload;
  const tenantId = data?.tenantId ?? payload?.tenantId;
  const userId = data?.userId;
  const formType = data?.formType;
  const paymentFormId = data?.paymentFormId;
  const memberId = data?.memberId || data?.membershipNumber;

  if (!userId || !tenantId) {
    logger.warn(
      { userId, tenantId, paymentFormId, formType, profileId: data?.profileId },
      "paymentFormApproved: skip — missing userId or tenantId (member may lack portal account)"
    );
    return;
  }

  const title = TITLES[formType] || "Payment form approved";
  const body = BODIES[formType] || "Your payment form has been approved.";

  const io = getSocketIO();
  const onlineUsers = getOnlineUsers();

  await dispatchNotification(
    {
      tenantId,
      userId,
      title,
      body,
      metadata: {
        type: "PAYMENT_FORM_APPROVED",
        sourceEventId: payload?.eventId || null,
        sourceEventType: payload?.eventType || null,
        paymentFormId: paymentFormId != null ? String(paymentFormId) : null,
        formType: formType || null,
        memberId: memberId != null ? String(memberId) : null,
        profileId: data?.profileId != null ? String(data.profileId) : null,
      },
    },
    io,
    onlineUsers
  );
};
