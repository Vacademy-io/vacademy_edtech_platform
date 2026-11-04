package vacademy.io.admin_core_service.features.student_analysis.service.aggregation.collectors;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.learner_tracking.dto.SlideMarksProjection;
import vacademy.io.admin_core_service.features.learner_tracking.entity.AssignmentSlideTracked;
import vacademy.io.admin_core_service.features.learner_tracking.repository.AssignmentSlideTrackedRepository;
import vacademy.io.admin_core_service.features.learner_tracking.repository.QuestionSlideTrackedRepository;
import vacademy.io.admin_core_service.features.learner_tracking.repository.QuizSlideQuestionTrackedRepository;
import vacademy.io.admin_core_service.features.slide.entity.Slide;
import vacademy.io.admin_core_service.features.slide.repository.AssignmentSlideRepository;
import vacademy.io.admin_core_service.features.slide.repository.SlideRepository;
import vacademy.io.admin_core_service.features.student_analysis.dto.comprehensive.AcademicsSection;
import vacademy.io.admin_core_service.features.student_analysis.dto.comprehensive.SubjectMarksSection;
import vacademy.io.admin_core_service.features.student_analysis.service.aggregation.SubjectResolver;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Collects EVERY mark-bearing item a learner did in the report window
 * (assessments, assignments, quiz slides, question slides) as a flat list of
 * {@link SubjectMarksSection.GradedItem}, then deterministically groups them by
 * their DB subject hint. Folded under the {@code ACADEMICS} module — no new
 * {@link vacademy.io.admin_core_service.features.student_analysis.service.aggregation.ReportModule} key.
 *
 * <p>The deterministic grouping in {@link #collect} is the MANDATORY fallback used
 * whenever the LLM clustering step ({@code ComprehensiveReportLLMService#clusterSubjectMarks})
 * fails or returns nothing — see {@code StudentAnalysisProcessorService} v2 path.
 *
 * <p>READ-ONLY. Never fails the report — any exception yields an "unavailable" section.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class SubjectMarksCollector {

    private final AssignmentSlideTrackedRepository assignmentSlideTrackedRepository;
    private final SlideRepository slideRepository;
    private final AssignmentSlideRepository assignmentSlideRepository;
    private final QuestionSlideTrackedRepository questionSlideTrackedRepository;
    private final QuizSlideQuestionTrackedRepository quizSlideQuestionTrackedRepository;
    private final SubjectResolver subjectResolver;

    /**
     * @param academics already-collected AcademicsSection (its assessments are reused here to
     *                  avoid a second assessment-service HMAC call).
     */
    public SubjectMarksSection collect(String userId, AcademicsSection academics,
                                        LocalDate startDate, LocalDate endDate) {
        return collect(userId, academics, startDate, endDate, null);
    }

    /** Slides of one batch, for scoping the report; empty when it cannot be read. */
    public Set<String> batchSlideIds(String batchId) {
        try {
            return new HashSet<>(slideRepository.findSlideIdsForPackageSession(batchId));
        } catch (Exception e) {
            log.warn("[SubjectMarksCollector] Slides of batch {} failed: {}", batchId, e.getMessage());
            return Set.of();
        }
    }

    /**
     * @param batchSlides when not null, only assignment, question and quiz marks on these slides
     *                    count (the picked batch). Assessments arrive already scoped.
     */
    public SubjectMarksSection collect(String userId, AcademicsSection academics,
                                       LocalDate startDate, LocalDate endDate, Set<String> batchSlides) {
        try {
            List<SubjectMarksSection.GradedItem> items = new ArrayList<>();

            items.addAll(collectAssessmentItems(academics));
            items.addAll(collectAssignmentItems(userId, startDate, endDate, batchSlides));
            items.addAll(collectQuestionItems(userId, startDate, endDate, batchSlides));
            items.addAll(collectQuizItems(userId, startDate, endDate, batchSlides));

            // Keep only gradable items (both a score AND a positive total) so neither the
            // deterministic grouping nor the LLM can produce a >100% subject from a missing total.
            items.removeIf(i -> !isValidForAggregation(i));

            // Resolve each item's subject (DB hint → keyword inference from the title). Unresolved
            // items get a null subject so the grouping below OMITS them rather than bucketing them
            // into "Other". The improved hint also flows into the LLM clustering prompt.
            for (SubjectMarksSection.GradedItem item : items) {
                item.setSubject(subjectResolver.resolve(item.getSubject(), item.getTitle()));
            }

            if (items.isEmpty()) {
                return SubjectMarksSection.builder().available(false).items(List.of()).subjects(List.of()).build();
            }

            List<SubjectMarksSection.SubjectMarks> subjects = deterministicGroup(items);

            return SubjectMarksSection.builder()
                    .available(true)
                    .items(items)
                    .subjects(subjects)
                    .build();

        } catch (Exception e) {
            log.error("[SubjectMarksCollector] Failed for userId={}: {}", userId, e.getMessage());
            return SubjectMarksSection.builder().available(false).build();
        }
    }

    /**
     * Deterministic fallback: group items by RESOLVED subject, sum obtained/total,
     * percentage = obtained/total*100. Items whose subject cannot be resolved (null/blank/
     * placeholder) are OMITTED — we never emit an "Other"/"Unknown" bucket to a parent. Public
     * so the processor can re-derive this if the LLM-clustered subjects come back empty.
     */
    public List<SubjectMarksSection.SubjectMarks> deterministicGroup(List<SubjectMarksSection.GradedItem> items) {
        Map<String, List<SubjectMarksSection.GradedItem>> bySubject = new LinkedHashMap<>();
        for (SubjectMarksSection.GradedItem item : items) {
            // Re-resolve defensively so this stays correct even if called with un-enriched items.
            String subject = subjectResolver.resolve(item.getSubject(), item.getTitle());
            if (subject == null) continue;   // unresolved → omit, never "Other"
            bySubject.computeIfAbsent(subject, k -> new ArrayList<>()).add(item);
        }

        List<SubjectMarksSection.SubjectMarks> result = new ArrayList<>();
        for (Map.Entry<String, List<SubjectMarksSection.GradedItem>> entry : bySubject.entrySet()) {
            double obtained = 0.0;
            double total = 0.0;
            List<String> topics = new ArrayList<>();
            for (SubjectMarksSection.GradedItem item : entry.getValue()) {
                // Defense-in-depth: only aggregate items that carry BOTH obtained AND a positive
                // total. Summing obtained without its total inflates the ratio past 100% (e.g. an
                // assessment with marks but a null totalMarks produced 156/45 → 346.7%).
                if (!isValidForAggregation(item)) continue;
                obtained += item.getMarksObtained();
                total += item.getTotalMarks();
                if (item.getTitle() != null) topics.add(item.getTitle());
            }
            if (total <= 0) continue;   // no valid, gradable items for this subject
            Double pct = Math.round((obtained / total * 100.0) * 10.0) / 10.0;
            result.add(SubjectMarksSection.SubjectMarks.builder()
                    .subject(entry.getKey())
                    .marksObtained(Math.round(obtained * 100.0) / 100.0)
                    .totalMarks(Math.round(total * 100.0) / 100.0)
                    .percentage(pct)
                    .itemCount(topics.size())
                    .topics(topics)
                    .build());
        }

        result.sort(Comparator.comparing(SubjectMarksSection.SubjectMarks::getSubject,
                Comparator.nullsLast(String::compareTo)));
        return result;
    }

    /** An item is aggregatable only if it has a real obtained score AND a positive total. */
    private boolean isValidForAggregation(SubjectMarksSection.GradedItem item) {
        return item.getMarksObtained() != null
                && item.getTotalMarks() != null
                && item.getTotalMarks() > 0;
    }

    // ── per-source collection ────────────────────────────────────────────────

    private List<SubjectMarksSection.GradedItem> collectAssessmentItems(AcademicsSection academics) {
        List<SubjectMarksSection.GradedItem> result = new ArrayList<>();
        if (academics == null || !academics.isAvailable() || academics.getAssessments() == null) return result;
        for (AcademicsSection.AssessmentItem a : academics.getAssessments()) {
            if (a.getMarks() == null && a.getTotalMarks() == null) continue;
            result.add(SubjectMarksSection.GradedItem.builder()
                    .type("ASSESSMENT")
                    .title(a.getName())
                    .subject(a.getSubject())
                    .marksObtained(a.getMarks())
                    .totalMarks(a.getTotalMarks())
                    .build());
        }
        return result;
    }

    private List<SubjectMarksSection.GradedItem> collectAssignmentItems(String userId, LocalDate startDate, LocalDate endDate,
                                                                  Set<String> batchSlides) {
        List<SubjectMarksSection.GradedItem> result = new ArrayList<>();
        try {
            Timestamp startTs = Timestamp.valueOf(startDate.atStartOfDay());
            Timestamp endTs = Timestamp.valueOf(endDate.atTime(23, 59, 59));
            List<AssignmentSlideTracked> submissions =
                    assignmentSlideTrackedRepository.findSubmissionsForUserInRange(userId, startTs, endTs);

            Map<String, Double> totalMarksCache = new HashMap<>();
            Map<String, String> subjectCache = new HashMap<>();
            Map<String, String> titleCache = new HashMap<>();

            for (AssignmentSlideTracked ast : submissions) {
                if (ast == null) continue;
                Double marks = ast.toAssignmentSlideActivityLog().getMarks();
                if (marks == null) continue;
                String slideId = ast.getActivityLog() != null ? ast.getActivityLog().getSlideId() : null;
                if (slideId == null) continue;
                if (batchSlides != null && !batchSlides.contains(slideId)) continue;

                Double totalMarks = resolveAssignmentTotalMarks(slideId, totalMarksCache);
                String subject = subjectCache.computeIfAbsent(slideId, this::resolveSubjectSafe);
                String title = titleCache.computeIfAbsent(slideId, this::resolveTitleSafe);

                result.add(SubjectMarksSection.GradedItem.builder()
                        .type("ASSIGNMENT")
                        .title(title != null ? title : slideId)
                        .subject(subject)
                        .marksObtained(marks)
                        .totalMarks(totalMarks)
                        .build());
            }
        } catch (Exception e) {
            log.warn("[SubjectMarksCollector] Assignment items failed for userId={}: {}", userId, e.getMessage());
        }
        return result;
    }

    private List<SubjectMarksSection.GradedItem> collectQuestionItems(String userId, LocalDate startDate, LocalDate endDate,
                                                                  Set<String> batchSlides) {
        List<SubjectMarksSection.GradedItem> result = new ArrayList<>();
        try {
            Timestamp startTs = Timestamp.valueOf(startDate.atStartOfDay());
            Timestamp endTs = Timestamp.valueOf(endDate.atTime(23, 59, 59));
            List<SlideMarksProjection> rows =
                    questionSlideTrackedRepository.findQuestionMarksForUserInRange(userId, startTs, endTs);
            for (SlideMarksProjection row : rows) {
                if (row.getMarksObtained() == null) continue;
                if (batchSlides != null && !batchSlides.contains(row.getSlideId())) continue;
                result.add(SubjectMarksSection.GradedItem.builder()
                        .type("QUESTION")
                        .title(row.getTitle() != null ? row.getTitle() : row.getSlideId())
                        .subject(row.getSubjectName())
                        .marksObtained(row.getMarksObtained())
                        .totalMarks(row.getTotalMarks())
                        .build());
            }
        } catch (Exception e) {
            log.warn("[SubjectMarksCollector] Question items failed for userId={}: {}", userId, e.getMessage());
        }
        return result;
    }

    private List<SubjectMarksSection.GradedItem> collectQuizItems(String userId, LocalDate startDate, LocalDate endDate,
                                                                  Set<String> batchSlides) {
        List<SubjectMarksSection.GradedItem> result = new ArrayList<>();
        try {
            Timestamp startTs = Timestamp.valueOf(startDate.atStartOfDay());
            Timestamp endTs = Timestamp.valueOf(endDate.atTime(23, 59, 59));
            List<SlideMarksProjection> rows =
                    quizSlideQuestionTrackedRepository.findQuizMarksForUserInRange(userId, startTs, endTs);
            for (SlideMarksProjection row : rows) {
                if (row.getMarksObtained() == null) continue;
                if (batchSlides != null && !batchSlides.contains(row.getSlideId())) continue;
                result.add(SubjectMarksSection.GradedItem.builder()
                        .type("QUIZ")
                        .title(row.getTitle() != null ? row.getTitle() : row.getSlideId())
                        .subject(row.getSubjectName())
                        .marksObtained(row.getMarksObtained())
                        .totalMarks(row.getTotalMarks())
                        .build());
            }
        } catch (Exception e) {
            log.warn("[SubjectMarksCollector] Quiz items failed for userId={}: {}", userId, e.getMessage());
        }
        return result;
    }

    // ── helpers (mirrors AssignmentCollector#resolveTotalMarks) ─────────────────

    private Double resolveAssignmentTotalMarks(String parentSlideId, Map<String, Double> cache) {
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
            log.warn("[SubjectMarksCollector] Could not resolve total marks for slide {}: {}", parentSlideId, e.getMessage());
        }
        cache.put(parentSlideId, totalMarks);
        return totalMarks;
    }

    private String resolveSubjectSafe(String slideId) {
        try {
            return slideRepository.findSubjectNameBySlideId(slideId).orElse(null);
        } catch (Exception e) {
            return null;
        }
    }

    private String resolveTitleSafe(String slideId) {
        try {
            return slideRepository.findById(slideId).map(Slide::getTitle).orElse(null);
        } catch (Exception e) {
            return null;
        }
    }
}
