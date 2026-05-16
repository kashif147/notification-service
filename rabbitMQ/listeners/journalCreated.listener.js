const { getSocketIO } = require("../index");
const logger = require("../../config/logger.js");
const {
  FINANCE_DOC_TYPES,
  extractMemberId,
} = require("../../helpers/journalFinanceRealtime.js");

function emitMemberFinanceUpdated(io, { tenantId, memberId, profileId, docType, docNo }) {
  const payload = {
    memberId,
    ...(profileId ? { profileId } : {}),
    docType,
    docNo,
    timestamp: new Date().toISOString(),
  };

  io.to(`tenant:${tenantId}`).emit("memberFinanceUpdated", payload);
  io.to(`tenant:${tenantId}`).emit("member:finance:updated", payload);
}

/**
 * journal.events → journal.created.v1
 * Pushes finance invalidation to CRM clients on the tenant room (ProfileRealtimeProvider).
 */
module.exports = async function handleJournalCreated(payload) {
  const data = payload?.data || payload || {};
  const docType = String(data.docType || "").trim();

  if (!FINANCE_DOC_TYPES.has(docType)) {
    return;
  }

  const memberId = extractMemberId(data);
  if (!memberId) {
    logger.debug(
      { docType, docNo: data.docNo },
      "journalCreated: no memberId; skip memberFinanceUpdated",
    );
    return;
  }

  const tenantId =
    payload?.tenantId ??
    data?.tenantId ??
    payload?.metadata?.tenantId ??
    null;

  if (!tenantId) {
    logger.warn(
      { docType, docNo: data.docNo, memberId },
      "journalCreated: tenantId missing; cannot emit memberFinanceUpdated",
    );
    return;
  }

  const io = getSocketIO();
  if (!io) {
    logger.warn(
      { tenantId, memberId, docNo: data.docNo },
      "journalCreated: Socket.IO not ready",
    );
    return;
  }

  emitMemberFinanceUpdated(io, {
    tenantId: String(tenantId),
    memberId,
    profileId: data.profileId ? String(data.profileId) : undefined,
    docType,
    docNo: data.docNo,
  });

  logger.info(
    { tenantId, memberId, docType, docNo: data.docNo },
    "journalCreated: emitted memberFinanceUpdated",
  );
};
