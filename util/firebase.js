var admin = require("firebase-admin");
const logger = require("../config/logger.js");

let firebaseInitialized = false;

// Try to initialize Firebase, but don't crash if not configured
try {
  // Check if Firebase is already initialized
  if (!admin.apps.length) {
    let serviceAccount;

    // Try to load from environment variable first
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
        serviceAccount = JSON.parse(envVar);
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
    } else {
      // Fall back to JSON file if env var is not set
      try {
        serviceAccount = require("./firebaseAdminSDK.json");
      } catch (fileError) {
        // File doesn't exist or can't be loaded - that's okay, Firebase is optional
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
      });

      firebaseInitialized = true;
      logger.info(
        { projectId: serviceAccount.project_id },
        "Firebase Admin SDK initialized"
      );
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
      logger.warn(
        {
          hasEnvVar: !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
          nodeEnv: process.env.NODE_ENV,
          allEnvKeys: Object.keys(process.env).filter((k) =>
            k.includes("FIREBASE")
          ),
        },
        "Firebase service account not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON environment variable or provide firebaseAdminSDK.json file. Notification features will not be available."
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
