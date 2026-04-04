/**
 * System default notification filter template per tenant.
 *
 *   TENANT_ID=your-tenant node scripts/seed-notification-system-default-template.js
 *   node scripts/seed-notification-system-default-template.js --tenant=your-tenant
 */

const mongoose = require("mongoose");
const path = require("path");
require("dotenv-flow").config({
  path: path.join(__dirname, ".."),
  silent: true,
});

const Template = require("../models/template.model.js");
const {
  NOTIFICATION_RESPONSE_COLUMNS,
} = require("../constants/notificationTemplate.js");

function parseTenantId() {
  const arg = process.argv.find((a) => a.startsWith("--tenant="));
  if (arg) return arg.split("=")[1]?.trim();
  return process.env.TENANT_ID || process.env.DEFAULT_TENANT_ID || "";
}

const tenantId = parseTenantId();
const uri =
  process.env.MONGO_URI ||
  (process.env.MONGO_USER && process.env.MONGO_PASS && process.env.MONGO_DB
    ? `mongodb+srv://${process.env.MONGO_USER}:${process.env.MONGO_PASS}@cluster.mongodb.net/${process.env.MONGO_DB}`
    : "");

async function main() {
  if (!tenantId) {
    console.error("Set TENANT_ID or --tenant=");
    process.exit(1);
  }
  if (!uri) {
    console.error("Set MONGO_URI (or MONGO_USER/MONGO_PASS/MONGO_DB)");
    process.exit(1);
  }

  await mongoose.connect(uri);
  const existing = await Template.findOne({
    tenantId,
    systemDefault: true,
    templateType: "notification",
    "meta.deleted": false,
  });
  if (existing) {
    console.log("Already exists:", existing._id);
    await mongoose.disconnect();
    return;
  }

  const doc = new Template({
    name: "System default",
    templateType: "notification",
    tenantId,
    filters: {},
    columns: [...NOTIFICATION_RESPONSE_COLUMNS],
    isDefault: false,
    pinned: false,
    systemDefault: true,
    meta: { deleted: false, deletedAt: null },
  });
  const saved = await doc.save();
  console.log("Created:", saved._id);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
