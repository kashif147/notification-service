#!/usr/bin/env node

const dotenvFlow = require("dotenv-flow");
const fs = require("fs");
const path = require("path");

// Load .env files using dotenv-flow
// Load .env.staging explicitly if it exists (even if NODE_ENV is not set to staging)
const stagingEnvPath = path.join(__dirname, "..", ".env.staging");
if (fs.existsSync(stagingEnvPath)) {
  // Load staging environment
  const result = dotenvFlow.config({ nodeEnv: "staging" });
  console.log("✅ Loaded .env.staging file");
  
  // Fix for FIREBASE_SERVICE_ACCOUNT_JSON if it's malformed (only first character loaded)
  // This handles cases where JSON is multi-line or improperly quoted
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON && process.env.FIREBASE_SERVICE_ACCOUNT_JSON.length === 1) {
    try {
      // Read the file directly and manually parse FIREBASE_SERVICE_ACCOUNT_JSON
      const fileContent = fs.readFileSync(stagingEnvPath, "utf8");
      const lines = fileContent.split("\n");
      
      let firebaseJsonValue = "";
      let capturing = false;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        if (line.startsWith("FIREBASE_SERVICE_ACCOUNT_JSON=")) {
          // Extract the value after =
          const valuePart = line.substring("FIREBASE_SERVICE_ACCOUNT_JSON=".length);
          
          // Handle different formats
          if (valuePart.startsWith('"') && !valuePart.endsWith('"')) {
            // Multi-line string starting with quote
            capturing = true;
            firebaseJsonValue = valuePart.substring(1); // Remove opening quote
          } else if (valuePart.startsWith("'") && !valuePart.endsWith("'")) {
            // Multi-line string starting with single quote
            capturing = true;
            firebaseJsonValue = valuePart.substring(1); // Remove opening quote
          } else if (valuePart.startsWith("{") && !valuePart.endsWith("}")) {
            // Multi-line JSON without quotes
            capturing = true;
            firebaseJsonValue = valuePart;
          } else {
            // Single line value - remove quotes if present
            firebaseJsonValue = valuePart.replace(/^["']|["']$/g, "");
            break;
          }
        } else if (capturing) {
          // Continue capturing multi-line value
          if (line.endsWith('"') || line.endsWith("'")) {
            // End of multi-line string
            firebaseJsonValue += "\n" + line.slice(0, -1); // Remove closing quote
            capturing = false;
            break;
          } else if (line.endsWith("}") && firebaseJsonValue.includes("{")) {
            // End of multi-line JSON
            firebaseJsonValue += "\n" + line;
            capturing = false;
            break;
          } else {
            firebaseJsonValue += "\n" + line;
          }
        }
      }
      
      if (firebaseJsonValue && firebaseJsonValue.length > 1) {
        // Strip leading/trailing quotes if present
        firebaseJsonValue = firebaseJsonValue.trim();
        if (
          (firebaseJsonValue.startsWith('"') && firebaseJsonValue.endsWith('"')) ||
          (firebaseJsonValue.startsWith("'") && firebaseJsonValue.endsWith("'"))
        ) {
          firebaseJsonValue = firebaseJsonValue.slice(1, -1);
        }
        
        // Validate it's valid JSON before setting
        try {
          JSON.parse(firebaseJsonValue);
          process.env.FIREBASE_SERVICE_ACCOUNT_JSON = firebaseJsonValue;
          console.log(`✅ Fixed FIREBASE_SERVICE_ACCOUNT_JSON (new length: ${firebaseJsonValue.length})`);
        } catch (e) {
          console.log(`⚠️  Could not fix FIREBASE_SERVICE_ACCOUNT_JSON: ${e.message}`);
        }
      }
    } catch (e) {
      console.log(`⚠️  Error trying to fix FIREBASE_SERVICE_ACCOUNT_JSON: ${e.message}`);
    }
  }
  
  // Also try loading directly using dotenv for additional compatibility
  try {
    require("dotenv").config({ path: stagingEnvPath, override: false });
  } catch (e) {
    // Ignore if dotenv is not available, we'll use dotenv-flow
  }
} else {
  // Load default dotenv files
  dotenvFlow.config();
}

// Debug: Check if FIREBASE_SERVICE_ACCOUNT_JSON is set
const firebaseEnvVar = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (firebaseEnvVar) {
  const envVarLength = firebaseEnvVar.length;
  console.log(`✅ FIREBASE_SERVICE_ACCOUNT_JSON found (length: ${envVarLength})`);
  // Show actual value for debugging (this will help identify the issue)
  if (envVarLength <= 200) {
    console.log(`   Actual value: "${firebaseEnvVar}"`);
  } else {
    console.log(`   Preview (first 100): ${firebaseEnvVar.substring(0, 100)}...`);
  }
  
  // Try to validate it's valid JSON
  try {
    const parsed = JSON.parse(firebaseEnvVar);
    if (parsed.project_id) {
      console.log(`✅ FIREBASE_SERVICE_ACCOUNT_JSON is valid JSON (project_id: ${parsed.project_id})`);
    } else {
      console.log(`⚠️  FIREBASE_SERVICE_ACCOUNT_JSON is valid JSON but missing project_id`);
    }
  } catch (e) {
    console.log(`⚠️  FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON: ${e.message}`);
    console.log(`   Full value: ${firebaseEnvVar}`);
  }
} else {
  console.log("⚠️  FIREBASE_SERVICE_ACCOUNT_JSON not found in environment");
  // List all FIREBASE-related env vars to help debug
  const firebaseKeys = Object.keys(process.env).filter((k) =>
    k.toUpperCase().includes("FIREBASE")
  );
  if (firebaseKeys.length > 0) {
    console.log(`Found FIREBASE-related env vars: ${firebaseKeys.join(", ")}`);
  }
}
const { shutdownEventSystem } = require("../rabbitMQ/index.js");
const { disconnectDB } = require("../config/db.js");
const logger = require("../config/logger.js");
const app = require("../app.js");

let server;

async function start() {
  const port = Number(process.env.PORT || 4010);
  server = app.listen(port, () => {
    logger.info({ port }, "API listening");
  });
}

async function shutdown(signal) {
  try {
    logger.info({ signal }, "Shutting down");
    if (server) {
      await new Promise((res) => server.close(res));
    }
    await Promise.allSettled([shutdownEventSystem(), disconnectDB()]);
    process.exit(0);
  } catch (e) {
    logger.error(e, "Shutdown error");
    process.exit(1);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (err) => {
  logger.error(err, "Unhandled rejection");
  shutdown("unhandledRejection");
});
process.on("uncaughtException", (err) => {
  logger.error(err, "Uncaught exception");
  shutdown("uncaughtException");
});

start().catch((err) => {
  logger.error({ err, stack: err.stack }, "Failed to start");
  process.exit(1);
});
