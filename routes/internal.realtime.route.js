const express = require("express");
const {
  emitMemberFinanceUpdated,
} = require("../services/memberFinanceRealtime.service");
const logger = require("../config/logger.js");

const router = express.Router();

function assertInternalKey(req, res, next) {
  const expected = process.env.NOTIFICATION_INTERNAL_API_KEY || "";
  if (!expected) {
    return res.status(503).json({
      status: "error",
      message: "Internal realtime API not configured",
    });
  }
  const provided =
    req.header("x-internal-api-key") || req.header("x-api-key") || "";
  if (provided !== expected) {
    return res.status(401).json({ status: "error", message: "Unauthorized" });
  }
  return next();
}

/**
 * POST /internal/realtime/member-finance-updated
 * Body: { tenantId, memberId, profileId?, docType?, docNo? }
 */
router.post(
  "/member-finance-updated",
  assertInternalKey,
  (req, res) => {
    const { tenantId, memberId, profileId, docType, docNo } = req.body || {};
    if (!tenantId || !memberId) {
      return res.status(400).json({
        status: "error",
        message: "tenantId and memberId are required",
      });
    }

    const ok = emitMemberFinanceUpdated({
      tenantId,
      memberId,
      profileId,
      docType,
      docNo,
    });

    if (!ok) {
      logger.warn(
        { tenantId, memberId, docNo },
        "internal member-finance-updated: emit returned false",
      );
    }

    return res.json({ status: "ok", emitted: ok });
  },
);

module.exports = router;
