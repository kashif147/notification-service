"use strict";
// Phase 1A adoption — notification-service tenant-context guard (WARN MODE).
// Native node:test (CommonJS). Run: node --test tests/tenantContext.adoption.test.js
//
// notification-service has a HYBRID auth layout:
//   - /api/notifications/admin: app-level `authenticate` (+ requireCrmUser) → guard mounted app-level
//   - /api/firebase & /api/notifications: per-route `authenticate` → guard inserted per-route
// Ordering everywhere: authenticate -> tenantContextWarn -> [requireCrmUser] -> handler.
//
// NOTE: the admin router defines 10 route registrations (the assessment said 9 — `/preview`
// and `/:id` both map to getNotificationAdminById). All are covered by the single app-level
// mount, so guard coverage is unchanged; the authenticated total is 10 + 4 + 2 = 16.
const os = require("os");
const path = require("path");
const fs = require("fs");
process.env.LOG_ROOT =
  process.env.LOG_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "notif-tenantctx-"));
process.env.NODE_ENV = process.env.NODE_ENV || "test";

const test = require("node:test");
const assert = require("node:assert");
const policyMw = require("@membership/policy-middleware");
const { tenantContextMiddleware, resolveTenantContext } = policyMw;
const { tenantContextWarn } = require("../middlewares/tenantContext.mw.js");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const TRUSTED = "68cbf7806080b4621d469d34";
const OTHER = "aaaaaaaaaaaaaaaaaaaaaaaa";

const appSrc = () => read("app.js");
const fbSrc = () => read(path.join("routes", "firebase.route.js"));
const notifSrc = () => read(path.join("routes", "notifications.route.js"));
const adminSrc = () => read(path.join("routes", "notification.admin.routes.js"));

// ordered triples: authenticate -> tenantContextWarn -> (non-empty next line)
const orderedGuardCount = (src) =>
  (src.match(/^\s*authenticate,\s*\n\s*tenantContextWarn,\s*\n\s*[A-Za-z]/gm) || []).length;

function gatewayReq(o = {}) {
  return {
    method: "GET",
    url: "/api/notifications",
    originalUrl: "/api/notifications",
    headers: {
      "x-jwt-verified": "true",
      "x-auth-source": "gateway",
      "x-user-id": "U1",
      "x-tenant-id": TRUSTED,
      ...(o.headers || {}),
    },
    ctx: o.ctx !== undefined ? o.ctx : { tenantId: TRUSTED, userId: "U1" },
    tenantId: o.tenantId,
    body: o.body,
    query: o.query,
    params: o.params,
  };
}
function mkRes() {
  const r = { statusCode: null, _s: [] };
  r.status = (c) => ((r.statusCode = c), r._s.push(c), r);
  r.json = () => r;
  return r;
}
function run(req) {
  const res = mkRes();
  const orig = process.stdout.write.bind(process.stdout);
  const chunks = [];
  process.stdout.write = (s) => (chunks.push(typeof s === "string" ? s : s.toString()), true);
  let n = 0;
  try {
    tenantContextWarn(req, res, () => (n += 1));
  } finally {
    process.stdout.write = orig;
  }
  const rows = chunks
    .join("")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return { req, res, nextCount: n, rows };
}

// ---- static structure ----
test("1 tenantContextWarn exists (exported, callable)", () => {
  assert.equal(typeof tenantContextWarn, "function");
});
test("2 guard mode is warn; no enforce", () => {
  const src = read(path.join("middlewares", "tenantContext.mw.js"));
  assert.match(src, /tenantContextMiddleware\(\{\s*mode:\s*"warn"\s*\}\)/);
  assert.ok(!/mode:\s*"enforce"/.test(src));
});
test("3 app.js imports tenantContextWarn", () => {
  assert.match(appSrc(), /require\("\.\/middlewares\/tenantContext\.mw\.js"\)/);
});
test("4 admin mount order: authenticate -> tenantContextWarn -> requireCrmUser -> routes", () => {
  assert.match(
    appSrc(),
    /app\.use\(\s*"\/api\/notifications\/admin",\s*authenticate,\s*tenantContextWarn,\s*requireCrmUser,\s*notificationAdminRoutes\s*\)/
  );
});
test("5 admin guarded mount appears exactly once", () => {
  const n = (appSrc().match(/app\.use\([^)]*tenantContextWarn[^)]*\)/g) || []).length;
  assert.equal(n, 1);
});
test("6 admin router defines 10 route registrations (all under the single guarded mount)", () => {
  const defs = (adminSrc().match(/^router\.(get|put|post|delete|patch)\(/gm) || []).length;
  assert.equal(defs, 10);
  assert.ok(!adminSrc().includes("tenantContextWarn"), "admin router file unchanged (guarded at mount)");
});
test("7 firebase authenticated guard count = 4", () => {
  assert.equal((fbSrc().match(/^\s*tenantContextWarn,\s*$/gm) || []).length, 4);
});
test("8 notifications authenticated guard count = 2", () => {
  assert.equal((notifSrc().match(/^\s*tenantContextWarn,\s*$/gm) || []).length, 2);
});
test("9 total authenticated coverage = 16 (10 admin + 4 firebase + 2 notifications)", () => {
  const admin = 10; // single mount covers all
  const fb = (fbSrc().match(/^\s*tenantContextWarn,\s*$/gm) || []).length;
  const nt = (notifSrc().match(/^\s*tenantContextWarn,\s*$/gm) || []).length;
  assert.equal(admin + fb + nt, 16);
});
test("10 firebase guarded ordering: authenticate -> tenantContextWarn -> handler (x4)", () => {
  assert.equal(orderedGuardCount(fbSrc()), 4);
  assert.ok(!/tenantContextWarn,\s*\n\s*authenticate,/.test(fbSrc()), "guard never before authenticate");
});
test("11 notifications guarded ordering: authenticate -> tenantContextWarn -> handler (x2)", () => {
  assert.equal(orderedGuardCount(notifSrc()), 2);
});
test("12 the 5 unauthenticated firebase routes remain unguarded", () => {
  const s = fbSrc();
  for (const line of [
    'router.post("/register-token", sendFirebaseNotification.registerToken);',
    'router.post("/unregister-token", sendFirebaseNotification.unregisterToken);',
    'router.get("/tokens", sendFirebaseNotification.getAllActiveTokens);',
    'router.get("/tokens/filter", sendFirebaseNotification.getFilteredTokens);',
    'router.post("/send-notification", sendFirebaseNotification.sendNotification);',
  ]) {
    assert.ok(s.includes(line), `unauth route present & unchanged: ${line}`);
  }
});
test("13 internal realtime remains unguarded", () => {
  assert.ok(!read(path.join("routes", "internal.realtime.route.js")).includes("tenantContextWarn"));
  assert.match(appSrc(), /app\.use\("\/api\/internal\/realtime",\s*internalRealtimeRoutes\)/);
});
test("14 / (root) remains unguarded", () => {
  const line = appSrc().split("\n").find((l) => l.includes('app.get("/"'));
  assert.ok(line && !line.includes("tenantContextWarn"));
});
test("15 /health* remains unguarded", () => {
  for (const l of appSrc().split("\n").filter((x) => x.includes('app.get("/health'))) {
    assert.ok(!l.includes("tenantContextWarn"));
  }
});
test("16 /api/system-logs remains unguarded", () => {
  const line = appSrc().split("\n").find((l) => l.includes("createSystemLogsRouter"));
  assert.ok(line && !line.includes("tenantContextWarn"));
});
test("17 auth.js unchanged (no guard reference)", () => {
  assert.ok(!read(path.join("middlewares", "auth.js")).includes("tenantContextWarn"));
});
test("18 controllers unchanged (no guard reference)", () => {
  for (const c of ["firebase.controller.js", "notification.admin.controller.js", "notification.filter.template.controller.js"]) {
    assert.ok(!read(path.join("controllers", c)).includes("tenantContextWarn"));
  }
});
test("19 services unchanged (no guard reference)", () => {
  assert.ok(!read(path.join("services", "notificationDispatcher.js")).includes("tenantContextWarn"));
});
test("20 models unchanged (no guard reference)", () => {
  for (const m of ["fcmToken.model.js", "notificationHistory.model.js", "template.model.js"]) {
    assert.ok(!read(path.join("models", m)).includes("tenantContextWarn"));
  }
});
test("21 RabbitMQ consumers unchanged (no guard reference)", () => {
  assert.ok(!read(path.join("rabbitMQ", "index.js")).includes("tenantContextWarn"));
});
test("22 Socket.IO code unchanged (no guard reference)", () => {
  assert.ok(!read(path.join("bin", "notification-service.js")).includes("tenantContextWarn"));
});
test("23 package.json unchanged (shared-dep SHAs pinned; no guard ref)", () => {
  const pkg = read("package.json");
  assert.match(pkg, /policy-middleware\.git#1d4a3b991c6bb3374e424e220f745b48d41e3ee7/);
  assert.match(pkg, /logging-lib\.git#5fd251bde4ad08ba71cf9844656b5bc126e13b43/);
  assert.match(pkg, /rabbitmq-middleware\.git#db70fb8ae7a6e62f2a96df1f68b41ec4944d5123/);
  assert.ok(!pkg.includes("tenantContextWarn"));
});
test("24 package-lock.json resolves the three pins", () => {
  const lock = read("package-lock.json");
  assert.match(lock, /policy-middleware\.git#1d4a3b991c6bb3374e424e220f745b48d41e3ee7/);
  assert.match(lock, /logging-lib\.git#5fd251bde4ad08ba71cf9844656b5bc126e13b43/);
  assert.match(lock, /rabbitmq-middleware\.git#db70fb8ae7a6e62f2a96df1f68b41ec4944d5123/);
});

// ---- runtime behaviour (WARN, non-blocking) ----
test("25 trusted tenant cannot be replaced by query tenant", () => {
  const { req, nextCount } = run(gatewayReq({ query: { tenantId: OTHER } }));
  assert.equal(req.tenantId, TRUSTED);
  assert.equal(nextCount, 1);
});
test("26 trusted tenant cannot be replaced by body tenant", () => {
  const { req, nextCount } = run(gatewayReq({ body: { tenantId: OTHER } }));
  assert.equal(req.tenantId, TRUSTED);
  assert.equal(nextCount, 1);
});
test("27 mismatch emits TenantContextMismatch (mode=warn, outcome=ignored)", () => {
  const { rows } = run(gatewayReq({ query: { tenantId: OTHER } }));
  const row = rows.find((r) => r.eventType === "TenantContextMismatch");
  assert.ok(row);
  assert.equal(row.mode, "warn");
  assert.equal(row.outcome, "ignored");
  assert.equal(row.trustedTenantId, TRUSTED);
  assert.ok(row.suppliedSources.includes("query"));
});
test("28 matching tenant emits no mismatch", () => {
  const { rows } = run(gatewayReq({ body: { tenantId: TRUSTED } }));
  assert.equal(rows.find((r) => r.eventType === "TenantContextMismatch"), undefined);
});
test("29 mismatch is non-blocking: next() called, no 403", () => {
  const { res, nextCount } = run(gatewayReq({ query: { tenantId: OTHER } }));
  assert.equal(nextCount, 1);
  assert.equal(res.statusCode, null);
  assert.ok(!res._s.includes(403));
});
test("30 warn only, not enforce; package exposes both primitives", () => {
  const src = read(path.join("middlewares", "tenantContext.mw.js"));
  assert.match(src, /mode:\s*"warn"/);
  assert.ok(!/mode:\s*"enforce"/.test(src));
  assert.equal(typeof tenantContextMiddleware, "function");
  assert.equal(typeof resolveTenantContext, "function");
});
