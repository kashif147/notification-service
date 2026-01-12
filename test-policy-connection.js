/**
 * Test script to verify policy service connection and permission evaluation
 * Run: node test-policy-connection.js <JWT_TOKEN>
 * 
 * For local testing (outside Docker):
 *   POLICY_SERVICE_URL=http://localhost:5001 node test-policy-connection.js <TOKEN>
 */

const axios = require("axios");
const fs = require("fs");

// Determine the correct policy service URL based on environment
// If running in Docker, use service name; if running locally, use localhost
const isDocker = process.env.DOCKER_ENV === "true" || fs.existsSync("/.dockerenv");
const defaultUrl = isDocker 
  ? "http://user-service:5001" 
  : "http://localhost:5001";

const POLICY_SERVICE_URL = process.env.POLICY_SERVICE_URL || defaultUrl;
const token = process.argv[2];

if (!token) {
  console.error("❌ Usage: node test-policy-connection.js <JWT_TOKEN>");
  console.error("\nNote: If running locally (not in Docker), set POLICY_SERVICE_URL:");
  console.error("   POLICY_SERVICE_URL=http://localhost:5001 node test-policy-connection.js <TOKEN>");
  process.exit(1);
}

async function testPolicyConnection() {
  console.log("🔍 Testing Policy Service Connection\n");
  console.log(`Policy Service URL: ${POLICY_SERVICE_URL}`);
  console.log(`Token (first 20 chars): ${token.substring(0, 20)}...\n`);

  try {
    // Test 1: Health check
    console.log("=".repeat(60));
    console.log("TEST 1: Health Check");
    console.log("=".repeat(60));
    try {
      const healthResponse = await axios.get(`${POLICY_SERVICE_URL}/policy/health`, {
        timeout: 5000,
      });
      console.log("✅ Health check passed:", healthResponse.data);
    } catch (error) {
      console.error("❌ Health check failed:", error.message);
      if (error.code === "ECONNREFUSED") {
        console.error("   → Cannot connect to policy service. Check POLICY_SERVICE_URL and network connectivity.");
      }
      return;
    }

    // Test 2: Policy evaluation for notification:read
    console.log("\n" + "=".repeat(60));
    console.log("TEST 2: Policy Evaluation (notification:read)");
    console.log("=".repeat(60));
    try {
      const evalResponse = await axios.post(
        `${POLICY_SERVICE_URL}/policy/evaluate`,
        {
          token,
          resource: "notification",
          action: "read",
          context: {},
        },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 10000,
        }
      );

      console.log("Response Status:", evalResponse.status);
      console.log("Response Data:", JSON.stringify(evalResponse.data, null, 2));

      if (evalResponse.data.success && evalResponse.data.decision === "PERMIT") {
        console.log("\n✅ Policy evaluation: PERMIT");
      } else {
        console.log("\n❌ Policy evaluation: DENY");
        console.log("Reason:", evalResponse.data.reason);
        console.log("Error:", evalResponse.data.error);
        if (evalResponse.data.userPermissions) {
          console.log("User Permissions:", evalResponse.data.userPermissions);
        }
        if (evalResponse.data.requiredPermissions) {
          console.log("Required Permissions:", evalResponse.data.requiredPermissions);
        }
      }
    } catch (error) {
      console.error("❌ Policy evaluation failed:", error.message);
      if (error.response) {
        console.error("Response Status:", error.response.status);
        console.error("Response Data:", JSON.stringify(error.response.data, null, 2));
      }
      if (error.code === "ECONNREFUSED") {
        console.error("   → Cannot connect to policy service. Check POLICY_SERVICE_URL and network connectivity.");
      }
    }

    // Test 3: Get permissions for notification resource
    console.log("\n" + "=".repeat(60));
    console.log("TEST 3: Get Permissions for 'notification' resource");
    console.log("=".repeat(60));
    try {
      const permsResponse = await axios.get(
        `${POLICY_SERVICE_URL}/policy/permissions/notification`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          timeout: 10000,
        }
      );

      console.log("Response Status:", permsResponse.status);
      console.log("Response Data:", JSON.stringify(permsResponse.data, null, 2));
    } catch (error) {
      console.error("❌ Get permissions failed:", error.message);
      if (error.response) {
        console.error("Response Status:", error.response.status);
        console.error("Response Data:", JSON.stringify(error.response.data, null, 2));
      }
    }

  } catch (error) {
    console.error("\n❌ Unexpected error:", error.message);
    console.error(error.stack);
  }
}

testPolicyConnection();
