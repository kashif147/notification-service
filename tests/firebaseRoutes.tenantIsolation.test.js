"use strict";
// Phase 2B0 — the five /api/firebase token/send routes are authenticated and tenant-scoped.
//
// Before: register-token, unregister-token, tokens, tokens/filter and send-notification had no
// authenticate middleware, so tenantId/userId came from the body/query: any caller could list
// every tenant's FCM tokens, push to any user in any tenant, and bind a device to another user.
//
// Drives the real router + real authenticate (gateway headers) + the tenant-context guard over
// HTTP. FCMToken / NotificationHistory, the FCM sender and axios (profile enrichment) are
// in-memory fakes injected via require.cache, so no DB / Firebase / network.
//
// Run: node --test tests/firebaseRoutes.tenantIsolation.test.js
const os = require("os");
const path = require("path");
const fs = require("fs");
process.env.LOG_ROOT =
  process.env.LOG_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "notif-firebase-"));
process.env.NODE_ENV = process.env.NODE_ENV || "test";

const test = require("node:test");
const assert = require("node:assert");
const express = require("express");

const TENANT_A = "68cbf7806080b4621d469d34";
const TENANT_B = "bbbbbbbbbbbbbbbbbbbbbbbb";

// ---------------- in-memory fakes ----------------
let tokens = [];
let history = [];
let pushes = [];
let profileCalls = [];

function matches(doc, query) {
  return Object.entries(query).every(([k, v]) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if ("$in" in v) return v.$in.map(String).includes(String(doc[k]));
      if ("$ne" in v) return String(doc[k]) !== String(v.$ne);
      throw new Error(`fake FCMToken: unsupported operator in ${JSON.stringify(v)}`);
    }
    return String(doc[k]) === String(v);
  });
}
function chain(rows) {
  const c = {
    select: () => c,
    sort: () => c,
    limit: () => c,
    skip: () => c,
    lean: () => c,
    then: (res, rej) => Promise.resolve(rows.map((r) => ({ ...r }))).then(res, rej),
  };
  return c;
}
function single(row) {
  const c = {
    select: () => c,
    lean: () => c,
    then: (res, rej) => Promise.resolve(row ? { ...row } : null).then(res, rej),
  };
  return c;
}
const FakeFCMToken = {
  find: (q) => chain(tokens.filter((t) => matches(t, q))),
  findOne: (q) => single(tokens.find((t) => matches(t, q))),
  countDocuments: async (q) => tokens.filter((t) => matches(t, q)).length,
  findOneAndUpdate: async (q, update, opts = {}) => {
    let doc = tokens.find((t) => matches(t, q));
    if (!doc) {
      if (!opts.upsert) return null;
      doc = { _id: `tok_${tokens.length + 1}`, createdAt: new Date() };
      tokens.push(doc);
    }
    Object.assign(doc, update.$set || update);
    return { ...doc };
  },
  updateMany: async (q, update) => {
    for (const t of tokens.filter((x) => matches(x, q))) Object.assign(t, update.$set || update);
    return {};
  },
};
const FakeHistory = { create: async (row) => (history.push(row), row) };
const fakeNotificationService = {
  sendNotification: async (title, body, token) => (pushes.push({ title, body, token }), `msg-${token}`),
};
const fakeAxios = {
  post: async (url, body, opts) => (profileCalls.push({ url, body, headers: opts.headers }), { data: { success: true, data: {} } }),
};

const stub = (rel, exportsObj) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exportsObj };
};
stub("../models/fcmToken.model.js", FakeFCMToken);
stub("../models/notificationHistory.model.js", FakeHistory);
stub("../services/notificationService", fakeNotificationService);
require.cache[require.resolve("axios")] = {
  id: require.resolve("axios"),
  filename: require.resolve("axios"),
  loaded: true,
  exports: fakeAxios,
};

const firebaseRoutes = require("../routes/firebase.route.js");

// ---------------- harness ----------------
function seed() {
  tokens = [
    { _id: "t1", tenantId: TENANT_A, userId: "uA1", fcmToken: "tok-A1", deviceId: "dA1", platform: "web", isActive: true },
    { _id: "t2", tenantId: TENANT_A, userId: "uA2", fcmToken: "tok-A2", deviceId: "dA2", platform: "ios", isActive: true },
    { _id: "t3", tenantId: TENANT_B, userId: "uB1", fcmToken: "tok-B1", deviceId: "dB1", platform: "android", isActive: true },
  ];
  history = [];
  pushes = [];
  profileCalls = [];
}

const ident = (tenantId, userId, userType) => ({
  "x-jwt-verified": "true",
  "x-auth-source": "gateway",
  "x-tenant-id": tenantId,
  "x-user-id": userId,
  "x-user-type": userType,
  "x-user-roles": "[]",
  "x-user-permissions": "[]",
});
const CRM_A = ident(TENANT_A, "crm-A", "CRM");
const PORTAL_A1 = ident(TENANT_A, "uA1", "PORTAL");
const PORTAL_B1 = ident(TENANT_B, "uB1", "PORTAL");

async function call(method, url, { headers = {}, body } = {}) {
  const app = express();
  app.use(express.json());
  app.use("/api/firebase", firebaseRoutes);
  const server = app.listen(0);
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}
    return { status: res.status, text, body: json };
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    await new Promise((r) => server.close(r));
  }
}

// ---------------- tests ----------------
test("A all five routes reject unauthenticated callers and touch nothing", async () => {
  seed();
  const before = JSON.stringify(tokens);
  for (const [m, u, body] of [
    ["POST", "/api/firebase/register-token", { fcmToken: "tok-X", userId: "uB1", tenantId: TENANT_B }],
    ["POST", "/api/firebase/unregister-token", { fcmToken: "tok-B1", userId: "uB1", tenantId: TENANT_B }],
    ["GET", "/api/firebase/tokens"],
    ["GET", `/api/firebase/tokens/filter?tenantId=${TENANT_B}`],
    ["POST", "/api/firebase/send-notification", { title: "t", body: "b", userId: "uB1", tenantId: TENANT_B }],
  ]) {
    const res = await call(m, u, { body });
    assert.ok(res.status === 401 || res.status === 400, `${m} ${u} -> ${res.status}`);
    assert.doesNotMatch(res.text, /tok-[AB]\d/, `${u} leaked a token`);
  }
  assert.strictEqual(JSON.stringify(tokens), before);
  assert.strictEqual(pushes.length, 0);
});

test("B an ordinary portal user cannot list tokens, filter tokens or push", async () => {
  seed();
  for (const [m, u, body] of [
    ["GET", "/api/firebase/tokens"],
    ["GET", `/api/firebase/tokens/filter?tenantId=${TENANT_B}`],
    ["POST", "/api/firebase/send-notification", { title: "t", body: "b", userId: ["uB1"], tenantId: [TENANT_B] }],
  ]) {
    const res = await call(m, u, { headers: PORTAL_A1, body });
    assert.strictEqual(res.status, 403, `${m} ${u}`);
    assert.doesNotMatch(res.text, /tok-[AB]\d/);
  }
  assert.strictEqual(pushes.length, 0);
});

test("C CRM token list is limited to the caller's tenant and forwards caller identity", async () => {
  seed();
  const res = await call("GET", "/api/firebase/tokens", { headers: { ...CRM_A, authorization: "Bearer crm-a-jwt" } });
  assert.strictEqual(res.status, 200);
  const got = res.body.data.tokens.map((t) => t.fcmToken).sort();
  assert.deepStrictEqual(got, ["tok-A1", "tok-A2"]);
  assert.strictEqual(res.body.data.pagination.total, 2);
  assert.strictEqual(profileCalls.length, 1);
  assert.strictEqual(profileCalls[0].headers.Authorization, "Bearer crm-a-jwt");
  assert.strictEqual(profileCalls[0].headers["x-internal-request"], undefined);
});

test("D CRM ?tenantId= on /tokens/filter cannot reach another tenant", async () => {
  seed();
  const res = await call("GET", `/api/firebase/tokens/filter?tenantId=${TENANT_B}&userId=uB1`, { headers: CRM_A });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body.data.tokens, []);
  assert.strictEqual(res.body.data.filters.tenantId, TENANT_A);
  const own = await call("GET", "/api/firebase/tokens/filter?userId=uA2", { headers: CRM_A });
  assert.deepStrictEqual(own.body.data.tokens.map((t) => t.fcmToken), ["tok-A2"]);
});

test("E register-token always binds to the authenticated user and tenant (body ids ignored)", async () => {
  seed();
  const res = await call("POST", "/api/firebase/register-token", {
    headers: PORTAL_A1,
    body: { fcmToken: "tok-new", userId: "uB1", tenantId: TENANT_B, deviceId: "dev-9", platform: "web" },
  });
  assert.strictEqual(res.status, 200);
  const rec = tokens.find((t) => t.fcmToken === "tok-new");
  assert.strictEqual(rec.tenantId, TENANT_A);
  assert.strictEqual(rec.userId, "uA1");
  assert.ok(!tokens.some((t) => t.fcmToken === "tok-new" && (t.userId === "uB1" || t.tenantId === TENANT_B)));
});

test("F unregister-token cannot deactivate another user's or another tenant's token", async () => {
  seed();
  const res = await call("POST", "/api/firebase/unregister-token", {
    headers: PORTAL_B1,
    body: { fcmToken: "tok-A1", userId: "uA1", tenantId: TENANT_A },
  });
  assert.strictEqual(res.status, 404);
  assert.strictEqual(tokens.find((t) => t.fcmToken === "tok-A1").isActive, true);

  const own = await call("POST", "/api/firebase/unregister-token", { headers: PORTAL_B1, body: { fcmToken: "tok-B1" } });
  assert.strictEqual(own.status, 200);
  assert.strictEqual(tokens.find((t) => t.fcmToken === "tok-B1").isActive, false);
});

test("G CRM send cannot target another tenant's users or raw tokens", async () => {
  seed();
  const byUser = await call("POST", "/api/firebase/send-notification", {
    headers: CRM_A,
    body: { title: "t", body: "b", userId: ["uB1"], tenantId: [TENANT_B] },
  });
  assert.strictEqual(byUser.status, 404);
  const byToken = await call("POST", "/api/firebase/send-notification", {
    headers: CRM_A,
    body: { title: "t", body: "b", fcmToken: "tok-B1", tenantId: TENANT_B },
  });
  assert.strictEqual(byToken.status, 404);
  assert.strictEqual(pushes.length, 0);
  assert.strictEqual(history.length, 0);
});

test("H CRM send to own-tenant users works (array userId) and history uses the trusted tenant", async () => {
  seed();
  const res = await call("POST", "/api/firebase/send-notification", {
    headers: CRM_A,
    body: { title: "Hello", body: "World", userId: ["uA1", "uA2", "uB1"], tenantId: [TENANT_B, TENANT_B, TENANT_B] },
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.total, 2);
  assert.deepStrictEqual(pushes.map((p) => p.token).sort(), ["tok-A1", "tok-A2"]);
  assert.strictEqual(history.length, 2);
  for (const h of history) assert.strictEqual(h.tenantId, TENANT_A);
  assert.deepStrictEqual(history.map((h) => h.userId).sort(), ["uA1", "uA2"]);
});
