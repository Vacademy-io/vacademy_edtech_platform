package vacademy.io.admin_core_service.features.student_analysis.service.aggregation.collectors;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.doubts.entity.Doubts;
import vacademy.io.admin_core_service.features.doubts.repository.DoubtsRepository;
import vacademy.io.admin_core_service.features.student_analysis.dto.comprehensive.DoubtsAndEngagementSection;

import java.time.LocalDate;
import java.util.Date;
import java.util.List;

/**
 * Collects doubts raised/resolved counts for a student in the report window.
 * Uses the existing DoubtsRepository.findDoubtsWithFilter (READ-ONLY).
 * Returns a {@link DoubtsAndEngagementSection} (v2 rename from DoubtsSection).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class DoubtCollector {

    private final DoubtsRepository doubtsRepository;

    /** Upper bound on doubts fetched per report. Exceeding it is logged, never silently swallowed. */
    private static final int DOUBT_FETCH_CAP = 1000;

    public DoubtsAndEngagementSection collect(String userId, String instituteId, LocalDate startDate, LocalDate endDate) {
        try {
            // doubts.raised_time is a timestamptz, and the query does `raised_time BETWEEN :start AND :end`.
            // Binding java.sql.Date.valueOf(endDate) sent midnight, so the upper bound was
            // `endDate 00:00:00` and EVERY doubt raised on the final day of the window was dropped
            // (for a single-day report, that's all of them). Bind the last instant of the day instead.
            // java.sql.Timestamp is a java.util.Date, so the shared repository signature is unchanged.
            Date start = java.sql.Timestamp.valueOf(startDate.atStartOfDay());
            Date end = java.sql.Timestamp.valueOf(endDate.atTime(23, 59, 59, 999_000_000));

            Page<Doubts> page = doubtsRepository.findDoubtsWithFilter(
                    null, null, null, null, null,
                    List.of(userId),
                    null,
                    instituteId,
                    List.of(), false,
                    // No assignee / workflow-status narrowing for the learner report.
                    List.of(""), false, false,
                    List.of(""), false,
                    start, end,
                    PageRequest.of(0, DOUBT_FETCH_CAP));

            List<Doubts> doubts = page.getContent();

            // The query has no ORDER BY, so if the learner ever exceeds the cap we would keep an
            // arbitrary subset and report it as the whole truth. Say so rather than under-count silently.
            if (page.getTotalElements() > doubts.size()) {
                log.warn("[DoubtCollector] userId={} has {} doubts in [{} .. {}] but the fetch cap is {} "
                        + "— counts are truncated.", userId, page.getTotalElements(), startDate, endDate, DOUBT_FETCH_CAP);
            }

            int questionsAsked = doubts.size();
            int resolved = 0;
            long totalResolutionMillis = 0;
            int resolvedWithTime = 0;

            for (Doubts d : doubts) {
                if ("RESOLVED".equalsIgnoreCase(d.getStatus())) {
                    resolved++;
                    if (d.getRaisedTime() != null && d.getResolvedTime() != null) {
                        long diffMs = d.getResolvedTime().getTime() - d.getRaisedTime().getTime();
                        if (diffMs > 0) {
                            totalResolutionMillis += diffMs;
                            resolvedWithTime++;
                        }
                    }
                }
            }

            // null, not 0.0, when nothing was resolved with a measurable turnaround — "0 hours"
            // reads as instant resolution, which is the opposite of "we have no resolution times".
            Double avgHours = resolvedWithTime > 0
                    ? Math.round((totalResolutionMillis / (double) resolvedWithTime / 3_600_000.0) * 100.0) / 100.0
                    : null;

            return DoubtsAndEngagementSection.builder()
                    .available(true)
                    .questionsAsked(questionsAsked)
                    .resolved(resolved)
                    .avgResolutionHours(avgHours)
                    .note(null)  // LLM sets this
                    .build();

        } catch (Exception e) {
            log.error("[DoubtCollector] Failed for userId={}: {}", userId, e.getMessage());
            return DoubtsAndEngagementSection.builder().available(false).build();
        }
    }
}
