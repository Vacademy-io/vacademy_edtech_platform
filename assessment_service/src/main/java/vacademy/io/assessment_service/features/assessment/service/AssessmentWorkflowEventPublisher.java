package vacademy.io.assessment_service.features.assessment.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentReattemptRequest;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.SectionRepository;
import vacademy.io.assessment_service.features.open_evaluation.policy.ApiCandidatePolicy;
import vacademy.io.assessment_service.features.open_evaluation.policy.ApiInstituteFlags;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Single entry point for every assessment workflow trigger emit.
 *
 * <p>Assessment events fire from more than one place — ASSESSMENT_END from both the learner
 * submit path and the attempt-expiry scheduler, RESULT_RELEASED from both the auto-release
 * cron and the admin's manual release. Routing them all through here keeps three things
 * from drifting apart across those call sites: the context key set (built by
 * {@link AssessmentTriggerContextBuilder}), the null guards on half-populated entities, and
 * the rule that a trigger failure must never break the assessment flow it was observing.
 *
 * <p>Every method here swallows its own exceptions. Callers do not need a try/catch.
 */
@Slf4j
@Service
public class AssessmentWorkflowEventPublisher {

    public static final String ASSESSMENT_CREATE = "ASSESSMENT_CREATE";
    public static final String ASSESSMENT_PUBLISHED = "ASSESSMENT_PUBLISHED";
    public static final String ASSESSMENT_START = "ASSESSMENT_START";
    public static final String ASSESSMENT_END = "ASSESSMENT_END";
    public static final String ASSESSMENT_FORM_SUBMISSION = "ASSESSMENT_FORM_SUBMISSION";
    public static final String ASSESSMENT_RESULT_RELEASED = "ASSESSMENT_RESULT_RELEASED";
    public static final String ASSESSMENT_REMINDER_BEFORE_START = "ASSESSMENT_REMINDER_BEFORE_START";
    public static final String ASSESSMENT_REATTEMPT_GRANTED = "ASSESSMENT_REATTEMPT_GRANTED";
    public static final String ASSESSMENT_REATTEMPT_REQUESTED = "ASSESSMENT_REATTEMPT_REQUESTED";
    public static final String ASSESSMENT_AI_EVALUATION_COMPLETED = "ASSESSMENT_AI_EVALUATION_COMPLETED";

    @Autowired
    WorkflowTriggerClient workflowTriggerClient;

    @Autowired
    AssessmentTriggerContextBuilder contextBuilder;

    @Autowired
    SectionRepository sectionRepository;

    /** Per-institute fire_workflow_events of the partner API; null in unit tests. */
    @Autowired(required = false)
    ApiInstituteFlags apiInstituteFlags;

    /** Fires ASSESSMENT_CREATE when an assessment row is first saved (as a DRAFT). */
    public void publishAssessmentCreated(Assessment assessment, String instituteId, String createdByUserId) {
        if (assessment == null || instituteId == null) {
            return;
        }
        if (suppressedForApiExam(assessment, instituteId, ASSESSMENT_CREATE)) {
            return;
        }
        Map<String, Object> ctx = contextBuilder.forAssessment(assessment, instituteId);
        putIfPresent(ctx, "createdBy", createdByUserId);
        emit(ASSESSMENT_CREATE, assessment.getId(), instituteId, ctx);
    }

    /**
     * Fires ASSESSMENT_PUBLISHED on the DRAFT -> PUBLISHED transition.
     *
     * <p>ASSESSMENT_CREATE fires when the draft row is saved, before sections or questions
     * exist, so it is the wrong hook for "tell learners a new test is available". This is
     * the point at which the assessment is actually visible to them.
     */
    public void publishAssessmentPublished(Assessment assessment, String instituteId, String publishedByUserId) {
        if (assessment == null || instituteId == null) {
            return;
        }
        if (suppressedForApiExam(assessment, instituteId, ASSESSMENT_PUBLISHED)) {
            return;
        }
        Map<String, Object> ctx = contextBuilder.forAssessment(assessment, instituteId);
        putIfPresent(ctx, "publishedBy", publishedByUserId);
        emit(ASSESSMENT_PUBLISHED, assessment.getId(), instituteId, ctx);
    }

    /**
     * Fires ASSESSMENT_START when a learner opens an assessment and an attempt row is created.
     *
     * <p>Note this is attempt creation, which puts the attempt in PREVIEW — the learner has
     * opened the assessment, not necessarily begun answering.
     */
    public void publishAssessmentStart(StudentAttempt attempt, Assessment assessment, String instituteId) {
        if (attempt == null || assessment == null || instituteId == null) {
            return;
        }
        if (suppressedForApiExam(assessment, instituteId, ASSESSMENT_START)) {
            return;
        }
        emit(ASSESSMENT_START, assessment.getId(), instituteId,
                contextBuilder.forAttempt(attempt, assessment, instituteId));
    }

    /**
     * Fires ASSESSMENT_END for a finished attempt.
     *
     * <p>Called from the learner submit path AND from the attempt-expiry scheduler. Before
     * the scheduler was wired up, an attempt that ran out of time ended silently — the very
     * learners most worth following up with were the ones no workflow ever saw.
     *
     * @param endSource SUBMITTED when the learner pressed submit, TIME_EXPIRED when the
     *                  scheduler closed the attempt. Workflows branch on this to word the
     *                  message differently.
     */
    public void publishAssessmentEnd(StudentAttempt attempt, String endSource) {
        Assessment assessment = assessmentOf(attempt);
        String instituteId = instituteIdOf(attempt);
        if (assessment == null || instituteId == null) {
            log.debug("Skipping ASSESSMENT_END emit — no assessment/institute resolvable for attempt {}",
                    safeAttemptId(attempt));
            return;
        }
        if (suppressedForApiExam(assessment, instituteId, ASSESSMENT_END)) {
            return;
        }
        Map<String, Object> ctx = contextBuilder.forAttempt(attempt, assessment, instituteId);
        ctx.put("endSource", endSource);
        emit(ASSESSMENT_END, assessment.getId(), instituteId, ctx);
    }

    /**
     * Fires ASSESSMENT_RESULT_RELEASED once a learner is actually allowed to see their score.
     *
     * <p>Distinct from ASSESSMENT_END: on a MANUAL / AI-evaluated assessment the gap between
     * the two is however long grading takes, and "your result is out" is the notification
     * learners are actually waiting on.
     *
     * @param rank       optional; pass null when not computed
     * @param percentile optional; pass null when not computed
     */
    public void publishResultReleased(StudentAttempt attempt, Integer rank, Double percentile) {
        Assessment assessment = assessmentOf(attempt);
        String instituteId = instituteIdOf(attempt);
        if (assessment == null || instituteId == null) {
            log.debug("Skipping ASSESSMENT_RESULT_RELEASED emit — no assessment/institute resolvable for attempt {}",
                    safeAttemptId(attempt));
            return;
        }
        if (suppressedForApiExam(assessment, instituteId, ASSESSMENT_RESULT_RELEASED)) {
            return;
        }
        Map<String, Object> ctx = contextBuilder.forResult(attempt, assessment, instituteId,
                totalAchievableMarks(assessment.getId()), rank, percentile);
        emit(ASSESSMENT_RESULT_RELEASED, assessment.getId(), instituteId, ctx);
    }

    /**
     * Batch variant of {@link #publishResultReleased}. The auto-release cron releases many
     * attempts at once, so the per-assessment total-marks lookup is resolved once and reused
     * rather than re-queried per learner.
     */
    public void publishResultReleased(List<StudentAttempt> attempts) {
        if (attempts == null || attempts.isEmpty()) {
            return;
        }
        Map<String, Double> totalMarksByAssessment = new HashMap<>();
        for (StudentAttempt attempt : attempts) {
            try {
                Assessment assessment = assessmentOf(attempt);
                String instituteId = instituteIdOf(attempt);
                if (assessment == null || instituteId == null) {
                    continue;
                }
                if (suppressedForApiExam(assessment, instituteId, ASSESSMENT_RESULT_RELEASED)) {
                    continue;
                }
                // Not computeIfAbsent: totalAchievableMarks returns null for an assessment
                // with no live sections, and computeIfAbsent does not store a null mapping —
                // so every attempt on that assessment would re-run the section query, which
                // is the exact N+1 this batch method exists to avoid.
                String assessmentId = assessment.getId();
                if (!totalMarksByAssessment.containsKey(assessmentId)) {
                    totalMarksByAssessment.put(assessmentId, totalAchievableMarks(assessmentId));
                }
                Double total = totalMarksByAssessment.get(assessmentId);
                Map<String, Object> ctx = contextBuilder.forResult(attempt, assessment, instituteId,
                        total, null, null);
                emit(ASSESSMENT_RESULT_RELEASED, assessment.getId(), instituteId, ctx);
            } catch (Exception e) {
                log.warn("Failed to emit ASSESSMENT_RESULT_RELEASED for attempt {}: {}",
                        safeAttemptId(attempt), e.getMessage());
            }
        }
    }

    /**
     * Fires ASSESSMENT_FORM_SUBMISSION when someone registers themselves through an
     * assessment's public registration form (OPEN_REGISTRATION).
     *
     * <p>The event name has been advertised in the admin trigger catalog since the workflow
     * feature shipped, but nothing emitted it — a workflow built on it silently never ran.
     */
    public void publishFormSubmission(AssessmentUserRegistration registration, Assessment assessment) {
        if (registration == null || assessment == null) {
            return;
        }
        String instituteId = registration.getInstituteId();
        if (instituteId == null) {
            log.debug("Skipping ASSESSMENT_FORM_SUBMISSION emit — no institute on registration {}",
                    registration.getId());
            return;
        }
        if (suppressedForApiExam(assessment, instituteId, ASSESSMENT_FORM_SUBMISSION)) {
            return;
        }
        Map<String, Object> ctx = contextBuilder.forAssessment(assessment, instituteId);
        putRegistrant(ctx, registration);
        putIfPresent(ctx, "registrationSource", registration.getSource());
        emit(ASSESSMENT_FORM_SUBMISSION, assessment.getId(), instituteId, ctx);
    }

    /**
     * Fires ASSESSMENT_REMINDER_BEFORE_START, once per registered learner, for an assessment
     * that is about to open.
     *
     * <p>Emitted per learner rather than per assessment on purpose: the engine's SpEL has no
     * way to iterate a list, so a workflow that has to reach each learner individually needs
     * their name and email already on the context.
     *
     * <p><b>Repeat protection is the trigger's job, not this method's.</b> The upstream scan
     * is a time-window sweep ("assessments starting within N minutes"), exactly like the
     * built-in reminder email, so a second sweep inside the same window sees the same
     * assessments again. ASSESSMENT_REMINDER_BEFORE_START therefore defaults to
     * CONTEXT_BASED idempotency over assessmentId + userId in admin_core (see
     * {@code WorkflowBuilderService.defaultIdempotencyFor}) — which is also why this emits
     * per learner rather than once per assessment: an EVENT_BASED key over
     * eventId = assessmentId would collapse the whole cohort into one execution.
     *
     * @param reminderWindowMinutes the sweep's look-ahead window (SCHEDULING_TIME_FRAME), i.e.
     *                              how far out the scan looks — NOT how far out this
     *                              particular assessment is. The actual countdown is derived
     *                              per assessment below.
     */
    public void publishReminderBeforeStart(Assessment assessment, List<AssessmentUserRegistration> registrations,
                                           Integer reminderWindowMinutes) {
        if (assessment == null || registrations == null || registrations.isEmpty()) {
            return;
        }
        // The sweep returns everything starting within the window, so the window bound is NOT
        // this assessment's countdown — an assessment opening in 3 minutes surfaces on a
        // 30-minute sweep. Emitting the bound as minutesToStart would put "starts in 30
        // minutes" into a reminder for a test starting in 3.
        Integer minutesToStart = minutesUntil(assessment.getBoundStartTime());
        for (AssessmentUserRegistration registration : registrations) {
            try {
                String instituteId = registration != null ? registration.getInstituteId() : null;
                if (instituteId == null) {
                    continue;
                }
                if (suppressedForApiExam(assessment, instituteId, ASSESSMENT_REMINDER_BEFORE_START)) {
                    continue;
                }
                Map<String, Object> ctx = contextBuilder.forAssessment(assessment, instituteId);
                putRegistrant(ctx, registration);
                putIfPresent(ctx, "minutesToStart", minutesToStart);
                putIfPresent(ctx, "reminderWindowMinutes", reminderWindowMinutes);
                emit(ASSESSMENT_REMINDER_BEFORE_START, assessment.getId(), instituteId, ctx);
            } catch (Exception e) {
                log.warn("Failed to emit ASSESSMENT_REMINDER_BEFORE_START for assessment {}: {}",
                        assessment.getId(), e.getMessage());
            }
        }
    }

    /**
     * Fires ASSESSMENT_REATTEMPT_GRANTED, once per learner, when an admin grants extra
     * attempts. Emitted per learner because the point of the event is telling that learner
     * they have another shot — and because attemptsRemaining differs per registration.
     *
     * @param attemptsGranted how many attempts this grant added
     */
    public void publishReattemptGranted(List<AssessmentUserRegistration> registrations, Assessment assessment,
                                        int attemptsGranted, String grantedByUserId) {
        if (assessment == null || registrations == null || registrations.isEmpty()) {
            return;
        }
        for (AssessmentUserRegistration registration : registrations) {
            try {
                String instituteId = registration != null ? registration.getInstituteId() : null;
                if (instituteId == null) {
                    continue;
                }
                if (suppressedForApiExam(assessment, instituteId, ASSESSMENT_REATTEMPT_GRANTED)) {
                    continue;
                }
                Map<String, Object> ctx = contextBuilder.forAssessment(assessment, instituteId);
                putRegistrant(ctx, registration);
                ctx.put("attemptsGranted", attemptsGranted);
                // reattemptCount is the learner's TOTAL allowance, not what is left — the
                // platform derives "remaining" as allowance minus attempts already taken
                // (AssessmentPublicPageManager). Emitting the raw count as attemptsRemaining
                // would tell a learner who has already used two tries that they have more
                // left than they do.
                putIfPresent(ctx, "attemptsAllowed", registration.getReattemptCount());
                putIfPresent(ctx, "attemptsRemaining", attemptsRemaining(registration));
                putIfPresent(ctx, "grantedBy", grantedByUserId);
                emit(ASSESSMENT_REATTEMPT_GRANTED, assessment.getId(), instituteId, ctx);
            } catch (Exception e) {
                log.warn("Failed to emit ASSESSMENT_REATTEMPT_GRANTED for assessment {}: {}",
                        assessment.getId(), e.getMessage());
            }
        }
    }

    /**
     * Fires ASSESSMENT_REATTEMPT_REQUESTED when a learner asks for another attempt or more time.
     *
     * <p>This is the admin-facing half of the reattempt loop. ASSESSMENT_REATTEMPT_GRANTED tells
     * the learner they have another try; this one tells staff a learner is waiting — which is the
     * event worth wiring to email / WhatsApp / push, because the learner raising it is usually
     * locked out of a paper right now and the answer is time-critical.
     *
     * <p>Emitted even when the learner has no registration row: they may be asking precisely
     * because they could not get into the assessment, and that is the case most worth escalating.
     */
    public void publishReattemptRequested(AssessmentReattemptRequest request, Assessment assessment,
                                          AssessmentUserRegistration registration) {
        if (request == null || request.getInstituteId() == null) {
            return;
        }
        try {
            String instituteId = request.getInstituteId();
            if (suppressedForApiExam(assessment, instituteId, ASSESSMENT_REATTEMPT_REQUESTED)) {
                return;
            }
            Map<String, Object> ctx = assessment != null
                    ? contextBuilder.forAssessment(assessment, instituteId)
                    : new HashMap<>();
            if (registration != null) {
                putRegistrant(ctx, registration);
                putIfPresent(ctx, "attemptsAllowed", registration.getReattemptCount());
                putIfPresent(ctx, "attemptsRemaining", attemptsRemaining(registration));
            } else {
                // No registration to read contact details from, but the workflow still needs to
                // know who asked.
                putIfPresent(ctx, "userId", request.getUserId());
            }
            putIfPresent(ctx, "requestId", request.getId());
            putIfPresent(ctx, "requestType", request.getRequestType());
            putIfPresent(ctx, "requestReason", request.getReason());
            putIfPresent(ctx, "requestStatus", request.getStatus());
            putIfPresent(ctx, "attemptId", request.getAttemptId());
            emit(ASSESSMENT_REATTEMPT_REQUESTED, request.getAssessmentId(), instituteId, ctx);
        } catch (Exception e) {
            log.warn("Failed to emit ASSESSMENT_REATTEMPT_REQUESTED for assessment {}: {}",
                    request.getAssessmentId(), e.getMessage());
        }
    }

    // ------------------------------------------------------------------ helpers

    /**
     * Exams created through the partner API fire no institute workflow event unless the
     * institute opted in ({@code institute_api_access.fire_workflow_events}, spec 12 item 6):
     * those automations would message API candidates, who have no login and blank
     * channels. Dashboard exams are never affected.
     */
    private boolean suppressedForApiExam(Assessment assessment, String instituteId, String eventName) {
        if (!ApiCandidatePolicy.isApiExam(assessment)) {
            return false;
        }
        try {
            if (ApiCandidatePolicy.workflowEventsAllowed(assessment, instituteId, apiInstituteFlags)) {
                return false;
            }
        } catch (Exception e) {
            // Policy failure must not break the flow; for an API exam, fail quiet (suppress).
            log.debug("Workflow policy check failed for {}: {}", eventName, e.getMessage());
        }
        log.debug("Skipping {} for API exam {} (institute has not opted in to workflow events)",
                eventName, assessment.getId());
        return true;
    }

    /**
     * Whole minutes from now until {@code when}, or null if unknown. Floored at 0 so an
     * assessment that has just crossed its start time never reports a negative countdown.
     */
    private Integer minutesUntil(java.util.Date when) {
        if (when == null) {
            return null;
        }
        long millis = when.getTime() - System.currentTimeMillis();
        return (int) Math.max(0, millis / 60000L);
    }

    /**
     * Attempts the learner has left, using the same arithmetic the learner-facing API uses:
     * total allowance minus attempts already taken. Returns null when the allowance is unset
     * (nothing meaningful to say) and never returns a negative.
     *
     * <p>studentAttempts is a LAZY collection, so this is guarded — callers emit from inside
     * their own transaction, but a missing count should cost one key, not the whole event.
     */
    private Integer attemptsRemaining(AssessmentUserRegistration registration) {
        try {
            Integer allowed = registration.getReattemptCount();
            if (allowed == null) {
                return null;
            }
            int taken = registration.getStudentAttempts() != null ? registration.getStudentAttempts().size() : 0;
            return Math.max(0, allowed - taken);
        } catch (Exception e) {
            log.debug("Could not resolve remaining attempts for registration {}: {}",
                    registration.getId(), e.getMessage());
            return null;
        }
    }

    /**
     * Learner identity keys, under the same names {@link AssessmentTriggerContextBuilder}
     * uses on attempt-scoped events, so a workflow author writes {@code #ctx['studentEmail']}
     * regardless of which assessment event they hung it off.
     */
    private void putRegistrant(Map<String, Object> ctx, AssessmentUserRegistration registration) {
        putIfPresent(ctx, "registrationId", registration.getId());
        putIfPresent(ctx, "userId", registration.getUserId());
        putIfPresent(ctx, "studentName", registration.getParticipantName());
        putIfPresent(ctx, "studentEmail", registration.getUserEmail());
        putIfPresent(ctx, "studentMobile", registration.getPhoneNumber());
        putIfPresent(ctx, "username", registration.getUsername());
    }

    /**
     * Fires ASSESSMENT_AI_EVALUATION_COMPLETED when a bulk AI copy-check batch
     * finishes - every uploaded copy is graded, failed, or waiting for a person.
     * Lets an institute wire "email the coordinator" / "post to the staff group"
     * automations to it; the counts ride along for the message.
     */
    public void publishAiEvaluationBatchCompleted(Assessment assessment, String instituteId,
                                                  String batchId, Map<String, Object> counts) {
        if (assessment == null || instituteId == null) {
            return;
        }
        if (suppressedForApiExam(assessment, instituteId, ASSESSMENT_AI_EVALUATION_COMPLETED)) {
            return;
        }
        Map<String, Object> ctx = contextBuilder.forAssessment(assessment, instituteId);
        putIfPresent(ctx, "batchId", batchId);
        if (counts != null) {
            ctx.putAll(counts);
        }
        emit(ASSESSMENT_AI_EVALUATION_COMPLETED, assessment.getId(), instituteId, ctx);
    }

    private void emit(String eventName, String assessmentId, String instituteId, Map<String, Object> ctx) {
        try {
            workflowTriggerClient.triggerEvent(eventName, assessmentId, instituteId, ctx);
        } catch (Exception e) {
            // The client is already async and self-guarding; this catches the bean-level
            // failure modes (proxy not initialised, rejected execution) so an emit can
            // never propagate into the assessment flow that called it.
            log.warn("Failed to trigger workflow event {} for assessment {}: {}",
                    eventName, assessmentId, e.getMessage());
        }
    }

    /**
     * Sum of every live section's marks. Mirrors the admin "total achievable marks" endpoint
     * so a learner's percentage in a notification matches what the dashboard shows.
     */
    private Double totalAchievableMarks(String assessmentId) {
        try {
            List<Section> sections = sectionRepository.findByAssessmentIdAndStatusNotIn(assessmentId,
                    List.of("DELETED"));
            if (sections == null || sections.isEmpty()) {
                return null;
            }
            double total = 0.0;
            for (Section section : sections) {
                if (section != null && section.getTotalMarks() != null) {
                    total += section.getTotalMarks();
                }
            }
            return total;
        } catch (Exception e) {
            log.debug("Could not resolve total marks for assessment {}: {}", assessmentId, e.getMessage());
            return null;
        }
    }

    private Assessment assessmentOf(StudentAttempt attempt) {
        try {
            if (attempt == null || attempt.getRegistration() == null) {
                return null;
            }
            return attempt.getRegistration().getAssessment();
        } catch (Exception e) {
            log.debug("Could not resolve assessment for attempt {}: {}", safeAttemptId(attempt), e.getMessage());
            return null;
        }
    }

    private String instituteIdOf(StudentAttempt attempt) {
        try {
            if (attempt == null || attempt.getRegistration() == null) {
                return null;
            }
            return attempt.getRegistration().getInstituteId();
        } catch (Exception e) {
            log.debug("Could not resolve institute for attempt {}: {}", safeAttemptId(attempt), e.getMessage());
            return null;
        }
    }

    private void putIfPresent(Map<String, Object> ctx, String key, Object value) {
        if (value != null) {
            ctx.put(key, value);
        }
    }

    private String safeAttemptId(StudentAttempt attempt) {
        try {
            return attempt != null ? attempt.getId() : null;
        } catch (Exception e) {
            return null;
        }
    }
}
