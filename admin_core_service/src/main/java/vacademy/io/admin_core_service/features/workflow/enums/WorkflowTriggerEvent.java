package vacademy.io.admin_core_service.features.workflow.enums;

public enum WorkflowTriggerEvent {
    // Existing - Enrollment
    LEARNER_BATCH_ENROLLMENT,
    GENERATE_ADMIN_LOGIN_URL_FOR_LEARNER_PORTAL,
    SEND_LEARNER_CREDENTIALS,
    SUB_ORG_MEMBER_ENROLLMENT,
    SUB_ORG_MEMBER_TERMINATION,

    // Existing - Audience / CRM
    AUDIENCE_LEAD_SUBMISSION,
    AUDIENCE_OPT_OUT,

    // Existing - Fee
    INSTALLMENT_DUE_REMINDER,

    // Live Session
    LIVE_SESSION_CREATE,
    LIVE_SESSION_START,
    LIVE_SESSION_END,
    LIVE_SESSION_FORM_SUBMISSION,

    // Payment
    PAYMENT_FAILED,
    PAYMENT_SUCCESS,
    ABANDONED_CART,

    // Subscription / plan lifecycle
    SUBSCRIPTION_CANCELLED,
    SUBSCRIPTION_TERMINATED,
    LEARNER_RE_ENROLLMENT,
    // Fired once a plan change is actually APPLIED to the user_plan — after the upgrade
    // payment clears, after a scheduled downgrade takes effect at renewal, or immediately
    // on an admin override. Keyed by eventId = enrollInviteId (the NEW one on a
    // cross-option move), falling back to instituteId.
    SUBSCRIPTION_PLAN_CHANGED,

    // Fired when an admin makes a learner INACTIVE in a package session
    // (institute_learner MAKE_INACTIVE operation). Keyed by eventId = packageSessionId.
    LEARNER_TERMINATION,

    // LMS / content / engagement
    COURSE_CREATED,
    DOUBT_RAISED,
    ASSIGNMENT_SUBMITTED,

    // Invites
    INVITE_CREATE,
    INVITE_FORM_FILL,

    // CRM
    MEMBERSHIP_EXPIRY,
    ENROLLMENT_REPORTS,

    // Lead TAT / Follow-up SLA (emit-only; delivery handled by the workflow engine)
    LEAD_ASSIGNED_TO_COUNSELOR,
    LEAD_TAT_REMINDER_BEFORE,
    LEAD_TAT_OVERDUE,
    FOLLOW_UP_DUE,
    FOLLOW_UP_OVERDUE,
    LEAD_STATUS_CHANGED,
    // Fired when an inbound AI call is received (lead dialed our AI line — detected by
    // a campaign id tagged INBOUND in AI_CALLING_SETTING). Keyed by eventId = responseId.
    LEAD_CALLED_BACK,

    // Assessment (cross-service via internal HTTP). All keyed by eventId = assessmentId.
    ASSESSMENT_CREATE,
    // DRAFT -> PUBLISHED. ASSESSMENT_CREATE fires on the draft save, before sections and
    // questions exist, so this is the correct hook for "a new test is available".
    ASSESSMENT_PUBLISHED,
    ASSESSMENT_START,
    ASSESSMENT_END,
    ASSESSMENT_FORM_SUBMISSION,
    // Fired when a learner's report actually becomes visible to them — auto-release
    // (AUTO_AFTER_SUBMISSION / AUTO_AFTER_ASSESSMENT_END) or an admin's manual release.
    // On MANUAL/AI-evaluated assessments this can be long after ASSESSMENT_END.
    ASSESSMENT_RESULT_RELEASED,
    // Emitted per registered learner by the "assessments starting soon" sweep in
    // assessment_service. Because it is a repeating scan that emits per learner while keying
    // eventId to the assessment, it defaults to CONTEXT_BASED idempotency over
    // assessmentId + userId — see WorkflowBuilderService.defaultIdempotencyFor.
    ASSESSMENT_REMINDER_BEFORE_START,
    // Emitted per learner when an admin grants extra attempts from the participants screen.
    ASSESSMENT_REATTEMPT_GRANTED,
    // Emitted when a LEARNER asks for another attempt (or more time) from inside the exam
    // shell. This is the staff-facing half of the loop: the learner raising it is usually
    // locked out of a live paper, so it is the assessment event most worth routing to email /
    // WhatsApp / push rather than leaving in an inbox nobody refreshes.
    ASSESSMENT_REATTEMPT_REQUESTED,
    // A bulk AI copy-check (uploaded scanned copies) finished: every copy graded,
    // failed, or waiting for an admin to pick the student. Fired by assessment_service.
    ASSESSMENT_AI_EVALUATION_COMPLETED,

    // Onboarding. STEP_* are keyed by eventId = onboarding_step.id (the step definition,
    // not the instance) so admins can target a specific step from the trigger config UI.
    ONBOARDING_FLOW_STARTED,
    ONBOARDING_FLOW_COMPLETED,
    ONBOARDING_STEP_ENTERED,
    ONBOARDING_STEP_COMPLETED,
    ONBOARDING_STEP_SKIPPED,

    /**
     * HR & Payroll events (Phase F5) — institutes attach approval/notification/
     * escalation workflows to these; HR's own emails remain as direct sends,
     * these enable AUTOMATION on top.
     */
    HR_LEAVE_REQUESTED,
    HR_LEAVE_DECIDED,
    HR_COMP_OFF_DECIDED,
    HR_LOAN_REQUESTED,
    HR_LOAN_DECIDED,
    HR_REIMBURSEMENT_REQUESTED,
    HR_REIMBURSEMENT_DECIDED,
    HR_PAYROLL_PROCESSED,
    HR_PAYROLL_APPROVED,
    HR_PAYROLL_PAID,
    HR_EMPLOYEE_STATUS_CHANGED
}

