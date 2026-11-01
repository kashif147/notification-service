// The canonical notification default (provisioning source) must capture the existing code-defined
// default exactly - what scripts/seed-notification-system-default-template.js creates: name "System
// default", columns NOTIFICATION_RESPONSE_COLUMNS (same order), no labels, no filters, flags false.
// Nothing added to make it look like other services. Only tenant ownership / system metadata may differ.
const g = require("../services/tenantGridDefaults");
const Template = require("../models/template.model");
const { NOTIFICATION_RESPONSE_COLUMNS } = require("../constants/notificationTemplate");

const OWNERSHIP_AND_SYSTEM_KEYS = ["_id", "tenantId", "userId", "createdAt", "updatedAt", "__v", "meta", "systemDefault"];
const TENANT = "68ebf0806080b4621d461ae0";
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !OWNERSHIP_AND_SYSTEM_KEYS.includes(k)));
// exactly the document the existing seed script builds (scripts/seed-notification-system-default-template.js)
const seedDoc = () => ({
  name: "System default",
  templateType: "notification",
  tenantId: TENANT,
  filters: {},
  columns: [...NOTIFICATION_RESPONSE_COLUMNS],
  isDefault: false,
  pinned: false,
  systemDefault: true,
  meta: { deleted: false, deletedAt: null },
});

test("manifest covers only 'notification'", () => {
  expect(Object.keys(g.loadCanonical().templates)).toEqual(["notification"]);
});

test("notification: provisioned default equals the code-defined seed default (columns, order, no labels, no filters, flags)", () => {
  const doc = g.buildTenantDefault(g.loadCanonical(), TENANT, "notification", new Date(0), undefined);
  expect(doc.columns).toEqual([...NOTIFICATION_RESPONSE_COLUMNS]);
  expect(doc.columnLabels).toEqual({});
  expect(doc.filters).toEqual({});
  expect(doc.visibleFilters).toEqual([]);
  expect(doc.name).toBe("System default");
  expect(doc.isDefault).toBe(false);
  expect(doc.pinned).toBe(false);
  const asServed = (raw) => strip(new Template(raw).toObject());
  expect(asServed(strip(doc))).toEqual(asServed(strip(seedDoc())));
});
