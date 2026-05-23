const logger = require("../../config/logger.js");
const {
  FINANCE_DOC_TYPES,
  extractMemberId,
} = require("../../helpers/journalFinanceRealtime.js");
const {
  emitMemberFinanceUpdated,
} = require("../../services/memberFinanceRealtime.service");

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

  emitMemberFinanceUpdated({
    tenantId: String(tenantId),
    memberId,
    profileId: data.profileId ? String(data.profileId) : undefined,
    docType,
    docNo: data.docNo,
  });
};
