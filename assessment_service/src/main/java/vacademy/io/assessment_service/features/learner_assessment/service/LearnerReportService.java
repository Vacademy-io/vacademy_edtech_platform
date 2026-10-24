package vacademy.io.assessment_service.features.learner_assessment.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.assessment_service.features.assessment.dto.LeaderBoardDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.StudentReportFilter;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.*;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.enums.ReleaseResultStatusEnum;
import vacademy.io.assessment_service.features.assessment.enums.ResultTypeEnum;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.manager.AssessmentParticipantsManager;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentUserRegistrationRepository;
import vacademy.io.assessment_service.features.assessment.repository.SectionRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.bulk_entry_services.QuestionAssessmentSectionMappingService;
import vacademy.io.assessment_service.features.learner_assessment.dto.*;
import vacademy.io.assessment_service.features.learner_assessment.dto.context.AssessmentOverviewSnapshot;
import vacademy.io.assessment_service.features.learner_assessment.dto.context.LeaderBoardSnapshot;
import vacademy.io.assessment_service.features.learner_assessment.dto.context.MarksRankSnapshot;
import vacademy.io.assessment_service.features.learner_assessment.dto.context.SectionAggregateSnapshot;
import vacademy.io.assessment_service.features.learner_assessment.dto.context.SectionSnapshot;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.*;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class LearnerReportService {

    @Autowired
    private StudentAttemptRepository studentAttemptRepository;

    @Autowired
    private AssessmentUserRegistrationRepository registrationRepository;

    @Autowired
    private AssessmentParticipantsManager assessmentParticipantsManager;

    @Autowired
    private AssessmentRepository assessmentRepository;

    @Autowired
    private SectionRepository sectionRepository;

    @Autowired
    private QuestionWiseMarksRepository questionWiseMarksRepository;

    @Autowired
    private vacademy.io.assessment_service.features.assessment.repository.CopyCheckLayoutRepository copyCheckLayoutRepository;

    @Autowired
    private vacademy.io.assessment_service.features.assessment.service.ReportPdfRenderService reportPdfRenderService;

    @Autowired
    private vacademy.io.assessment_service.features.assessment.service.AiReportHtmlBuilder aiReportHtmlBuilder;

    /** The 2026-10 AI report; also answers "is there an AI report?" for the one-report rule. */
    @Autowired
    private vacademy.io.assessment_service.features.assessment.service.aireport.AiReportPdfService aiReportPdfService;

    @Autowired
    private vacademy.io.assessment_service.features.assessment.service.aireport.ReportProfileService reportProfileService;

    @Autowired
    private vacademy.io.common.media.service.FileService fileService;

    @Autowired
    @org.springframework.context.annotation.Lazy
    private LearnerReportService self;

    @Autowired
    private vacademy.io.assessment_service.features.client.AdminCoreServiceClient adminCoreServiceClient;

    @Autowired
    private QuestionAssessmentSectionMappingService questionAssessmentSectionMappingService;

    private static final int TOP_RANKS_COUNT = 2;
    private static final int SURROUNDING_WINDOW = 3;

    /**
     * Validates that the current user owns the given attempt and report is released.
     */
    /**
     * The AI-annotated copy for the learner: the OCR layout map + every
     * annotation (tick/cross/circle/margin note) across all questions, so the
     * learner app can overlay them on the student's own submitted answer sheet.
     * Ownership-checked; returns empty layout/annotations when the attempt was
     * not AI-evaluated.
     */
    public LearnerAnnotatedCopyDto getAnnotatedCopy(CustomUserDetails user, String assessmentId, String attemptId) {
        validateOwnershipAndAccess(user.getUserId(), assessmentId, attemptId);

        com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();

        com.fasterxml.jackson.databind.JsonNode layoutMap = copyCheckLayoutRepository.findByAttemptId(attemptId)
                .map(layout -> {
                    try {
                        return layout.getLayoutJson() != null ? mapper.readTree(layout.getLayoutJson()) : null;
                    } catch (Exception e) {
                        log.warn("Bad layout_json for attempt {}: {}", attemptId, e.getMessage());
                        return null;
                    }
                })
                .orElse(null);

        List<com.fasterxml.jackson.databind.JsonNode> annotations = new ArrayList<>();
        for (QuestionWiseMarks marks : questionWiseMarksRepository.findByStudentAttemptId(attemptId)) {
            String aiJson = marks.getAiEvaluationDetailsJson();
            if (aiJson == null || aiJson.isBlank()) {
                continue;
            }
            try {
                com.fasterxml.jackson.databind.JsonNode node = mapper.readTree(aiJson);
                if (node.has("annotations") && node.get("annotations").isArray()) {
                    String questionId = marks.getQuestion() != null ? marks.getQuestion().getId() : null;
                    for (com.fasterxml.jackson.databind.JsonNode ann : node.get("annotations")) {
                        if (ann.isObject() && questionId != null) {
                            ((com.fasterxml.jackson.databind.node.ObjectNode) ann).put("question_id", questionId);
                        }
                        annotations.add(ann);
                    }
                }
            } catch (Exception ignored) {
                // Skip questions whose verdict JSON can't be parsed.
            }
        }

        return LearnerAnnotatedCopyDto.builder()
                .layoutMap(layoutMap)
                .annotations(annotations)
                .build();
    }

    private AssessmentUserRegistration validateOwnershipAndAccess(String userId, String assessmentId, String attemptId) {
        Optional<AssessmentUserRegistration> registration = registrationRepository
                .findTopByUserIdAndAssessmentId(userId, assessmentId);

        if (registration.isEmpty()) {
            throw new VacademyException("You are not registered for this assessment");
        }

        Optional<StudentAttempt> attempt = studentAttemptRepository.findById(attemptId);
        if (attempt.isEmpty()) {
            throw new VacademyException("Attempt not found");
        }

        if (!attempt.get().getRegistration().getId().equals(registration.get().getId())) {
            throw new VacademyException("You do not have access to this attempt");
        }

        // Same rule the learner UI applies (AssessmentCard, assessment-slide-viewer):
        // on a MANUAL result type nothing is visible until the teacher releases.
        // The list endpoint hands the learner their attempt id on the "Pending
        // evaluation" row, so without this the detail, comparison, annotated-copy
        // and PDF endpoints would serve the AI's (or an evaluator's) marks before
        // release to anyone who calls them directly. AUTO result types are
        // deliberately NOT gated here: the card offers "Show report" for them
        // regardless of release status, and refusing would break that button -
        // unless the attempt is explicitly held (PENDING) for a teacher.
        if (isHeldManualResult(registration.get().getAssessment(), attempt.get())) {
            throw new VacademyException("Result has not been released yet");
        }

        return registration.get();
    }

    static boolean isHeldManualResult(Assessment assessment, StudentAttempt attempt) {
        if (ReleaseResultStatusEnum.PENDING.name().equals(attempt.getReportReleaseStatus())) {
            // Explicitly held for a teacher on any result type: an uploaded copy, or
            // an online attempt whose written answers the AI is grading.
            return true;
        }
        // NO_AUTO_RELEASE is auto-marked but released by hand, so it is held like MANUAL.
        return assessment != null
                && (ResultTypeEnum.MANUAL.name().equals(assessment.getResultType())
                        || "NO_AUTO_RELEASE".equals(assessment.getResultType()))
                && !ReleaseResultStatusEnum.RELEASED.name().equals(attempt.getReportReleaseStatus());
    }

    /**
     * Get paginated list of own assessment reports.
     */
    public ResponseEntity<Page<StudentReportDto>> getStudentReportList(CustomUserDetails user, String instituteId,
                                                                        StudentReportFilter filter, int pageNo, int pageSize) {
        Pageable pageable = PageRequest.of(pageNo, pageSize);

        List<String> statusList = filter.getStatus() != null ? filter.getStatus() : List.of("ENDED");
        List<String> releaseStatus = filter.getReleaseResultStatus() != null ? filter.getReleaseResultStatus() : List.of("RELEASED");
        List<String> assessmentTypes = filter.getAssessmentType();

        Page<StudentReportDto> reports;
        if (StringUtils.hasText(filter.getName())) {
            reports = studentAttemptRepository.findAssessmentForUserWithFilterAndSearch(
                    true, filter.getName(), user.getUserId(), instituteId, statusList, releaseStatus, assessmentTypes, pageable);
        } else {
            reports = studentAttemptRepository.findAssessmentForUserWithFilter(
                    true, user.getUserId(), instituteId, statusList, releaseStatus, assessmentTypes, pageable);
        }

        return ResponseEntity.ok(reports);
    }

    /**
     * Get detailed report for own attempt.
     */
    public ResponseEntity<StudentReportOverallDetailDto> getStudentReportDetail(CustomUserDetails user, String assessmentId,
                                                                                 String attemptId, String instituteId) {
        validateOwnershipAndAccess(user.getUserId(), assessmentId, attemptId);

        StudentReportOverallDetailDto reportDetail = assessmentParticipantsManager
                .createStudentReportDetailResponse(assessmentId, attemptId, instituteId);

        return ResponseEntity.ok(reportDetail);
    }

    /**
     * Get comparison data: student vs batch performance.
     */
    public ResponseEntity<StudentComparisonDto> getComparisonData(CustomUserDetails user, String assessmentId,
                                                                    String attemptId, String instituteId) {
        validateOwnershipAndAccess(user.getUserId(), assessmentId, attemptId);
        StudentComparisonDto comparison = self.buildComparisonData(user.getUserId(), assessmentId, attemptId, instituteId);
        if (comparison != null) {
            comparison.setQuestionWiseHidden(reportProfileService.hideQuestionWise(assessmentId, instituteId));
        }
        return ResponseEntity.ok(comparison);
    }

    /**
     * Core comparison data builder — cached for 15 minutes per attempt.
     * Reused by both the API endpoint and PDF generation.
     *
     * Re-expressed (PR2, bulk report export) as loadClassContext +
     * buildComparisonFromContext. Signature and @Cacheable are unchanged —
     * six call sites depend on both (see ARCHITECTURE.md §5.2 / X5):
     * the /comparison endpoint, the learner PDF, the AI-report PDF, the
     * release flow, AssessmentDataEnrichmentService.addComparisonContext, and
     * StudentAnalysisInternalService (admin_core v2 student report, via HMAC).
     *
     * Self-invocation note: loadClassContext/buildComparisonFromContext below
     * are plain `this.` calls, which is correct — neither carries
     * @Cacheable/@Async/@Transactional, so no proxy is required. If either
     * ever gains such an annotation, route the call through the `self` field
     * instead (do not silently rely on `this.`).
     */
    @Cacheable(value = "comparisonData", key = "#assessmentId + ':' + #attemptId")
    public StudentComparisonDto buildComparisonData(String userId, String assessmentId,
                                                     String attemptId, String instituteId) {
        ReportClassContext ctx = loadClassContext(assessmentId, instituteId);
        if (ctx == null || ctx.getOverview() == null) return null; // preserves prior null-on-missing-overview behaviour
        return buildComparisonFromContext(ctx, attemptId, userId);
    }

    /**
     * Builds the assessment-wide (class-level) context once. ~7 queries plus
     * two best-effort external calls (option distribution, branding). Not
     * @Transactional — each call is a discrete, fully-materialised repository
     * read/HTTP call; wrapping them in one transaction would hold a DB
     * connection across the branding HTTP round trip (plan C1).
     *
     * Not cached — the Spring cache is evicted wholesale on every attempt
     * update (plan C11), which makes it unusable as job-scoped state for the
     * bulk export worker. Callers that want caching go through
     * buildComparisonData, which is @Cacheable per-attempt.
     */
    public ReportClassContext loadClassContext(String assessmentId, String instituteId) {
        AssessmentOverviewDto overviewProjection = studentAttemptRepository
                .findAssessmentOverviewDetails(assessmentId, instituteId);
        if (overviewProjection == null) {
            return ReportClassContext.builder()
                    .assessmentId(assessmentId)
                    .instituteId(instituteId)
                    .build();
        }
        AssessmentOverviewSnapshot overview = AssessmentOverviewSnapshot.from(overviewProjection);

        List<MarksRankDto> marksDistributionRaw = studentAttemptRepository
                .findMarkRankForAssessment(assessmentId, instituteId);
        List<MarksRankDto> marksDistribution = marksDistributionRaw.stream()
                .map(m -> (MarksRankDto) MarksRankSnapshot.from(m))
                .collect(Collectors.toList());

        List<LeaderBoardDto> fullLeaderboardRaw = studentAttemptRepository
                .findLeaderBoardForAssessmentAndInstituteId(assessmentId, instituteId, List.of("ACTIVE"));
        List<LeaderBoardDto> fullLeaderboard = fullLeaderboardRaw.stream()
                .map(l -> (LeaderBoardDto) LeaderBoardSnapshot.from(l))
                .collect(Collectors.toList());

        StructuralData structural = loadStructuralData(assessmentId, instituteId);
        List<SectionSnapshot> sections = structural.sections();
        Map<String, SectionAggregateSnapshot> sectionAggregation = structural.sectionAggregation();

        String assessmentName = assessmentRepository.findById(assessmentId).map(Assessment::getName).orElse(null);

        ReportBrandingDto branding = null;
        try {
            branding = adminCoreServiceClient.getReportBranding(instituteId);
        } catch (Exception e) {
            log.warn("[report-context] Failed to fetch report branding for institute {}: {}", instituteId, e.getMessage());
        }

        // Derive total marks from section totals — same fallback as the
        // pre-PR2 per-student derivation (sum > 0 ? sum : 100.0).
        double totalMarksSum = sections.stream()
                .mapToDouble(s -> s.totalMarks() != null ? s.totalMarks() : 0.0)
                .sum();
        Double totalMarks = totalMarksSum > 0 ? totalMarksSum : 100.0;

        double classAccuracy = 0.0;
        if (overview.getTotalParticipants() != null && overview.getTotalParticipants() > 0
                && overview.getAverageMarks() != null && totalMarks > 0) {
            classAccuracy = Math.max(0.0, Math.min(100.0, (overview.getAverageMarks() / totalMarks) * 100.0));
        }

        Double highestMarks = 0.0;
        Double lowestMarks = 0.0;
        if (!marksDistribution.isEmpty()) {
            Double first = marksDistribution.get(0).getMarks();
            Double last = marksDistribution.get(marksDistribution.size() - 1).getMarks();
            highestMarks = first != null ? first : 0.0;
            lowestMarks = last != null ? last : 0.0;
        }

        return ReportClassContext.builder()
                .assessmentId(assessmentId)
                .instituteId(instituteId)
                .assessmentName(assessmentName)
                .overview(overview)
                .marksDistribution(marksDistribution)
                .fullLeaderboard(fullLeaderboard)
                .sectionAggregation(sectionAggregation)
                .totalMarks(totalMarks)
                .classAccuracy(Math.round(classAccuracy * 10.0) / 10.0)
                .highestMarks(highestMarks)
                .lowestMarks(lowestMarks)
                .branding(branding)
                .sections(sections)
                .questionOrderByQuestionAndSection(structural.questionOrderByQuestionAndSection())
                .optionDistribution(structural.optionDistribution())
                .build();
    }

    /**
     * The @JsonIgnore'd, non-snapshotted part of {@link ReportClassContext}:
     * sections, question order, and option distribution. Immutable for a
     * published assessment and cheap to re-query (plan §6.3 / ARCHITECTURE.md
     * §9), so this is deliberately factored out — the bulk-export worker calls
     * it directly on resume ({@code ReportZipExportService.hydrateNonSnapshotted})
     * instead of paying for the full 7-query + 2-HTTP-call
     * {@link #loadClassContext} just to discard the snapshotted half.
     */
    public StructuralData loadStructuralData(String assessmentId, String instituteId) {
        List<Section> sectionEntities = sectionRepository.findByAssessmentIdAndStatusNotIn(assessmentId, List.of("DELETED"));
        List<String> sectionIds = sectionEntities.stream().map(Section::getId).collect(Collectors.toList());
        List<SectionSnapshot> sections = sectionEntities.stream()
                .map(s -> new SectionSnapshot(s.getId(), s.getName(), s.getTotalMarks(), s.getCutOffMarks(), s.getSectionOrder()))
                .collect(Collectors.toList());

        Map<String, SectionAggregateSnapshot> sectionAggregation = new HashMap<>();
        if (!sectionIds.isEmpty()) {
            List<Object[]> aggregations = questionWiseMarksRepository
                    .findSectionWiseAggregation(assessmentId, instituteId, sectionIds);
            for (Object[] row : aggregations) {
                SectionAggregateSnapshot snap = SectionAggregateSnapshot.from(row);
                sectionAggregation.put(snap.sectionId(), snap);
            }
        }

        Map<String, Integer> questionOrderByQuestionAndSection = new HashMap<>();
        if (!sectionIds.isEmpty()) {
            List<QuestionAssessmentSectionMapping> mappings = questionAssessmentSectionMappingService
                    .getQuestionAssessmentSectionMappingBySectionIds(sectionIds);
            questionOrderByQuestionAndSection.putAll(buildQuestionOrderMap(mappings));
        }

        Map<String, Map<String, Double>> optionDistribution = new HashMap<>();
        try {
            optionDistribution = self.computeOptionDistribution(assessmentId);
        } catch (Exception e) {
            log.warn("[report-context] Failed to compute option distribution for assessment {}: {}", assessmentId, e.getMessage());
        }

        return new StructuralData(sections, sectionAggregation, questionOrderByQuestionAndSection, optionDistribution);
    }

    public record StructuralData(List<SectionSnapshot> sections,
                                  Map<String, SectionAggregateSnapshot> sectionAggregation,
                                  Map<String, Integer> questionOrderByQuestionAndSection,
                                  Map<String, Map<String, Double>> optionDistribution) {
    }

    // Same merge rule as AssessmentParticipantsManager.buildQuestionOrderMap (PR1,
    // X8): findByQuestionIdAndSectionId is ORDER BY created_at DESC LIMIT 1, but
    // the bulk loader is unordered/undeduped, so ties are broken on greatest
    // createdAt to reproduce that pick.
    private static Map<String, Integer> buildQuestionOrderMap(List<QuestionAssessmentSectionMapping> mappings) {
        Map<String, QuestionAssessmentSectionMapping> newest = new HashMap<>();
        for (QuestionAssessmentSectionMapping m : mappings) {
            if (m.getQuestion() == null || m.getSection() == null) continue;
            String key = ReportClassContext.mappingKey(m.getQuestion().getId(), m.getSection().getId());
            newest.merge(key, m, (a, b) -> {
                Date da = a.getCreatedAt();
                Date db = b.getCreatedAt();
                if (da == null) return b;
                if (db == null) return a;
                return db.after(da) ? b : a;
            });
        }
        Map<String, Integer> out = new HashMap<>(newest.size() * 2);
        newest.forEach((k, m) -> out.put(k, m.getQuestionOrder()));
        return out;
    }

    /**
     * Per-student comparison, given an already-loaded class context. 2 queries
     * (student overall detail + student's own question-wise marks for section
     * comparison). Not cached — the caller already holds the context.
     */
    public StudentComparisonDto buildComparisonFromContext(ReportClassContext ctx, String attemptId, String userId) {
        ParticipantsQuestionOverallDetailDto studentDetail = studentAttemptRepository
                .findParticipantsQuestionOverallDetails(ctx.getAssessmentId(), ctx.getInstituteId(), attemptId);
        if (studentDetail == null) return null;

        SmartLeaderboardDto smartLeaderboard = buildSmartLeaderboard(ctx.getFullLeaderboard(), userId);

        List<SectionComparisonDto> sectionComparisons = buildSectionComparisonFromContext(ctx, attemptId);

        Double totalMarks = ctx.getTotalMarks();

        double studentMarksAchieved = studentDetail.getAchievedMarks() != null ? studentDetail.getAchievedMarks() : 0.0;
        double studentAccuracy = totalMarks != null && totalMarks > 0
                ? Math.max(0.0, Math.min(100.0, (studentMarksAchieved * 100.0) / totalMarks))
                : 0.0;

        return StudentComparisonDto.builder()
                .startTime(studentDetail.getStartTime())
                .submitTime(studentDetail.getSubmitTime())
                .studentRank(studentDetail.getRank())
                .studentPercentile(studentDetail.getPercentile())
                .studentMarks(studentDetail.getAchievedMarks())
                .totalMarks(totalMarks)
                .totalParticipants(ctx.getOverview() != null ? ctx.getOverview().getTotalParticipants() : null)
                .averageMarks(ctx.getOverview() != null ? ctx.getOverview().getAverageMarks() : null)
                .highestMarks(ctx.getHighestMarks())
                .lowestMarks(ctx.getLowestMarks())
                .averageDuration(ctx.getOverview() != null ? ctx.getOverview().getAverageDuration() : null)
                .studentDuration(studentDetail.getCompletionTimeInSeconds())
                .studentAccuracy(Math.round(studentAccuracy * 10.0) / 10.0)
                .classAccuracy(ctx.getClassAccuracy())
                .marksDistribution(ctx.getMarksDistribution())
                .sectionWiseComparison(sectionComparisons)
                .leaderboard(smartLeaderboard)
                .build();
    }

    /**
     * Get student-facing smart leaderboard.
     */
    public ResponseEntity<SmartLeaderboardDto> getStudentLeaderboard(CustomUserDetails user, String assessmentId,
                                                                      String instituteId) {
        List<LeaderBoardDto> fullLeaderboard = studentAttemptRepository
                .findLeaderBoardForAssessmentAndInstituteId(assessmentId, instituteId, List.of("ACTIVE"));
        SmartLeaderboardDto smartLeaderboard = buildSmartLeaderboard(fullLeaderboard, user.getUserId());
        return ResponseEntity.ok(smartLeaderboard);
    }

    /**
     * Download own PDF report.
     */
    public ResponseEntity<byte[]> getStudentReportPdf(CustomUserDetails user, String assessmentId,
                                                        String attemptId, String instituteId) {
        validateOwnershipAndAccess(user.getUserId(), assessmentId, attemptId);

        // Always render fresh. There IS a pre-generated PDF on the attempt
        // (report_pdf_file_id, produced at result-release time for the email
        // attachment), but it is frozen with whatever report branding existed
        // back then — serving it meant an institute could change its logo/theme
        // and every already-released assessment kept the old (usually default)
        // look forever. The generation below is the same builder, so the only
        // cost of re-rendering is CPU on an explicit user download.
        StudentReportOverallDetailDto reportDetail = assessmentParticipantsManager
                .createStudentReportDetailResponse(assessmentId, attemptId, instituteId);

        Optional<Assessment> assessmentOptional = assessmentRepository.findById(assessmentId);
        if (assessmentOptional.isEmpty()) throw new VacademyException("Assessment Not Found");

        // One report per student: the AI report once it exists, else the normal report
        // (rendered through the shared release-flow builder), wrapped in the assessment's
        // report-profile pages if it has any.
        byte[] pdfBytes;
        try {
            pdfBytes = aiReportPdfService.renderStudentReport(user.getUserId(), assessmentId, attemptId, instituteId,
                    reportDetail, null, () -> reportPdfRenderService.render(reportDetail,
                            self.buildComparisonData(user.getUserId(), assessmentId, attemptId, instituteId),
                            loadClassContext(assessmentId, instituteId)));
        } catch (Exception e) {
            log.error("Error generating student report PDF for attempt {}", attemptId, e);
            throw new VacademyException("Failed to generate report PDF");
        }
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=studentReport.pdf")
                .contentType(MediaType.APPLICATION_PDF)
                .body(pdfBytes);
    }

    /** The normal report's per-question review, which the AI report also renders; null on failure. */
    private StudentReportOverallDetailDto reviewDetailOrNull(String assessmentId, String attemptId, String instituteId) {
        try {
            return assessmentParticipantsManager.createStudentReportDetailResponse(assessmentId, attemptId, instituteId);
        } catch (Exception e) {
            log.warn("[ai-report] question review unavailable for attempt {}: {}", attemptId, e.getMessage());
            return null;
        }
    }

    /**
     * API endpoint: returns option distribution with auth check.
     */
    public ResponseEntity<Map<String, Map<String, Double>>> getOptionDistribution(
            CustomUserDetails user, String assessmentId, String attemptId, String instituteId) {
        validateOwnershipAndAccess(user.getUserId(), assessmentId, attemptId);
        return ResponseEntity.ok(self.computeOptionDistribution(assessmentId));
    }

    /**
     * Core option distribution computation. Cached for 15 minutes per assessment.
     * Returns: questionId -> { optionId -> percentage }
     */
    @Cacheable(value = "comparisonData", key = "'optdist:' + #assessmentId")
    public Map<String, Map<String, Double>> computeOptionDistribution(String assessmentId) {
        List<Object[]> rows = questionWiseMarksRepository.findOptionResponsesByAssessmentId(assessmentId);

        Map<String, List<String>> responsesByQuestion = new HashMap<>();
        for (Object[] row : rows) {
            String questionId = (String) row[0];
            String responseJson = (String) row[1];
            responsesByQuestion.computeIfAbsent(questionId, k -> new ArrayList<>()).add(responseJson);
        }

        com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        Map<String, Map<String, Double>> result = new HashMap<>();

        for (Map.Entry<String, List<String>> entry : responsesByQuestion.entrySet()) {
            String questionId = entry.getKey();
            List<String> responses = entry.getValue();
            int totalResponses = responses.size();

            Map<String, Integer> optionCounts = new HashMap<>();
            for (String json : responses) {
                try {
                    com.fasterxml.jackson.databind.JsonNode root = mapper.readTree(json);
                    com.fasterxml.jackson.databind.JsonNode optionIds = root.path("responseData").path("optionIds");
                    if (optionIds.isArray()) {
                        for (com.fasterxml.jackson.databind.JsonNode idNode : optionIds) {
                            optionCounts.merge(idNode.asText(), 1, Integer::sum);
                        }
                    }
                } catch (Exception ignored) {}
            }

            if (!optionCounts.isEmpty()) {
                Map<String, Double> percentages = new HashMap<>();
                for (Map.Entry<String, Integer> oc : optionCounts.entrySet()) {
                    percentages.put(oc.getKey(), Math.round((oc.getValue() * 1000.0) / totalResponses) / 10.0);
                }
                result.put(questionId, percentages);
            }
        }

        return result;
    }

    /**
     * Builds a smart leaderboard showing top 2 + ±3 around the student.
     */
    private SmartLeaderboardDto buildSmartLeaderboard(List<LeaderBoardDto> fullLeaderboard, String userId) {
        if (fullLeaderboard == null || fullLeaderboard.isEmpty()) {
            return SmartLeaderboardDto.builder()
                    .topRanks(Collections.emptyList())
                    .surroundingRanks(Collections.emptyList())
                    .hasGap(false)
                    .totalParticipants(0L)
                    .build();
        }

        int studentIndex = -1;
        for (int i = 0; i < fullLeaderboard.size(); i++) {
            if (userId.equals(fullLeaderboard.get(i).getUserId())) {
                studentIndex = i;
                break;
            }
        }

        long totalParticipants = fullLeaderboard.size();
        Integer studentRank = studentIndex >= 0 ? fullLeaderboard.get(studentIndex).getRank() : null;

        // Top 2
        List<LeaderBoardDto> topRanks = fullLeaderboard.stream()
                .limit(TOP_RANKS_COUNT)
                .collect(Collectors.toList());

        // ±3 around student
        List<LeaderBoardDto> surroundingRanks;
        boolean hasGap;

        if (studentIndex < 0) {
            // Student not in leaderboard (shouldn't happen normally)
            surroundingRanks = Collections.emptyList();
            hasGap = false;
        } else if (studentIndex < TOP_RANKS_COUNT + SURROUNDING_WINDOW) {
            // Student is close to top, no gap needed — show from top to student+3
            int end = Math.min(studentIndex + SURROUNDING_WINDOW + 1, fullLeaderboard.size());
            // Clamp start so it never exceeds end (handles leaderboards smaller than TOP_RANKS_COUNT,
            // e.g. when only the current student has submitted so far — size=1)
            int start = Math.min(TOP_RANKS_COUNT, end);
            surroundingRanks = fullLeaderboard.subList(start, end)
                    .stream().collect(Collectors.toList());
            hasGap = false;
        } else {
            // Gap between top 2 and student's window
            int start = Math.max(studentIndex - SURROUNDING_WINDOW, TOP_RANKS_COUNT);
            int end = Math.min(studentIndex + SURROUNDING_WINDOW + 1, fullLeaderboard.size());
            surroundingRanks = fullLeaderboard.subList(start, end)
                    .stream().collect(Collectors.toList());
            hasGap = true;
        }

        return SmartLeaderboardDto.builder()
                .topRanks(topRanks)
                .surroundingRanks(surroundingRanks)
                .hasGap(hasGap)
                .studentRank(studentRank)
                .totalParticipants(totalParticipants)
                .build();
    }

    /**
     * Builds section-wise comparison data from an already-loaded class context
     * (sections + per-section class aggregation). Only the per-student query
     * (findByStudentAttemptId) and the per-section arithmetic run here — the
     * class-wide aggregation is hoisted into loadClassContext (plan C4/C5).
     */
    private List<SectionComparisonDto> buildSectionComparisonFromContext(ReportClassContext ctx, String attemptId) {
        List<SectionSnapshot> sections = ctx.getSections();
        if (sections == null || sections.isEmpty()) return Collections.emptyList();

        // Fetch all student marks once and group by section (avoids N+1)
        List<QuestionWiseMarks> allStudentMarks = questionWiseMarksRepository.findByStudentAttemptId(attemptId);
        Map<String, List<QuestionWiseMarks>> marksBySectionId = allStudentMarks.stream()
                .filter(qwm -> qwm.getSection() != null)
                .collect(Collectors.groupingBy(qwm -> qwm.getSection().getId()));

        Map<String, SectionAggregateSnapshot> aggMap = ctx.getSectionAggregation() != null
                ? ctx.getSectionAggregation() : Collections.emptyMap();

        List<SectionComparisonDto> comparisons = new ArrayList<>();

        for (SectionSnapshot section : sections) {
            List<QuestionWiseMarks> studentSectionMarks = marksBySectionId.getOrDefault(section.id(), Collections.emptyList());
            double studentSectionTotal = studentSectionMarks.stream()
                    .mapToDouble(QuestionWiseMarks::getMarks)
                    .sum();
            Double sectionMax = section.totalMarks() != null ? section.totalMarks() : 0.0;
            // Marks-based section accuracy so partial credit (e.g. coding on hidden
            // tests) is reflected. Clamped for negative marking.
            double studentAccuracy = sectionMax > 0
                    ? Math.max(0.0, Math.min(100.0, (studentSectionTotal * 100.0) / sectionMax))
                    : 0.0;

            // Class data from the snapshotted aggregation
            double classAvg = 0.0;
            double classHighestMarks = 0.0;
            double classAccuracy = 0.0;
            SectionAggregateSnapshot agg = aggMap.get(section.id());
            if (agg != null) {
                classAvg = agg.avgMarks() != null ? agg.avgMarks() : 0.0;
                classHighestMarks = agg.maxMarks() != null ? agg.maxMarks() : 0.0;
                classAccuracy = sectionMax > 0
                        ? Math.max(0.0, Math.min(100.0, (classAvg * 100.0) / sectionMax))
                        : 0.0;
            }

            Double sectionTotalMarks = section.totalMarks() != null ? section.totalMarks() : 0.0;
            Double cutOff = section.cutOffMarks();
            boolean passed = cutOff != null && studentSectionTotal >= cutOff;

            comparisons.add(SectionComparisonDto.builder()
                    .sectionId(section.id())
                    .sectionName(section.name())
                    .studentMarks(studentSectionTotal)
                    .sectionTotalMarks(sectionTotalMarks)
                    .sectionAverageMarks(Math.round(classAvg * 10.0) / 10.0)
                    .sectionHighestMarks(classHighestMarks)
                    .cutOffMarks(cutOff)
                    .studentAccuracy(Math.round(studentAccuracy * 10.0) / 10.0)
                    .classAccuracy(Math.round(classAccuracy * 10.0) / 10.0)
                    .passed(passed)
                    .build());
        }

        return comparisons;
    }

    /**
     * Generate AI report PDF by fetching processed JSON from admin-core-service
     * and converting to HTML → PDF with branding.
     */
    public ResponseEntity<byte[]> getAiReportPdf(CustomUserDetails user, String assessmentId, String attemptId, String instituteId) {
        try {
            // Fetch processed AI report from admin-core-service
            String processedJson = adminCoreServiceClient.getProcessedAIReport(user.getUserId(), assessmentId);
            if (processedJson == null || processedJson.isEmpty()) {
                throw new VacademyException("AI report not yet available for this assessment");
            }

            // Get assessment name
            String assessmentName = assessmentRepository.findById(assessmentId)
                    .map(a -> a.getName()).orElse("Assessment");

            // Get branding
            ReportBrandingDto branding = ReportBrandingDto.builder().build();
            try {
                // null means "couldn't read branding" — keep the defaults rather than NPE downstream.
                ReportBrandingDto fetched = adminCoreServiceClient.getReportBranding(instituteId);
                if (fetched != null) branding = fetched;
            } catch (Exception e) {
                log.warn("Failed to fetch branding for AI report PDF: {}", e.getMessage());
            }

            // Get comparison data (rank, percentile, class avg, leaderboard)
            // If attemptId not provided, resolve from registration
            StudentComparisonDto comparison = null;
            String resolvedAttemptId = attemptId;
            if (resolvedAttemptId == null || resolvedAttemptId.isEmpty()) {
                try {
                    // Use a direct query instead of lazy-loaded collection to avoid LazyInitializationException
                    var reg = registrationRepository.findTopByUserIdAndAssessmentId(user.getUserId(), assessmentId);
                    if (reg.isPresent()) {
                        var latestAttempt = studentAttemptRepository.findTopByRegistrationOrderByCreatedAtDesc(reg.get());
                        if (latestAttempt.isPresent()) {
                            resolvedAttemptId = latestAttempt.get().getId();
                        }
                    }
                } catch (Exception e) {
                    log.warn("Failed to resolve attemptId for AI report: {}", e.getMessage());
                }
            }
            if (resolvedAttemptId != null && !resolvedAttemptId.isEmpty()) {
                // The attempt id comes from the client: it must be this learner's own attempt,
                // and a result still held for release must not be readable through this PDF.
                validateOwnershipAndAccess(user.getUserId(), assessmentId, resolvedAttemptId);
            }

            if (aiReportPdfService.isEnabled() && resolvedAttemptId != null && !resolvedAttemptId.isEmpty()) {
                try {
                    byte[] pdf = aiReportPdfService.renderStudentReport(user.getUserId(), assessmentId, resolvedAttemptId,
                            instituteId, reviewDetailOrNull(assessmentId, resolvedAttemptId, instituteId), processedJson, null);
                    return ResponseEntity.ok()
                            .header(org.springframework.http.HttpHeaders.CONTENT_DISPOSITION,
                                    "attachment; filename=ai-report-" + assessmentId + ".pdf")
                            .contentType(org.springframework.http.MediaType.APPLICATION_PDF)
                            .body(pdf);
                } catch (VacademyException e) {
                    throw e;
                } catch (Exception e) {
                    // Never leave a learner without a report: fall back to the previous layout.
                    log.error("[ai-report] v2 render failed for attempt {}, serving the previous layout", resolvedAttemptId, e);
                }
            }

            if (resolvedAttemptId != null && !resolvedAttemptId.isEmpty()) {
                try {
                    comparison = self.buildComparisonData(user.getUserId(), assessmentId, resolvedAttemptId, instituteId);
                } catch (Exception e) {
                    log.warn("Failed to fetch comparison for AI report PDF: {}", e.getMessage());
                }
            }

            // Build HTML and convert to PDF
            String html = aiReportHtmlBuilder.generateAiReportHtml(assessmentName, processedJson, branding, comparison);

            java.io.ByteArrayOutputStream pdfOutputStream = new java.io.ByteArrayOutputStream();
            com.itextpdf.html2pdf.ConverterProperties converterProperties = new com.itextpdf.html2pdf.ConverterProperties();
            com.itextpdf.html2pdf.HtmlConverter.convertToPdf(html, pdfOutputStream, converterProperties);

            return ResponseEntity.ok()
                    .header(org.springframework.http.HttpHeaders.CONTENT_DISPOSITION,
                            "attachment; filename=ai-report-" + assessmentId + ".pdf")
                    .contentType(org.springframework.http.MediaType.APPLICATION_PDF)
                    .body(pdfOutputStream.toByteArray());

        } catch (VacademyException e) {
            throw e;
        } catch (Exception e) {
            log.error("Error generating AI report PDF", e);
            throw new VacademyException("Failed to generate AI report PDF");
        }
    }
}
