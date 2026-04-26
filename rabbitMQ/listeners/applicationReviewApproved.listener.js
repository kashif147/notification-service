const fs = require("fs");
const { dispatchNotification } = require("../../services/notificationDispatcher");
const { getSocketIO, getOnlineUsers } = require("../index");
const logger = require("../../config/logger.js");
const { buildPrefilledMembershipFormPdf } = require("../../services/membershipFormPdf.js");
const { paths } = require("../../config/membershipFormLayout.js");

function normalizePaymentType(t) {
  if (t == null) return "";
  return String(t).trim();
}

function formKindForPayment(paymentType) {
  const p = normalizePaymentType(paymentType).toLowerCase();
  if (p === "standing order") return "SBO";
  if (
    p === "salary deduction" ||
    p === "deduction" ||
    p === "deductions" ||
    p === "payroll deduction"
  ) {
    return "SD19";
  }
  return null;
}

module.exports = async function handleApplicationReviewApproved(payload) {
  const data = payload?.data || payload;
  const tenantId = data?.tenantId ?? payload?.tenantId;
  const userId = data?.userId;
  const effective = data?.effective;
  const memberId = data?.memberId;

  const io = getSocketIO();
  const onlineUsers = getOnlineUsers();

  if (!userId || !tenantId) {
    logger.debug(
      { userId, tenantId, applicationId: data?.applicationId },
      "applicationReviewApproved: Skipping notification — userId or tenantId missing"
    );
    return;
  }

  const paymentType = effective?.subscriptionDetails?.paymentType;
  const formKind = formKindForPayment(paymentType);
  const applicationId = data?.applicationId;
  const profileId = data?.profileId;

  let pdfBuffer;
  let attachment;
  if (memberId && formKind && effective) {
    const pdfPath = formKind === "SBO" ? paths().sbo : paths().sd19;
    if (fs.existsSync(pdfPath)) {
      const payrollNo = effective?.subscriptionDetails?.payrollNo ?? null;
      try {
        pdfBuffer = await buildPrefilledMembershipFormPdf(formKind, {
          memberId: String(memberId),
          payrollNo,
        });
        const filename =
          formKind === "SBO"
            ? "INMO-Standing-Order-Form-SBO-2492.pdf"
            : "INMO-Salary-Deduction-Form-SD19.pdf";
        attachment = {
          filename,
          mimeType: "application/pdf",
          dataBase64: pdfBuffer.toString("base64"),
        };
      } catch (err) {
        logger.error(
          { err: err.message, formKind, applicationId },
          "membershipForm: failed to build PDF for notification attachment"
        );
      }
    } else {
      logger.error(
        { pdfPath: formKind === "SBO" ? paths().sbo : paths().sd19, formKind },
        "membershipForm: template PDF not found on disk"
      );
    }
  }

  const formLabel =
    formKind === "SBO"
      ? "standing order"
      : formKind === "SD19"
        ? "salary deduction"
        : null;

  const bodyWithForm =
    attachment && formLabel
      ? `Your membership application has been approved. Your prefilled ${formLabel} form is attached — open the notification to download the PDF.`
      : "Your membership application has been approved.";

  await dispatchNotification(
    {
      tenantId,
      userId,
      title: "Application approved",
      body: bodyWithForm,
      metadata: {
        type: "APPLICATION_REVIEW_APPROVED",
        applicationId,
        profileId,
        memberId: memberId != null ? String(memberId) : null,
        ...(formKind ? { formKind } : {}),
        ...(attachment ? { attachments: [attachment] } : {}),
      },
    },
    io,
    onlineUsers
  );
};
