# Institute Announcement Settings Management Guide

## Overview
The Institute Announcement Settings system allows administrators to configure who can send announcements and how they can use different announcement modes and mediums within their institute.

## Base URL
```
http://notification-service:8076/notification-service/v1/institute-settings
```

## Core APIs

### 1. Create or Update Institute Settings
Configure announcement permissions and limitations for an institute.

**Endpoint:** `POST /institute-settings`  
**Auth:** JWT + `clientId` header; caller must be an ADMIN of the institute. Responses never include the Firebase key.

**Request Body:**
```json
{
  "instituteId": "institute_123",
  "settings": {
    "community": {
      "students_can_send": false,
      "teachers_can_send": true,
      "admins_can_send": true,
      "allow_replies": true,
      "moderation_enabled": false,
      "allowed_tags": ["physics", "math", "chemistry", "biology"]
    },
    "dashboardPins": {
      "students_can_create": false,
      "teachers_can_create": true,
      "admins_can_create": true,
      "max_duration_hours": 24,
      "max_pins_per_user": 5,
      "require_approval": false
    },
    "systemAlerts": {
      "students_can_send": false,
      "teachers_can_send": true,
      "admins_can_send": true,
      "high_priority_roles": ["ADMIN", "PRINCIPAL"],
      "auto_dismiss_hours": 72
    },
    "directMessages": {
      "students_can_send": true,
      "teachers_can_send": true,
      "admins_can_send": true,
      "allow_student_to_student": false,
      "allow_replies": true,
      "moderation_enabled": false
    },
    "streams": {
      "students_can_send": false,
      "teachers_can_send": true,
      "admins_can_send": true,
      "allow_during_class": true,
      "auto_archive_hours": 24
    },
    "resources": {
      "students_can_upload": false,
      "teachers_can_upload": true,
      "admins_can_upload": true,
      "allowed_folders": ["Homework", "Notes", "Assignments", "Study Materials"],
      "allowed_categories": ["PDF", "Image", "Video", "Document"],
      "max_file_size_mb": 50
    },
    "general": {
      "announcement_approval_required": false,
      "max_announcements_per_day": 10,
      "allowed_mediums": ["PUSH_NOTIFICATION", "EMAIL", "WHATSAPP"],
      "default_timezone": "Asia/Kolkata",
      "retention_days": 365
    }
  }
}
```

**Response:**
```json
{
  "id": "settings_456",
  "instituteId": "institute_123",
  "settings": {
    // Same structure as request
  },
  "createdAt": "2024-01-15T10:30:00",
  "updatedAt": "2024-01-15T10:30:00"
}
```

### 2. Get Institute Settings
Retrieve settings for a specific institute.

**Endpoint:** `GET /institute-settings/institute/{instituteId}`

**Example:** `GET /institute-settings/institute/institute_123`

**Response:** Same structure as create response, or default settings if none exist.

### 3. Check User Permissions
Verify if a user role can perform specific actions.

**Endpoint:** `GET /institute-settings/institute/{instituteId}/permissions`

**Query Parameters:**
- `userRole`: User role (STUDENT, TEACHER, ADMIN)
- `action`: Action to check (send, create)
- `modeType`: Mode type (COMMUNITY, DASHBOARD_PIN, SYSTEM_ALERT, etc.)

**Example:**
```
GET /institute-settings/institute/institute_123/permissions?userRole=TEACHER&action=send&modeType=COMMUNITY
```

**Response:**
```json
{
  "canPerform": true,
  "instituteId": true,
  "userRole": true,
  "action": true,
  "modeType": true
}
```

### 4. Get All Institute Settings (closed)
Closed: always returns `403 NOT_AVAILABLE`. There is no platform-staff role to gate a cross-institute
listing on, and nothing calls it. Read one institute at a time with endpoint 2.

**Endpoint:** `GET /institute-settings/all`

### 5. Delete Institute Settings
Remove settings for an institute (reverts to defaults).

**Endpoint:** `DELETE /institute-settings/institute/{instituteId}`
**Auth:** JWT + `clientId` header; caller must be an ADMIN of that institute.

**Response:** `204 No Content`

### 6. Get Default Template
Get the default settings template for reference.

**Endpoint:** `GET /institute-settings/default-template`

**Response:** Default settings structure without institute-specific data.

### 7. Validate Settings
Validate settings without saving them.

**Endpoint:** `POST /institute-settings/validate`

**Request Body:** Same as create settings request.

**Response:**
```json
{
  "valid": true,
  "message": "Settings validation passed",
  "instituteId": "institute_123"
}
```

## Settings Structure

### Community Settings
Controls community/discussion post permissions:
- `students_can_send`: Whether students can post
- `teachers_can_send`: Whether teachers can post  
- `admins_can_send`: Whether admins can post
- `allow_replies`: Enable/disable replies to posts
- `moderation_enabled`: Require moderation before posts are visible
- `allowed_tags`: List of allowed tags for categorization

### Dashboard Pin Settings
Controls dashboard pinned message permissions:
- `students_can_create`: Whether students can pin messages
- `teachers_can_create`: Whether teachers can pin messages
- `admins_can_create`: Whether admins can pin messages
- `max_duration_hours`: Maximum pin duration (default: 24)
- `max_pins_per_user`: Maximum pins per user (default: 5)
- `require_approval`: Whether pins need approval

### System Alert Settings
Controls system-wide alert permissions:
- `students_can_send`: Whether students can send alerts
- `teachers_can_send`: Whether teachers can send alerts
- `admins_can_send`: Whether admins can send alerts
- `high_priority_roles`: Roles that can send high-priority alerts
- `auto_dismiss_hours`: Auto-dismiss alerts after X hours

### Direct Message Settings
Controls private messaging permissions:
- `students_can_send`: Whether students can send DMs
- `teachers_can_send`: Whether teachers can send DMs
- `admins_can_send`: Whether admins can send DMs
- `allow_student_to_student`: Whether students can DM each other
- `allow_replies`: Enable/disable DM replies
- `moderation_enabled`: Moderate DMs before delivery

### Stream Settings
Controls live stream/class message permissions:
- `students_can_send`: Whether students can send stream messages
- `teachers_can_send`: Whether teachers can send stream messages
- `admins_can_send`: Whether admins can send stream messages
- `allow_during_class`: Whether messages are allowed during active classes
- `auto_archive_hours`: Auto-archive stream messages after X hours

### Resource Settings
Controls resource sharing permissions:
- `students_can_upload`: Whether students can upload resources
- `teachers_can_upload`: Whether teachers can upload resources
- `admins_can_upload`: Whether admins can upload resources
- `allowed_folders`: List of allowed folder names
- `allowed_categories`: List of allowed resource categories
- `max_file_size_mb`: Maximum file size in MB

### General Settings
Global announcement settings:
- `announcement_approval_required`: Whether announcements need approval
- `max_announcements_per_day`: Daily announcement limit per user
- `allowed_mediums`: List of allowed delivery mediums
- `default_timezone`: Default timezone for the institute
- `retention_days`: How long to keep announcement data

## Permission Validation

When creating announcements, the system automatically validates:

1. **Mode Permissions**: Checks if user role can use requested modes
2. **Medium Permissions**: Verifies allowed delivery mediums
3. **General Limits**: Enforces daily limits and approval requirements

**Example Permission Check:**
```javascript
// Before creating announcement
const canSend = await checkPermissions({
  instituteId: "institute_123",
  userRole: "TEACHER", 
  action: "send",
  modeType: "COMMUNITY"
});

if (!canSend.canPerform) {
  throw new Error("Permission denied for community posts");
}
```

## Default Settings

If no custom settings exist for an institute, the system uses these defaults:

```json
{
  "community": {
    "students_can_send": false,
    "teachers_can_send": true,
    "admins_can_send": true,
    "allow_replies": true,
    "moderation_enabled": false
  },
  "dashboardPins": {
    "students_can_create": false,
    "teachers_can_create": true,
    "admins_can_create": true,
    "max_duration_hours": 24,
    "max_pins_per_user": 5,
    "require_approval": false
  },
  "systemAlerts": {
    "students_can_send": false,
    "teachers_can_send": true,
    "admins_can_send": true,
    "auto_dismiss_hours": 72
  },
  "directMessages": {
    "students_can_send": true,
    "teachers_can_send": true,
    "admins_can_send": true,
    "allow_student_to_student": false,
    "allow_replies": true,
    "moderation_enabled": false
  },
  "streams": {
    "students_can_send": false,
    "teachers_can_send": true,
    "admins_can_send": true,
    "allow_during_class": true,
    "auto_archive_hours": 24
  },
  "resources": {
    "students_can_upload": false,
    "teachers_can_upload": true,
    "admins_can_upload": true,
    "max_file_size_mb": 50
  },
  "general": {
    "announcement_approval_required": false,
    "max_announcements_per_day": 10,
    "default_timezone": "Asia/Kolkata",
    "retention_days": 365
  }
}
```

## Integration Examples

### From Admin Dashboard
```javascript
// Update institute settings
const settings = {
  instituteId: "institute_123",
  settings: {
    community: {
      students_can_send: true, // Allow students to post
      moderation_enabled: true // Enable moderation
    },
    general: {
      max_announcements_per_day: 5 // Reduce daily limit
    }
  }
};

const response = await fetch('/notification-service/v1/institute-settings', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`, // caller must be an ADMIN of the institute
    clientId: instituteId,
  },
  body: JSON.stringify(settings)
});
```

### Permission Validation in Services
```javascript
// Before creating announcement in assessment service
const canCreate = await fetch(
  `/notification-service/v1/institute-settings/institute/${instituteId}/permissions?` +
  `userRole=${userRole}&action=send&modeType=SYSTEM_ALERT`
);

const permissions = await canCreate.json();
if (!permissions.canPerform) {
  throw new Error('User not authorized to send system alerts');
}

// Proceed with announcement creation
```

### Bulk Settings Management
`GET /institute-settings/all` is closed (403). Read settings per institute with
`GET /institute-settings/institute/{instituteId}`.

## Best Practices

1. **Start with Defaults**: Use default template and modify as needed
2. **Gradual Permissions**: Start restrictive, gradually open up permissions
3. **Monitor Usage**: Track announcement patterns to adjust limits
4. **Regular Review**: Periodically review and update settings
5. **User Feedback**: Collect feedback on permission restrictions
6. **Backup Settings**: Keep backups of working configurations

## Security Considerations

1. **Admin Only**: Only administrators should modify institute settings
2. **Audit Trail**: All settings changes should be logged
3. **Validation**: Always validate settings before applying
4. **Fallback**: System gracefully handles missing settings
5. **Rate Limiting**: Consider rate limiting settings API calls

## Troubleshooting

### Common Issues

**Permission Denied Errors:**
- Check if user role is allowed for the specific mode
- Verify institute settings exist or use defaults
- Ensure correct role name format (STUDENT, TEACHER, ADMIN)

**Settings Not Applied:**
- Verify settings were saved successfully
- Check for validation errors in request
- Confirm institute ID is correct

**Performance Issues:**
- Settings are cached for better performance
- Consider pagination for large institute lists
- Monitor database performance for settings queries

### Error Codes
- `400`: Invalid request data or validation failure
- `404`: Institute settings not found (returns defaults)
- `403`: Permission denied for operation
- `500`: Internal server error

For additional support, refer to the main announcement system documentation or contact the platform team.