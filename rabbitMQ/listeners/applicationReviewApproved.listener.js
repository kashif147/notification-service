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
function resolveMembershipCategory(effective) {
  const raw = effective?.subscriptionDetails?.membershipCategory;
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

  let bodyWithForm;
  if (formKind === "SD19") {
    const categorySegment = resolveMembershipCategory(effective);
    const beforeMembership = categorySegment
      ? `${categorySegment} `
      : "";
    bodyWithForm = `You chose to pay by Salary Deduction for your ${beforeMembership}membership. Please download, print, sign, and return your form or submit it directly via your membership companion mobile App`;
  } else if (attachment && formLabel) {
    bodyWithForm = `Your membership application has been approved. Your prefilled ${formLabel} form is attached — open the notification to download the PDF.`;
  } else {
    bodyWithForm = "Your membership application has been approved.";
  }

  const notificationTitle =
    formKind === "SD19"
      ? "Submit Salary Deduction Form"
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
