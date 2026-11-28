package vacademy.io.assessment_service.features.assessment.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentBatchRegistration;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.enums.UserRegistrationSources;

import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Builds the {@code contextData} map carried by every assessment workflow trigger.
 *
 * <p>The workflow engine reads these values dynamically via SpEL ({@code #ctx['attemptId']}),
 * so the map itself needs no schema. What it DOES need is to be complete and consistent —
 * an admin configuring a notification picks tokens from
 * {@code GET /trigger-catalog/trigger-context-variables}, and that catalog is only truthful
 * if every emit site produces the same key set. Hence one builder rather than an ad-hoc
 * map per call site.
 *
 * <p>Two rules govern what goes in here:
 * <ul>
 *   <li><b>Flat and pre-computed.</b> SpEL in this engine has no lambdas, no streams and no
 *       way to flatten nested structures, so a workflow author cannot unpack
 *       {@code student.profile.name} or divide marks by total. Ship {@code studentName} and
 *       {@code percentage} already resolved.</li>
 *   <li><b>Never throw.</b> Every emit site wraps this in a try/catch, but a context builder
 *       that throws on a detached entity would still turn a lazy-loading accident into a
 *       swallowed exception and an empty notification. Each accessor is individually guarded
 *       so one unreadable field costs one key, not the whole map.</li>
 * </ul>
 *
 * <p><b>Batch scoping:</b> {@code batchId} and {@code packageSessionId} carry the same value.
 * In this domain an assessment "batch" IS a package session (see
 * {@code RegisterAssessmentBatchesRequest}: "Registers EXISTING assessments to additional
 * batches (package_sessions)"). Both keys are emitted so a workflow author can use whichever
 * term the rest of their configuration uses — the same aliasing the CRM context does for
 * {@code leadName}/{@code parentName}.
 */
@Slf4j
@Service
public class AssessmentTriggerContextBuilder {

    /**
     * Base layer — every assessment event carries these.
     */
    public Map<String, Object> forAssessment(Assessment assessment, String instituteId) {
        Map<String, Object> ctx = new LinkedHashMap<>();
        put(ctx, "instituteId", instituteId);
        if (assessment == null) {
            return ctx;
        }
        put(ctx, "assessmentId", assessment.getId());
        put(ctx, "assessmentName", assessment.getName());
        put(ctx, "assessmentType", assessment.getAssessmentType());
        // Distinct from assessmentType. The original ad-hoc ASSESSMENT_CREATE context put the
        // play mode under the "assessmentType" key; both are emitted under their correct names
        // so nothing a pre-existing workflow read has disappeared.
        put(ctx, "playMode", assessment.getPlayMode());
        put(ctx, "evaluationType", assessment.getEvaluationType());
        put(ctx, "assessmentStatus", assessment.getStatus());
        put(ctx, "resultType", assessment.getResultType());
        // "API" for exams created through the partner API, so an institute that opted in to
        // workflow events on them can branch (spec 12 item 7). Absent for dashboard exams.
        put(ctx, "assessmentSource", assessment.getSource());
        put(ctx, "boundStartTime", iso(assessment.getBoundStartTime()));
        put(ctx, "boundEndTime", iso(assessment.getBoundEndTime()));
        put(ctx, "durationMinutes", assessment.getDuration());
        addAssessmentBatchIds(ctx, assessment);
        return ctx;
    }

    /**
     * Attempt layer — base plus the learner and their attempt. Used by START / END /
     * EVALUATION_* / REPORT_READY.
     */
    public Map<String, Object> forAttempt(StudentAttempt attempt, Assessment assessment, String instituteId) {
        Map<String, Object> ctx = forAssessment(assessment, instituteId);
        if (attempt == null) {
            return ctx;
        }
        put(ctx, "attemptId", attempt.getId());
        put(ctx, "attemptNumber", attempt.getAttemptNumber());
        put(ctx, "attemptStatus", attempt.getStatus());
        put(ctx, "startTime", iso(attempt.getStartTime()));
        put(ctx, "submitTime", iso(attempt.getSubmitTime()));
        put(ctx, "totalTimeInSeconds", attempt.getTotalTimeInSeconds());

        AssessmentUserRegistration registration = registrationOf(attempt);
        if (registration != null) {
            put(ctx, "registrationId", registration.getId());
            put(ctx, "userId", registration.getUserId());
            put(ctx, "studentName", registration.getParticipantName());
            put(ctx, "studentEmail", registration.getUserEmail());
            put(ctx, "studentMobile", registration.getPhoneNumber());
            put(ctx, "username", registration.getUsername());
            // A batch-sourced registration stores its package_session id in source_id.
            // Overrides the assessment-level batch list with the learner's ACTUAL batch,
            // which is what a per-learner workflow needs to scope on.
            if (UserRegistrationSources.BATCH_PREVIEW_REGISTRATION.name().equals(registration.getSource())) {
                putBatch(ctx, registration.getSourceId());
            }
            // instituteId from the registration is more specific than the caller's when both
            // exist (the caller may pass a null on internal paths).
            if (registration.getInstituteId() != null) {
                put(ctx, "instituteId", registration.getInstituteId());
            }
        }
        return ctx;
    }

    /**
     * Result layer — attempt plus scoring and rank. Used by RESULT_RELEASED.
     * {@code rank} and {@code percentile} are optional; pass null when not computed.
     */
    public Map<String, Object> forResult(StudentAttempt attempt, Assessment assessment, String instituteId,
                                         Double totalPossibleMarks, Integer rank, Double percentile) {
        Map<String, Object> ctx = forAttempt(attempt, assessment, instituteId);
        if (attempt == null) {
            return ctx;
        }
        Double marks = attempt.getResultMarks() != null ? attempt.getResultMarks() : attempt.getTotalMarks();
        put(ctx, "marks", marks);
        put(ctx, "totalMarks", totalPossibleMarks);
        put(ctx, "percentage", percentage(marks, totalPossibleMarks));
        put(ctx, "resultStatus", attempt.getResultStatus());
        put(ctx, "reportReleaseStatus", attempt.getReportReleaseStatus());
        put(ctx, "reportPdfFileId", attempt.getReportPdfFileId());
        // The checked copy (AI-annotated or teacher-uploaded PDF). On a manual-result
        // test this is the only document a learner gets — there is no generated
        // report — so an automation needs it to link or attach anything.
        put(ctx, "checkedCopyFileId", attempt.getEvaluatedFileId());
        put(ctx, "rank", rank);
        put(ctx, "percentile", percentile);
        return ctx;
    }

    /**
     * Evaluation layer — attempt plus how it was graded. Used by EVALUATION_COMPLETED and
     * EVALUATION_NEEDS_REVIEW.
     *
     * @param evaluationSource one of AUTO / MANUAL / AI
     */
    public Map<String, Object> forEvaluation(StudentAttempt attempt, Assessment assessment, String instituteId,
                                             String evaluationSource, String processId,
                                             Integer failedCount, Integer lowConfidenceCount) {
        Map<String, Object> ctx = forAttempt(attempt, assessment, instituteId);
        put(ctx, "evaluationSource", evaluationSource);
        put(ctx, "processId", processId);
        put(ctx, "failedCount", failedCount);
        put(ctx, "lowConfidenceCount", lowConfidenceCount);
        return ctx;
    }

    // ------------------------------------------------------------------ helpers

    /**
     * Assessment-level batch ids. {@code Assessment.batchRegistrations} is EAGER, so this is
     * safe on a detached entity — but it is still guarded, because a future fetch-type change
     * must not turn every trigger emit into a LazyInitializationException.
     *
     * <p>Emits {@code batchIds} (all of them, for fan-out) and, when there is exactly one,
     * the singular {@code batchId}/{@code packageSessionId} so single-batch assessments —
     * the common case — can be scoped without list handling in SpEL.
     */
    private void addAssessmentBatchIds(Map<String, Object> ctx, Assessment assessment) {
        try {
            Set<AssessmentBatchRegistration> batchRegistrations = assessment.getBatchRegistrations();
            if (batchRegistrations == null || batchRegistrations.isEmpty()) {
                return;
            }
            List<String> batchIds = new ArrayList<>();
            for (AssessmentBatchRegistration registration : batchRegistrations) {
                if (registration != null && registration.getBatchId() != null) {
                    batchIds.add(registration.getBatchId());
                }
            }
            if (batchIds.isEmpty()) {
                return;
            }
            ctx.put("batchIds", batchIds);
            ctx.put("packageSessionIds", batchIds);
            if (batchIds.size() == 1) {
                putBatch(ctx, batchIds.get(0));
            }
        } catch (Exception e) {
            log.debug("Could not resolve batch registrations for assessment {}: {}",
                    safeId(assessment), e.getMessage());
        }
    }

    private AssessmentUserRegistration registrationOf(StudentAttempt attempt) {
        try {
            return attempt.getRegistration();
        } catch (Exception e) {
            log.debug("Could not resolve registration for attempt {}: {}", attempt.getId(), e.getMessage());
            return null;
        }
    }

    /** Writes the batch id under both names it is known by. */
    private void putBatch(Map<String, Object> ctx, String batchId) {
        put(ctx, "batchId", batchId);
        put(ctx, "packageSessionId", batchId);
    }

    /** Null values are omitted entirely — a missing key reads better in SpEL than a null one. */
    private void put(Map<String, Object> ctx, String key, Object value) {
        if (value != null) {
            ctx.put(key, value);
        }
    }

    private String iso(Date date) {
        if (date == null) {
            return null;
        }
        try {
            return DateTimeFormatter.ISO_INSTANT.format(date.toInstant());
        } catch (Exception e) {
            return null;
        }
    }

    private Double percentage(Double marks, Double total) {
        if (marks == null || total == null || total <= 0) {
            return null;
        }
        return Math.round((marks / total) * 10000.0) / 100.0;
    }

    private String safeId(Assessment assessment) {
        try {
            return assessment != null ? assessment.getId() : null;
        } catch (Exception e) {
            return null;
        }
    }
}
