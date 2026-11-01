// GET /api/notifications/admin/templates/default is read-only and strictly tenant-scoped: it resolves
// the user's default view, else the tenant's system default, else null (= the client's built-in
// default). It used to persist a blank user view (columns: []) whenever the user had no default, which
// then took priority over the system default in PUT /filter.
// Part 1: REAL service + controller, Template write paths spied. Part 2: REAL service against a
// throwaway mongod (MONGOD_BIN or `mongod` on PATH; skipped otherwise). Run: jest
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const { spawn, spawnSync } = require("child_process");
const mongoose = require("mongoose");
const Template = require("../models/template.model");
const service = require("../services/notification.filter.template.service");
const controller = require("../controllers/notification.filter.template.controller");

jest.setTimeout(60000);

const TENANT = "68cbf7806080b4621d469d34";
const OTHER_TENANT = "68ebf0806080b4621d461ae0";
const USER = "700000000000000000000001";

const WRITE_METHODS = ["create", "insertMany", "updateOne", "updateMany", "findOneAndUpdate", "findByIdAndUpdate", "replaceOne", "bulkWrite", "deleteOne", "deleteMany"];
function spyWrites() {
  const spies = WRITE_METHODS.map((name) => jest.spyOn(Template, name).mockImplementation(() => { throw new Error(`write ${name}`); }));
  spies.push(jest.spyOn(Template.prototype, "save").mockImplementation(() => { throw new Error("write save"); }));
  return spies;
}
const writeCalls = (spies) => spies.reduce((n, s) => n + s.mock.calls.length, 0);
const fakeDoc = (fields) => ({ ...fields, toObject() { return { ...fields }; } });
function mockReads({ own = null, tenantDefault = null } = {}) {
  return jest.spyOn(Template, "findOne").mockImplementation(async (q) => {
    if (q.userId) return own;
    if (q.systemDefault && q.tenantId) return tenantDefault;
    return null;
  });
}

describe("GET /templates/default - read-only, tenant-scoped resolution (spied model)", () => {
  afterEach(() => jest.restoreAllMocks());

  test("no user default + no tenant system default: zero writes, null (client built-in default)", async () => {
    const spies = spyWrites();
    const find = mockReads();
    await expect(service.getDefaultTemplate(TENANT, USER)).resolves.toBeNull();
    expect(find.mock.calls.every(([q]) => q.tenantId === TENANT)).toBe(true); // never a tenantless query
    expect(writeCalls(spies)).toBe(0);
  });

  test("no user default: returns the tenant's system default", async () => {
    const spies = spyWrites();
    mockReads({ tenantDefault: fakeDoc({ _id: "t1", tenantId: TENANT, systemDefault: true, templateType: "notification", columns: ["a"], meta: {} }) });
    const r = await service.getDefaultTemplate(TENANT, USER);
    expect(r).toMatchObject({ _id: "t1", isDefault: true, columns: ["a"] });
    expect(r.meta).toBeUndefined();
    expect(writeCalls(spies)).toBe(0);
  });

  test("the user's own default view wins", async () => {
    const spies = spyWrites();
    mockReads({ own: fakeDoc({ _id: "u1", tenantId: TENANT, userId: USER, isDefault: true, templateType: "notification", columns: ["c"] }) });
    await expect(service.getDefaultTemplate(TENANT, USER)).resolves.toMatchObject({ _id: "u1" });
    expect(writeCalls(spies)).toBe(0);
  });

  test("controller: success(null); type from ?type or ?templateType", async () => {
    const spies = spyWrites();
    const find = mockReads();
    const res = { success: jest.fn() };
    const req = { user: { userType: "CRM", id: USER }, tenantId: TENANT, query: { templateType: "notification" } };
    await controller.getDefaultTemplate(req, res, (e) => { throw e; });
    expect(res.success).toHaveBeenCalledWith(null);
    expect(find.mock.calls[0][0]).toMatchObject({ tenantId: TENANT, templateType: "notification" });
    expect(writeCalls(spies)).toBe(0);
  });
});

const mongodBin =
  process.env.MONGOD_BIN || (spawnSync("sh", ["-c", "command -v mongod"], { encoding: "utf8" }).stdout || "").trim();
const describeDb = mongodBin ? describe : describe.skip;
if (!mongodBin) console.warn("templateDefault real-mongod tests skipped: no mongod binary (set MONGOD_BIN)");

describeDb("GET /templates/default - zero writes against a real mongod", () => {
  let mongod;
  let dbPath;
  const freePort = () =>
    new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.listen(0, "127.0.0.1", () => {
        const { port } = srv.address();
        srv.close(() => resolve(port));
      });
      srv.on("error", reject);
    });
  const coll = () => mongoose.connection.db.collection(Template.collection.collectionName);
  const state = async () => JSON.stringify(await coll().find({}).sort({ _id: 1 }).toArray());

  beforeAll(async () => {
    const port = await freePort();
    dbPath = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-getdefault-"));
    mongod = spawn(mongodBin, ["--dbpath", dbPath, "--port", String(port), "--bind_ip", "127.0.0.1", "--quiet"], { stdio: "ignore" });
    for (let i = 0; i < 160 && mongoose.connection.readyState !== 1; i += 1) {
      try {
        await mongoose.connect(`mongodb://127.0.0.1:${port}/tpl-getdefault-test`, { serverSelectionTimeoutMS: 500 });
      } catch (_) {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    if (mongoose.connection.readyState !== 1) throw new Error("throwaway mongod did not start");
  });
  afterAll(async () => {
    await mongoose.disconnect();
    if (mongod) mongod.kill();
    await new Promise((r) => setTimeout(r, 300));
    if (dbPath && dbPath.startsWith(os.tmpdir())) fs.rmSync(dbPath, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await coll().deleteMany({});
    await coll().insertMany([
      { templateType: "notification", tenantId: OTHER_TENANT, systemDefault: true, isDefault: false, columns: ["other"], meta: { deleted: false } },
    ]);
  });

  test("repeated GET with no user default is idempotent: no row created, no columns:[] record, never another tenant's default", async () => {
    const before = await state();
    expect(await service.getDefaultTemplate(TENANT, USER)).toBeNull();
    expect(await service.getDefaultTemplate(TENANT, USER)).toBeNull();
    expect(await state()).toBe(before);
    expect(await coll().countDocuments({ columns: { $size: 0 } })).toBe(0);
  });
});
