# Notification Service — Unified Send API

Single API for sending WhatsApp, Email, Push Notifications, and System Alerts.

## Base URLs

| Environment | URL |
|---|---|
| Stage | `https://backend-stage.vacademy.io/notification-service` |
| Production | `https://backend.vacademy.io/notification-service` |

## Authentication


| Endpoint Path | Auth Type | Who Uses It |
|---|---|---|
| `/v1/send` | JWT (Bearer token) | Frontend |
| `/internal/v1/send` | HMAC (service-to-service) | Backend services (admin-core, auth, assessment, community) |
| `/internal/v1/events` | HMAC | Backend services (event-driven triggers) |

---

## 1. Unified Send

### `POST /v1/send` (JWT) or `POST /internal/v1/send` (HMAC)

Send a notification on any channel. Automatically handles:
- **Sync** (<=100 recipients): returns results immediately
- **Async** (>100 recipients): returns `batchId`, process in background

### Request Body

```json
{
  "instituteId": "872b5826-963f-4d72-9676-7f34e4f43217",
  "channel": "WHATSAPP",
  "templateName": "hello_2_utility",
  "languageCode": "en",
  "recipients": [
    {
      "phone": "919425677707",
      "email": "user@example.com",
      "userId": "uuid-optional",
      "name": "Shreyash",
      "variables": {
        "1": "Shreyash"
      },
      "attachments": []
    }
  ],
  "options": {
    "emailSubject": "Welcome!",
    "emailBody": "<h1>Hello {{name}}</h1>",
    "emailType": "UTILITY_EMAIL",
    "fromEmail": "noreply@institute.com",
    "fromName": "My Institute",
    "headerType": "image",
    "headerUrl": "https://example.com/header.jpg",
    "buttonUrlParams": {"0": "https://example.com/action"},
    "pushTitle": "New notification",
    "pushBody": "You have a new message",
    "pushData": {"screen": "dashboard", "id": "123"},
    "rateLimitPerSecond": 50,
    "source": "my-service",
    "sourceId": "campaign-123"
  }
}
```

### Field Reference

#### Top-Level Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `instituteId` | string | Yes | Institute UUID. Used for provider config resolution, logging. |
| `channel` | string | Yes | `WHATSAPP`, `EMAIL`, `PUSH`, `SYSTEM_ALERT` |
| `templateName` | string | Depends | **WhatsApp**: required — must match an approved Meta template name. **Email**: optional — if set, looks up email template from `notification_template` table (subject + body auto-resolved). |
| `languageCode` | string | No | Default: `en`. WhatsApp template language code. |
| `recipients` | array | Yes | At least 1 recipient. |
| `options` | object | No | Channel-specific configuration. |

#### Recipient Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `phone` | string | WhatsApp | Phone number with country code, no `+`. E.g., `919425677707` |
| `email` | string | Email | Email address |
| `userId` | string | Push/Alert | User UUID for push notifications and system alerts |
| `name` | string | No | Display name (for logging) |
| `variables` | object | No | Key-value pairs for template variable substitution (see below) |
| `attachments` | array | No | Email attachments (see below) |

#### Options Fields

| Field | Type | Channel | Description |
|---|---|---|---|
| `emailSubject` | string | EMAIL | Email subject line. Supports `{{key}}` placeholders. |
| `emailBody` | string | EMAIL | Email HTML body. Supports `{{key}}` placeholders. Ignored if `templateName` resolves to an email template. |
| `emailType` | string | EMAIL | `UTILITY_EMAIL` (default), `PROMOTIONAL_EMAIL`, `TRANSACTIONAL_EMAIL`. Controls which SMTP credentials to use. |
| `fromEmail` | string | EMAIL | Custom sender email address (overrides institute default) |
| `fromName` | string | EMAIL | Custom sender display name |
| `headerType` | string | WHATSAPP | `image`, `video`, `document` — type of media header |
| `headerUrl` | string | WHATSAPP | URL of the media file for the template header |
| `buttonUrlParams` | object | WHATSAPP | Dynamic URL button parameters. Key = button index (e.g., `"0"`), value = URL suffix. |
| `pushTitle` | string | PUSH | Push notification title |
| `pushBody` | string | PUSH/ALERT | Push notification body text |
| `pushData` | object | PUSH | Custom key-value data payload for the push notification |
| `rateLimitPerSecond` | integer | EMAIL | Optional rate limit for bulk sends. E.g., `50` = max 50 emails/sec. |
| `source` | string | All | Caller identifier for logging/auditing. E.g., `announcement-service` |
| `sourceId` | string | All | Source record ID for traceability. E.g., announcement ID |

#### Attachment Fields (per recipient)

| Field | Type | Description |
|---|---|---|
| `filename` | string | File name with extension. E.g., `invoice.pdf` |
| `contentBase64` | string | Base64-encoded file content |

### Response

```json
{
  "batchId": null,
  "total": 2,
  "accepted": 2,
  "failed": 0,
  "status": "COMPLETED",
  "results": [
    {
      "phone": "919425677707",
      "email": null,
      "success": true,
      "status": "SENT",
      "error": null
    },
    {
      "phone": null,
      "email": "user@example.com",
      "success": true,
      "status": "SENT",
      "error": null
    }
  ]
}
```

| Field | Description |
|---|---|
| `batchId` | Non-null only for async batches (>100 recipients). Use to poll status. |
| `total` | Total recipients processed |
| `accepted` | Successfully sent count |
| `failed` | Failed count |
| `status` | `COMPLETED`, `PROCESSING` (async), `PARTIAL` (some failed), `FAILED` |
| `results[].status` | `SENT`, `FAILED`, `SKIPPED_OPT_OUT`, `QUEUED` (rate-limited, will retry) |

---

## 2. Dynamic Variables

### WhatsApp Variables

WhatsApp templates use positional placeholders: `{{1}}`, `{{2}}`, etc.

**Option A: Positional (direct)**
```json
"variables": {
  "1": "Shreyash",
  "2": "Math 101"
}
```

**Option B: Named (auto-resolved)**

If the template has `body_variable_names` configured in the `notification_template` table (e.g., `["name", "course"]`), you can send named variables:

```json
"variables": {
  "name": "Shreyash",
  "course": "Math 101"
}
```

The service maps `name` -> position 1, `course` -> position 2 automatically.

**Resolution order:**
1. `body_variable_names` (semantic names set by admin in template builder)
2. `body_sample_values` (fallback — example values from Meta sync)
3. If neither exists, variables pass through as-is (must be positional)

### Email Variables

Email templates use `{{key}}` placeholders in both subject and body:

```html
<h1>Hello {{name}}</h1>
<p>Your payment of {{amount}} is confirmed.</p>
```

Variables are replaced per-recipient:
```json
"variables": {
  "name": "Shreyash",
  "amount": "$99"
}
```

### Per-Recipient Dynamic URLs (WhatsApp)

For per-recipient dynamic button URLs (e.g., unique payment links):
```json
"recipients": [
  {
    "phone": "919425677707",
    "variables": {
      "1": "Shreyash",
      "_buttonUrl": "https://pay.example.com/inv/abc123"
    }
  },
  {
    "phone": "919876543210",
    "variables": {
      "1": "Rahul",
      "_buttonUrl": "https://pay.example.com/inv/def456"
    }
  }
]
```

Special variable keys starting with `_` are used for per-recipient overrides:

| Key | Description | Works with |
|---|---|---|
| `_headerUrl` | Per-recipient header media URL (overrides `options.headerUrl`) | META, COMBOT, WATI |
| `_headerType` | Header media type: `image`, `video`, `document` (auto-set from `options.headerType`) | META, COMBOT, WATI |
| `_buttonUrl` | Dynamic URL button parameter (overrides `options.buttonUrlParams`) | META, COMBOT, WATI |

These special keys are **not sent as body parameters** — they are extracted and routed to the correct provider-specific field:
- **META/COMBOT**: `_headerUrl` → header component, `_buttonUrl` → button component
- **WATI**: `_headerUrl` → `header_image_url`/`header_video_url`/`header_document_url` customParam, `_buttonUrl` → `button_url_suffix` customParam

---

## 3. Provider-Specific Notes

### Media Support by Provider

| Feature | META (Direct) | COMBOT | WATI |
|---|---|---|---|
| Template with image header | Yes | Yes | Yes |
| Template with video header | Yes | Yes | Yes |
| Template with document header | Yes (with filename) | Yes (with filename) | Yes |
| Dynamic URL buttons | Yes | Yes | Yes (via `button_url_suffix`) |
| Per-recipient media URLs | Yes (`_headerUrl`) | Yes (`_headerUrl`) | Yes (`_headerUrl`) |
| Named variable resolution | Yes (needs `body_variable_names`) | Yes (needs `body_variable_names`) | Yes (needs `body_variable_names`) |

### WATI-Specific
- WATI bulk API passes media as `customParams` (e.g., `header_image_url`). The unified send handles this automatically.
- WATI template creation must be done in the WATI Dashboard (no API). Use "Sync Templates" to import.

### Workflow (SEND_WHATSAPP node) Compatibility
- Workflows can send `params` as `List<String>` (positional) OR `Map<String, Object>` (named keys auto-converted to positional)
- Both formats are backward compatible
- Media: use `headerImage`, `headerVideo`, `buttonUrlParam` fields in the workflow TRANSFORM node

---

## 4. Batch Status Polling

### `GET /v1/send/{batchId}/status`

For async sends (>100 recipients), poll this endpoint for progress.

```json
{
  "batchId": "abc-123",
  "total": 500,
  "accepted": 350,
  "failed": 10,
  "status": "PROCESSING"
}
```

Status transitions: `QUEUED` -> `PROCESSING` -> `COMPLETED` / `PARTIAL` / `FAILED`

### `GET /v1/send/batches?instituteId=X&limit=20`

List recent batches for an institute.

---

## 5. Event-Driven Triggers

### `POST /internal/v1/events`

Fire a notification event. The caller pre-resolves which channels and templates to use.

```json
{
  "eventType": "LEARNER_ENROLL",
  "instituteId": "872b5826-...",
  "sourceType": "BATCH",
  "sourceId": "package-session-id",
  "sends": [
    {
      "channel": "WHATSAPP",
      "templateName": "welcome_whatsapp",
      "languageCode": "en",
      "recipients": [
        {
          "phone": "919425677707",
          "variables": {"1": "Shreyash"}
        }
      ]
    },
    {
      "channel": "EMAIL",
      "templateName": "welcome_email",
      "recipients": [
        {
          "email": "user@example.com",
          "variables": {"name": "Shreyash"}
        }
      ],
      "emailSubject": "Welcome!",
      "emailBody": "<h1>Hello {{name}}</h1>"
    }
  ],
  "metadata": {
    "triggeredBy": "enrollment-service"
  }
}
```

---

## 6. Template Management

### `GET /v1/templates/list?instituteId=X&channelType=WHATSAPP`

List all templates. Filter by `channelType`: `WHATSAPP`, `EMAIL`, or omit for all.

### `POST /v1/templates`

Create a new template (EMAIL or WhatsApp).

```json
{
  "instituteId": "872b5826-...",
  "name": "welcome_email",
  "channelType": "EMAIL",
  "subject": "Welcome {{name}}!",
  "content": "<h1>Hello {{name}}</h1><p>Welcome to {{institute_name}}.</p>",
  "contentType": "HTML",
  "status": "ACTIVE",
  "dynamicParameters": "[\"name\", \"institute_name\"]"
}
```

### `GET /v1/templates/variables/{templateName}?instituteId=X&channelType=WHATSAPP`

Get just the variable names for a template (used by other services for validation).

### WhatsApp-Specific Endpoints

| Endpoint | Description |
|---|---|
| `POST /v1/whatsapp-templates` | Create WhatsApp template draft |
| `POST /v1/whatsapp-templates/{id}/submit` | Submit to Meta for approval |
| `POST /v1/whatsapp-templates/sync?instituteId=X` | Sync templates from Meta |

---

## 7. Provider Config & Cache

### `POST /v1/channel-mapping/evict-cache?instituteId=X`

Evict provider config cache after switching WhatsApp provider or updating credentials. Called automatically by the frontend when provider settings change.

---

## 8. Channel-Specific Examples

### WhatsApp Template with Image Header
```json
{
  "instituteId": "...",
  "channel": "WHATSAPP",
  "templateName": "promo_with_image",
  "languageCode": "en",
  "recipients": [{"phone": "919425677707", "variables": {"1": "Shreyash"}}],
  "options": {
    "headerType": "image",
    "headerUrl": "https://cdn.example.com/promo.jpg"
  }
}
```

### WhatsApp Template with Video Header
```json
{
  "options": {
    "headerType": "video",
    "headerUrl": "https://cdn.example.com/intro.mp4"
  }
}
```

### WhatsApp Template with Dynamic URL Button
```json
{
  "options": {
    "buttonUrlParams": {"0": "https://example.com/track/abc123"}
  }
}
```

### Email with Attachments
```json
{
  "channel": "EMAIL",
  "recipients": [{
    "email": "user@example.com",
    "variables": {"name": "Shreyash", "invoice_number": "INV-001"},
    "attachments": [{
      "filename": "invoice.pdf",
      "contentBase64": "JVBERi0xLjQKJ..."
    }]
  }],
  "options": {
    "emailSubject": "Invoice {{invoice_number}}",
    "emailBody": "<p>Dear {{name}}, please find your invoice attached.</p>",
    "emailType": "UTILITY_EMAIL"
  }
}
```

### Email from Template (no inline body)
```json
{
  "channel": "EMAIL",
  "templateName": "welcome_email",
  "recipients": [{
    "email": "user@example.com",
    "variables": {"name": "Shreyash", "institute_name": "Vacademy"}
  }]
}
```
The service looks up `notification_template` by name + channelType=EMAIL, resolves subject + body, and replaces `{{key}}` placeholders.

### Push Notification
```json
{
  "channel": "PUSH",
  "recipients": [{"userId": "user-uuid-1"}, {"userId": "user-uuid-2"}],
  "options": {
    "pushTitle": "New Assignment",
    "pushBody": "You have a new assignment due tomorrow",
    "pushData": {"screen": "assignments", "assignmentId": "123"}
  }
}
```

### System Alert
```json
{
  "channel": "SYSTEM_ALERT",
  "recipients": [{"userId": "user-uuid-1"}],
  "options": {
    "pushTitle": "Maintenance Notice",
    "pushBody": "System will be down for maintenance at 2 AM"
  }
}
```

### Bulk Send with Rate Limiting
```json
{
  "channel": "EMAIL",
  "recipients": [... 5000 recipients ...],
  "options": {
    "emailSubject": "Monthly Newsletter",
    "emailBody": "<p>Dear {{name}}, ...</p>",
    "rateLimitPerSecond": 50,
    "source": "newsletter-campaign",
    "sourceId": "campaign-2026-03"
  }
}
```
Response (async): `{"batchId": "uuid", "status": "PROCESSING", "total": 5000}`

---

## 9. Frontend Integration

### TypeScript Service

File: `src/services/unified-send-service.ts`

```typescript
import { sendNotification, getBatchStatus, waitForBatchCompletion } from '@/services/unified-send-service';

// Simple WhatsApp send
const result = await sendNotification({
  instituteId: '...',
  channel: 'WHATSAPP',
  templateName: 'hello_2_utility',
  languageCode: 'en',
  recipients: [{ phone: '919425677707', variables: { '1': 'Shreyash' } }],
});

// Bulk email with progress tracking
const result = await sendNotification({ ... 5000 recipients ... });
if (result.batchId) {
  const final = await waitForBatchCompletion(result.batchId, (status) => {
    console.log(`Progress: ${status.accepted}/${status.total}`);
  });
}
```

### Batch Progress Component

File: `src/components/unified-send/batch-progress.tsx`

```tsx
import { BatchProgress } from '@/components/unified-send/batch-progress';

<BatchProgress batchId={batchId} onComplete={(result) => {
  toast.success(`Sent ${result.accepted} of ${result.total}`);
}} />
```

---

## 10. Migration Notes for Backend Services

### Adding Unified Send to a New Service

1. Add `UnifiedSendRequest` and `UnifiedSendResponse` DTOs (copy from any existing service)
2. Add `@JsonIgnoreProperties(ignoreUnknown = true)` to `UnifiedSendResponse`
3. Call via HMAC:

```java
@Value("${notification.server.baseurl}")
private String notificationServerBaseUrl;

private static final String UNIFIED_SEND = "/notification-service/internal/v1/send";

public void sendEmail(String to, String subject, String body, String instituteId) {
    UnifiedSendRequest request = UnifiedSendRequest.builder()
        .instituteId(instituteId)
        .channel("EMAIL")
        .recipients(List.of(UnifiedSendRequest.Recipient.builder()
            .email(to).build()))
        .options(UnifiedSendRequest.SendOptions.builder()
            .emailSubject(subject)
            .emailBody(body)
            .emailType("UTILITY_EMAIL")
            .build())
        .build();

    internalClientUtils.makeHmacRequest(
        clientName, HttpMethod.POST.name(),
        notificationServerBaseUrl, UNIFIED_SEND, request);
}
```

### Important: Response Deserialization

Always configure ObjectMapper to ignore unknown properties:
```java
ObjectMapper mapper = new ObjectMapper();
mapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
return mapper.readValue(response.getBody(), UnifiedSendResponse.class);
```

Or add `@JsonIgnoreProperties(ignoreUnknown = true)` to the DTO class.
