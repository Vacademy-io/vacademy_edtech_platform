package vacademy.io.admin_core_service.features.student_analysis.service.aggregation.collectors;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.learner_tracking.dto.AssignmentSlideActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.entity.AssignmentSlideTracked;
import vacademy.io.admin_core_service.features.learner_tracking.repository.AssignmentSlideTrackedRepository;
import vacademy.io.admin_core_service.features.slide.entity.Slide;
import vacademy.io.admin_core_service.features.slide.repository.AssignmentSlideRepository;
import vacademy.io.admin_core_service.features.slide.repository.SlideRepository;
import vacademy.io.admin_core_service.features.student_analysis.dto.comprehensive.AssignmentsSection;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Collects assignment submission data (READ-ONLY).
 *
 * <p>Submissions are read from {@code assignment_slide_tracked} and dated by that
 * row's own {@code created_at} (the actual submit time) — NOT the parent
 * activity_log's created_at, which is the slide-open time and is not updated on
 * re-submission (that caused genuine in-window submissions to be missed).
 *
 * <p>Computes: submitted, late, onTime, graded, avgScorePercentage.
 * assigned and pending are null (no query for total available assignments exists).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AssignmentCollector {

    private final AssignmentSlideTrackedRepository assignmentSlideTrackedRepository;
    private final SlideRepository slideRepository;
    private final AssignmentSlideRepository assignmentSlideRepository;

    public AssignmentsSection collect(String userId, String batchId, LocalDate startDate, LocalDate endDate) {
        try {
            java.sql.Timestamp startTs = java.sql.Timestamp.valueOf(startDate.atStartOfDay());
            java.sql.Timestamp endTs = java.sql.Timestamp.valueOf(endDate.atTime(23, 59, 59));

            List<AssignmentSlideTracked> submissions = assignmentSlideTrackedRepository
                    .findSubmissionsForUserInRange(userId, startTs, endTs);

            int submitted = 0, graded = 0, late = 0;
            List<AssignmentsSection.AssignmentItem> items = new ArrayList<>();
            // Distinct assignment slides the learner submitted (for pending = assigned - distinct-submitted).
            java.util.Set<String> submittedSlideIds = new java.util.HashSet<>();

            // Accumulate score percentages for graded submissions that have a resolvable total.
            double scorePctSum = 0.0;
            int scorePctCount = 0;
            // Cache total-marks per parent slideId to avoid re-querying for the same assignment.
            Map<String, Double> totalMarksCache = new HashMap<>();

            for (AssignmentSlideTracked ast : submissions) {
                if (ast == null) continue;
                String slideId = ast.getActivityLog() != null ? ast.getActivityLog().getSlideId() : null;
                if (slideId != null) submittedSlideIds.add(slideId);
                AssignmentSlideActivityLogDTO dto = ast.toAssignmentSlideActivityLog();
                submitted++;
                boolean isLate = Boolean.TRUE.equals(dto.getLateSubmission());
                if (isLate) late++;
                boolean isGraded = dto.getMarks() != null
                        || dto.getFeedback() != null
                        || dto.getCheckedFileId() != null;
                if (isGraded) graded++;

                // Per-submission score % = marks / assignment.total_marks * 100 (only when graded with marks).
                Double scorePct = null;
                if (dto.getMarks() != null) {
                    Double totalMarks = resolveTotalMarks(slideId, totalMarksCache);
                    if (totalMarks != null && totalMarks > 0) {
                        scorePct = Math.round((dto.getMarks() * 100.0 / totalMarks) * 10.0) / 10.0;
                        scorePctSum += scorePct;
                        scorePctCount++;
                    }
                }

                items.add(AssignmentsSection.AssignmentItem.builder()
                        .slideId(slideId)
                        .title(slideId)
                        .marks(dto.getMarks())
                        .scorePercentage(scorePct)
                        .late(isLate)
                        .feedback(dto.getFeedback())
                        .reviewStatus(isGraded ? "REVIEWED" : "PENDING")
                        .build());
            }

            int onTime = submitted - late;
            // avgScorePercentage across graded submissions with a known total; null when nothing gradable.
            Double avgScorePct = scorePctCount > 0
                    ? Math.round((scorePctSum / scorePctCount) * 10.0) / 10.0
                    : null;

            // Assigned = total ACTIVE assignment slides in the batch's course structure.
            // Pending = assigned − distinct assignments the learner has submitted (clamped ≥ 0).
            Integer assigned = null;
            Integer pending = null;
            if (batchId != null) {
                try {
                    Integer total = slideRepository.countAssignmentSlidesForPackageSession(batchId);
                    if (total != null) {
                        assigned = total;
                        pending = Math.max(0, total - submittedSlideIds.size());
                    }
                } catch (Exception e) {
                    log.warn("[AssignmentCollector] Could not count assigned assignments for batch {}: {}", batchId, e.getMessage());
                }
            }

            // Nothing assigned and nothing submitted: there is no assignment story to tell. Reporting
            // it as "available" printed an "Assignments Done 0" tile and zero rows.
            if (submitted == 0 && (assigned == null || assigned == 0)) {
                return AssignmentsSection.builder().available(false).build();
            }

            return AssignmentsSection.builder()
                    .available(true)
                    .assigned(assigned)
                    .submitted(submitted)
                    .onTime(onTime)
                    .late(late)
                    .pending(pending)
                    .avgScorePercentage(avgScorePct)
                    .graded(graded)
                    .items(items)
                    .build();

        } catch (Exception e) {
            log.error("[AssignmentCollector] Failed for userId={}: {}", userId, e.getMessage());
            return AssignmentsSection.builder().available(false).build();
        }
    }

    /**
     * Resolves an assignment's total marks from its parent slide id.
     * The activity_log stores the parent {@code slide_id}; the AssignmentSlide row
     * (which carries {@code total_marks}) is referenced via {@code slide.source_id}.
     * Results are cached per slideId. Returns null if unresolvable (collector then
     * simply omits that submission from the average — never fails the section).
     */
    private Double resolveTotalMarks(String parentSlideId, Map<String, Double> cache) {
        if (parentSlideId == null) return null;
        if (cache.containsKey(parentSlideId)) return cache.get(parentSlideId);
        Double totalMarks = null;
        try {
            Slide parentSlide = slideRepository.findById(parentSlideId).orElse(null);
            if (parentSlide != null && parentSlide.getSourceId() != null) {
                totalMarks = assignmentSlideRepository.findById(parentSlide.getSourceId())
                        .map(a -> a.getTotalMarks())
                        .orElse(null);
            }
        } catch (Exception e) {
            log.warn("[AssignmentCollector] Could not resolve total marks for slide {}: {}",
                    parentSlideId, e.getMessage());
        }
        cache.put(parentSlideId, totalMarks);
        return totalMarks;
    }
}
