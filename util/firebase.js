var admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
const logger = require("../config/logger.js");

let firebaseInitialized = false;
/** @type {string | null} */
let initCredentialSource = null;
/** @type {string | null} */
let initProjectId = null;

function normalizeServiceAccount(obj) {
  if (!obj || typeof obj.private_key !== "string") return obj;
  const copy = { ...obj };
  copy.private_key = copy.private_key.replace(/\\n/g, "\n");
  return copy;
}

function loadServiceAccountFromPath(filePath) {
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved, "utf8");
  return normalizeServiceAccount(JSON.parse(raw));
}

// Try to initialize Firebase, but don't crash if not configured
try {
  // Check if Firebase is already initialized
  if (!admin.apps.length) {
    let serviceAccount;

    // Try plain JSON string first (often breaks in Docker/env files when multiline or too long)
    let envVar = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (envVar) {
      // Strip leading/trailing quotes if present (common .env file issue)
      envVar = envVar.trim();

      // More aggressive quote stripping - handle cases where quotes wrap the entire value
      // Remove outer quotes if the value starts with quote and ends with matching quote
      while (
        (envVar.startsWith('"') && envVar.endsWith('"')) ||
        (envVar.startsWith("'") && envVar.endsWith("'"))
      ) {
        const original = envVar;
        envVar = envVar.slice(1, -1).trim();
        // Safety check to avoid infinite loop
        if (envVar === original) break;
      }

      try {
        serviceAccount = normalizeServiceAccount(JSON.parse(envVar));
        initCredentialSource = "FIREBASE_SERVICE_ACCOUNT_JSON";
      } catch (parseError) {
        logger.warn(
          {
            error: parseError.message,
            envVarLength: envVar.length,
            envVarPreview: envVar.substring(0, 50) + "...",
          },
          "Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON environment variable"
        );
        serviceAccount = null;
      }
    }

    // Base64 avoids docker-compose / shell truncation and newline mangling
    if (
      !serviceAccount &&
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 &&
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64.trim() !== ""
    ) {
      try {
        const raw = Buffer.from(
          process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64.trim(),
          "base64"
        ).toString("utf8");
        serviceAccount = normalizeServiceAccount(JSON.parse(raw));
        initCredentialSource = "FIREBASE_SERVICE_ACCOUNT_JSON_BASE64";
      } catch (parseError) {
        logger.warn(
          { error: parseError.message },
          "Failed to decode/parse FIREBASE_SERVICE_ACCOUNT_JSON_BASE64"
        );
        serviceAccount = null;
      }
    }

    if (
      !serviceAccount &&
      process.env.GOOGLE_APPLICATION_CREDENTIALS &&
      process.env.GOOGLE_APPLICATION_CREDENTIALS.trim() !== ""
    ) {
      try {
        serviceAccount = loadServiceAccountFromPath(
          process.env.GOOGLE_APPLICATION_CREDENTIALS
        );
        initCredentialSource = "GOOGLE_APPLICATION_CREDENTIALS";
      } catch (fileErr) {
        logger.warn(
          {
            path: process.env.GOOGLE_APPLICATION_CREDENTIALS,
            error: fileErr.message,
          },
          "Could not read GOOGLE_APPLICATION_CREDENTIALS file"
        );
        serviceAccount = null;
      }
    }

    // Only if still unset — do NOT run after env/base64/GAC or we wipe good credentials (see bugfix).
    if (!serviceAccount) {
      try {
        serviceAccount = normalizeServiceAccount(
          require("./firebaseAdminSDK.json")
        );
        initCredentialSource = "firebaseAdminSDK.json";
      } catch (fileError) {
        serviceAccount = null;
      }
    }

    const saOk =
      serviceAccount &&
      serviceAccount.project_id &&
      serviceAccount.client_email &&
      typeof serviceAccount.private_key === "string" &&
      serviceAccount.private_key.includes("BEGIN PRIVATE KEY");

    if (saOk) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
      });

      firebaseInitialized = true;
      initProjectId = serviceAccount.project_id;
      logger.info(
        {
          projectId: serviceAccount.project_id,
          credentialSource: initCredentialSource,
          privateKeyIdSuffix:
            typeof serviceAccount.private_key_id === "string"
              ? serviceAccount.private_key_id.slice(-8)
              : null,
        },
        "Firebase Admin SDK initialized"
      );

      // Confirms service account can mint OAuth tokens (failure ⇒ same error as FCM send).
      setImmediate(() => {
        (async () => {
          try {
            const cred = admin.app().options.credential;
            if (cred && typeof cred.getAccessToken === "function") {
              await cred.getAccessToken();
              logger.info(
                { credentialSource: initCredentialSource },
                "Firebase service account OAuth token fetch succeeded"
              );
            }
          } catch (tokenErr) {
            logger.error(
              {
                err: tokenErr.message,
                credentialSource: initCredentialSource,
                projectId: serviceAccount.project_id,
              },
              "Firebase service account cannot obtain OAuth access token — FCM will fail with missing-credential errors"
            );
          }
        })();
      });
    } else if (serviceAccount && serviceAccount.project_id) {
      logger.warn(
        {
          projectId: serviceAccount.project_id,
          hasClientEmail: !!serviceAccount.client_email,
          hasPrivateKey:
            typeof serviceAccount.private_key === "string" &&
            serviceAccount.private_key.length > 0,
        },
        "Firebase service account JSON is incomplete (need client_email and private_key). FCM will fail with OAuth errors until fixed."
      );
    } else {
      const rawLen = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
        ? process.env.FIREBASE_SERVICE_ACCOUNT_JSON.length
        : 0;
      logger.warn(
        {
          hasEnvJson: !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
          envJsonLength: rawLen,
          hasEnvJsonB64: !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64,
          hasGac: !!process.env.GOOGLE_APPLICATION_CREDENTIALS,
          nodeEnv: process.env.NODE_ENV,
          envKeysFirebase: Object.keys(process.env).filter((k) =>
            k.includes("FIREBASE")
          ),
        },
        "Firebase service account not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON, FIREBASE_SERVICE_ACCOUNT_JSON_BASE64, GOOGLE_APPLICATION_CREDENTIALS (path to JSON file), or provide firebaseAdminSDK.json."
      );
    }
  } else {
    firebaseInitialized = true;
    logger.info("Firebase Admin SDK already initialized");
  }
} catch (error) {
  logger.warn(
    { error: error.message },
    "Failed to initialize Firebase Admin SDK. Notification features will not be available."
  );
  // Don't throw - allow service to start without Firebase
}

module.exports = admin;
module.exports.isInitialized = () =>
  firebaseInitialized || admin.apps.length > 0;
/** Safe for logs/health: no secrets */
module.exports.getInitReport = () => ({
  initialized: firebaseInitialized || admin.apps.length > 0,
  credentialSource: initCredentialSource,
  projectId: initProjectId,
});
