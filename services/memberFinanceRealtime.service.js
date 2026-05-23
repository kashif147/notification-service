const { getSocketIO } = require("../rabbitMQ/index");
const logger = require("../config/logger.js");

/**
 * Push finance invalidation to all CRM sockets in the tenant room.
 * @param {{ tenantId: string, memberId: string, profileId?: string, docType?: string, docNo?: string }} params
 */
function emitMemberFinanceUpdated({
  tenantId,
  memberId,
  profileId,
  docType,
  docNo,
}) {
  const tid = tenantId != null ? String(tenantId).trim() : "";
  const mid = memberId != null ? String(memberId).trim() : "";
  if (!tid || !mid) {
    return false;
  }

  const io = getSocketIO();
  if (!io) {
    logger.warn(
      { tenantId: tid, memberId: mid, docNo },
      "emitMemberFinanceUpdated: Socket.IO not ready",
    );
    return false;
  }

  const payload = {
    memberId: mid,
    ...(profileId ? { profileId: String(profileId) } : {}),
    ...(docType ? { docType: String(docType) } : {}),
    ...(docNo ? { docNo: String(docNo) } : {}),
    timestamp: new Date().toISOString(),
  };

  io.to(`tenant:${tid}`).emit("memberFinanceUpdated", payload);
  io.to(`tenant:${tid}`).emit("member:finance:updated", payload);

  logger.info(
    { tenantId: tid, memberId: mid, docType, docNo },
    "emitMemberFinanceUpdated: pushed to tenant room",
  );
  return true;
}

module.exports = { emitMemberFinanceUpdated };
