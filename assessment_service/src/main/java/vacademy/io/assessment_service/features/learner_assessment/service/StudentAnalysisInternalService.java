package vacademy.io.assessment_service.features.learner_assessment.service;

import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.StudentReportDto;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.StudentAttemptHistoryProjection;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.UserAssessmentHistorySummaryProjection;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.learner_assessment.dto.SectionComparisonDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.StudentComparisonDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.internal.AssessmentHistoryItemDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.internal.AssessmentHistorySummaryDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.internal.AssessmentSectionSummaryDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.internal.BatchAssessmentHistoryRequest;
import vacademy.io.assessment_service.features.learner_assessment.dto.internal.BatchAssessmentHistoryResponse;
import vacademy.io.assessment_service.features.learner_assessment.dto.internal.StudentAssessmentHistoryResponse;
import vacademy.io.assessment_service.features.learner_assessment.dto.internal.UserAssessmentSummaryDto;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Backing service for the internal student-analysis endpoint.
 *
 * <p><b>Isolation contract (§13.4 of the design doc):</b>
 * <ul>
 *   <li>Read-only — no writes anywhere.
 *   <li>Reuses existing {@link StudentAttemptRepository} queries and
 *       {@link LearnerReportService#buildComparisonData} — no duplicated query logic.
 *   <li>Comparison is capped at {@link #MAX_ASSESSMENTS_PER_REPORT} (default 50) to bound
 *       per-request work.  A truncation warning is logged so operators can tune the cap.
 *   <li>Per-assessment comparison failures are isolated: a single failure marks that entry
 *       with null comparison fields but never aborts the whole request.
 * </ul>
 */
@Slf4j
@Service
public class StudentAnalysisInternalService {

    /**
     * Maximum number of assessments that will have full comparison data computed.
     * The most recent N attempts (by exam date) are processed; older ones are silently omitted.
     * 25 was too tight: a school term of weekly offline tests passes it (26 in a Sep 2026
     * Elevate report), and the newest test was the one that got dropped.
     */
    static final int MAX_ASSESSMENTS_PER_REPORT = 50;

    /** Maximum cohort size accepted by the batch endpoint; larger requests are rejected with 400. */
    static final int MAX_BATCH_USERS = 500;

    /** Default look-back window (days) for the batch endpoint when sinceDays is omitted. */
    static final int DEFAULT_SINCE_DAYS = 90;

    @Autowired
    private StudentAttemptRepository studentAttemptRepository;

    /**
     * Self-injection to benefit from Spring's @Cacheable proxy on
     * {@link LearnerReportService#buildComparisonData}.
     */
    @Autowired
    @Lazy
    private LearnerReportService learnerReportService;

    /**
     * Assembles a student's assessment history with per-attempt comparison data.
     *
     * @param userId      learner's UUID
     * @param instituteId institute's UUID
     * @param startDate   inclusive lower bound (null = no lower bound)
     * @param endDate     inclusive upper bound (null = no upper bound)
     * @return fully populated response
     */
    public StudentAssessmentHistoryResponse fetchAssessmentHistory(
            String userId, String instituteId, Date startDate, Date endDate) {

        // `endDate` arrives via @DateTimeFormat(ISO.DATE), so "2026-06-30" materialises as
        // 2026-06-30T00:00:00 and the query's `created_at <= :endDate` then excluded EVERY attempt
        // taken on the final day of the window — an "inclusive upper bound" that silently lost 24h.
        // Widen it to the last instant of that day so the bound is genuinely inclusive.
        Date inclusiveEnd = endOfDay(endDate);

        // Fetch at most MAX+1 rows so we can detect truncation without fetching everything
        List<StudentAttemptHistoryProjection> rows = studentAttemptRepository
                .findAssessmentHistoryForUserInDateRange(
                        userId, instituteId, startDate, inclusiveEnd,
                        PageRequest.of(0, MAX_ASSESSMENTS_PER_REPORT + 1));

        boolean truncated = rows.size() > MAX_ASSESSMENTS_PER_REPORT;
        if (truncated) {
            log.warn("student-analysis: assessment history for userId={} instituteId={} " +
                     "exceeded cap of {}; truncating to most recent {}.",
                     userId, instituteId, MAX_ASSESSMENTS_PER_REPORT, MAX_ASSESSMENTS_PER_REPORT);
            rows = rows.subList(0, MAX_ASSESSMENTS_PER_REPORT);
        }

        List<AssessmentHistoryItemDto> items = new ArrayList<>(rows.size());

        for (StudentAttemptHistoryProjection row : rows) {
            AssessmentHistoryItemDto item = buildHistoryItem(row, userId, instituteId);
            items.add(item);
        }

        AssessmentHistorySummaryDto summary = buildSummary(items);

        return StudentAssessmentHistoryResponse.builder()
                .userId(userId)
                .instituteId(instituteId)
                .assessments(items)
                .summary(summary)
                .build();
    }

    /**
     * BATCHED sibling of {@link #fetchAssessmentHistory}: per-user summaries for a cohort of up
     * to {@value #MAX_BATCH_USERS} users in ONE repository query (no per-user loop).  Consumed by
     * the Engagement Engine in admin_core_service.
     *
     * <p>The response map contains an entry ONLY for userIds with at least one ENDED attempt in
     * the window — absence means "no data"; a user is never emitted as zeros.  {@code avgPercentage}
     * is null whenever marks data does not allow a reliable computation (see repository javadoc).
     *
     * @throws VacademyException 400 on missing instituteId/userIds, more than
     *                           {@value #MAX_BATCH_USERS} userIds, or non-positive sinceDays
     */
    public BatchAssessmentHistoryResponse fetchAssessmentHistoryBatch(BatchAssessmentHistoryRequest request) {
        if (request == null || request.getInstituteId() == null || request.getInstituteId().isBlank()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "instituteId is required");
        }
        if (request.getUserIds() == null || request.getUserIds().isEmpty()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "userIds is required and must be non-empty");
        }
        if (request.getUserIds().size() > MAX_BATCH_USERS) {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "userIds exceeds the maximum of " + MAX_BATCH_USERS + " per call");
        }
        int sinceDays = request.getSinceDays() != null ? request.getSinceDays() : DEFAULT_SINCE_DAYS;
        if (sinceDays < 1) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "sinceDays must be a positive integer");
        }

        // De-duplicate and drop null/blank ids so the IN-list stays tight.
        Set<String> distinctUserIds = new LinkedHashSet<>();
        for (String id : request.getUserIds()) {
            if (id != null && !id.isBlank()) {
                distinctUserIds.add(id);
            }
        }
        if (distinctUserIds.isEmpty()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "userIds contains no usable ids");
        }

        Date since = Date.from(Instant.now().minus(sinceDays, ChronoUnit.DAYS));

        List<UserAssessmentHistorySummaryProjection> rows = studentAttemptRepository
                .findAssessmentHistorySummaryForUsersSince(
                        request.getInstituteId(), new ArrayList<>(distinctUserIds), since);

        Map<String, UserAssessmentSummaryDto> byUserId = new HashMap<>(Math.max(16, rows.size() * 2));
        for (UserAssessmentHistorySummaryProjection row : rows) {
            byUserId.put(row.getUserId(), UserAssessmentSummaryDto.builder()
                    .attemptCount(row.getAttemptCount())
                    .lastAttemptAt(row.getLastAttemptAt() != null
                            ? row.getLastAttemptAt().toInstant().toString()
                            : null)
                    .avgPercentage(roundToOneDecimal(row.getAvgPercentage()))
                    .lastAssessmentName(row.getLastAssessmentName())
                    .build());
        }

        log.info("student-analysis/batch: instituteId={} requestedUsers={} distinctUsers={} " +
                 "usersWithData={} sinceDays={}",
                 request.getInstituteId(), request.getUserIds().size(), distinctUserIds.size(),
                 byUserId.size(), sinceDays);

        return BatchAssessmentHistoryResponse.builder()
                .byUserId(byUserId)
                .build();
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    /** Same one-decimal rounding the per-user endpoint applies to percentages. Null-safe. */
    private static Double roundToOneDecimal(Double value) {
        if (value == null) return null;
        return Math.round(value * 10.0) / 10.0;
    }

    /**
     * Widens a date-only upper bound to the last instant of that same day, so that
     * {@code created_at <= :endDate} includes attempts made during the day rather than
     * only those at exactly 00:00:00. Null-safe (null = no upper bound).
     */
    private static Date endOfDay(Date endDate) {
        if (endDate == null) return null;
        java.util.Calendar cal = java.util.Calendar.getInstance();
        cal.setTime(endDate);
        cal.set(java.util.Calendar.HOUR_OF_DAY, 23);
        cal.set(java.util.Calendar.MINUTE, 59);
        cal.set(java.util.Calendar.SECOND, 59);
        cal.set(java.util.Calendar.MILLISECOND, 999);
        return cal.getTime();
    }

    private AssessmentHistoryItemDto buildHistoryItem(
            StudentAttemptHistoryProjection row,
            String userId,
            String instituteId) {

        AssessmentHistoryItemDto.AssessmentHistoryItemDtoBuilder builder =
                AssessmentHistoryItemDto.builder()
                        .assessmentId(row.getAssessmentId())
                        .assessmentName(row.getAssessmentName())
                        .attemptId(row.getAttemptId())
                        .attemptDate(row.getAttemptDate())
                        .marks(row.getTotalMarks())
                        .durationSeconds(row.getDurationInSeconds())
                        .resultStatus(row.getResultStatus())
                        .sections(Collections.emptyList());

        enrichWithComparison(builder, userId, row.getAssessmentId(), row.getAttemptId(),
                row.getTotalMarks(), instituteId);
        return builder.build();
    }

    /**
     * One history item from a learner-visible report row (learner chatbot). The caller has
     * already applied the learner app's release gating; enrichment is the same as above.
     */
    AssessmentHistoryItemDto buildHistoryItemFromReport(
            StudentReportDto row, String userId, String instituteId) {
        AssessmentHistoryItemDto.AssessmentHistoryItemDtoBuilder builder =
                AssessmentHistoryItemDto.builder()
                        .assessmentId(row.getAssessmentId())
                        .assessmentName(row.getAssessmentName())
                        .attemptId(row.getAttemptId())
                        .attemptDate(row.getAttemptDate())
                        .marks(row.getTotalMarks())
                        .durationSeconds(row.getDurationInSeconds())
                        .resultStatus(row.getReportReleaseStatus())
                        .sections(Collections.emptyList());
        enrichWithComparison(builder, userId, row.getAssessmentId(), row.getAttemptId(),
                row.getTotalMarks(), instituteId);
        return builder.build();
    }

    private void enrichWithComparison(
            AssessmentHistoryItemDto.AssessmentHistoryItemDtoBuilder builder,
            String userId, String assessmentId, String attemptId, Double earnedMarks,
            String instituteId) {
        // Attempt to enrich with comparison data; never let a failure abort the whole request.
        try {
            StudentComparisonDto comparison = learnerReportService
                    .buildComparisonData(userId, assessmentId, attemptId, instituteId);

            if (comparison != null) {
                Double totalMarks = comparison.getTotalMarks();
                double percentage = (totalMarks != null && totalMarks > 0 && earnedMarks != null)
                        ? Math.round((earnedMarks / totalMarks) * 1000.0) / 10.0
                        : 0.0;

                builder.totalMarks(totalMarks)
                        .percentage(percentage)
                        .rank(comparison.getStudentRank())
                        .percentile(comparison.getStudentPercentile())
                        .accuracy(comparison.getStudentAccuracy())
                        .classAverageMarks(comparison.getAverageMarks())
                        .classAccuracy(comparison.getClassAccuracy())
                        .sections(mapSections(comparison.getSectionWiseComparison()));
            }
        } catch (Exception ex) {
            log.warn("student-analysis: failed to build comparison for " +
                     "assessmentId={} attemptId={} userId={}: {}",
                     assessmentId, attemptId, userId, ex.getMessage());
        }
    }

    private List<AssessmentSectionSummaryDto> mapSections(List<SectionComparisonDto> sectionComparisons) {
        if (sectionComparisons == null || sectionComparisons.isEmpty()) {
            return Collections.emptyList();
        }
        List<AssessmentSectionSummaryDto> result = new ArrayList<>(sectionComparisons.size());
        for (SectionComparisonDto s : sectionComparisons) {
            result.add(AssessmentSectionSummaryDto.builder()
                    .sectionId(s.getSectionId())
                    .sectionName(s.getSectionName())
                    .studentMarks(s.getStudentMarks())
                    .sectionTotalMarks(s.getSectionTotalMarks())
                    .sectionAverageMarks(s.getSectionAverageMarks())
                    .studentAccuracy(s.getStudentAccuracy())
                    .classAccuracy(s.getClassAccuracy())
                    .build());
        }
        return result;
    }

    private AssessmentHistorySummaryDto buildSummary(List<AssessmentHistoryItemDto> items) {
        if (items == null || items.isEmpty()) {
            return AssessmentHistorySummaryDto.builder()
                    .totalAssessments(0)
                    .averagePercentage(0.0)
                    .build();
        }

        double totalPct = 0.0;
        double bestPct = Double.NEGATIVE_INFINITY;
        double worstPct = Double.POSITIVE_INFINITY;
        String bestId = null;
        String weakestId = null;

        for (AssessmentHistoryItemDto item : items) {
            double pct = item.getPercentage() != null ? item.getPercentage() : 0.0;
            totalPct += pct;
            if (pct > bestPct) {
                bestPct = pct;
                // BUG-17: store the name (rendered in UI), not the id
                bestId = item.getAssessmentName();
            }
            if (pct < worstPct) {
                worstPct = pct;
                // BUG-17: store the name (rendered in UI), not the id
                weakestId = item.getAssessmentName();
            }
        }

        double avg = Math.round((totalPct / items.size()) * 10.0) / 10.0;

        return AssessmentHistorySummaryDto.builder()
                .totalAssessments(items.size())
                .averagePercentage(avg)
                .bestAssessment(bestId)
                .weakestAssessment(weakestId)
                .build();
    }
}
