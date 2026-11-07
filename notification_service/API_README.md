# Notification Service - Announcement APIs

This document lists the public/internal REST APIs of the announcement system in `notification_service` with example curl commands.

## Base URL
- Local K8s (cluster DNS): http://notification-service:8080
- All paths are prefixed with `/notification-service` in controllers below.

## Announcement System Overview (Architecture & Logic)

### Goals & Capabilities
- Multi-mode announcements: SYSTEM_ALERT, DASHBOARD_PIN, DM, STREAM, RESOURCES, COMMUNITY, TASKS
- Multi-medium delivery: WHATSAPP, PUSH_NOTIFICATION, EMAIL (per-announcement selectable)
- Recipient targeting: by ROLE, USER, PACKAGE_SESSION (dedup by caller upstream); institute scoped
- Scheduling: immediate, one-time, recurring (Quartz, timezone-aware)
- Tracking: per-recipient delivery records, status, interactions, replies/threads
- Institute-specific permissions and defaults via JSON settings
- Real-time updates via SSE (with mode subscriptions) + polling compatibility

### High-level Flow
1. Create announcement (validate + permissions + mode settings validation)
2. Save recipients, mediums, mode-specific settings, (optional) schedule
3. When due (immediate or scheduled):
   - Resolve recipients to userIds (roles, package_sessions via other services)
   - Create `recipient_messages` per user x mode
   - Deliver via selected mediums (existing WA/Push/Email) and update status
   - Emit SSE: NEW_ANNOUNCEMENT
4. Users fetch messages (mode-specific filters) and interact (read/dismiss/reply)
5. SSE emits interaction events (MESSAGE_READ, MESSAGE_DISMISSED, MESSAGE_REPLY_ADDED)
6. For TASKS: automatic status transitions + reminders + SSE

### Data Model (core tables)
- `rich_text_data`: id, type (text|html|video|image), content
- `announcements`: title, rich_text_id, institute_id, creator, status, timezone, audit
- `announcement_recipients`: announcement_id, recipient_type (ROLE|USER|PACKAGE_SESSION), recipient_id
- `announcement_mediums`: announcement_id, medium_type, medium_config (JSON), is_active
- `scheduled_messages`: announcement_id, schedule_type, cron, timezone, start/end/next/last, is_active
- `recipient_messages`: per-user x mode delivery record; status PENDING|SENT|DELIVERED|FAILED|READ
- `message_interactions`: recipient_message_id, user_id, interaction_type (READ|DISMISSED|CLICK|...)
- `message_replies`: announcement-scoped replies (parentMessageId for threading), rich_text_id
- `institute_announcement_settings`: institute_id, settings (JSON)

### Mode-specific tables (for query efficiency)
- `announcement_system_alerts`
- `announcement_dashboard_pins`
- `announcement_dms`
- `announcement_streams`
- `announcement_resources`
- `announcement_community`
- `announcement_tasks` (TASKS mode; slide_ids JSON, go_live, deadline, status, etc.)

### Enums (selected)
- ModeType, MediumType, RecipientType, AnnouncementStatus, MessageStatus, InteractionType, ScheduleType, TaskStatus

### Validation & Permissions
- Jakarta validation on DTOs (required fields, sizes, patterns)
- Custom `ModeSettingsValidator` per mode (e.g., TASKS requires slideIds/goLive/deadline)
- `InstituteAnnouncementSettingsService` checks whether `createdByRole` can use a given mode/medium

### Scheduling & Processing
- Quartz configured with JDBC job store (cluster-ready)
- Immediate: process on create; Scheduled/Recurring: Quartz trigger invokes processing
- `AnnouncementProcessingService` orchestrates to avoid circular deps:
  - Resolves recipients (roles and package sessions)
  - Creates `recipient_messages` per mode
  - Delegates to `AnnouncementDeliveryService` for multi-medium delivery
  - Updates announcement status; emits SSE NEW_ANNOUNCEMENT

### Recipient Resolution (cross-service)
- Roles & user details from `auth_service`
- Package sessions from `admin_core_service` (faculty/student mappings)
- RestTemplate clients with Spring Retry and Cache; batched user lookups
- Dedup of users expected upstream when multiple package_sessions overlap (defensive Set usage on our side where applicable)

### Delivery (mediums)
- Uses existing WA/Push/Email services; medium config stored as JSON per announcement
- `recipient_messages.status` transitions:
  - PENDING -> SENT (request dispatched)
  - SENT -> DELIVERED (callback/heuristic) or -> FAILED (error)
  - READ tracked via `message_interactions` (not a status change)

### User Retrieval & UI Queries
- `UserMessageService` consolidates message views with mode-specific filters:
  - Resources by folder/category; Community by type/tags; Dashboard pins active; Streams by package_session/streamType; Alerts by priority; DMs ordered by priority
- Response includes title, content, creator, read/dismissed flags, recent reply preview

### Interactions & Replies
- Interactions: mark-as-read, dismiss, generic interactions; persisted and exposed via counts
- Replies: create/update/delete, top-level and threaded children (community/DM oriented)
- SSE emissions:
  - MESSAGE_READ, MESSAGE_DISMISSED (to announcement participants)
  - MESSAGE_REPLY_ADDED (to recipients of that announcement)

### TASKS mode automation
- `TaskStatusUpdateService`:
  - SCHEDULED -> LIVE (at go_live)
  - LIVE -> OVERDUE (at deadline)
  - Optional reminders X minutes before deadline
- SSE emissions: TASK_STATUS_CHANGED, TASK_REMINDER

### SSE (Server-Sent Events)
- Endpoints for per-user and per-mode streams; connection manager maintains multiple connections per user
- Heartbeats and cleanup of stale emitters
- Mode subscription filtering: only receive events for subscribed mode
- Event payload (AnnouncementEvent) carries `type`, `announcementId`, optional `modeType`, `data`, `timestamp`

### Security
- Internal APIs allowed without JWT (per security config allowlist); identify user via request body
- Optional HMAC/JWT filters retained for other parts of the service; SSE endpoints whitelisted

### Performance & Resilience
- Batched user-resolution (configurable batch size)
- Caching for cross-service lookups; retries for transient failures
- Dedicated tables for mode settings → efficient reads and indexes for UI queries

### Error Handling
- Centralized exception handler returns consistent JSON errors (validation, not-found, external service errors)
- Validation errors include field-level messages

### Extensibility (adding a new mode)
1. Create mode-specific entity + repository; add Flyway migration
2. Extend `ModeType` and `ModeSettingsValidator`
3. Update `AnnouncementService` mapping and `getModeTypesForAnnouncement`
4. Add repository queries for UI filtering (in `RecipientMessageRepository`)
5. Add controller endpoints if needed and update API docs

---

## Announcements
Base path: `/notification-service/v1/announcements`

- Create Announcement
  - Method: POST
  - Path: `/notification-service/v1/announcements`
  - Body: `CreateAnnouncementRequest`
  - Curl:
    ```bash
    curl -X POST "$BASE/notification-service/v1/announcements" \
      -H "Content-Type: application/json" \
      -d '{
        "title": "Exam Reminder",
        "instituteId": "INST_123",
        "createdBy": "USER_1",
        "createdByRole": "ADMIN",
        "timezone": "Asia/Kolkata",
        "content": { "richTextId": "RT_abc123" },
        "recipients": [
          { "recipientType": "ROLE", "recipientId": "STUDENT" }
        ],
        "modes": [
          { "modeType": "SYSTEM_ALERT", "settings": { "priority": "HIGH" } }
        ],
        "mediums": [
          { "mediumType": "PUSH", "config": { "title": "Exam", "body": "Tomorrow 9am" } }
        ],
        "scheduling": { "type": "IMMEDIATE" }
      }'
    ```

- Get Announcement by ID
  - Method: GET
  - Path: `/notification-service/v1/announcements/{announcementId}`
  - Curl:
    ```bash
    curl "$BASE/notification-service/v1/announcements/$ANNOUNCEMENT_ID"
    ```

- List Announcements by Institute (with optional status)
  - Method: GET
  - Path: `/notification-service/v1/announcements/institute/{instituteId}?page=0&size=20&status=ACTIVE`
  - Curl:
    ```bash
    curl "$BASE/notification-service/v1/announcements/institute/$INSTITUTE_ID?page=0&size=20&status=ACTIVE"
    ```

- Planned Announcements (calendar view)
  - Method: GET
  - Path: `/notification-service/v1/announcements/institute/{instituteId}/planned?page=0&size=20&from=2025-08-01T00:00:00&to=2025-08-31T23:59:59`
  - Notes: `from`/`to` are optional ISO datetimes; returns items with schedule info.
  - Curl:
    ```bash
    curl "$BASE/notification-service/v1/announcements/institute/$INSTITUTE_ID/planned?page=0&size=20&from=2025-08-01T00:00:00&to=2025-08-31T23:59:59"
    ```

- Past Announcements (calendar view)
  - Method: GET
  - Path: `/notification-service/v1/announcements/institute/{instituteId}/past?page=0&size=20&from=2025-07-01T00:00:00&to=2025-07-31T23:59:59`
  - Notes: `from`/`to` are optional ISO datetimes; includes delivered/expired/rejected.
  - Curl:
    ```bash
    curl "$BASE/notification-service/v1/announcements/institute/$INSTITUTE_ID/past?page=0&size=20&from=2025-07-01T00:00:00&to=2025-07-31T23:59:59"
    ```

- Update Announcement Status
  - Method: PUT
  - Path: `/notification-service/v1/announcements/{announcementId}/status`
  - Body: `{ "status": "ACTIVE|INACTIVE|..." }`
  - Curl:
    ```bash
    curl -X PUT "$BASE/notification-service/v1/announcements/$ANNOUNCEMENT_ID/status" \
      -H "Content-Type: application/json" \
      -d '{"status":"ACTIVE"}'
    ```

- Delete Announcement
  - Method: DELETE
  - Path: `/notification-service/v1/announcements/{announcementId}`
  - Curl:
    ```bash
    curl -X DELETE "$BASE/notification-service/v1/announcements/$ANNOUNCEMENT_ID"
    ```

- Trigger Delivery (manual)
  - Method: POST
  - Path: `/notification-service/v1/announcements/{announcementId}/deliver`
  - Curl:
    ```bash
    curl -X POST "$BASE/notification-service/v1/announcements/$ANNOUNCEMENT_ID/deliver"
    ```

- Get Announcement Stats
  - Method: GET
  - Path: `/notification-service/v1/announcements/{announcementId}/stats`
  - Curl:
    ```bash
    curl "$BASE/notification-service/v1/announcements/$ANNOUNCEMENT_ID/stats"
    ```

- Submit For Approval
  - Method: POST
  - Path: `/notification-service/v1/announcements/{announcementId}/submit-approval?submittedByRole={ROLE}`
  - Notes: Moves status from DRAFT/REJECTED → PENDING_APPROVAL if institute requires approval and role isn’t ADMIN.
  - Curl:
    ```bash
    curl -X POST "$BASE/notification-service/v1/announcements/$ANNOUNCEMENT_ID/submit-approval?submittedByRole=TEACHER"
    ```

- Approve Announcement
  - Method: POST
  - Path: `/notification-service/v1/announcements/{announcementId}/approve?approvedByRole=ADMIN`
  - Notes: Only ADMIN. If a schedule exists, sets status to SCHEDULED; otherwise triggers immediate delivery.
  - Curl:
    ```bash
    curl -X POST "$BASE/notification-service/v1/announcements/$ANNOUNCEMENT_ID/approve?approvedByRole=ADMIN"
    ```

- Reject Announcement
  - Method: POST
  - Path: `/notification-service/v1/announcements/{announcementId}/reject?rejectedByRole=ADMIN&reason={reason}`
  - Notes: Only ADMIN. Sets status to REJECTED.
  - Curl:
    ```bash
    curl -X POST "$BASE/notification-service/v1/announcements/$ANNOUNCEMENT_ID/reject?rejectedByRole=ADMIN&reason=Insufficient%20details"
    ```

### CreateAnnouncementRequest (schema)
```json
{
  "title": "string (<=500)",
  "content": {
    "type": "text|html|video|image",
    "content": "string (<=10000)"
  },
  "instituteId": "string",
  "createdBy": "string",
  "createdByName": "string?",
  "createdByRole": "string?",
  "timezone": "string?",
  "recipients": [
    {
      "recipientType": "ROLE|USER|PACKAGE_SESSION",
      "recipientId": "string",
      "recipientName": "string?"
    }
  ],
  "modes": [
    {
      "modeType": "SYSTEM_ALERT|DASHBOARD_PIN|DM|STREAM|RESOURCES|COMMUNITY|TASKS",
      "settings": { "...": "mode-specific" }
    }
  ],
  "mediums": [
    { "mediumType": "WHATSAPP|PUSH_NOTIFICATION|EMAIL", "config": { "...": "medium-specific" } }
  ],
  "scheduling": {
    "scheduleType": "IMMEDIATE|ONE_TIME|RECURRING",
    "cronExpression": "string?",
    "timezone": "string?",
    "startDate": "yyyy-MM-dd'T'HH:mm:ss?",
    "endDate": "yyyy-MM-dd'T'HH:mm:ss?"
  }
}
```

### AnnouncementResponse (schema)
```json
{
  "id": "string",
  "title": "string",
  "content": { "id": "string", "type": "text|html|video|image", "content": "string" },
  "instituteId": "string",
  "createdBy": "string",
  "createdByName": "string?",
  "createdByRole": "string?",
  "status": "ACTIVE|INACTIVE|...",
  "timezone": "string",
  "createdAt": "yyyy-MM-dd'T'HH:mm:ss",
  "updatedAt": "yyyy-MM-dd'T'HH:mm:ss",
  "recipients": [ { "id": "string", "recipientType": "ROLE|USER|PACKAGE_SESSION", "recipientId": "string", "recipientName": "string?" } ],
  "modes": [ { "id": "string", "modeType": "...", "settings": {}, "isActive": true } ],
  "mediums": [ { "id": "string", "mediumType": "...", "config": {}, "isActive": true } ],
  "scheduling": { "id": "string", "scheduleType": "...", "cronExpression": "string?", "timezone": "string?", "startDate": "...", "endDate": "...", "nextRunTime": "...", "lastRunTime": "...", "isActive": true },
  "stats": { "totalRecipients": 0, "deliveredCount": 0, "readCount": 0, "failedCount": 0, "deliveryRate": 0.0, "readRate": 0.0 }
}
```

---

## User Messages
Base path: `/notification-service/v1/user-messages`

- Get User Messages (optional mode filter)
  - GET `/notification-service/v1/user-messages/user/{userId}?modeType=SYSTEM_ALERT&page=0&size=20`
  - ```bash
    curl "$BASE/notification-service/v1/user-messages/user/$USER_ID?modeType=SYSTEM_ALERT&page=0&size=20"
    ```

- Get Unread Count (per mode or all modes)
  - GET `/notification-service/v1/user-messages/user/{userId}/unread-count?modeType=DM`
  - ```bash
    curl "$BASE/notification-service/v1/user-messages/user/$USER_ID/unread-count?modeType=DM"
    ```

- Mark As Read
  - POST `/notification-service/v1/user-messages/interactions/read`
  - Body: `{ recipientMessageId, userId }`
  - ```bash
    curl -X POST "$BASE/notification-service/v1/user-messages/interactions/read" \
      -H "Content-Type: application/json" \
      -d '{"recipientMessageId":"RM_123","userId":"USER_1"}'
    ```

- Dismiss Message
  - POST `/notification-service/v1/user-messages/interactions/dismiss`
  - Body: `{ recipientMessageId, userId }`
  - ```bash
    curl -X POST "$BASE/notification-service/v1/user-messages/interactions/dismiss" \
      -H "Content-Type: application/json" \
      -d '{"recipientMessageId":"RM_123","userId":"USER_1"}'
    ```

- Record Interaction (generic)
  - POST `/notification-service/v1/user-messages/interactions`
  - Body: `MessageInteractionRequest`
  - ```bash
    curl -X POST "$BASE/notification-service/v1/user-messages/interactions" \
      -H "Content-Type: application/json" \
      -d '{"recipientMessageId":"RM_123","userId":"USER_1","interactionType":"CLICK","additionalData":{"x":1}}'
    ```

- Resources Messages
  - GET `/notification-service/v1/user-messages/user/{userId}/resources?folderName=assignments&category=math&page=0&size=20`
  - ```bash
    curl "$BASE/notification-service/v1/user-messages/user/$USER_ID/resources?folderName=assignments&category=math&page=0&size=20"
    ```

- Community Messages
  - GET `/notification-service/v1/user-messages/user/{userId}/community?communityType=SCHOOL&tag=general&page=0&size=20`
  - ```bash
    curl "$BASE/notification-service/v1/user-messages/user/$USER_ID/community?communityType=SCHOOL&tag=general&page=0&size=20"
    ```

- Dashboard Pins (active)
  - GET `/notification-service/v1/user-messages/user/{userId}/dashboard-pins`
  - ```bash
    curl "$BASE/notification-service/v1/user-messages/user/$USER_ID/dashboard-pins"
    ```

- Stream Messages (by package session)
  - GET `/notification-service/v1/user-messages/user/{userId}/streams/{packageSessionId}?streamType=LIVE&page=0&size=20`
  - ```bash
    curl "$BASE/notification-service/v1/user-messages/user/$USER_ID/streams/$PKG_SESSION_ID?streamType=LIVE&page=0&size=20"
    ```

- System Alerts
  - GET `/notification-service/v1/user-messages/user/{userId}/system-alerts?priority=HIGH&page=0&size=20`
  - ```bash
    curl "$BASE/notification-service/v1/user-messages/user/$USER_ID/system-alerts?priority=HIGH&page=0&size=20"
    ```

- Direct Messages
  - GET `/notification-service/v1/user-messages/user/{userId}/direct-messages?page=0&size=20`
  - ```bash
    curl "$BASE/notification-service/v1/user-messages/user/$USER_ID/direct-messages?page=0&size=20"
    ```

- All Stream Messages (any package session)
  - GET `/notification-service/v1/user-messages/user/{userId}/streams?streamType=RECORDED&page=0&size=20`
  - ```bash
    curl "$BASE/notification-service/v1/user-messages/user/$USER_ID/streams?streamType=RECORDED&page=0&size=20"
    ```

### MessageInteractionRequest (schema)
```json
{
  "recipientMessageId": "string",
  "userId": "string",
  "interactionType": "READ|DISMISSED|CLICK|LIKE|SHARE|...",
  "additionalData": { "...": "optional" }
}
```

### UserMessagesResponse (shape)
```json
{
  "messageId": "string",
  "announcementId": "string",
  "modeType": "SYSTEM_ALERT|DASHBOARD_PIN|DM|STREAM|RESOURCES|COMMUNITY|TASKS",
  "status": "PENDING|SENT|DELIVERED|FAILED|READ",
  "createdAt": "yyyy-MM-dd'T'HH:mm:ss",
  "deliveredAt": "yyyy-MM-dd'T'HH:mm:ss?",
  "isRead": true,
  "isDismissed": false,
  "interactionTime": "yyyy-MM-dd'T'HH:mm:ss?",
  "title": "string?",
  "createdBy": "string?",
  "createdByName": "string?",
  "content": { "id": "string", "type": "text|html|video|image", "content": "string" },
  "repliesCount": 0,
  "recentReplies": [
    { "id": "string", "userId": "string", "userName": "string?", "createdAt": "...", "content": {"id":"...","type":"...","content":"..."}, "childRepliesCount": 0 }
  ]
}
```

---

## Message Replies
Base path: `/notification-service/v1/message-replies`

- Create Reply
  - POST `/notification-service/v1/message-replies`
  - Body: `MessageReplyRequest`
  - ```bash
    curl -X POST "$BASE/notification-service/v1/message-replies" \
      -H "Content-Type: application/json" \
      -d '{
        "announcementId":"ANN_1",
        "parentMessageId":null,
        "userId":"USER_1",
        "userName":"Alice",
        "userRole":"STUDENT",
        "content": {"type":"text","content":"Great!"}
      }'
    ```

- Get Announcement Replies (top-level)
  - GET `/notification-service/v1/message-replies/announcement/{announcementId}?page=0&size=20`
  - ```bash
    curl "$BASE/notification-service/v1/message-replies/announcement/$ANNOUNCEMENT_ID?page=0&size=20"
    ```

- Get Child Replies
  - GET `/notification-service/v1/message-replies/{parentReplyId}/children`
  - ```bash
    curl "$BASE/notification-service/v1/message-replies/$REPLY_ID/children"
    ```

- Update Reply
  - PUT `/notification-service/v1/message-replies/{replyId}`
  - Body: `MessageReplyRequest` (same as create)
  - ```bash
    curl -X PUT "$BASE/notification-service/v1/message-replies/$REPLY_ID" \
      -H "Content-Type: application/json" \
      -d '{
        "announcementId":"ANN_1",
        "userId":"USER_1",
        "content": {"type":"text","content":"Updated"}
      }'
    ```

- Delete Reply
  - DELETE `/notification-service/v1/message-replies/{replyId}?userId={userId}`
  - ```bash
    curl -X DELETE "$BASE/notification-service/v1/message-replies/$REPLY_ID?userId=$USER_ID"
    ```

- Get User Replies
  - GET `/notification-service/v1/message-replies/user/{userId}?page=0&size=20`
  - ```bash
    curl "$BASE/notification-service/v1/message-replies/user/$USER_ID?page=0&size=20"
    ```

- Reply Stats
  - GET `/notification-service/v1/message-replies/announcement/{announcementId}/stats`
  - ```bash
    curl "$BASE/notification-service/v1/message-replies/announcement/$ANNOUNCEMENT_ID/stats"
    ```

### MessageReplyRequest (schema)
```json
{
  "announcementId": "string",
  "parentMessageId": "string?",
  "userId": "string",
  "userName": "string?",
  "userRole": "string?",
  "content": { "type": "text|html|video|image", "content": "string (<=5000)" }
}
```

### MessageReplyResponse (shape)
```json
{
  "id": "string",
  "userId": "string",
  "userName": "string?",
  "userRole": "string?",
  "createdAt": "yyyy-MM-dd'T'HH:mm:ss",
  "content": { "id": "string", "type": "text|html|video|image", "content": "string" },
  "childRepliesCount": 0
}
```

---

## Institute Announcement Settings
Base path: `/notification-service/v1/institute-settings`

> Auth: create/update (`POST /institute-settings`) and `DELETE /institute-settings/institute/{id}` need a JWT (`Authorization: Bearer …`) plus a `clientId` header, and the caller must be an ADMIN of that institute. `GET …/all` is closed (403). `GET …/institute/{id}`, `…/permissions`, `/default-template` and `POST /validate` stay public. Responses never include the Firebase service-account key; `settings.firebase.configured` reports whether one is stored (absent when there is no firebase block). The curl examples below omit the auth headers.

- Create/Update Settings
  - POST `/notification-service/v1/institute-settings`
  - Body: `InstituteAnnouncementSettingsRequest`
  - ```bash
    curl -X POST "$BASE/notification-service/v1/institute-settings" \
      -H "Content-Type: application/json" \
      -d '{
        "instituteId":"INST_123",
        "settings": {"community":{"students_can_send":true}}
      }'
    ```

- Get Settings by Institute
  - GET `/notification-service/v1/institute-settings/institute/{instituteId}`
  - ```bash
    curl "$BASE/notification-service/v1/institute-settings/institute/$INSTITUTE_ID"
    ```

- Get All Settings
  - GET `/notification-service/v1/institute-settings/all`
  - ```bash
    curl "$BASE/notification-service/v1/institute-settings/all"
    ```

- Delete Settings
  - DELETE `/notification-service/v1/institute-settings/institute/{instituteId}`
  - ```bash
    curl -X DELETE "$BASE/notification-service/v1/institute-settings/institute/$INSTITUTE_ID"
    ```

- Check Permissions
  - GET `/notification-service/v1/institute-settings/institute/{instituteId}/permissions?userRole=STUDENT&action=send&modeType=COMMUNITY`
  - ```bash
    curl "$BASE/notification-service/v1/institute-settings/institute/$INSTITUTE_ID/permissions?userRole=STUDENT&action=send&modeType=COMMUNITY"
    ```

- Default Template
  - GET `/notification-service/v1/institute-settings/default-template`
  - ```bash
    curl "$BASE/notification-service/v1/institute-settings/default-template"
    ```

- Validate Settings
  - POST `/notification-service/v1/institute-settings/validate`
  - Body: `InstituteAnnouncementSettingsRequest`
  - ```bash
    curl -X POST "$BASE/notification-service/v1/institute-settings/validate" \
      -H "Content-Type: application/json" \
      -d '{"instituteId":"INST_123","settings":{}}'
    ```

### InstituteAnnouncementSettingsRequest (schema)
```json
{
  "instituteId": "string",
  "settings": { "...": "arbitrary JSON with institute permissions/configs" }
}
```

### InstituteAnnouncementSettingsResponse (shape)
```json
{
  "id": "string",
  "instituteId": "string",
  "settings": { "...": "JSON" },
  "createdAt": "yyyy-MM-dd'T'HH:mm:ss",
  "updatedAt": "yyyy-MM-dd'T'HH:mm:ss"
}
```

---

## Server-Sent Events (SSE)
Base path: `/notification-service/v1/sse`

- User Stream (all events)
  - GET `/notification-service/v1/sse/stream/{userId}?instituteId={instituteId}`
  - ```bash
    curl -N "$BASE/notification-service/v1/sse/stream/$USER_ID?instituteId=$INSTITUTE_ID"
    ```

### SSE Event (AnnouncementEvent shape)
```json
{
  "type": "NEW_ANNOUNCEMENT|TASK_STATUS_CHANGED|TASK_REMINDER|DASHBOARD_PIN_ADDED|DASHBOARD_PIN_REMOVED|SYSTEM_ALERT|MESSAGE_READ|MESSAGE_DISMISSED|MESSAGE_REPLY_ADDED|ANNOUNCEMENT_UPDATED|ANNOUNCEMENT_CANCELLED|HEARTBEAT",
  "targetUserId": "string?",
  "announcementId": "string?",
  "modeType": "SYSTEM_ALERT|DASHBOARD_PIN|DM|STREAM|RESOURCES|COMMUNITY|TASKS?",
  "instituteId": "string?",
  "data": {},
  "metadata": {},
  "timestamp": "yyyy-MM-dd'T'HH:mm:ss",
  "priority": "HIGH|MEDIUM|LOW",
  "persistent": true,
  "eventId": "string"
}
```

- Mode-specific Stream
  - GET `/notification-service/v1/sse/stream/{userId}/mode/{modeType}?instituteId={instituteId}`
  - ```bash
    curl -N "$BASE/notification-service/v1/sse/stream/$USER_ID/mode/TASKS?instituteId=$INSTITUTE_ID"
    ```

- Stats
  - GET `/notification-service/v1/sse/stats`
  - ```bash
    curl "$BASE/notification-service/v1/sse/stats"
    ```

- Health
  - GET `/notification-service/v1/sse/health`
  - ```bash
    curl "$BASE/notification-service/v1/sse/health"
    ```

---

## Mode Settings Examples
These examples show the `modes[].settings` object for each `modeType` in `CreateAnnouncementRequest`.

### SYSTEM_ALERT
```json
{
  "priority": "HIGH",          
  "expiresAt": "2025-12-31T23:59:59" 
}
```

Notes:
- `priority`: HIGH | MEDIUM | LOW (used in sorting/filters)
- `expiresAt`: optional; controls visibility window

### DASHBOARD_PIN
```json
{
  "priority": 10,                          
  "pinStartTime": "2025-08-01T09:00:00", 
  "pinEndTime": "2025-08-02T09:00:00",   
  "position": "TOP"                      
}
```

Notes:
- Queries sort by `priority` and ensure `pinEndTime` is in future for active pins

### DM
```json
{
  "messagePriority": 5,   
  "allowReplies": true
}
```

Notes:
- `messagePriority` is used for ordering DMs in lists

### STREAM
```json
{
  "packageSessionId": "PKG_2024_8A", 
  "streamType": "LIVE"               
}
```

Notes:
- If `packageSessionId` is omitted, recipients derived from the announcement recipients are used
- `streamType`: e.g., LIVE | RECORDED | UPCOMING

### RESOURCES
```json
{
  "folderName": "assignments", 
  "category": "math",          
  "accessLevel": "STUDENTS"    
}
```

Notes:
- Queries filter by `folderName` and `category`

### COMMUNITY
```json
{
  "communityType": "SCHOOL",           
  "tags": ["general", "announcements"] 
}
```

Notes:
- Queries filter by `communityType` and search `tags`

### TASKS
```json
{
  "slideIds": ["SLIDE_101", "SLIDE_102"],        
  "goLiveDateTime": "2025-08-01T10:00:00",        
  "deadlineDateTime": "2025-08-05T23:59:00",      
  "status": "SCHEDULED",                          
  "taskTitle": "Unit 1 Worksheet",                
  "taskDescription": "Solve all questions.",       
  "estimatedDurationMinutes": 45,                   
  "maxAttempts": 1,                                 
  "isMandatory": true,                              
  "autoStatusUpdate": true,                         
  "reminderBeforeMinutes": 120                      
}
```

Notes:
- `status`: DRAFT | SCHEDULED | LIVE | COMPLETED | OVERDUE | CANCELLED
- `autoStatusUpdate` drives automatic transitions (SCHEDULED→LIVE, LIVE→OVERDUE)
- `reminderBeforeMinutes`: emits reminders before `deadlineDateTime`

