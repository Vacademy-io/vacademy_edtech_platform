package vacademy.io.assessment_service.features.assessment.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.assessment.dto.QuestionWiseBasicDetailDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.request.RevaluateRequest;
import vacademy.io.assessment_service.features.assessment.dto.manual_evaluation.ManualAttemptResponseDto;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.enums.AttemptResultStatusEnum;
import vacademy.io.assessment_service.features.assessment.enums.ReleaseResultStatusEnum;
import vacademy.io.assessment_service.features.assessment.enums.ResultTypeEnum;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.assessment.repository.SectionRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.TypedAnswerEvaluation;
import vacademy.io.assessment_service.features.learner_assessment.constants.AttemptJsonConstants;
import vacademy.io.assessment_service.features.learner_assessment.dto.status_json.LearnerAssessmentAttemptDataDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.status_json.manual.LearnerManualAttemptDataDto;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.enums.AssessmentAttemptEnum;
import vacademy.io.assessment_service.features.learner_assessment.enums.AssessmentAttemptResultEnum;
import vacademy.io.assessment_service.features.learner_assessment.service.QuestionWiseMarksService;
import vacademy.io.assessment_service.features.notification.service.AssessmentNotificationService;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.enums.EvaluationTypes;
import vacademy.io.assessment_service.features.question_core.repository.QuestionRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.stream.StreamSupport;

@Slf4j
@Service
public class StudentAttemptService {

    /** Internal choice ("any 4 of 5"); absent in unit tests that do not need it. */
    @Autowired(required = false)
    private vacademy.io.assessment_service.features.assessment.service.evaluation_ai.DashboardChoiceGroups choiceGroups;

    @Autowired
    StudentAttemptRepository studentAttemptRepository;

    @Autowired
    QuestionAssessmentSectionMappingRepository questionAssessmentSectionMappingRepository;

    @Autowired
    QuestionWiseMarksService questionWiseMarksService;

    @Autowired
    SectionRepository sectionRepository;

    @Autowired
    QuestionRepository questionRepository;

    @Autowired
    AssessmentNotificationService assessmentNotificationService;

    @Autowired
    AttemptDataParserService attemptDataParserService;

    @Autowired
    AssessmentWorkflowEventPublisher assessmentWorkflowEventPublisher;

    @Autowired
    TypedAnswerEvaluation typedAnswerEvaluation;

    public StudentAttempt updateStudentAttempt(StudentAttempt studentAttempt) {
        return studentAttemptRepository.save(studentAttempt);
    }

    public StudentAttempt updateLeaderBoard(StudentAttempt studentAttempt) {
        return updateStudentAttempt(studentAttempt);
    }

    public void releaseResultsForEndedAutoReleaseAssessments() {
        List<StudentAttempt> unreleased = studentAttemptRepository.findUnreleasedAttemptsForEndedAutoReleaseAssessments();
        Date now = new Date();
        for (StudentAttempt attempt : unreleased) {
            attempt.setReportReleaseStatus(ReleaseResultStatusEnum.RELEASED.name());
            attempt.setReportLastReleaseDate(now);
        }
        if (!unreleased.isEmpty()) {
            studentAttemptRepository.saveAll(unreleased);
            log.info("[AUTO-RELEASE] Released results for {} attempts after assessment end", unreleased.size());
            // The query only returns attempts that were NOT yet released, so every row here
            // is a genuine transition — no re-notification risk on a repeated cron pass.
            assessmentWorkflowEventPublisher.publishResultReleased(unreleased);
        }
    }


    // @Transactional is load-bearing, not decorative: without it the rows loaded by
    // the marks calculation detach the instant their read finishes, so saveAll() falls
    // back to merge() and fires a SELECT per row — each dragging this entity's four
    // EAGER @ManyToOne graphs. A 42-question paper became ~84 round trips per autosave
    // per candidate, which took a live exam's background recalcs to 29s on 2026-08-29.
    // Inside a transaction the entities stay managed, dirty checking emits plain
    // batched UPDATEs, and the same work costs a couple of round trips.
    @Async
    @Transactional
    @CacheEvict(value = "comparisonData", allEntries = true)
    public CompletableFuture<StudentAttempt> updateStudentAttemptWithTotalAfterMarksCalculationAsync(Optional<StudentAttempt> studentAttemptOptional) {
        return CompletableFuture.completedFuture(updateStudentAttemptWithTotalAfterMarksCalculation(studentAttemptOptional));
    }

    @Async
    @Transactional
    @CacheEvict(value = "comparisonData", allEntries = true)
    public CompletableFuture<StudentAttempt> updateStudentAttemptResultAfterMarksCalculationAsync(Optional<StudentAttempt> studentAttemptOptional) {
        return updateStudentAttemptResultAfterMarksCalculationAsync(studentAttemptOptional, null);
    }

    /** @param endSource see {@link #updateStudentAttemptWithResultAfterMarksCalculation(Optional, String)}. */
    @Async
    @Transactional
    @CacheEvict(value = "comparisonData", allEntries = true)
    public CompletableFuture<StudentAttempt> updateStudentAttemptResultAfterMarksCalculationAsync(Optional<StudentAttempt> studentAttemptOptional,
                                                                                                 String endSource) {
        return CompletableFuture.completedFuture(
                updateStudentAttemptWithResultAfterMarksCalculation(studentAttemptOptional, endSource));
    }

    @CacheEvict(value = "comparisonData", allEntries = true)
    public StudentAttempt updateStudentAttemptWithResultAfterMarksCalculation(Optional<StudentAttempt> studentAttemptOptional) {
        return updateStudentAttemptWithResultAfterMarksCalculation(studentAttemptOptional, null);
    }

    /**
     * @param endSource why this call is ending the attempt (e.g. TIME_EXPIRED), used as the
     *                  ASSESSMENT_END trigger's endSource. Pass null when the caller has
     *                  already emitted ASSESSMENT_END itself (the learner submit path) or
     *                  when ending the attempt is not what this call means — the reason
     *                  cannot be inferred from here, because callers reach this method with
     *                  a non-ENDED attempt for several different reasons.
     */
    @Transactional
    @CacheEvict(value = "comparisonData", allEntries = true)
    public StudentAttempt updateStudentAttemptWithResultAfterMarksCalculation(Optional<StudentAttempt> studentAttemptOptional,
                                                                             String endSource) {
        if (studentAttemptOptional.isEmpty()) throw new VacademyException("Student Attempt Not Found");

        String attemptData = studentAttemptOptional.get().getAttemptData();

        Long timeElapsedInSeconds = attemptDataParserService.getTimeElapsedInSecondsFromAttemptData(attemptData);

        double totalMarks = calculateTotalMarksForAttemptAndUpdateQuestionWiseMarks(studentAttemptOptional);

        StudentAttempt attempt = studentAttemptOptional.get();

        attempt.setTotalMarks(totalMarks);
        attempt.setTotalTimeInSeconds(timeElapsedInSeconds);

        // MANUAL-evaluation assessments are graded by an evaluator (tool or AI),
        // which sets COMPLETED itself. Auto marks calculation (submit flow /
        // attempt-expiry cron) must not flip such attempts to COMPLETED
        // ("Evaluated") or release their results.
        boolean isManualEvaluation = isManualEvaluationAssessment(attempt);
        // An online attempt whose written answers the AI is about to grade is held
        // the same way: until then those answers carry only the word-overlap score,
        // and the AI's marks are a draft the teacher reviews and releases.
        boolean heldForAi = !isManualEvaluation && awaitsAiGrading(attempt);
        if (heldForAi) {
            // Still an AUTO attempt: keep result_marks as the release path expects;
            // the AI run replaces both totals when it completes.
            attempt.setResultMarks(totalMarks);
        }
        if (isManualEvaluation || heldForAi) {
            if (!AssessmentAttemptResultEnum.COMPLETED.name().equals(attempt.getResultStatus())) {
                attempt.setResultStatus(AssessmentAttemptResultEnum.PENDING.name());
            }
            // Nothing automatic will ever release a manually-evaluated attempt
            // (autoRelease is skipped below), so make the hold explicit. Left
            // NULL, the attempt was invisible on the learner's Reports list —
            // it filters on report_release_status IN ('RELEASED','PENDING') —
            // and read "Not available" in the admin's Result Status column;
            // the PDF-upload submit path already writes PENDING. Only fill the
            // gap: a RELEASED attempt that comes back through here (a
            // re-calculation) must stay released.
            if (attempt.getReportReleaseStatus() == null) {
                attempt.setReportReleaseStatus(ReleaseResultStatusEnum.PENDING.name());
            }
        } else {
            attempt.setResultMarks(totalMarks);
            attempt.setResultStatus(AssessmentAttemptResultEnum.COMPLETED.name());
        }
        // True only when THIS call is what ends the attempt. On the learner submit path
        // handleAttemptLiveOrEndedStatusWhenSubmit has already set ENDED and fired
        // ASSESSMENT_END, so this is false there and the event cannot double-fire.
        boolean endedByThisCall = !AssessmentAttemptEnum.ENDED.name().equals(attempt.getStatus());
        if (endedByThisCall) {
            attempt.setStatus(AssessmentAttemptEnum.ENDED.name());
        }

        // Auto-release result based on assessment's result_type. An OMR-mode assessment
        // is never auto-released: its scanned sheets are reviewed (faint marks, double
        // bubbles, a mis-bubbled roll number) and the admin releases them.
        boolean heldForOmrReview = isOmrModeAssessment(attempt);
        boolean justReleased = !isManualEvaluation && !heldForAi && !heldForOmrReview
                && autoReleaseResultIfApplicable(attempt);

        StudentAttempt saved = studentAttemptRepository.save(attempt);
        if (endedByThisCall && endSource != null) {
            assessmentWorkflowEventPublisher.publishAssessmentEnd(saved, endSource);
        }
        if (justReleased) {
            assessmentWorkflowEventPublisher.publishResultReleased(saved, null, null);
        }
        return saved;
    }

    private boolean awaitsAiGrading(StudentAttempt attempt) {
        try {
            return typedAnswerEvaluation.awaitsAiGrading(attempt, attempt.getRegistration().getAssessment());
        } catch (Exception e) {
            log.error("Failed to resolve AI grading for attempt {}: {}", attempt.getId(), e.getMessage());
            return false;
        }
    }

    private boolean isOmrModeAssessment(StudentAttempt attempt) {
        try {
            Assessment assessment = attempt.getRegistration().getAssessment();
            return assessment != null && Boolean.TRUE.equals(assessment.getOmrMode());
        } catch (Exception e) {
            log.error("Failed to resolve OMR mode for attempt {}: {}", attempt.getId(), e.getMessage());
            return false;
        }
    }

    private boolean isManualEvaluationAssessment(StudentAttempt attempt) {
        try {
            Assessment assessment = attempt.getRegistration().getAssessment();
            return assessment != null
                    && EvaluationTypes.MANUAL.name().equals(assessment.getEvaluationType());
        } catch (Exception e) {
            log.error("Failed to resolve evaluation type for attempt {}: {}", attempt.getId(), e.getMessage());
            return false;
        }
    }


    @CacheEvict(value = "comparisonData", allEntries = true)
    public StudentAttempt updateStudentAttemptWithTotalAfterMarksCalculation(Optional<StudentAttempt> studentAttemptOptional) {
        if (studentAttemptOptional.isEmpty()) throw new VacademyException("Student Attempt Not Found");

        String attemptData = studentAttemptOptional.get().getAttemptData();

        Long timeElapsedInSeconds = attemptDataParserService.getTimeElapsedInSecondsFromAttemptData(attemptData);

        double totalMarks = calculateTotalMarksForAttemptAndUpdateQuestionWiseMarks(studentAttemptOptional);

        // Re-read before writing. This runs async off a 60s autosave, so the
        // learner may have submitted while it was calculating; the entity we
        // were handed is a snapshot from before that submit. StudentAttempt has
        // no @Version, so saving the snapshot is a full-row overwrite that
        // resets status to LIVE and wipes submit_time/result_marks — measured at
        // 6.6% of submits in the 1000-VU load test (2026-08-27). The submit and
        // expiry paths compute authoritative marks, so once the attempt has
        // ended there is nothing here worth persisting.
        StudentAttempt attempt = studentAttemptRepository.findById(studentAttemptOptional.get().getId())
                .orElse(studentAttemptOptional.get());
        if (AssessmentAttemptEnum.ENDED.name().equals(attempt.getStatus()) || attempt.getSubmitTime() != null) {
            log.debug("Skipping live-sync marks write, attempt already submitted: attemptId={}", attempt.getId());
            return attempt;
        }
        attempt.setTotalMarks(totalMarks);
        attempt.setTotalTimeInSeconds(timeElapsedInSeconds);

        return studentAttemptRepository.save(attempt);

    }


    /**
     * @return true when this call transitioned the attempt into RELEASED, so the caller can
     *         fire ASSESSMENT_RESULT_RELEASED exactly once — after the row is saved, and not
     *         again for an attempt that was already released.
     */
    private boolean autoReleaseResultIfApplicable(StudentAttempt attempt) {
        try {
            Assessment assessment = attempt.getRegistration().getAssessment();
            String resultType = assessment.getResultType();
            if (resultType == null) return false;

            boolean alreadyReleased = ReleaseResultStatusEnum.RELEASED.name()
                    .equals(attempt.getReportReleaseStatus());

            if (ResultTypeEnum.AUTO_AFTER_SUBMISSION.name().equals(resultType)) {
                attempt.setReportReleaseStatus(ReleaseResultStatusEnum.RELEASED.name());
                attempt.setReportLastReleaseDate(new Date());
                return !alreadyReleased;
            } else if (ResultTypeEnum.AUTO_AFTER_ASSESSMENT_END.name().equals(resultType)) {
                Date now = new Date();
                // A mock or practice test never ends (its window closes in 9999),
                // so "after the assessment ends" would mean never. Release on
                // submission instead - the only reading that shows results at all.
                boolean openEnded = OPEN_ENDED_PLAY_MODES.contains(
                        assessment.getPlayMode() == null ? "" : assessment.getPlayMode().toUpperCase());
                if (openEnded || (assessment.getBoundEndTime() != null && now.after(assessment.getBoundEndTime()))) {
                    attempt.setReportReleaseStatus(ReleaseResultStatusEnum.RELEASED.name());
                    attempt.setReportLastReleaseDate(now);
                    return !alreadyReleased;
                }
            }
        } catch (Exception e) {
            log.error("Failed to auto-release result for attempt {}: {}", attempt.getId(), e.getMessage());
        }
        return false;
    }

    @Transactional
    public Double calculateTotalMarksForAttemptAndUpdateQuestionWiseMarks(Optional<StudentAttempt> studentAttemptOptional) {
        return calculateTotalMarks(studentAttemptOptional);
    }

    /**
     * This method calculates the total marks for a learner's assessment attempt based on the questions
     * they answered and their responses. It iterates over the sections and questions, applying the
     * appropriate marking strategy for each question type.
     *
     * <p>All DB access is batched up front (marking schemes, sections, existing
     * question_wise_marks rows) and the attempt JSON is parsed once, because the
     * previous per-question form (3+ selects and a full re-parse per question)
     * took 20-30s per attempt during live exams and saturated the async pool.
     * The question_wise_marks upserts are flushed in one saveAll at the end —
     * including on the failure path, preserving the pre-batching behaviour
     * where every question scored before a mid-loop failure kept its row.
     *
     * @param studentAttemptOptional - The student's attempt details, wrapped in an Optional.
     * @return The total marks for the learner's attempt.
     */
    public double calculateTotalMarks(Optional<StudentAttempt> studentAttemptOptional){
        MarksCalculationContext context = null;
        try{
            double totalMarks = 0.0;

            if (studentAttemptOptional.isEmpty()) {
                return 0.0;
            }

            StudentAttempt studentAttempt = studentAttemptOptional.get();
            Assessment assessment = studentAttempt.getRegistration().getAssessment();
            String attemptData = studentAttempt.getAttemptData();

            List<String> sectionList = attemptDataParserService.extractSectionJsonStrings(attemptData);

            context = buildMarksCalculationContext(assessment, studentAttempt, sectionList, attemptData);

            for (String section : sectionList) {
                totalMarks += calculateMarksForSection(section, assessment, studentAttempt, context);
            }

            flushQuestionWiseMarks(context);
            context = null;

            return totalMarks;
        } catch (Exception e) {
            log.error("Failed To Calculate Marks: " +e.getMessage());
            // Persist whatever was scored before the failure — the pre-batching
            // code saved each question's row as it went, so a mid-loop failure
            // must not wipe the per-question breakdown for the whole attempt.
            flushQuestionWiseMarks(context);
            return 0.0;
        }
    }

    private void flushQuestionWiseMarks(MarksCalculationContext context) {
        if (context == null || context.dirtyQuestionWiseMarks.isEmpty()) {
            return;
        }
        try {
            questionWiseMarksService.createQuestionWiseMarks(context.dirtyQuestionWiseMarks);
        } catch (Exception e) {
            log.error("Failed to persist question wise marks: {}", e.getMessage());
        }
    }

    /** Batched lookups for one calculateTotalMarks run, keyed by questionId + "|" + sectionId. */
    private static class MarksCalculationContext {
        final Map<String, QuestionAssessmentSectionMappingRepository.MarkingSchemeRow> markingSchemeByQuestionAndSection = new HashMap<>();
        final Map<String, Section> sectionById = new HashMap<>();
        final Map<String, QuestionWiseMarks> marksRowByQuestionAndSection = new HashMap<>();
        final Map<String, String> responseJsonByQuestionId = new HashMap<>();
        final List<QuestionWiseMarks> dirtyQuestionWiseMarks = new ArrayList<>();
        final Set<String> dirtyKeys = new HashSet<>();
    }

    private MarksCalculationContext buildMarksCalculationContext(Assessment assessment, StudentAttempt studentAttempt,
                                                                 List<String> sectionList, String attemptData) {
        MarksCalculationContext context = new MarksCalculationContext();

        List<String> sectionIds = new ArrayList<>();
        for (String sectionJson : sectionList) {
            String sectionId = attemptDataParserService.extractSectionIdFromSectionJson(sectionJson);
            if (sectionId != null && !sectionIds.contains(sectionId)) {
                sectionIds.add(sectionId);
            }
        }
        if (sectionIds.isEmpty()) {
            return context;
        }

        for (QuestionAssessmentSectionMappingRepository.MarkingSchemeRow row : questionAssessmentSectionMappingRepository
                .findMarkingSchemeRowsBySectionIds(sectionIds)) {
            String key = row.getQuestionId() + "|" + row.getSectionId();
            QuestionAssessmentSectionMappingRepository.MarkingSchemeRow current = context.markingSchemeByQuestionAndSection
                    .get(key);
            // The per-question query this replaces picked the newest row by created_at
            // when duplicates exist; keep that tie-break.
            if (current == null || (row.getCreatedAt() != null
                    && (current.getCreatedAt() == null || row.getCreatedAt().after(current.getCreatedAt())))) {
                context.markingSchemeByQuestionAndSection.put(key, row);
            }
        }

        sectionRepository.findAllById(sectionIds).forEach(section -> context.sectionById.put(section.getId(), section));

        for (QuestionWiseMarks existing : questionWiseMarksService
                .getAllQuestionWiseMarksForAttemptId(studentAttempt.getId(), assessment.getId())) {
            String questionId = existing.getQuestion() != null ? existing.getQuestion().getId() : null;
            String sectionId = existing.getSectionId() != null ? existing.getSectionId()
                    : (existing.getSection() != null ? existing.getSection().getId() : null);
            if (questionId != null && sectionId != null) {
                context.marksRowByQuestionAndSection.putIfAbsent(questionId + "|" + sectionId, existing);
            }
        }

        // One parse of the whole attempt JSON. Replaces getQuestionDetails' full
        // re-parse per question; like it, the first question node wins on duplicate
        // ids and any parse failure degrades to "{}" per question downstream.
        try {
            ObjectMapper objectMapper = new ObjectMapper();
            JsonNode rootNode = objectMapper.readTree(attemptData);
            for (JsonNode section : rootNode.path(AttemptJsonConstants.sections)) {
                for (JsonNode question : section.path(AttemptJsonConstants.questions)) {
                    String questionId = question.path(AttemptJsonConstants.questionId).asText();
                    if (!context.responseJsonByQuestionId.containsKey(questionId)) {
                        context.responseJsonByQuestionId.put(questionId, objectMapper.writeValueAsString(question));
                    }
                }
            }
        } catch (Exception e) {
            log.error("Failed to parse attempt data for marks calculation: {}", e.getMessage());
        }

        return context;
    }

    private double calculateMarksForSection(String sectionJson, Assessment assessment, StudentAttempt studentAttempt,
                                            MarksCalculationContext context) {
        double sectionMarks = 0.0;
        List<String> questionJsons = attemptDataParserService.extractQuestionJsonsFromSection(sectionJson);

        for (String question : questionJsons) {
            sectionMarks += calculateMarksForQuestion(sectionJson, question, assessment, studentAttempt, context);
        }

        return sectionMarks;
    }

    private double calculateMarksForQuestion(String sectionJson, String questionJson, Assessment assessment,
                                             StudentAttempt studentAttempt, MarksCalculationContext context) {
        String sectionId = attemptDataParserService.extractSectionIdFromSectionJson(sectionJson);
        String questionId = attemptDataParserService.extractQuestionIdFromQuestionJson(questionJson);

        String type = attemptDataParserService.extractResponseTypeFromQuestionJson(questionJson);

        QuestionAssessmentSectionMappingRepository.MarkingSchemeRow markingScheme = context.markingSchemeByQuestionAndSection
                .get(questionId + "|" + sectionId);

        if (markingScheme == null) {
            return 0.0;
        }

        String questionWiseResponseData = context.responseJsonByQuestionId.getOrDefault(questionId, "{}");

        QuestionWiseBasicDetailDto questionWiseBasicDetailDto = QuestionBasedStrategyFactory.calculateMarks(
                markingScheme.getMarkingJson(),
                markingScheme.getAutoEvaluationJson(),
                questionWiseResponseData,
                type
        );
        double marksObtained = questionWiseBasicDetailDto.getMarks();
        String answerStatus = questionWiseBasicDetailDto.getAnswerStatus();

        Section section = context.sectionById.get(sectionId);
        if (section == null) throw new VacademyException("Section Not Found");

        Long timeTakenInSecs = attemptDataParserService.extractTimeTakenInSecondsFromQuestionJson(questionJson);

        QuestionWiseMarks marksRow = context.marksRowByQuestionAndSection.get(questionId + "|" + sectionId);
        if (marksRow != null && isEvaluatorMarked(marksRow)) {
            // Read by the AI (and maybe a teacher) - a recalculation must not put
            // the word-overlap score back over that mark.
            return marksRow.getMarks();
        }
        if (marksRow != null) {
            if (!Objects.isNull(timeTakenInSecs)) {
                marksRow.setTimeTakenInSeconds(timeTakenInSecs);
            }
            if (!Objects.isNull(questionWiseResponseData)) {
                marksRow.setResponseJson(questionWiseResponseData);
            }
            marksRow.setMarks(marksObtained);
            marksRow.setSection(section);
            marksRow.setStatus(answerStatus);
            if (context.dirtyKeys.add(questionId + "|" + sectionId)) {
                context.dirtyQuestionWiseMarks.add(marksRow);
            }
        } else {
            // getReferenceById writes just the FK — the mapping row's existence
            // guarantees the question exists, so the proxy is never resolved.
            QuestionWiseMarks created = QuestionWiseMarks.builder()
                    .assessment(assessment)
                    .studentAttempt(studentAttempt)
                    .question(questionRepository.getReferenceById(questionId))
                    .timeTakenInSeconds(timeTakenInSecs)
                    .responseJson(questionWiseResponseData)
                    .section(section)
                    .status(answerStatus)
                    .marks(marksObtained).build();
            context.marksRowByQuestionAndSection.put(questionId + "|" + sectionId, created);
            context.dirtyKeys.add(questionId + "|" + sectionId);
            context.dirtyQuestionWiseMarks.add(created);
        }

        return marksObtained;
    }

    static boolean isEvaluatorMarked(QuestionWiseMarks marksRow) {
        return "AI".equals(marksRow.getMarksSource()) || "AI_REVIEWED".equals(marksRow.getMarksSource());
    }

    public LearnerAssessmentAttemptDataDto validateAndCreateJsonObject(String jsonContent) {
        try {
            ObjectMapper objectMapper = new ObjectMapper();
            return objectMapper.readValue(jsonContent, LearnerAssessmentAttemptDataDto.class);
        } catch (Exception e) {
            throw new VacademyException("Invalid json format: " + e.getMessage());
        }
    }

    public LearnerManualAttemptDataDto validateAndCreateManualAttemptJsonObject(String jsonContent) {
        try {
            ObjectMapper objectMapper = new ObjectMapper();
            return objectMapper.readValue(jsonContent, LearnerManualAttemptDataDto.class);
        } catch (Exception e) {
            throw new VacademyException("Invalid json format: " + e.getMessage());
        }
    }

    public String getQuestionDetails(String questionId, String attemptDataJson) {
        try {
            ObjectMapper objectMapper = new ObjectMapper();
            JsonNode rootNode = objectMapper.readTree(attemptDataJson);

            // Iterate over the sections array
            JsonNode sections = rootNode.path(AttemptJsonConstants.sections);
            for (JsonNode section : sections) {
                JsonNode questions = section.path(AttemptJsonConstants.questions);

                // Iterate over the questions in the current section
                for (JsonNode question : questions) {
                    // Compare question_id to find the correct question
                    if (question.path(AttemptJsonConstants.questionId).asText().equals(questionId)) {
                        return objectMapper.writeValueAsString(question); // Return question as JSON string
                    }
                }
            }
            return "{}"; // Return empty JSON if questionId not found
        } catch (Exception e) {
            return "{}"; // Return empty JSON in case of error
        }
    }

    public List<StudentAttempt> getStudentAttemptsByIds(List<String> attemptIds) {
        return StreamSupport
                .stream(studentAttemptRepository.findAllById(attemptIds).spliterator(), false)
                .toList();
    }

    public List<StudentAttempt> getAllParticipantsAttemptForAssessment(String assessmentId) {
        return studentAttemptRepository.findAllParticipantsFromAssessmentAndStatusNotIn(assessmentId, List.of("DELETED"));
    }

    public void revaluateForAllParticipants(String assessmentId) {
        List<StudentAttempt> allAttempts = studentAttemptRepository.findAllParticipantsFromAssessmentAndStatusNotIn(assessmentId, List.of("DELETED"));
        revaluateAssessmentForAttempts(allAttempts);
    }

    public void revaluateAssessmentForAttempts(List<StudentAttempt> allAttempts) {
        allAttempts.forEach(attempt -> {
            if (attempt.getStatus().equals("ENDED")) {
                updateStudentAttemptWithResultAfterMarksCalculation(Optional.of(attempt));
            } else if (attempt.getStatus().equals("LIVE")) {
                updateStudentAttemptWithTotalAfterMarksCalculation(Optional.of(attempt));
            }

        });
    }

    public void revaluateForCustomParticipantsAndQuestions(Assessment assessment, RevaluateRequest request) {
        List<StudentAttempt> allAttempts = StreamSupport
                .stream(studentAttemptRepository.findAllById(request.getAttemptIds()).spliterator(), false)
                .toList();

        List<RevaluateRequest.RevaluateQuestionDto> questionDtos = request.getQuestions();
        questionDtos.forEach(question -> {
            String sectionId = question.getSectionId();
            List<String> questionIds = question.getQuestionIds();

            for (StudentAttempt attempt : allAttempts) {
                calculateMarksForSectionIdAndQuestionIds(Optional.of(attempt), sectionId, questionIds, assessment);
                updateMarksAfterRevaluation(attempt, assessment.getId());
            }
        });
    }

    @Async
    public CompletableFuture<Void> revaluateForAllParticipantsWrapper(Assessment assessment, String instituteId) {
        return CompletableFuture.runAsync(() -> revaluateForAllParticipants(assessment.getId()))
                .thenRun(() -> sendEmail(instituteId, assessment));
    }

    @Async
    public CompletableFuture<Void> revaluateForParticipantIdsWrapper(Assessment assessment, List<String> allAttemptIds, String instituteId) {
        List<StudentAttempt> allAttempts = StreamSupport
                .stream(studentAttemptRepository.findAllById(allAttemptIds).spliterator(), false)
                .toList();

        return CompletableFuture.runAsync(() -> revaluateAssessmentForAttempts(allAttempts))
                .thenRun(() -> sendEmail(instituteId, assessment));
    }

    @Async
    public CompletableFuture<Void> revaluateCustomParticipantAndQuestionsWrapper(Assessment assessment, RevaluateRequest request, String instituteId) {

        return CompletableFuture.runAsync(() -> revaluateForCustomParticipantsAndQuestions(assessment, request))
                .thenRun(() -> sendEmail(instituteId, assessment));
    }


    public void updateMarksAfterRevaluation(StudentAttempt studentAttempt, String assessmentId) {
        List<QuestionWiseMarks> allQuestionWiseMarks = questionWiseMarksService.getAllQuestionWiseMarksForAttemptId(studentAttempt.getId(), assessmentId);
        double totalMarks = 0.0;

        for (QuestionWiseMarks questionWiseMarks : allQuestionWiseMarks) {
            totalMarks += questionWiseMarks.getMarks();
        }
        // Internal choice ("any 4 of 5"): the extra answers keep their marks but leave
        // the total. Nothing changes for a paper without groups.
        if (choiceGroups != null) {
            java.util.Map<String, Double> byQuestion = new java.util.HashMap<>();
            for (QuestionWiseMarks m : allQuestionWiseMarks) {
                if (m.getQuestion() != null) byQuestion.put(m.getQuestion().getId(), m.getMarks());
            }
            for (String left : choiceGroups.notCountedByMarks(assessmentId, byQuestion)) {
                Double marks = byQuestion.get(left);
                if (marks != null) totalMarks -= marks;
            }
        }

        studentAttempt.setTotalMarks(totalMarks);
        if (studentAttempt.getStatus().equals("ENDED")) {
            studentAttempt.setResultMarks(totalMarks);
        }

        studentAttemptRepository.save(studentAttempt);
    }

    public void calculateMarksForSectionIdAndQuestionIds(Optional<StudentAttempt> studentAttemptOptional, String sectionId, List<String> questionIds, Assessment assessment) {
        questionIds.forEach(questionId -> {
            calculateMarksForSectionIdAndQuestionId(studentAttemptOptional, sectionId, questionId, assessment);
        });
    }


    public double calculateMarksForSectionIdAndQuestionId(Optional<StudentAttempt> studentAttemptOptional, String sectionId, String questionId, Assessment assessment) {
        if (studentAttemptOptional.isEmpty()) throw new VacademyException("Student Attempt Not Found");

        StudentAttempt studentAttempt = studentAttemptOptional.get();
        String jsonAttemptData = studentAttempt.getAttemptData();
        if (Objects.isNull(jsonAttemptData)) return 0.0;

        Optional<QuestionAssessmentSectionMapping> questionAssessmentSectionMapping =
                questionAssessmentSectionMappingRepository.findByQuestionIdAndSectionId(questionId, sectionId);

        if (questionAssessmentSectionMapping.isEmpty()) {
            return 0.0;
        }

        QuestionAssessmentSectionMapping markingScheme = questionAssessmentSectionMapping.get();
        Question questionAsked = markingScheme.getQuestion();
        String questionWiseResponseData = getQuestionDetails(questionId, jsonAttemptData);

        QuestionWiseBasicDetailDto questionWiseBasicDetailDto = QuestionBasedStrategyFactory.calculateMarks(
                markingScheme.getMarkingJson(),
                questionAsked.getAutoEvaluationJson(),
                questionWiseResponseData,
                questionAsked.getQuestionType()
        );

        double marksObtained = questionWiseBasicDetailDto.getMarks();
        String answerStatus = questionWiseBasicDetailDto.getAnswerStatus();

        Section section = questionAssessmentSectionMapping.get().getSection();

        questionWiseMarksService.updateQuestionWiseMarksForEveryQuestion(
                assessment, studentAttempt, questionAsked, questionWiseResponseData, null, answerStatus, section, marksObtained
        );

        return marksObtained;
    }


    private void sendEmail(String instituteId, Assessment assessment) {
        assessmentNotificationService.sendNotificationsToAdminsAfterReevaluating(assessment, instituteId);
    }

    public Optional<StudentAttempt> getStudentAttemptById(String id) {
        return studentAttemptRepository.findById(id);
    }

    public Page<ManualAttemptResponseDto> getAllManualAssignedAttempt(String userId, String assessmentId, String instituteId, String name, List<String> evaluationStatus, Pageable pageable) {
        if (Objects.isNull(evaluationStatus)) evaluationStatus = new ArrayList<>();
        return studentAttemptRepository.findAllAssignedAttemptForUserIdWithFilter(userId, instituteId, assessmentId, name, evaluationStatus, pageable);
    }

    public List<StudentAttempt> getAllLiveAttempt() {
        return studentAttemptRepository.findByStatusNotIn(List.of(AssessmentAttemptEnum.ENDED.name()));
    }

    /**
     * Assessment types with no clock. A practice test is "no time limits" and a
     * survey cannot even be given a duration; the learner app shows them no
     * timer. Their attempts must never be ended for running out of time.
     */
    public static final List<String> UNTIMED_PLAY_MODES = List.of("PRACTICE", "SURVEY");

    /** Always-available types: their live window is "now until 9999", so they never end. */
    public static final List<String> OPEN_ENDED_PLAY_MODES = List.of("MOCK", "PRACTICE");

    public Set<String> getOpenUntimedAttemptIds() {
        return new HashSet<>(studentAttemptRepository.findOpenAttemptIdsByPlayModes(
                List.of(AssessmentAttemptEnum.ENDED.name()), UNTIMED_PLAY_MODES));
    }

    public List<StudentAttempt> getAllAttemptsFromIds(List<String> attemptIds) {
        return StreamSupport.stream(studentAttemptRepository.findAllById(attemptIds).spliterator(), false)
                .toList();
    }
}
