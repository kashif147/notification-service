const { tenantContextMiddleware } = require("@membership/policy-middleware");

/**
 * Phase 1A canonical tenant-context guard — WARN MODE ONLY (non-blocking).
 *
 * Mounted immediately AFTER `authenticate` (the trusted identity/tenant-establishing
 * middleware) and BEFORE the route handler / CRM gate:
 *   authenticate -> tenantContextWarn -> [requireCrmUser] -> handler
 *
 * It observes the trusted tenant already on req.ctx/req.user/req.tenantId,
 * re-pins req.tenantId to it, and LOGS any caller-supplied (body/query/params)
 * tenantId that disagrees as a non-blocking TenantContextMismatch event. It
 * never returns 403.
 *
 * Scope note: Phase 1A applies only to the 15 authenticated HTTP routes. The
 * unauthenticated firebase token routes (body tenantId), the internal realtime
 * route, RabbitMQ consumers, and Socket.IO delivery are deliberately out of
 * scope (parked N2/N3/N4).
 */
const tenantContextWarn = tenantContextMiddleware({ mode: "warn" });

module.exports = {
  tenantContextWarn,
};
