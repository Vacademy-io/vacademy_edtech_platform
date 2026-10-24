package vacademy.io.admin_core_service.features.workflow.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.workflow.dto.CatalogItemDTO;
import vacademy.io.admin_core_service.features.workflow.enums.EventAppliedType;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;

import java.util.*;

@Slf4j
@RestController
@RequestMapping("/admin-core-service/v1/workflow/catalog")
@RequiredArgsConstructor
public class WorkflowCatalogController {

    @GetMapping("/query-keys")
    public ResponseEntity<List<CatalogItemDTO>> getQueryKeys() {
        List<CatalogItemDTO> keys = List.of(
            CatalogItemDTO.builder()
                .key("fetch_ssigm_by_package")
                .label("Fetch Learners by Batch")
                .description("Get enrolled students with name, email, mobile from a batch. Leave batchId empty for all batches (limited to 10).")
                .category("Enrollment")
                .requiredParams(List.of("instituteId"))
                .optionalParams(List.of("batchId", "statuses"))
                .build(),
            CatalogItemDTO.builder()
                .key("getSSIGMByStatusAndPackageSessionIds")
                .label("Get Enrollments with Computed Fields")
                .description("Get enrollments with learningDay, remainingDays, daysPastExpiry computed fields")
                .category("Enrollment")
                .requiredParams(List.of("packageSessionIds", "statusList"))
                .build(),
            CatalogItemDTO.builder()
                .key("updateSSIGMRemaingDaysByOne")
                .label("Update Remaining Days")
                .description("Decrement remaining days by 1 in custom fields for enrollments")
                .category("Enrollment")
                .requiredParams(List.of("ssigm"))
                .build(),
            CatalogItemDTO.builder()
                .key("createSessionSchedule")
                .label("Create Live Session Schedule")
                .description("Create a new schedule entry for a live session")
                .category("Live Session")
                .requiredParams(List.of("sessionId"))
                .optionalParams(List.of("recurrenceType", "meetingDate", "startTime", "lastEntryTime", "linkType", "customMeetingLink", "status", "dailyAttendance"))
                .build(),
            CatalogItemDTO.builder()
                .key("createSessionParticipent")
                .label("Add Session Participant")
                .description("Add a participant to a live session")
                .category("Live Session")
                .requiredParams(List.of("sourceId", "sessionId"))
                .build(),
            CatalogItemDTO.builder()
                .key("createLiveSession")
                .label("Create Live Session")
                .description("Create a new live session record")
                .category("Live Session")
                .requiredParams(List.of("title", "instituteId"))
                .build(),
            CatalogItemDTO.builder()
                .key("checkStudentIsPresentInPackageSession")
                .label("Check Student Enrollment")
                .description("Validate if a student is enrolled in a specific package session")
                .category("Enrollment")
                .requiredParams(List.of("userId", "packageSessionId"))
                .build(),
            CatalogItemDTO.builder()
                .key("fetchInstituteSetting")
                .label("Fetch Institute Settings")
                .description("Get configuration settings for an institute")
                .category("Settings")
                .requiredParams(List.of("instituteId", "settingKey"))
                .build(),
            CatalogItemDTO.builder()
                .key("getAudienceResponsesByDayDifference")
                .label("Get Audience Responses by Day Offset")
                .description("Get audience/lead responses whose workflowActivateDayAt is exactly N days ago. Custom-field keys are LOWERCASED in the result.")
                .category("CRM")
                .requiredParams(List.of("instituteId", "audienceId", "daysAgo"))
                .optionalParams(List.of("conversionStatus"))
                .build(),
            CatalogItemDTO.builder()
                .key("fetchPackageLMSSetting")
                .label("Fetch Package LMS Settings")
                .description("Get LMS configuration for a specific package. Also returns courseDescription "
                        + "(the course's rich-text description) so a shared welcome-email template can render "
                        + "per-course copy; pass defaultCourseDescriptionHtml for courses that have none.")
                .category("Settings")
                .requiredParams(List.of("packageId", "settingKey"))
                .optionalParams(List.of("defaultCourseDescriptionHtml"))
                .build(),
            CatalogItemDTO.builder()
                .key("upsertUserCustomField")
                .label("Upsert Custom Field Value")
                .description("Create or update a custom field value for a user")
                .category("Data")
                .requiredParams(List.of("userId", "customFieldId", "value"))
                .build(),
            CatalogItemDTO.builder()
                .key("getUpcomingFeeInstallments")
                .label("Get Upcoming Fee Installments")
                .description("Get fee installments due within a window around today for an institute")
                .category("Fee Management")
                .requiredParams(List.of("instituteId"))
                .optionalParams(List.of("daysBeforeWindow", "daysAfterWindow"))
                .build(),
            CatalogItemDTO.builder()
                .key("fetch_live_sessions")
                .label("Fetch Live Sessions")
                .description("Get live sessions for an institute with optional status filter")
                .category("Live Session")
                .requiredParams(List.of("instituteId"))
                .optionalParams(List.of("status"))
                .build(),
            CatalogItemDTO.builder()
                .key("fetch_live_session_participants")
                .label("Fetch Live Session Participants")
                .description("Get all participants of a live session")
                .category("Live Session")
                .requiredParams(List.of("liveSessionId"))
                .optionalParams(List.of("status"))
                .build(),
            CatalogItemDTO.builder()
                .key("fetch_enroll_invites")
                .label("Fetch Enrollment Invites")
                .description("Get enrollment invites for an institute with optional filters")
                .category("Invites")
                .requiredParams(List.of("instituteId"))
                .optionalParams(List.of("status"))
                .build(),
            CatalogItemDTO.builder()
                .key("fetch_expiring_memberships")
                .label("Fetch Expiring Memberships")
                .description("Get this institute's ACTIVE user plans whose end_date falls within the next N days. Returns expiringMemberships[] with email/fullName/mobileNumber/endDate per plan.")
                .category("CRM")
                .requiredParams(List.of("instituteId"))
                .optionalParams(List.of("daysUntilExpiry"))
                .build(),
            CatalogItemDTO.builder()
                .key("fetch_audience_responses_filtered")
                .label("Fetch Audience Responses (Filtered)")
                .description("Get audience/lead responses with flexible date and audience filters")
                .category("CRM")
                .requiredParams(List.of("instituteId"))
                .optionalParams(List.of("audienceId", "daysAgo", "startDate", "endDate"))
                .build(),
            CatalogItemDTO.builder()
                .key("fetch_student_attendance_report")
                .label("Student Attendance & Engagement Report")
                .description("Get attendance %, session-wise attendance, and concentration/engagement scores for a student in a batch")
                .category("Live Session")
                .requiredParams(List.of("userId", "batchId"))
                .optionalParams(List.of("daysBack"))
                .build(),
            CatalogItemDTO.builder()
                .key("fetch_batch_attendance_report")
                .label("Batch Attendance Report (All Students)")
                .description("Get attendance and engagement data for students — pass batchId for one batch, or leave empty for ALL batches in the institute")
                .category("Live Session")
                .requiredParams(List.of("instituteId"))
                .optionalParams(List.of("batchId", "daysBack"))
                .build(),
            CatalogItemDTO.builder()
                .key("fetch_students_by_batch")
                .label("Get Students from Batch (Lightweight)")
                .description("Fast query — gets student names, emails, and phone numbers from a batch. No attendance data. Best for sending notifications.")
                .category("Notification")
                .requiredParams(List.of("instituteId"))
                .optionalParams(List.of("batchId"))
                .build(),
            CatalogItemDTO.builder()
                .key("fetch_institute_admin_emails")
                .label("Fetch Institute Admin / Team Emails")
                .description("Returns the institute's admin and teacher contacts as a list of {email, fullName, role} maps — for routing reports and notifications to staff. Pass 'roles' as CSV (e.g. 'ADMIN,TEACHER') to scope.")
                .category("Notification")
                .requiredParams(List.of("instituteId"))
                .optionalParams(List.of("roles"))
                .build(),
            CatalogItemDTO.builder()
                .key("fetch_live_session_attendance")
                .label("Live Session Attendance (Present / Absent)")
                .description("Get present and absent students for one live session occurrence, with attendance %, join time and a pre-rendered attendanceBlockHtml per student.")
                .category("Live Session")
                .requiredParams(List.of("sessionId", "scheduleId"))
                .build(),
            CatalogItemDTO.builder()
                .key("fetch_enrollment_details")
                .label("Fetch Enrollment & Payment Details")
                .description("Get a learner's enrollment and payment status for a package session as a flat map (used to gate abandoned-cart / webhook flows).")
                .category("Enrollment")
                .requiredParams(List.of("userId"))
                .optionalParams(List.of("packageSessionId", "packageSessionIds", "instituteId"))
                .build()
        );
        return ResponseEntity.ok(keys);
    }

    @GetMapping("/trigger-events")
    public ResponseEntity<List<CatalogItemDTO>> getTriggerEvents() {
        // Each entry: label, description, category, eventAppliedType
        Map<String, String[]> eventMeta = new LinkedHashMap<>();
        // Existing
        eventMeta.put("LEARNER_BATCH_ENROLLMENT", new String[]{"Learner Batch Enrollment", "Fires when learners are enrolled in a batch", "Enrollment", "PACKAGE_SESSION"});
        eventMeta.put("GENERATE_ADMIN_LOGIN_URL_FOR_LEARNER_PORTAL", new String[]{"Generate Admin Login URL", "Fires when admin login URL is generated for learner portal", "Auth", "PACKAGE_SESSION"});
        eventMeta.put("SEND_LEARNER_CREDENTIALS", new String[]{"Send Learner Credentials", "Fires when credentials need to be sent to learners", "Notification", "PACKAGE_SESSION"});
        eventMeta.put("SUB_ORG_MEMBER_ENROLLMENT", new String[]{"Sub-Org Member Enrollment", "Fires when a member is enrolled in a sub-organization", "Enrollment", "PACKAGE_SESSION"});
        eventMeta.put("SUB_ORG_MEMBER_TERMINATION", new String[]{"Sub-Org Member Termination", "Fires when a member is removed from a sub-organization", "Enrollment", "PACKAGE_SESSION"});
        eventMeta.put("AUDIENCE_LEAD_SUBMISSION", new String[]{"Audience Lead Submission", "Fires when a new lead is submitted via audience form", "CRM", "AUDIENCE"});
        eventMeta.put("INSTALLMENT_DUE_REMINDER", new String[]{"Installment Due Reminder", "Fires when a fee installment is approaching its due date", "Fee Management", "INSTITUTE"});
        // Live Session
        eventMeta.put("LIVE_SESSION_CREATE", new String[]{"Live Session Created", "Fires when a new live session is created", "Live Session", "LIVE_SESSION"});
        eventMeta.put("LIVE_SESSION_START", new String[]{"Live Session Started", "Fires when a live session starts", "Live Session", "LIVE_SESSION"});
        eventMeta.put("LIVE_SESSION_END", new String[]{"Live Session Ended", "Fires when a live session ends", "Live Session", "LIVE_SESSION"});
        eventMeta.put("LIVE_SESSION_FORM_SUBMISSION", new String[]{"Live Session Form Submission", "Fires when a learner submits a live session registration form", "Live Session", "LIVE_SESSION"});
        // Payment
        eventMeta.put("PAYMENT_FAILED", new String[]{"Payment Failed", "Fires when a payment fails for an enrollment invite", "Payment", "ENROLL_INVITE"});
        eventMeta.put("PAYMENT_SUCCESS", new String[]{"Payment Success", "Fires when a payment completes successfully", "Payment", "ENROLL_INVITE"});
        eventMeta.put("ABANDONED_CART", new String[]{"Abandoned Cart", "Fires when a user starts enrollment but doesn't complete payment", "Payment", "ENROLL_INVITE"});
        // Subscription / plan lifecycle
        eventMeta.put("SUBSCRIPTION_CANCELLED", new String[]{"Subscription Cancelled", "Fires when a learner cancels their own subscription", "Subscription", "USER_PLAN"});
        eventMeta.put("SUBSCRIPTION_TERMINATED", new String[]{"Subscription Terminated", "Fires when an admin terminates a learner's subscription", "Subscription", "USER_PLAN"});
        eventMeta.put("LEARNER_RE_ENROLLMENT", new String[]{"Learner Re-enrolment", "Fires when a learner re-enrols in a course they already had a plan for", "Enrollment", "ENROLL_INVITE"});
        eventMeta.put("LEARNER_TERMINATION", new String[]{"Learner Termination", "Fires when a learner is removed / terminated from a course batch", "Enrollment", "PACKAGE_SESSION"});
        // LMS / content / engagement
        eventMeta.put("COURSE_CREATED", new String[]{"Course Created", "Fires when a new course / package is published in the institute", "Course", "PACKAGE_SESSION"});
        eventMeta.put("DOUBT_RAISED", new String[]{"Doubt Raised", "Fires when a learner posts a new doubt", "Engagement", "PACKAGE_SESSION"});
        eventMeta.put("ASSIGNMENT_SUBMITTED", new String[]{"Assignment Submitted", "Fires when a learner submits an assignment slide for the first time", "Engagement", "PACKAGE_SESSION"});
        // Invites
        eventMeta.put("INVITE_CREATE", new String[]{"Invite Created", "Fires when a new enroll invite is created", "Invites", "ENROLL_INVITE"});
        eventMeta.put("INVITE_FORM_FILL", new String[]{"Invite Form Filled", "Fires when a learner completes an invite enrollment form", "Invites", "ENROLL_INVITE"});
        // CRM
        eventMeta.put("MEMBERSHIP_EXPIRY", new String[]{"Membership Expiry", "Fires when a user's membership/subscription is about to expire", "CRM", "USER_PLAN"});
        eventMeta.put("ENROLLMENT_REPORTS", new String[]{"Enrollment Reports", "Fires periodically for generating enrollment reports", "CRM", "INSTITUTE"});
        // Lead TAT / Follow-up SLA (emit-only; the workflow you bind here decides the channel/template/recipients)
        eventMeta.put("LEAD_ASSIGNED_TO_COUNSELOR", new String[]{"Lead Assigned to Counselor", "Fires when a lead is assigned or reassigned to a counselor", "CRM", "AUDIENCE"});
        eventMeta.put("LEAD_TAT_REMINDER_BEFORE", new String[]{"Lead TAT Reminder (Before Breach)", "Fires when an unacted lead is approaching its TAT/SLA deadline", "CRM", "AUDIENCE"});
        eventMeta.put("LEAD_TAT_OVERDUE", new String[]{"Lead TAT Overdue", "Fires when the counselor has not acted on a lead by its TAT/SLA deadline", "CRM", "AUDIENCE"});
        eventMeta.put("FOLLOW_UP_DUE", new String[]{"Follow-up Due", "Fires when a lead follow-up is approaching its SLA deadline", "CRM", "AUDIENCE"});
        eventMeta.put("FOLLOW_UP_OVERDUE", new String[]{"Follow-up Overdue", "Fires when a lead follow-up has crossed its SLA deadline", "CRM", "AUDIENCE"});
        eventMeta.put("LEAD_STATUS_CHANGED", new String[]{"Lead Status Changed", "Fires when a lead's status/tier changes (carries oldStatus and newStatus)", "CRM", "AUDIENCE"});
        // Assessment
        eventMeta.put("ASSESSMENT_CREATE", new String[]{"Assessment Created", "Fires when a new assessment is saved as a draft", "Assessment", "ASSESSMENT"});
        eventMeta.put("ASSESSMENT_PUBLISHED", new String[]{"Assessment Published", "Fires when an assessment goes from draft to published and becomes visible to learners", "Assessment", "ASSESSMENT"});
        eventMeta.put("ASSESSMENT_START", new String[]{"Assessment Started", "Fires when a student opens an assessment and an attempt is created", "Assessment", "ASSESSMENT"});
        eventMeta.put("ASSESSMENT_END", new String[]{"Assessment Ended", "Fires when a student's attempt ends — on submit, or when the timer expires (see endSource)", "Assessment", "ASSESSMENT"});
        eventMeta.put("ASSESSMENT_FORM_SUBMISSION", new String[]{"Assessment Form Submission", "Fires when someone registers through an assessment's public registration form", "Assessment", "ASSESSMENT"});
        eventMeta.put("ASSESSMENT_RESULT_RELEASED", new String[]{"Assessment Result Released", "Fires when a learner's result becomes visible to them, automatically or via manual release", "Assessment", "ASSESSMENT"});
        eventMeta.put("ASSESSMENT_REMINDER_BEFORE_START", new String[]{"Assessment Starting Soon", "Fires for each registered learner shortly before an assessment opens", "Assessment", "ASSESSMENT"});
        eventMeta.put("ASSESSMENT_REATTEMPT_GRANTED", new String[]{"Assessment Reattempt Granted", "Fires for each learner an admin grants extra attempts to", "Assessment", "ASSESSMENT"});
        eventMeta.put("ASSESSMENT_REATTEMPT_REQUESTED", new String[]{"Assessment Reattempt Requested", "Fires when a learner asks for another attempt or more time — notify staff", "Assessment", "ASSESSMENT"});
        eventMeta.put("ASSESSMENT_AI_EVALUATION_COMPLETED", new String[]{"AI Copy Check Completed", "Fires when a bulk AI check of uploaded answer copies finishes — notify the coordinator, with counts of checked / failed / copies needing review", "Assessment", "ASSESSMENT"});

        List<CatalogItemDTO> events = new ArrayList<>();
        for (WorkflowTriggerEvent event : WorkflowTriggerEvent.values()) {
            String[] meta = eventMeta.getOrDefault(event.name(), new String[]{event.name(), "", "General", ""});
            events.add(CatalogItemDTO.builder()
                    .key(event.name())
                    .label(meta[0])
                    .description(meta[1])
                    .category(meta[2])
                    .eventAppliedType(meta.length > 3 && !meta[3].isEmpty() ? meta[3] : null)
                    .requiredParams(List.of())
                    .build());
        }
        return ResponseEntity.ok(events);
    }

    @GetMapping("/event-applied-types")
    public ResponseEntity<List<CatalogItemDTO>> getEventAppliedTypes() {
        Map<String, String> descriptions = new HashMap<>();
        descriptions.put("PACKAGE_SESSION", "Package Session (enrollment-related)");
        descriptions.put("AUDIENCE", "Audience / Lead (CRM-related)");
        descriptions.put("LIVE_SESSION", "Live Session");
        descriptions.put("ENROLL_INVITE", "Enrollment Invite");
        descriptions.put("PAYMENT", "Payment");
        descriptions.put("USER_PLAN", "User Plan / Membership");
        descriptions.put("INSTITUTE", "Institute-wide");
        descriptions.put("ASSESSMENT", "Assessment (cross-service)");
        descriptions.put("POOL", "Counselor Pool (lead routing)");

        List<CatalogItemDTO> types = new ArrayList<>();
        for (EventAppliedType type : EventAppliedType.values()) {
            types.add(CatalogItemDTO.builder()
                    .key(type.name())
                    .label(descriptions.getOrDefault(type.name(), type.name()))
                    .description(descriptions.getOrDefault(type.name(), ""))
                    .category("Event Applied Type")
                    .requiredParams(List.of())
                    .build());
        }
        return ResponseEntity.ok(types);
    }

    /**
     * Context variables available per lead trigger event, so the "Create sample template" UI
     * (Trigger workflow → Communication) can offer insertable tokens that map to the ctx keys
     * the workflow engine reads via SpEL (e.g. {@code #ctx['parentName']}). Keys mirror what
     * {@link vacademy.io.admin_core_service.features.audience.service.LeadTriggerContextBuilder}
     * and the lead SLA scheduler put on the context. Returns a map of event name → list of
     * {key, label}. Events not listed have no lead-specific variables.
     */
    @GetMapping("/trigger-context-variables")
    public ResponseEntity<Map<String, List<Map<String, String>>>> getTriggerContextVariables() {
        // Common keys present on every lead-row emit (forLead / SLA scheduler).
        List<Map<String, String>> base = new ArrayList<>(List.of(
                ctxVar("instituteId", "Institute ID"),
                ctxVar("leadId", "Lead ID"),
                ctxVar("userId", "Parent user ID"),
                ctxVar("studentUserId", "Student user ID"),
                ctxVar("enquiryId", "Enquiry ID"),
                ctxVar("audienceId", "Campaign (audience) ID"),
                ctxVar("poolId", "Counselor pool ID"),
                ctxVar("campaignName", "Campaign name"),
                ctxVar("counselorId", "Counselor user ID"),
                ctxVar("counselorName", "Counselor name"),
                ctxVar("counselorEmail", "Counselor email"),
                ctxVar("counselorMobile", "Counselor mobile"),
                ctxVar("leadName", "Lead name"),
                ctxVar("leadEmail", "Lead email"),
                ctxVar("leadMobile", "Lead mobile"),
                ctxVar("tat", "Configured TAT (human-readable, e.g. '1 hour 30 minutes')"),
                ctxVar("tatMinutes", "Configured TAT in minutes (exact integer)"),
                ctxVar("tatHours", "Configured TAT in whole hours, rounded up (integer)"),
                // Same values as lead-* above, kept for backward compat with older templates.
                ctxVar("parentName", "Parent name (alias of leadName)"),
                ctxVar("parentEmail", "Parent email (alias of leadEmail)"),
                ctxVar("parentMobile", "Parent mobile (alias of leadMobile)")));

        // TAT / follow-up reminders add SLA timing keys.
        List<Map<String, String>> sla = new ArrayList<>(base);
        sla.addAll(List.of(
                ctxVar("tatStage", "SLA stage (TAT_BEFORE / TAT_OVERDUE / FOLLOW_UP_DUE / FOLLOW_UP_OVERDUE)"),
                ctxVar("stageLabel", "Stage label (e.g. BEFORE_30M)"),
                ctxVar("notifyRoles", "Roles to notify"),
                ctxVar("dueAt", "Deadline (ISO timestamp)"),
                ctxVar("minutesToBreach", "Minutes until breach")));

        // Status changes add the old/new status keys.
        List<Map<String, String>> status = new ArrayList<>(base);
        status.addAll(List.of(
                ctxVar("changeType", "Change type (CONVERSION_STATUS / TIER / ENQUIRY_STATUS / LEAD_STATUS)"),
                ctxVar("oldStatus", "Previous status"),
                ctxVar("newStatus", "New status"),
                // Only emitted by the per-lead LEAD_STATUS path (LeadStatusService); the
                // profile-level conversion/tier emitters don't set them.
                ctxVar("statusChangeSource", "Who changed it: MANUAL | MANUAL_DISPOSITION | AI_CALLING | AI_WORKFLOW"),
                ctxVar("statusChangedByUserId", "User ID of whoever changed it (blank for system changes)"),
                ctxVar("conversionStatus", "Conversion status")));

        // Assessment events. Emitted cross-service by assessment_service's
        // AssessmentTriggerContextBuilder — these lists must stay in step with it, since
        // this endpoint is what an admin picks notification tokens from.
        List<Map<String, String>> assessment = new ArrayList<>(List.of(
                ctxVar("instituteId", "Institute ID"),
                ctxVar("assessmentId", "Assessment ID"),
                ctxVar("assessmentName", "Assessment name"),
                // playMode carries AssessmentModeEnum; assessmentType is a free-form label set
                // from the create request, so do NOT document the enum value space against it —
                // a condition written on those values would never match.
                ctxVar("assessmentType", "Assessment type label set when the assessment was created"),
                ctxVar("playMode", "Play mode (EXAM / MOCK / PRACTICE / SURVEY / ASSIGNMENT / MANUAL_UPLOAD)"),
                ctxVar("evaluationType", "Evaluation type (AUTO / MANUAL / AI)"),
                ctxVar("assessmentStatus", "Assessment status (DRAFT / PUBLISHED)"),
                ctxVar("resultType", "Result release type"),
                ctxVar("boundStartTime", "Assessment start time (ISO timestamp)"),
                ctxVar("boundEndTime", "Assessment end time (ISO timestamp)"),
                ctxVar("durationMinutes", "Duration in minutes"),
                ctxVar("batchId", "Batch / package session ID (when the assessment has exactly one)"),
                ctxVar("packageSessionId", "Package session ID (alias of batchId)"),
                ctxVar("batchIds", "All batch IDs the assessment is registered to"),
                ctxVar("packageSessionIds", "All package session IDs (alias of batchIds)")));

        // Learner-scoped events add the attempt and the student behind it. Keys the builder
        // omits when null are NOT listed for an event that cannot have them yet — an admin
        // picking a token here must get a value, not an empty string.
        List<Map<String, String>> attemptStart = new ArrayList<>(assessment);
        attemptStart.addAll(List.of(
                ctxVar("attemptId", "Attempt ID"),
                ctxVar("attemptNumber", "Attempt number"),
                ctxVar("attemptStatus", "Attempt status (PREVIEW / LIVE / ENDED)"),
                ctxVar("startTime", "Attempt start time (ISO timestamp)"),
                ctxVar("registrationId", "Registration ID"),
                ctxVar("userId", "Learner user ID"),
                ctxVar("studentName", "Learner name"),
                ctxVar("studentEmail", "Learner email"),
                ctxVar("studentMobile", "Learner mobile"),
                ctxVar("username", "Learner username")));

        // Only once the attempt is over do submitTime / totalTimeInSeconds exist.
        List<Map<String, String>> attempt = new ArrayList<>(attemptStart);
        attempt.addAll(List.of(
                ctxVar("submitTime", "Attempt submit time (ISO timestamp)"),
                ctxVar("totalTimeInSeconds", "Time taken in seconds")));

        List<Map<String, String>> attemptEnd = new ArrayList<>(attempt);
        attemptEnd.add(ctxVar("endSource", "How the attempt ended (SUBMITTED / TIME_EXPIRED)"));

        // Result events add scoring on top of the attempt keys.
        List<Map<String, String>> result = new ArrayList<>(attempt);
        result.addAll(List.of(
                ctxVar("marks", "Marks scored"),
                ctxVar("totalMarks", "Total achievable marks"),
                ctxVar("percentage", "Percentage scored"),
                ctxVar("resultStatus", "Result status"),
                ctxVar("reportReleaseStatus", "Report release status"),
                ctxVar("reportPdfFileId", "Generated report PDF file ID")));
        // rank / percentile are intentionally NOT advertised. AssessmentTriggerContextBuilder
        // can carry them, but no emit site computes them today, so listing them would offer an
        // admin a token that always resolves empty. Add them here the day a call site fills
        // them in — not before.

        // Registration form submissions carry the registrant, but no attempt yet.
        List<Map<String, String>> formSubmission = new ArrayList<>(assessment);
        formSubmission.addAll(List.of(
                ctxVar("registrationId", "Registration ID"),
                ctxVar("userId", "Registrant user ID"),
                ctxVar("studentName", "Registrant name"),
                ctxVar("studentEmail", "Registrant email"),
                ctxVar("studentMobile", "Registrant mobile"),
                ctxVar("username", "Registrant username"),
                ctxVar("registrationSource", "Registration source (e.g. OPEN_REGISTRATION)")));

        // Learner identity without an attempt — these events are per-learner but fire before
        // (reminder) or outside (reattempt grant) any single attempt.
        List<Map<String, String>> assessmentLearner = new ArrayList<>(assessment);
        assessmentLearner.addAll(List.of(
                ctxVar("registrationId", "Registration ID"),
                ctxVar("userId", "Learner user ID"),
                ctxVar("studentName", "Learner name"),
                ctxVar("studentEmail", "Learner email"),
                ctxVar("studentMobile", "Learner mobile"),
                ctxVar("username", "Learner username")));

        List<Map<String, String>> reminder = new ArrayList<>(assessmentLearner);
        reminder.addAll(List.of(
                ctxVar("minutesToStart", "Minutes until this assessment opens"),
                ctxVar("reminderWindowMinutes", "Look-ahead window of the reminder sweep")));

        List<Map<String, String>> reattemptGranted = new ArrayList<>(assessmentLearner);
        reattemptGranted.addAll(List.of(
                ctxVar("attemptsGranted", "How many attempts this grant added"),
                ctxVar("attemptsAllowed", "Total attempts the learner is now allowed"),
                ctxVar("attemptsRemaining", "Attempts left (allowed minus attempts already taken)"),
                ctxVar("grantedBy", "User ID of the admin who granted them")));

        List<Map<String, String>> reattemptRequested = new ArrayList<>(assessmentLearner);
        reattemptRequested.addAll(List.of(
                ctxVar("requestId", "ID of the request, for the review link"),
                ctxVar("requestType", "REATTEMPT or TIME_INCREASE"),
                ctxVar("requestReason", "What the learner typed as their reason"),
                ctxVar("requestStatus", "Status of the request (PENDING when raised)"),
                ctxVar("attemptId", "Attempt they were on, when known"),
                ctxVar("attemptsAllowed", "Total attempts the learner is currently allowed"),
                ctxVar("attemptsRemaining", "Attempts left (allowed minus attempts already taken)")));

        // ASSESSMENT_CREATE fires on the very first save of a brand-new draft row, before any
        // batch is registered to it, so the batch tokens are always absent there. Offering
        // them would hand an admin a token that is guaranteed empty for this event.
        List<Map<String, String>> assessmentCreated = new ArrayList<>(assessment.stream()
                .filter(v -> !BATCH_KEYS.contains(v.get("key")))
                .toList());
        assessmentCreated.add(ctxVar("createdBy", "User ID of the admin who created it"));

        List<Map<String, String>> assessmentPublished = new ArrayList<>(assessment);
        assessmentPublished.add(ctxVar("publishedBy", "User ID of the admin who published it"));

        Map<String, List<Map<String, String>>> out = new LinkedHashMap<>();
        out.put(WorkflowTriggerEvent.LEAD_ASSIGNED_TO_COUNSELOR.name(), base);
        out.put(WorkflowTriggerEvent.LEAD_TAT_REMINDER_BEFORE.name(), sla);
        out.put(WorkflowTriggerEvent.LEAD_TAT_OVERDUE.name(), sla);
        out.put(WorkflowTriggerEvent.FOLLOW_UP_DUE.name(), sla);
        out.put(WorkflowTriggerEvent.FOLLOW_UP_OVERDUE.name(), sla);
        out.put(WorkflowTriggerEvent.LEAD_STATUS_CHANGED.name(), status);
        out.put(WorkflowTriggerEvent.ASSESSMENT_CREATE.name(), assessmentCreated);
        out.put(WorkflowTriggerEvent.ASSESSMENT_PUBLISHED.name(), assessmentPublished);
        out.put(WorkflowTriggerEvent.ASSESSMENT_START.name(), attemptStart);
        out.put(WorkflowTriggerEvent.ASSESSMENT_END.name(), attemptEnd);
        out.put(WorkflowTriggerEvent.ASSESSMENT_FORM_SUBMISSION.name(), formSubmission);
        out.put(WorkflowTriggerEvent.ASSESSMENT_RESULT_RELEASED.name(), result);
        out.put(WorkflowTriggerEvent.ASSESSMENT_REMINDER_BEFORE_START.name(), reminder);
        out.put(WorkflowTriggerEvent.ASSESSMENT_REATTEMPT_GRANTED.name(), reattemptGranted);
        out.put(WorkflowTriggerEvent.ASSESSMENT_REATTEMPT_REQUESTED.name(), reattemptRequested);
        List<Map<String, String>> aiBatch = new ArrayList<>(assessment);
        aiBatch.addAll(List.of(
                ctxVar("batchId", "ID of the bulk upload, for the results link"),
                ctxVar("totalCopies", "Copies in the upload"),
                ctxVar("checkedCopies", "Copies the AI checked"),
                ctxVar("failedCopies", "Copies that could not be checked"),
                ctxVar("copiesNeedingReview", "Copies waiting for an admin to pick the student"),
                ctxVar("batchStatus", "COMPLETED or NEEDS_REVIEW"),
                ctxVar("startedBy", "User ID of the admin who uploaded the copies")));
        out.put(WorkflowTriggerEvent.ASSESSMENT_AI_EVALUATION_COMPLETED.name(), aiBatch);
        return ResponseEntity.ok(out);
    }

    /** Batch/package-session tokens, absent on events that fire before any batch is attached. */
    private static final List<String> BATCH_KEYS =
            List.of("batchId", "packageSessionId", "batchIds", "packageSessionIds");

    private static Map<String, String> ctxVar(String key, String label) {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("key", key);
        m.put("label", label);
        return m;
    }

    @GetMapping("/actions")
    public ResponseEntity<List<CatalogItemDTO>> getActionTypes() {
        List<CatalogItemDTO> actions = List.of(
            CatalogItemDTO.builder()
                .key("ITERATOR")
                .label("Loop Over Items")
                .description("Iterate over a collection and perform an operation on each item")
                .category("Logic")
                .requiredParams(List.of("on", "forEach"))
                .build(),
            CatalogItemDTO.builder()
                .key("ACTIVATE_ENROLLMENT")
                .label("Activate Enrollment")
                .description("Activate a student's enrollment status")
                .category("Enrollment")
                .requiredParams(List.of("enrollmentId"))
                .build(),
            CatalogItemDTO.builder()
                .key("SWITCH")
                .label("Conditional Branch")
                .description("Route to different paths based on a condition")
                .category("Logic")
                .requiredParams(List.of("condition", "cases"))
                .build()
        );
        return ResponseEntity.ok(actions);
    }
}
