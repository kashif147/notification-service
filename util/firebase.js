var admin = require("firebase-admin");
const logger = require("../config/logger.js");

let firebaseInitialized = false;

try {
  // Check if Firebase is already initialized
  if (admin.apps.length === 0) {
    var serviceAccount = require("./firebaseAdminSDK.json");

    if (!serviceAccount || !serviceAccount.project_id) {
      throw new Error("Invalid Firebase service account configuration");
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    firebaseInitialized = true;
    logger.info(
      { projectId: serviceAccount.project_id },
      "Firebase Admin SDK initialized"
    );
  } else {
    firebaseInitialized = true;
    logger.info("Firebase Admin SDK already initialized");
  }
} catch (error) {
  logger.error(
    { error: error.message },
    "Failed to initialize Firebase Admin SDK"
  );
  throw error;
}

module.exports = admin;
