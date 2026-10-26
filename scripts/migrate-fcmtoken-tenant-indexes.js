#!/usr/bin/env node
/**
 * Phase A / A6 — FCM token tenant-aware uniqueness.
 *
 *   (default)       dry run: preconditions + planned changes only
 *   --execute       create tenantId_1_fcmToken_1 (unique) + fcmToken_active_unique
 *                   (unique, partial isActive:true); both coexist with the old index
 *   --drop-global   additionally drop the old GLOBAL unique fcmToken_1 (only when both new
 *                   indexes exist; run before deploying the handoff code)
 *
 * Prints index names, counts and booleans only — never token values. Uses this service's own
 * MONGO_URI (database-per-service). Rollback: drop the two new indexes and recreate
 * { fcmToken: 1 } unique (valid only while every token has <= 1 document).
 */
const mongoose = require("mongoose");
const EXECUTE = process.argv.includes("--execute");
const DROP_GLOBAL = process.argv.includes("--drop-global");

(async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI, { autoIndex: false, autoCreate: false });
  const db = mongoose.connection.db;
  const c = db.collection("fcmtokens");
  const dup = async (keys, match = {}) =>
    (await c.aggregate([{ $match: match }, { $group: { _id: Object.fromEntries(keys.map((k) => [k, `$${k}`])), n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]).toArray()).length;
  const pre = {
    db: db.databaseName,
    total: await c.countDocuments(),
    active: await c.countDocuments({ isActive: true }),
    missingIsActive: await c.countDocuments({ isActive: { $exists: false } }),
    missingTenant: await c.countDocuments({ $or: [{ tenantId: { $exists: false } }, { tenantId: null }, { tenantId: "" }] }),
    dupTenantToken: await dup(["tenantId", "fcmToken"]),
    dupActiveToken: await dup(["fcmToken"], { isActive: true }),
  };
  console.log("[fcm-idx] preconditions", JSON.stringify(pre));
  const names = async () => (await c.indexes()).map((i) => `${i.name}${i.unique ? "(U)" : ""}${i.partialFilterExpression ? "(partial)" : ""}`);
  console.log("[fcm-idx] indexes before", JSON.stringify(await names()));
  if (pre.missingIsActive || pre.missingTenant || pre.dupTenantToken || pre.dupActiveToken) {
    console.log("[fcm-idx] PRECONDITION FAIL — nothing changed");
    process.exitCode = 2;
    return mongoose.disconnect();
  }
  if (!EXECUTE) {
    console.log("[fcm-idx] dry run — would create tenantId_1_fcmToken_1, fcmToken_active_unique" + (DROP_GLOBAL ? " and drop fcmToken_1" : ""));
    return mongoose.disconnect();
  }
  await c.createIndex({ tenantId: 1, fcmToken: 1 }, { unique: true, name: "tenantId_1_fcmToken_1" });
  await c.createIndex({ fcmToken: 1 }, { unique: true, name: "fcmToken_active_unique", partialFilterExpression: { isActive: true } });
  const after = await c.indexes();
  const ok = after.some((i) => i.name === "tenantId_1_fcmToken_1" && i.unique) && after.some((i) => i.name === "fcmToken_active_unique" && i.unique && i.partialFilterExpression);
  console.log("[fcm-idx] new indexes present:", ok);
  if (DROP_GLOBAL) {
    if (!ok) { console.log("[fcm-idx] not dropping fcmToken_1: new indexes missing"); process.exitCode = 3; return mongoose.disconnect(); }
    if (after.some((i) => i.name === "fcmToken_1")) { await c.dropIndex("fcmToken_1"); console.log("[fcm-idx] dropped fcmToken_1"); }
    else console.log("[fcm-idx] fcmToken_1 already absent");
  }
  console.log("[fcm-idx] indexes after", JSON.stringify(await names()));
  await mongoose.disconnect();
})().catch((e) => { console.log("[fcm-idx] ERROR", e.name, e.code || "", String(e.message).slice(0, 120)); process.exit(1); });
