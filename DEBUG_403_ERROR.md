# Debugging 403 Error for /notifications Endpoint

## Current Status
- JWT token contains `"notification:read"` ✅
- `POLICY_SERVICE_URL` is set correctly ✅
- Policy middleware is configured ✅

## Steps to Debug

### 1. Check the 403 Response Body

When you get a 403, the response should now include a `reason` field. Check the exact response:

```json
{
  "success": false,
  "error": "...",
  "reason": "INSUFFICIENT_RESOURCE_PERMISSION" | "UNKNOWN_RESOURCE" | "INVALID_USER_TYPE" | "MISSING_PERMISSION" | "PERMISSION_NOT_DEFINED",
  "code": "PERMISSION_DENIED",
  "resource": "notification",
  "action": "read"
}
```

**The `reason` field tells you exactly why it failed.**

### 2. Check Notification-Service Logs

Look for these log messages in notification-service:

```
[POLICY_MIDDLEWARE] ❌ Authorization denied for notification:read
[POLICY_MIDDLEWARE] Reason: <REASON>
[POLICY_MIDDLEWARE] Full result: {...}
```

This will show the exact error from user-service.

### 3. Check User-Service Logs

Look for these log messages in user-service:

```
[EVALUATE_RESOURCE_POLICY] Found X permission(s) for resource 'notification'
Resource permission check failed for notification:read
Category check failed for notification:read
Permission check failed for notification:read
```

### 4. Common Reasons and Fixes

#### `UNKNOWN_RESOURCE`
- **Meaning**: No permissions found for resource "notification" in database
- **Fix**: Run permission initialization in user-service to create `NOTIFICATION_READ` permission

#### `INSUFFICIENT_RESOURCE_PERMISSION`
- **Meaning**: Permission exists but user doesn't have it
- **Fix**: 
  1. Verify permission exists: Check database for `NOTIFICATION_READ`
  2. Assign to role: Run `add-notification-read-permissions.js` script
  3. User needs new JWT: Log out and log back in

#### `INVALID_USER_TYPE`
- **Meaning**: User type doesn't match permission category
- **Fix**: Already fixed in code - verify user-service has latest code deployed

#### `MISSING_PERMISSION`
- **Meaning**: Permission not in user's JWT token
- **Fix**: User needs to log out and log back in to get new JWT

#### `PERMISSION_NOT_DEFINED`
- **Meaning**: Permission doesn't exist in database for this resource/action
- **Fix**: Run permission initialization

### 5. Verify Permission in Database

Run this in user-service to check if permission exists:

```bash
cd user-service
node -e "
const mongoose = require('mongoose');
require('dotenv').config({ path: '.env.staging' });
const Permission = require('./models/permission.model');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const perm = await Permission.findOne({ code: 'NOTIFICATION_READ' });
  console.log('Permission:', perm);
  process.exit(0);
})();
"
```

### 6. Verify Permission is Assigned to Role

Check if the user's role has the permission:

```bash
cd user-service
node -e "
const mongoose = require('mongoose');
require('dotenv').config({ path: '.env.staging' });
const Role = require('./models/role.model');
const Permission = require('./models/permission.model');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const perm = await Permission.findOne({ code: 'NOTIFICATION_READ' });
  const role = await Role.findOne({ code: 'NON-MEMBER' }).populate('permissions');
  console.log('Role has permission:', role.permissions.some(p => p.code === 'NOTIFICATION_READ'));
  process.exit(0);
})();
"
```

### 7. Test Direct Policy Evaluation

If user-service is accessible, test directly:

```bash
curl -X POST http://user-service:5001/policy/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "token": "YOUR_JWT_TOKEN",
    "resource": "notification",
    "action": "read",
    "context": {}
  }'
```

## Next Steps

1. **Check the 403 response body** - What is the `reason` field?
2. **Check notification-service logs** - What does `[POLICY_MIDDLEWARE]` show?
3. **Check user-service logs** - What does `[EVALUATE_RESOURCE_POLICY]` show?
4. **Share the `reason` field** from the 403 response so we can target the fix
