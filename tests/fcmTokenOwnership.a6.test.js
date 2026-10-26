// Phase A / A6 — push-token ownership is tenant-aware: a binding's tenantId never changes; the same
// physical token in another tenant is an explicit, logged handoff; at most one active binding per token.
// The in-memory fake enforces both unique indexes (tenantId+fcmToken, and fcmToken where isActive).
// Native node:test. Run: node --test tests/fcmTokenOwnership.a6.test.js
const os = require("os");
const path = require("path");
const fs = require("fs");
process.env.LOG_ROOT = process.env.LOG_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "notif-a6-"));
process.env.NODE_ENV = process.env.NODE_ENV || "test";
const test = require("node:test");
const assert = require("node:assert");

const A = "68cbf7806080b4621d469d34", B = "6acd6119b28a863c61361ae0";
let docs = [], seq = 0;
const val = (d, k) => d[k];
function matches(d, q) {
  return Object.entries(q).every(([k, v]) => {
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      if ("$in" in v) return v.$in.map(String).includes(String(val(d, k)));
      if ("$ne" in v) return String(val(d, k)) !== String(v.$ne);
      throw new Error("unsupported " + JSON.stringify(v));
    }
    return String(val(d, k)) === String(v);
  });
}
function checkUnique() {
  const seen1 = new Set(), seen2 = new Set();
  for (const d of docs) {
    const k1 = `${d.tenantId}|${d.fcmToken}`; if (seen1.has(k1)) { const e = new Error("E11000 tenantId_1_fcmToken_1"); e.code = 11000; throw e; } seen1.add(k1);
    if (d.isActive) { if (seen2.has(d.fcmToken)) { const e = new Error("E11000 fcmToken_active_unique"); e.code = 11000; throw e; } seen2.add(d.fcmToken); }
  }
}
const chain = (rows) => { const c = { select: () => c, lean: () => c, sort: () => c, then: (r, j) => Promise.resolve(rows.map((x) => ({ ...x }))).then(r, j) }; return c; };
const Fake = {
  find: (q) => chain(docs.filter((d) => matches(d, q))),
  updateMany: async (q, u) => { const snap = JSON.stringify(docs); for (const d of docs.filter((x) => matches(x, q))) Object.assign(d, u.$set); try { checkUnique(); } catch (e) { docs = JSON.parse(snap); throw e; } return {}; },
  findOneAndUpdate: async (q, u, o) => {
    const snap = JSON.stringify(docs);
    let d = docs.find((x) => matches(x, q));
    if (!d) { if (!o.upsert) return null; d = { _id: `b${++seq}`, createdAt: new Date() }; docs.push(d); }
    Object.assign(d, u.$set);
    try { checkUnique(); } catch (e) { docs = JSON.parse(snap); throw e; }
    return { ...d };
  },
};
const file = require.resolve("../models/fcmToken.model.js");
require.cache[file] = { id: file, filename: file, loaded: true, exports: Fake };
const logger = require("../config/logger.js");
const warns = [];
logger.warn = (o, m) => warns.push({ o, m });
const ctrl = require("../controllers/firebase.controller.js");

const mkRes = () => { const r = { statusCode: 200, body: null }; r.status = (c) => ((r.statusCode = c), r); r.json = (b) => ((r.body = b), r); return r; };
const register = async (tenantId, userId, body) => { const res = mkRes(); await ctrl.registerToken({ ctx: { tenantId, userId }, body }, res); return res; };
const reset = () => { docs = []; seq = 0; warns.length = 0; };
const of = (t) => docs.filter((d) => d.tenantId === t);
const handoffs = () => warns.filter((w) => w.o?.event === "FcmTokenTenantHandoff");

test("same token, same tenant: one binding, re-registration updates it in place", async () => {
  reset();
  await register(A, "uA", { fcmToken: "TOK", deviceId: "d1", platform: "web" });
  await register(A, "uA", { fcmToken: "TOK", deviceId: "d1", platform: "web" });
  assert.strictEqual(docs.length, 1);
  assert.deepStrictEqual([docs[0].tenantId, docs[0].isActive], [A, true]);
  assert.strictEqual(handoffs().length, 0);
});

test("same token, second tenant: explicit handoff — A deactivated (tenant unchanged), B gets its own active binding", async () => {
  reset();
  await register(A, "uA", { fcmToken: "TOK" });
  const res = await register(B, "uB", { fcmToken: "TOK" });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(docs.length, 2);
  assert.deepStrictEqual([of(A)[0].tenantId, of(A)[0].userId, of(A)[0].isActive], [A, "uA", false]);
  assert.deepStrictEqual([of(B)[0].tenantId, of(B)[0].userId, of(B)[0].isActive], [B, "uB", true]);
  const h = handoffs();
  assert.strictEqual(h.length, 1);
  assert.deepStrictEqual([h[0].o.toTenantId, h[0].o.fromTenantIds], [B, [A]]);
  assert.ok(!JSON.stringify(h[0]).includes("TOK"), "handoff log must not contain the token value");
});

test("old tenant cannot implicitly mutate the new tenant's binding: re-registering in A is a new explicit handoff", async () => {
  reset();
  await register(A, "uA", { fcmToken: "TOK" });
  await register(B, "uB", { fcmToken: "TOK" });
  await register(A, "uA", { fcmToken: "TOK" });
  assert.deepStrictEqual([of(B)[0].tenantId, of(B)[0].userId, of(B)[0].isActive], [B, "uB", false]);
  assert.deepStrictEqual([of(A)[0].tenantId, of(A)[0].isActive], [A, true]);
  assert.strictEqual(docs.filter((d) => d.isActive).length, 1);
  assert.strictEqual(handoffs().length, 2);
});

test("inactive historical binding in another tenant: no handoff, untouched", async () => {
  reset();
  docs.push({ _id: "old", tenantId: A, userId: "uA", fcmToken: "TOK", isActive: false });
  await register(B, "uB", { fcmToken: "TOK" });
  assert.deepStrictEqual({ ...docs.find((d) => d._id === "old") }, { _id: "old", tenantId: A, userId: "uA", fcmToken: "TOK", isActive: false });
  assert.strictEqual(of(B)[0].isActive, true);
  assert.strictEqual(handoffs().length, 0);
});

test("no tenant supplied: 401, nothing written", async () => {
  reset();
  const res = await register(undefined, "uA", { fcmToken: "TOK" });
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(docs.length, 0);
});

test("forged ownership in the body is ignored: binding goes to the trusted tenant/user only", async () => {
  reset();
  await register(B, "uB", { fcmToken: "TOK", tenantId: A, userId: "uA" });
  assert.strictEqual(docs.length, 1);
  assert.deepStrictEqual([docs[0].tenantId, docs[0].userId], [B, "uB"]);
});

test("dispatcher deactivation and model indexes are tenant-aware", () => {
  const disp = fs.readFileSync(path.join(__dirname, "..", "services", "notificationDispatcher.js"), "utf8");
  assert.ok(/\{ tenantId: tokenDoc\.tenantId, fcmToken: tokenDoc\.fcmToken, isActive: true \}/.test(disp));
  assert.ok(!/\{ fcmToken: tokenDoc\.fcmToken, isActive: true \}/.test(disp));
  const model = fs.readFileSync(path.join(__dirname, "..", "models", "fcmToken.model.js"), "utf8");
  assert.ok(!/fcmToken: \{[^}]*unique: true/.test(model), "no global unique on the fcmToken field");
  assert.ok(/index\(\{ tenantId: 1, fcmToken: 1 \}, \{ unique: true, name: "tenantId_1_fcmToken_1" \}\)/.test(model));
  assert.ok(/name: "fcmToken_active_unique", partialFilterExpression: \{ isActive: true \}/.test(model));
});
