package vacademy.io.admin_core_service.features.student_analysis.service.aggregation.collectors;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.learner_operation.repository.LearnerOperationRepository;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogRepository;
import vacademy.io.admin_core_service.features.student_analysis.dto.comprehensive.ProgressSection;

import java.sql.Date;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Collects course-progress metrics.
 *
 * <p>Completion percentages are sourced from the authoritative pre-computed
 * rollups in {@code learner_operation} (the same values the learner portal
 * shows): {@code PERCENTAGE_PACKAGE_SESSION_COMPLETED} for overall and
 * {@code PERCENTAGE_SUBJECT_COMPLETED} per subject. The subject list / names /
 * time-spent come from the activity-log CTE, which is also the fallback for any
 * subject that has no rollup row yet.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ProgressCollector {

    private final ActivityLogRepository activityLogRepository;
    private final LearnerOperationRepository learnerOperationRepository;
    private final ObjectMapper objectMapper;

    // learner_operation source / operation constants (see LearnerOperationSourceEnum / LearnerOperationEnum)
    private static final String SRC_PACKAGE_SESSION = "PACKAGE_SESSION";
    private static final String SRC_SUBJECT = "SUBJECT";
    private static final String OP_PACKAGE_SESSION_COMPLETED = "PERCENTAGE_PACKAGE_SESSION_COMPLETED";
    private static final String OP_SUBJECT_COMPLETED = "PERCENTAGE_SUBJECT_COMPLETED";

    private static final List<String> ACTIVE_STATUS = Arrays.asList("ACTIVE");
    private static final List<String> STANDARD_STATUSES = Arrays.asList("ACTIVE", "PUBLISHED");
    private static final List<String> CHAPTER_PACKAGE_STATUSES = Arrays.asList("ACTIVE");

    /**
     * Slide statuses a learner can actually see. Must include UNSYNC: when a teacher edits a live
     * slide it flips to UNSYNC while learners keep seeing and studying the published version.
     * Filtering to PUBLISHED alone erased those slides — and all time spent on them — from
     * completion and time-spent. Matches LearnerReportService.VALID_SLIDE_STATUSES.
     */
    private static final List<String> VISIBLE_SLIDE_STATUSES = Arrays.asList("PUBLISHED", "UNSYNC");

    /**
     * Only VIDEO and DOCUMENT: those are the only two the completion query has progress CTEs for.
     * AUDIO was included here but has no CTE, so every audio slide resolved to 0% completion while
     * still counting in the denominator — silently deflating the learner's progress. ("PDF" was
     * never a real SlideTypeEnum value at all.) Matches LearnerReportService.
     */
    private static final List<String> SLIDE_TYPES = Arrays.asList("VIDEO", "DOCUMENT");

    public ProgressSection collect(String userId, String packageSessionId, LocalDate startDate, LocalDate endDate) {
        try {
            if (packageSessionId == null) {
                log.info("[ProgressCollector] No packageSessionId provided, skipping progress collection for userId={}", userId);
                return ProgressSection.builder().available(false).build();
            }

            // Fetch per-subject, per-module completion + time using existing query
            // Slide-level statuses must allow UNSYNC (see VISIBLE_SLIDE_STATUSES); the subject /
            // module / chapter levels keep the ACTIVE+PUBLISHED list.
            List<Object[]> subjectRows = activityLogRepository.getModuleCompletionByUserAndBatch(
                    packageSessionId, userId,
                    STANDARD_STATUSES, STANDARD_STATUSES, STANDARD_STATUSES,
                    VISIBLE_SLIDE_STATUSES, VISIBLE_SLIDE_STATUSES,
                    ACTIVE_STATUS);

            List<ProgressSection.SubjectProgress> subjects = new ArrayList<>();
            double overallCompletion = 0.0;
            // True once ANY real source (subject rows, subject rollup, package rollup, or the CTE)
            // yields a value. Without this, "we found nothing" and "the learner completed 0%" both
            // emit 0.0 and are indistinguishable in the report.
            boolean haveCompletionData = false;

            if (subjectRows != null && !subjectRows.isEmpty()) {
                for (Object[] row : subjectRows) {
                    String subjectId = row[0] != null ? row[0].toString() : null;
                    String subjectName = row[1] != null ? row[1].toString() : null;
                    String modulesJson = row[2] != null ? row[2].toString() : null;

                    double subjectTimeMinutes = 0.0;
                    // Fallback completion from the activity-log CTE (module average) — used only
                    // when learner_operation has no PERCENTAGE_SUBJECT_COMPLETED rollup yet.
                    double fallbackCompletion = 0.0;

                    if (modulesJson != null && !modulesJson.isBlank()) {
                        try {
                            JsonNode modules = objectMapper.readTree(modulesJson);
                            int count = 0;
                            for (JsonNode m : modules) {
                                fallbackCompletion += m.path("module_completion_percentage").asDouble(0);
                                subjectTimeMinutes += m.path("avg_time_spent_minutes").asDouble(0);
                                count++;
                            }
                            if (count > 0) fallbackCompletion /= count;
                        } catch (Exception e) {
                            log.warn("[ProgressCollector] Failed to parse modules JSON for subject {}: {}", subjectId, e.getMessage());
                        }
                    }

                    // Authoritative per-subject completion from learner_operation rollup.
                    Double subjectRollup = readRollup(userId, SRC_SUBJECT, subjectId, OP_SUBJECT_COMPLETED);
                    double subjectCompletion = subjectRollup != null ? subjectRollup : fallbackCompletion;

                    // Convert minutes to hours (1 decimal)
                    double timeHours = Math.round((subjectTimeMinutes / 60.0) * 10.0) / 10.0;

                    subjects.add(ProgressSection.SubjectProgress.builder()
                            .subjectId(subjectId)
                            .subject(subjectName)   // map "name" → "subject" for v2 output
                            .completionPercentage(Math.round(subjectCompletion * 100.0) / 100.0)
                            .timeHours(timeHours)
                            .build());

                    overallCompletion += subjectCompletion;
                }
                if (!subjects.isEmpty()) {
                    overallCompletion /= subjects.size();
                    haveCompletionData = true;
                }
                // A course without subjects has one placeholder subject named "DEFAULT". It still
                // counts toward the overall figure above, but a per-subject row labelled "DEFAULT"
                // means nothing to a parent (and leaked into Areas to Improve).
                subjects.removeIf(sp -> sp.getSubject() == null || sp.getSubject().isBlank()
                        || sp.getSubject().trim().equalsIgnoreCase("default"));
            }

            // Overall completion precedence:
            //   1. authoritative package-session rollup (the value the learner portal shows)
            //   2. the subject average computed above (from PERCENTAGE_SUBJECT_COMPLETED rollups)
            //   3. the slide-based CTE — ONLY when there's no subject data at all.
            // Step 3 must never overwrite a non-zero subject average: the CTE only counts
            // video/document slide watch-time and legitimately returns 0 for a learner who made
            // real progress via other slide types, which previously clobbered the average to 0%.
            double subjectAvg = overallCompletion;
            Double packageRollup = readRollup(userId, SRC_PACKAGE_SESSION, packageSessionId, OP_PACKAGE_SESSION_COMPLETED);
            if (packageRollup != null) {
                overallCompletion = packageRollup;
                haveCompletionData = true;
            } else if (subjectAvg > 0) {
                overallCompletion = subjectAvg;
                haveCompletionData = true;
            } else {
                try {
                    // End bound must be the last instant of endDate: activity_log.created_at is a
                    // TIMESTAMP, so binding a bare DATE made it `endDate 00:00:00` and every slide
                    // the learner studied on the final day of the window was excluded.
                    Double courseCompletion = activityLogRepository.getLearnerCourseCompletionPercentage(
                            packageSessionId, userId,
                            java.sql.Timestamp.valueOf(startDate.atStartOfDay()),
                            java.sql.Timestamp.valueOf(endDate.atTime(23, 59, 59, 999_000_000)),
                            STANDARD_STATUSES, STANDARD_STATUSES, STANDARD_STATUSES, VISIBLE_SLIDE_STATUSES,
                            SLIDE_TYPES, CHAPTER_PACKAGE_STATUSES);
                    if (courseCompletion != null) {
                        overallCompletion = courseCompletion;
                        haveCompletionData = true;
                    }
                } catch (Exception e) {
                    log.warn("[ProgressCollector] Course completion percentage query failed, using subject average: {}", e.getMessage());
                }
            }

            // Nothing anywhere knows this learner's progress — say so instead of asserting 0%.
            if (!haveCompletionData) {
                log.info("[ProgressCollector] No progress data for userId={} packageSessionId={} "
                        + "— reporting as unavailable rather than 0%.", userId, packageSessionId);
                return ProgressSection.builder().available(false).subjects(List.of()).build();
            }

            return ProgressSection.builder()
                    .available(true)
                    .overallCompletionPercentage(Math.round(overallCompletion * 100.0) / 100.0)
                    .subjects(subjects)
                    .build();

        } catch (Exception e) {
            log.error("[ProgressCollector] Failed for userId={}: {}", userId, e.getMessage());
            return ProgressSection.builder().available(false).build();
        }
    }

    /**
     * Reads a numeric completion rollup from learner_operation for the given
     * (userId, source, sourceId, operation). Returns null when there's no row or
     * the stored value isn't numeric — the caller then uses its own fallback.
     */
    private Double readRollup(String userId, String source, String sourceId, String operation) {
        if (sourceId == null) return null;
        try {
            return learnerOperationRepository
                    .findByUserIdAndSourceAndSourceIdAndOperation(userId, source, sourceId, operation)
                    .map(op -> {
                        try {
                            return op.getValue() != null ? Double.valueOf(op.getValue().trim()) : null;
                        } catch (NumberFormatException nfe) {
                            return null;
                        }
                    })
                    .orElse(null);
        } catch (Exception e) {
            log.warn("[ProgressCollector] Rollup read failed for {}/{}: {}", operation, sourceId, e.getMessage());
            return null;
        }
    }
}
