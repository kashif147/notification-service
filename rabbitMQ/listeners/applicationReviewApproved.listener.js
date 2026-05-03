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

function resolveMemberFullName(effective) {
  const pi = effective?.personalInfo;
  if (!pi || typeof pi !== "object") return "";
  if (typeof pi.fullName === "string" && pi.fullName.trim()) {
    return pi.fullName.trim();
  }
  const f = typeof pi.forename === "string" ? pi.forename.trim() : "";
  const s = typeof pi.surname === "string" ? pi.surname.trim() : "";
  return [f, s].filter(Boolean).join(" ").trim();
}

function resolveWorkLocation(effective) {
  const pd = effective?.professionalDetails;
  if (!pd || typeof pd !== "object") return "";
  const wl =
    pd.workLocation != null ? String(pd.workLocation).trim() : "";
  if (wl) return wl;
  const ow =
    pd.otherWorkLocation != null ? String(pd.otherWorkLocation).trim() : "";
  return ow;
}

/** Membership category label from subscription details (e.g. application-approved payload). */
function resolveMembershipCategory(effective, mergedSubscriptionDetails) {
  const raw =
    mergedSubscriptionDetails?.membershipCategory ??
    effective?.subscriptionDetails?.membershipCategory;
  if (raw == null) return "";
  const s = String(raw).trim();
  return s;
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

  const attrs = data?.subscriptionAttributes;
  const subscriptionDetailsForForm = { ...(effective?.subscriptionDetails || {}) };
  if (attrs && typeof attrs === "object") {
    if (
      attrs.paymentFrequency != null &&
      (subscriptionDetailsForForm.paymentFrequency == null ||
        subscriptionDetailsForForm.paymentFrequency === "")
    ) {
      subscriptionDetailsForForm.paymentFrequency = attrs.paymentFrequency;
    }
    if (
      attrs.membershipCategory != null &&
      (subscriptionDetailsForForm.membershipCategory == null ||
        subscriptionDetailsForForm.membershipCategory === "")
    ) {
      subscriptionDetailsForForm.membershipCategory = attrs.membershipCategory;
    }
  }

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
          memberFullName:
            formKind === "SD19" ? resolveMemberFullName(effective) : "",
          workLocation:
            formKind === "SD19" ? resolveWorkLocation(effective) : "",
          subscriptionDetails: subscriptionDetailsForForm,
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

  let bodyWithForm;
  if (formKind === "SD19") {
    const categorySegment = resolveMembershipCategory(
      effective,
      subscriptionDetailsForForm,
    );
    const beforeMembership = categorySegment
      ? `${categorySegment} `
      : "";
    bodyWithForm = `You chose to pay by Salary Deduction for your ${beforeMembership}membership. Please download, print, sign, and return your form or submit it directly via your membership companion mobile App`;
  } else if (formKind === "SBO") {
    const categorySegment = resolveMembershipCategory(
      effective,
      subscriptionDetailsForForm,
    );
    const beforeMembership = categorySegment
      ? `${categorySegment} `
      : "";
    const attachedDetailsSentence = attachment
      ? " The required details are included in the attached form."
      : "";
    bodyWithForm = `You have chosen to pay by Standing Order for your ${beforeMembership}membership. Please set up your Standing Order using your banking App.${attachedDetailsSentence} Kindly return a signed copy by post or your membership companion mobile app.`;
  } else {
    bodyWithForm = "Your membership application has been approved.";
  }

  const notificationTitle =
    formKind === "SD19"
      ? "Submit Salary Deduction Form"
      : formKind === "SBO"
        ? "Submit Standing Order Form"
        : "Application approved";

  await dispatchNotification(
    {
      tenantId,
      userId,
      title: notificationTitle,
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
