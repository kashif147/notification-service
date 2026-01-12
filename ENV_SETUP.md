# Notification Service Environment Variables

## Required Environment Variables

### Policy Service Configuration

**`POLICY_SERVICE_URL`** (REQUIRED)
- **Description**: URL of the user-service for policy evaluation
- **Example (Staging)**: `https://userserviceshell-aqf6f0b8fqgmagch.canadacentral-01.azurewebsites.net`
- **Example (Local)**: `http://localhost:3000`
- **Default**: `http://localhost:3000` (only works in local development)

### Setting in `.env.staging`

Add this line to your `.env.staging` file:

```bash
POLICY_SERVICE_URL=https://userserviceshell-aqf6f0b8fqgmagch.canadacentral-01.azurewebsites.net
```

### Setting in Azure App Service

1. Go to Azure Portal → App Service → Configuration
2. Add Application Setting:
   - **Name**: `POLICY_SERVICE_URL`
   - **Value**: `https://userserviceshell-aqf6f0b8fqgmagch.canadacentral-01.azurewebsites.net`

### Verification

After setting the environment variable, restart the service and check logs for:
```
✅ Policy service URL configured: https://userserviceshell-aqf6f0b8fqgmagch.canadacentral-01.azurewebsites.net
```

If you see:
```
⚠️  WARNING: POLICY_SERVICE_URL not set. Using default localhost URL.
```

Then the environment variable is not set correctly.
