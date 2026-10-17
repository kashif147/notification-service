"use strict";
// Socket.IO handshake authentication + request-log redaction (security: no JWT in URLs or logs).
//
// Synthetic secret and tokens only. The socket tests run the REAL socket.io server (installed
// version) on 127.0.0.1 with the real middleware, driven by a raw WebSocket client speaking the
// Engine.IO / Socket.IO protocol, so the exact handshake path the CRM uses is exercised.
const http = require("http");
const { Writable } = require("stream");
const jwt = require("jsonwebtoken");
const WebSocket = require("ws");
const { Server } = require("socket.io");
const pino = require("pino");
const pinoHttp = require("pino-http");
const express = require("express");
const {
  createSocketAuthMiddleware,
  verifySocketToken,
  socketRooms,
} = require("../middlewares/socketAuth");
const { REQUEST_LOG_REDACT } = require("../config/requestLogRedaction");

const SECRET = "synthetic-test-secret";
const TENANT = "68cbf7806080b4621d469d34";
const OTHER_TENANT = "6acd6119b28a863c61361ae0";
const USER = "6ab40c9cadc2091d67334ac8";
const sign = (claims, opts = {}, secret = SECRET) => jwt.sign(claims, secret, { expiresIn: "1h", ...opts });
const VALID = () => sign({ sub: USER, tenantId: TENANT });

beforeAll(() => {
  process.env.JWT_SECRET = SECRET;
});

describe("verifySocketToken / middleware", () => {
  const run = (handshake) =>
    new Promise((resolve) => {
      const socket = { handshake };
      createSocketAuthMiddleware()(socket, (err) => resolve({ err, user: socket.user }));
    });

  test("1 valid auth.token succeeds; 6/7 verified userId and ProjectShell tenantId", async () => {
    const r = await run({ auth: { token: VALID() }, query: {} });
    expect(r.err).toBeUndefined();
    expect(r.user).toEqual({ userId: USER, tenantId: TENANT });
  });

  test("userId from `id` when there is no `sub` (unchanged derivation)", async () => {
    const r = await run({ auth: { token: sign({ id: USER, tenantId: TENANT }) } });
    expect(r.user).toEqual({ userId: USER, tenantId: TENANT });
  });

  test.each([
    ["2 missing token", { auth: {} }, "Unauthorized"],
    ["2 empty token", { auth: { token: "" } }, "Unauthorized"],
    ["2 no auth at all", {}, "Unauthorized"],
    ["2 non-string token", { auth: { token: 12345 } }, "Unauthorized"],
    ["3 invalid token", { auth: { token: "not.a.jwt" } }, "Invalid token"],
    ["4 expired token", { auth: { token: sign({ sub: USER, tenantId: TENANT }, { expiresIn: -10 }) } }, "Invalid token"],
    ["5 wrong-secret token", { auth: { token: sign({ sub: USER, tenantId: TENANT }, {}, "another-secret") } }, "Invalid token"],
    ["unsigned (alg none) token", { auth: { token: jwt.sign({ sub: USER, tenantId: TENANT }, null, { algorithm: "none" }) } }, "Invalid token"],
    ["no user identity", { auth: { token: sign({ tenantId: TENANT }) } }, "Invalid token: missing userId or tenantId"],
    ["12 Entra tid only (no ProjectShell tenantId)", { auth: { token: sign({ sub: USER, tid: TENANT }) } }, "Invalid token: missing userId or tenantId"],
    ["13 extension_tenantId only", { auth: { token: sign({ sub: USER, extension_tenantId: TENANT }) } }, "Invalid token: missing userId or tenantId"],
  ])("%s -> rejected", async (_label, handshake, message) => {
    const r = await run(handshake);
    expect(r.err).toBeInstanceOf(Error);
    expect(r.err.message).toBe(message);
    expect(r.user).toBeUndefined();
  });

  test("7 tenantId comes only from the ProjectShell claim, even when tid / extension_tenantId differ", async () => {
    const token = sign({ sub: USER, tenantId: TENANT, tid: "39866a06-30bc-4a89-80c6-9dd9357dd453", extension_tenantId: OTHER_TENANT });
    expect((await run({ auth: { token } })).user).toEqual({ userId: USER, tenantId: TENANT });
  });

  test("10 a query-only token does NOT authenticate", async () => {
    const r = await run({ auth: {}, query: { token: VALID() } });
    expect(r.err.message).toBe("Unauthorized");
    expect(r.user).toBeUndefined();
  });

  test("11 the auth token decides, independently of any query token (query is never read)", async () => {
    const other = sign({ sub: "aaaaaaaaaaaaaaaaaaaaaaaa", tenantId: OTHER_TENANT });
    expect((await run({ auth: { token: VALID() }, query: { token: other } })).user).toEqual({ userId: USER, tenantId: TENANT });
    expect((await run({ auth: { token: VALID() }, query: { token: "garbage" } })).err).toBeUndefined(); // ignored, not rejected
    expect((await run({ auth: { token: "garbage" }, query: { token: VALID() } })).err.message).toBe("Invalid token");
  });

  test("14 no error message ever contains the token", async () => {
    for (const token of ["not.a.jwt", sign({ sub: USER, tid: TENANT }), sign({ sub: USER, tenantId: TENANT }, { expiresIn: -5 })]) {
      const { err } = await run({ auth: { token } });
      expect(err.message).not.toContain(token);
      expect(JSON.stringify(err)).not.toContain(token);
    }
    expect(JSON.stringify(verifySocketToken("x.y.z", SECRET))).not.toContain("x.y.z");
  });

  test("8/9 rooms unchanged: tenant:<ProjectShell tenantId> and user:<userId>", () => {
    expect(socketRooms({ userId: USER, tenantId: TENANT })).toEqual([`tenant:${TENANT}`, `user:${USER}`]);
  });
});

describe("real Socket.IO server, raw WebSocket handshake", () => {
  let server;
  let io;
  let port;
  let authCalls;
  const joined = [];

  beforeAll(async () => {
    server = http.createServer();
    io = new Server(server, { path: "/socket.io" });
    const auth = createSocketAuthMiddleware();
    io.use((socket, next) => {
      authCalls += 1;
      auth(socket, next);
    });
    io.on("connection", (socket) => {
      for (const room of socketRooms(socket.user)) socket.join(room);
      joined.push([...socket.rooms].filter((r) => r !== socket.id).sort());
      socket.emit("unreadCount", { count: 0 });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    port = server.address().port;
  });
  afterAll(async () => {
    io.close();
    await new Promise((r) => server.close(r));
  });
  beforeEach(() => {
    authCalls = 0;
    joined.length = 0;
  });

  // One Socket.IO connection: resolves {connected, error, unread, url}. The URL carries only the
  // Engine.IO fields plus whatever `query` the caller passes (to model the legacy client).
  const connect = ({ auth, query = "" }) =>
    new Promise((resolve) => {
      const url = `ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket${query}`;
      const ws = new WebSocket(url);
      const out = { connected: false, error: null, unread: null, url };
      const done = () => {
        ws.close();
        resolve(out);
      };
      ws.on("message", (raw) => {
        const msg = raw.toString();
        if (msg.startsWith("0")) ws.send("40" + (auth === undefined ? "" : JSON.stringify(auth)));
        else if (msg === "2") ws.send("3");
        else if (msg.startsWith("40")) out.connected = true;
        else if (msg.startsWith("44")) {
          out.error = JSON.parse(msg.slice(2)).message;
          done();
        } else if (msg.startsWith("42")) {
          const [event, payload] = JSON.parse(msg.slice(2));
          if (event === "unreadCount") {
            out.unread = payload;
            done();
          }
        }
      });
      ws.on("error", (e) => {
        out.error = String(e.message);
        done();
      });
    });

  test("1 a valid auth payload connects; rooms joined as before; the URL carries no token", async () => {
    const token = VALID();
    const r = await connect({ auth: { token } });
    expect(r).toMatchObject({ connected: true, error: null, unread: { count: 0 } });
    expect(r.url).not.toContain(token);
    expect(joined).toEqual([[`tenant:${TENANT}`, `user:${USER}`]]);
  });

  test("10 legacy client sending ONLY a query token is refused", async () => {
    const r = await connect({ auth: undefined, query: `&token=${VALID()}` });
    expect(r).toMatchObject({ connected: false, error: "Unauthorized" });
  });

  test("legacy client sending auth AND query (the previous CRM) still connects via auth", async () => {
    const token = VALID();
    const r = await connect({ auth: { token }, query: `&token=${token}` });
    expect(r).toMatchObject({ connected: true, error: null });
  });

  test("4 expired / 5 wrong-secret tokens are refused at the handshake", async () => {
    expect((await connect({ auth: { token: sign({ sub: USER, tenantId: TENANT }, { expiresIn: -10 }) } })).error).toBe("Invalid token");
    expect((await connect({ auth: { token: sign({ sub: USER, tenantId: TENANT }, {}, "another-secret") } })).error).toBe("Invalid token");
  });

  test("18 every (re)connection authenticates again: a later connection with an expired token fails", async () => {
    expect((await connect({ auth: { token: VALID() } })).connected).toBe(true);
    expect((await connect({ auth: { token: sign({ sub: USER, tenantId: TENANT }, { expiresIn: -10 }) } })).error).toBe("Invalid token");
    expect((await connect({ auth: { token: VALID() } })).connected).toBe(true);
    expect(authCalls).toBe(3);
  });
});

describe("request-log redaction (real pino + pino-http, the app's REQUEST_LOG_REDACT)", () => {
  async function logOneRequest(headers) {
    const lines = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const logger = pino({}, sink);
    const app = express();
    app.use(pinoHttp({ logger, redact: REQUEST_LOG_REDACT }));
    app.get("/api/notifications", (req, res) => {
      res.setHeader("Set-Cookie", "session=SETCOOKIE-SECRET-VALUE; HttpOnly");
      res.json({ ok: true });
    });
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    await new Promise((resolve, reject) => {
      http
        .get({ host: "127.0.0.1", port: server.address().port, path: "/api/notifications?limit=1", headers }, (res) => {
          res.resume();
          res.on("end", resolve);
        })
        .on("error", reject);
    });
    await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => server.close(r));
    return lines.map((l) => JSON.parse(l)).find((l) => l.msg === "request completed");
  }

  test("15 Authorization / 16 Cookie / 17 Set-Cookie are censored; useful request metadata stays", async () => {
    const token = VALID();
    const rec = await logOneRequest({ Authorization: `Bearer ${token}`, Cookie: "sid=COOKIE-SECRET-VALUE", "User-Agent": "jest" });
    const text = JSON.stringify(rec);
    expect(text).not.toContain(token);
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(text).not.toContain("COOKIE-SECRET-VALUE");
    expect(text).not.toContain("SETCOOKIE-SECRET-VALUE");
    expect(rec.req.headers.authorization).toBe("[REDACTED]");
    expect(rec.req.headers.cookie).toBe("[REDACTED]");
    expect(rec.res.headers["set-cookie"]).toBe("[REDACTED]");
    expect(rec.req).toMatchObject({ method: "GET", url: "/api/notifications?limit=1" });
    expect(rec.req.headers["user-agent"]).toBe("jest");
    expect(rec.res.statusCode).toBe(200);
    expect(typeof rec.responseTime).toBe("number");
  });

  test("app.js wires pinoHttp with the shared REQUEST_LOG_REDACT", () => {
    const src = require("fs").readFileSync(require("path").join(__dirname, "..", "app.js"), "utf8");
    expect(src).toMatch(/pinoHttp\(\{\s*logger,[\s\S]*?redact: REQUEST_LOG_REDACT/);
  });
});

describe("rollback / mixed-version compatibility", () => {
  // The previous server middleware (auth first, query fallback, tid fallbacks), reproduced
  // verbatim to prove the new CRM client (auth only) still works if the server is rolled back.
  const previousServer = (handshake) => {
    const token = handshake.auth?.token || handshake.query?.token;
    if (!token) return "Unauthorized";
    try {
      const decoded = jwt.verify(token, SECRET);
      const tenantId = decoded.tenantId || decoded.tid || decoded.extension_tenantId;
      return decoded.sub && tenantId ? { userId: decoded.sub, tenantId } : "missing";
    } catch {
      return "Invalid token";
    }
  };

  test("new CRM (auth only) -> previous server: authenticates", () => {
    expect(previousServer({ auth: { token: VALID() }, query: {} })).toEqual({ userId: USER, tenantId: TENANT });
  });

  test("previous CRM (auth + query) -> new server: authenticates via auth", () => {
    const token = VALID();
    const socket = { handshake: { auth: { token }, query: { token } } };
    createSocketAuthMiddleware()(socket, (err) => expect(err).toBeUndefined());
    expect(socket.user).toEqual({ userId: USER, tenantId: TENANT });
  });
});
