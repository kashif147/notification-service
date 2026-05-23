const express = require("express");
const {
  emitMemberFinanceUpdated,
} = require("../services/memberFinanceRealtime.service");
const logger = require("../config/logger.js");

const router = express.Router();

function assertInternalRequest(req, res, next) {
  const isInternal =
    req.headers["x-internal-request"] === "true" ||
    req.headers["x-internal-request"] === "1";
  if (!isInternal) {
    return res.status(401).json({
      status: "error",
      message: "Internal endpoint: x-internal-request header required",
    });
  }
  return next();
}

/**
 * POST /internal/realtime/member-finance-updated
 * Body: { tenantId, memberId, profileId?, docType?, docNo? }
 */
router.post(
  "/member-finance-updated",
  assertInternalRequest,
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
