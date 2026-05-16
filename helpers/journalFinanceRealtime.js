/** Shared extraction for journal → member finance Socket.IO payloads. */
const FINANCE_DOC_TYPES = new Set(["Receipt", "Claim", "Refund", "WriteOff"]);

function extractMemberId(data) {
  if (!data || typeof data !== "object") return null;

  const claim = data.claimMemberId;
  if (claim != null && String(claim).trim()) return String(claim).trim();

  const top = data.memberId ?? data.membershipNumber ?? data.membershipNo;
  if (top != null && String(top).trim()) return String(top).trim();

  const entries = Array.isArray(data.entries) ? data.entries : [];
  for (const entry of entries) {
    const mid = entry?.memberId;
    if (mid != null && String(mid).trim() && !String(mid).startsWith("app:")) {
      return String(mid).trim();
    }
  }

  const memo = String(data.memo || "");
  const memberMatch = memo.match(/\(member\s+([^)]+)\)/i);
  if (memberMatch?.[1]) return memberMatch[1].trim();
  const batchMemberMatch = memo.match(/\bMember:\s*([^\s|]+)/i);
  if (batchMemberMatch?.[1]) return batchMemberMatch[1].trim();

  return null;
}

module.exports = {
  FINANCE_DOC_TYPES,
  extractMemberId,
};
