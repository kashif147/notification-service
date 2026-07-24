# Authentication

`middlewares/auth.js` supports three modes, tried in order:

1. **Gateway-verified** (primary for microservice mesh): headers `x-jwt-verified: true` +
   `x-auth-source: gateway` — trusts the gateway's pre-validation, extracts user context from
   `x-user-id`, `x-tenant-id`, etc.
2. **Auth bypass** (legacy/dev): `AUTH_BYPASS_ENABLED=true` — still validates the JWT but skips
   authorization checks.
3. **Bearer JWT** (fallback): verifies with `JWT_SECRET`, extracts `tenantId`, `sub`/`id`,
   `userType`, `roles`, `permissions`.

`requireCrmUser` is a separate, stricter gate layered on top of `authenticate` for the admin
routes — don't reuse plain `authenticate` alone for anything that should be CRM-staff-only; it
will let non-CRM authenticated users through.

`routes/internal.realtime.route.js` bypasses all three modes, trusting only
`x-internal-request: true` — it is not meant to be reachable from outside the platform's internal
network/gateway.
