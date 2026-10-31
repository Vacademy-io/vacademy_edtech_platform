# WATI Integration Guide for Notification Service

## Overview

This guide explains how to integrate WATI (WhatsApp Team Inbox) API for sending WhatsApp notifications through the notification service. The implementation supports both WATI and Meta WhatsApp Business API, allowing institutes to choose their preferred provider.

## WATI API Overview

WATI is a WhatsApp Business API solution that provides:
- Template messaging
- Session messaging (24-hour window)
- Interactive messages
- Contact management
- Webhook support for delivery status

## Architecture Changes

### 1. WhatsApp Provider Enum

Added support for multiple WhatsApp providers:
- `META` - Facebook/Meta WhatsApp Business API (existing)
- `WATI` - WATI API

### 2. Configuration Structure

Institute settings JSON structure for WATI:

```json
{
  "setting": {
    "WHATSAPP_SETTING": {
      "data": {
        "UTILITY_WHATSAPP": {
          "provider": "WATI",
          "wati": {
            "apiKey": "YOUR_WATI_API_KEY",
            "apiUrl": "https://live-server.wati.io",
            "whatsappNumber": "919876543210"
          },
          "meta": {
            "appId": "YOUR_META_APP_ID",
            "accessToken": "YOUR_META_ACCESS_TOKEN",
            "phoneNumberId": "PHONE_NUMBER_ID"
          }
        },
        "MARKETING_WHATSAPP": {
          "provider": "WATI",
          "wati": {
            "apiKey": "YOUR_WATI_API_KEY",
            "apiUrl": "https://live-server.wati.io",
            "whatsappNumber": "919876543210"
          }
        }
      }
    }
  }
}
```

## WATI API Integration

### Endpoints Used

1. **Send Template Message**
   - Endpoint: `POST /api/v1/sendTemplateMessage`
   - Use: Send pre-approved template messages
   
2. **Send Session Message**
   - Endpoint: `POST /api/v1/sendSessionMessage`
   - Use: Send messages within 24-hour window after user interaction

3. **Get Message Status** (optional)
   - Endpoint: `GET /api/v1/getMessageStatus/{messageId}`
   - Use: Check delivery status

### Authentication

WATI uses Bearer token authentication:
```
Authorization: Bearer YOUR_WATI_API_KEY
```

## Implementation Details

### 1. WATI Service (`WatiService.java`)

Handles all WATI-specific API calls:
- Template message sending
- Session message sending
- Parameter mapping
- Error handling
- Response parsing

### 2. WhatsApp Service Updates

Updated to:
- Detect provider from institute settings
- Route to appropriate service (WATI or Meta)
- Handle provider-specific configurations
- Manage fallback logic

### 3. Configuration Constants

Added WATI-related constants:
- `PROVIDER`
- `WATI`
- `API_KEY`
- `API_URL`
- `WHATSAPP_NUMBER`

## Usage Examples

### 1. Sending Template Message via Announcement

```json
{
  "title": "Assignment Reminder",
  "content": {
    "type": "text",
    "content": "Your assignment is due tomorrow"
  },
  "instituteId": "INST_123",
  "createdBy": "USER_1",
  "createdByRole": "TEACHER",
  "recipients": [
    {
      "recipientType": "ROLE",
      "recipientId": "STUDENT"
    }
  ],
  "modes": [
    {
      "modeType": "SYSTEM_ALERT",
      "settings": {
        "priority": "HIGH"
      }
    }
  ],
  "mediums": [
    {
      "mediumType": "WHATSAPP",
      "config": {
        "template_name": "assignment_reminder",
        "dynamic_values": {
          "1": "{{title}}",
          "2": "Tomorrow 5 PM"
        },
        "language_code": "en"
      }
    }
  ]
}
```

### 2. Direct WhatsApp API Call

```bash
POST /notification-service/whatsapp/v1/send-template-whatsapp?instituteId=INST_123
Content-Type: application/json

{
  "templateName": "assignment_reminder",
  "userDetails": [
    {
      "919876543210": {
        "1": "Math Assignment",
        "2": "Tomorrow 5 PM"
      }
    }
  ],
  "languageCode": "en",
  "headerType": null,
  "headerParams": null
}
```

## WATI Template Message Format

### Template Structure in WATI Dashboard

```
Template Name: assignment_reminder
Language: English
Category: UTILITY

Body:
Hello {{1}},

Your assignment *{{2}}* is due on {{3}}.

Please submit it on time.

Thanks,
{{4}}
```

### Calling with Parameters

```json
{
  "templateName": "assignment_reminder",
  "broadcast_name": "Assignment Reminder",
  "receivers": [
    {
      "whatsappNumber": "919876543210",
      "customParams": [
        {"name": "name", "value": "John Doe"},
        {"name": "assignment", "value": "Math Homework"},
        {"name": "due_date", "value": "Tomorrow 5 PM"},
        {"name": "sender", "value": "ABC School"}
      ]
    }
  ]
}
```

## Error Handling

### Common WATI Errors

| Error Code | Meaning | Solution |
|------------|---------|----------|
| 401 | Unauthorized | Check API key |
| 404 | Template not found | Verify template name and approval |
| 429 | Rate limit exceeded | Implement retry with backoff |
| 470 | Template not approved | Get template approved in WATI dashboard |
| 471 | Invalid WhatsApp number | Verify number format (with country code) |

### Retry Strategy

The service implements exponential backoff:
- Initial retry after 1 second
- Maximum 3 retries
- Exponential backoff multiplier: 2

## Webhooks (Optional)

### Setting up WATI Webhooks

Configure webhook URL in WATI dashboard:
```
https://your-domain.com/notification-service/whatsapp/v1/wati-webhook
```

### Webhook Events

- `message.delivered`
- `message.read`
- `message.failed`
- `message.sent`

## Configuration Steps

### 1. Get WATI Credentials

1. Login to WATI dashboard: https://app.wati.io
2. Go to Settings → API
3. Copy API Key
4. Note your WhatsApp number

### 2. Create Templates in WATI

1. Go to Templates section
2. Create template with parameters
3. Submit for approval
4. Wait for WhatsApp approval

### 3. Configure Institute Settings

Update institute settings via API:

```bash
POST /notification-service/v1/institute-settings
Content-Type: application/json
Authorization: Bearer <admin access token>
clientId: <instituteId>

{
  "instituteId": "INST_123",
  "settings": {
    "whatsapp": {
      "provider": "WATI",
      "wati": {
        "apiKey": "YOUR_WATI_API_KEY",
        "apiUrl": "https://live-server.wati.io",
        "whatsappNumber": "919876543210"
      }
    }
  }
}
```

### 4. Test the Integration

```bash
POST /notification-service/whatsapp/v1/send-template-whatsapp?instituteId=INST_123
Content-Type: application/json

{
  "templateName": "test_template",
  "userDetails": [
    {
      "YOUR_PHONE_NUMBER": {
        "1": "Test Value"
      }
    }
  ],
  "languageCode": "en"
}
```

## Migration from Meta to WATI

### Step-by-step Migration

1. **Audit existing templates** in Meta
2. **Recreate templates** in WATI dashboard
3. **Update institute settings** to use WATI provider
4. **Test with small user group**
5. **Monitor delivery rates**
6. **Rollout to all users**

### Rollback Plan

Keep Meta credentials in settings:
```json
{
  "provider": "META",
  "meta": { ... }
}
```

## Best Practices

1. **Template Management**
   - Use descriptive template names
   - Version templates (v1, v2)
   - Test before production use

2. **Phone Number Format**
   - Always include country code
   - Remove special characters (+, -, spaces)
   - Format: "919876543210" (for India)

3. **Rate Limiting**
   - WATI limits: 1000 messages/hour
   - Implement batch processing
   - Use queuing for large campaigns

4. **Error Logging**
   - Log all API responses
   - Track failed messages
   - Set up alerts for high failure rates

5. **Testing**
   - Test templates in sandbox first
   - Verify all parameter mappings
   - Check delivery on different devices

## Monitoring & Analytics

### Key Metrics to Track

- Message sent count
- Delivery rate
- Read rate
- Failed message rate
- Average delivery time
- Template-wise performance

### Logging

All WhatsApp messages are logged in:
- `notification_log` table
- `recipient_messages` table (with status)

### Queries for Monitoring

```sql
-- Failed WATI messages today
SELECT * FROM recipient_messages
WHERE medium_type = 'WHATSAPP'
AND status = 'FAILED'
AND DATE(sent_at) = CURRENT_DATE;

-- Delivery rate by template
SELECT 
  nm.body as template,
  COUNT(*) as total,
  SUM(CASE WHEN rm.status = 'DELIVERED' THEN 1 ELSE 0 END) as delivered,
  ROUND(100.0 * SUM(CASE WHEN rm.status = 'DELIVERED' THEN 1 ELSE 0 END) / COUNT(*), 2) as delivery_rate
FROM recipient_messages rm
JOIN notification_log nm ON rm.announcement_id = nm.source_id
WHERE rm.medium_type = 'WHATSAPP'
GROUP BY nm.body;
```

## Troubleshooting

### Issue: Messages not sending

**Checks:**
1. Verify API key is correct
2. Check template is approved
3. Verify phone number format
4. Check WATI account balance/credits
5. Review error logs

### Issue: Template not found

**Solutions:**
1. Verify template name matches exactly (case-sensitive)
2. Check template is approved
3. Verify language code matches

### Issue: Invalid phone number

**Solutions:**
1. Ensure country code is included
2. Remove special characters
3. Check number is registered on WhatsApp

## Support & Resources

- **WATI Documentation**: https://docs.wati.io
- **WATI API Reference**: https://docs.wati.io/reference
- **Support**: support@wati.io
- **Internal Documentation**: This file

## Version History

- v1.0 (2025-09-30): Initial WATI integration
- Support for template messages
- Multi-provider support (WATI + Meta)
