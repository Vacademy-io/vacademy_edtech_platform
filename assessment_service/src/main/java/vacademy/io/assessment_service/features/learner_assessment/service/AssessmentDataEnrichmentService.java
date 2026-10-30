package vacademy.io.assessment_service.features.learner_assessment.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.SectionRepository;
import vacademy.io.assessment_service.features.assessment.service.HtmlBuilderService;
import vacademy.io.assessment_service.features.learner_assessment.dto.SectionComparisonDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.StudentComparisonDto;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.question_core.entity.Option;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.repository.OptionRepository;
import vacademy.io.assessment_service.features.question_core.repository.QuestionRepository;

import java.util.*;

/**
 * Service to enrich assessment data with actual text content instead of just
 * IDs
 * This makes the data more useful for LLM processing
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AssessmentDataEnrichmentService {

    private final QuestionRepository questionRepository;
    private final OptionRepository optionRepository;
    private final SectionRepository sectionRepository;
    private final QuestionWiseMarksRepository questionWiseMarksRepository;
    private final LearnerReportService learnerReportService;
    private final ObjectMapper objectMapper;

    /**
     * Off = the payload carries no class context. Each comparison scans every attempt of the
     * assessment, once per submission, so a big exam's submit wave saturates the database
     * (see application.properties).
     */
    @Value("${assessment.llm-analytics.class-context-enabled:true}")
    private boolean classContextEnabled;

    /**
     * Build enriched assessment data with full text content for LLM analysis
     */
    public Map<String, Object> buildEnrichedAssessmentData(
            StudentAttempt studentAttempt,
            String assessmentId,
            String assessmentName,
            String assessmentType,
            Integer durationMinutes,
            Integer totalMarks,
            String instituteId) {

        Map<String, Object> enrichedData = new HashMap<>();

        try {
            enrichedData.put("activity_type", "assessment_attempt");
            enrichedData.put("timestamp",
                    studentAttempt.getSubmitTime() != null ? studentAttempt.getSubmitTime().toInstant().toString()
                            : java.time.Instant.now().toString());

            // Envelope identifiers (root level). admin_core_service reads these to set
            // activity_log.source_id (= assessmentId). Without them source_id stays null
            // and the learner AI report fetch (by userId + sourceId) never matches.
            enrichedData.put("assessmentId", assessmentId);
            enrichedData.put("attemptId", studentAttempt.getId());
            enrichedData.put("instituteId", instituteId);

            // Assessment metadata. `id` is what admin_core_service's primary extractor
            // (assessment.id) reads to set activity_log.source_id; the root-level
            // assessmentId above is its fallback. Both are populated so source_id is set
            // regardless of which extraction path admin takes.
            Map<String, Object> assessment = new LinkedHashMap<>();
            assessment.put("id", assessmentId);
            assessment.put("name", assessmentName);
            assessment.put("type", assessmentType);
            assessment.put("total_marks", totalMarks != null ? totalMarks : 0);
            assessment.put("duration_minutes", durationMinutes != null ? durationMinutes : 0);
            enrichedData.put("assessment", assessment);

            // Attempt metadata
            Map<String, Object> attempt = new LinkedHashMap<>();
            attempt.put("id", studentAttempt.getId());
            attempt.put("user_id", studentAttempt.getRegistration().getUserId());
            attempt.put("start_time",
                    studentAttempt.getStartTime() != null ? studentAttempt.getStartTime().toInstant().toString() : null);
            attempt.put("submit_time",
                    studentAttempt.getSubmitTime() != null ? studentAttempt.getSubmitTime().toInstant().toString() : null);
            attempt.put("duration_seconds", studentAttempt.getTotalTimeInSeconds());
            attempt.put("time_limit_seconds", durationMinutes != null ? durationMinutes * 60 : 0);
            enrichedData.put("attempt", attempt);

            // Summary
            double maxScore = totalMarks != null ? totalMarks : 0;
            double scored = studentAttempt.getResultMarks() != null ? studentAttempt.getResultMarks() : 0;
            Map<String, Object> summary = new LinkedHashMap<>();
            summary.put("scored_marks", scored);
            summary.put("total_marks", maxScore);
            summary.put("result_status", studentAttempt.getResultStatus());
            summary.put("percentage", maxScore > 0 ? Math.round((scored / maxScore) * 1000.0) / 10.0 : 0);
            enrichedData.put("summary", summary);

            // Comparison context (rank, percentile, class avg) — for AI comparative insights
            if (classContextEnabled) {
                addComparisonContext(enrichedData, studentAttempt, assessmentId, instituteId);
            }

            // Question-wise marks (status per question — CORRECT/INCORRECT/PARTIAL_CORRECT)
            Map<String, QuestionWiseMarks> qwmMap = buildQuestionWiseMarksMap(assessmentId, studentAttempt.getId());

            // Parse submit data and enrich with actual content + marks status
            String submitDataJson = studentAttempt.getSubmitData() != null ? studentAttempt.getSubmitData()
                    : studentAttempt.getAttemptData();

            if (submitDataJson != null) {
                List<Map<String, Object>> enrichedSections = enrichSubmitData(submitDataJson, assessmentId, qwmMap);
                enrichedData.put("sections", enrichedSections);
            }

        } catch (Exception e) {
            log.error("Error enriching assessment data", e);
            enrichedData.put("enrichmentError", e.getMessage());
        }

        return enrichedData;
    }

    /**
     * Add comparison context (rank, percentile, class stats) from buildComparisonData
     */
    private void addComparisonContext(Map<String, Object> enrichedData, StudentAttempt studentAttempt,
                                       String assessmentId, String instituteId) {
        try {
            String userId = studentAttempt.getRegistration().getUserId();
            StudentComparisonDto comparison = learnerReportService.buildComparisonData(
                    userId, assessmentId, studentAttempt.getId(), instituteId);

            if (comparison != null) {
                Map<String, Object> ctx = new LinkedHashMap<>();
                ctx.put("student_rank", comparison.getStudentRank());
                ctx.put("student_percentile", comparison.getStudentPercentile());
                ctx.put("total_participants", comparison.getTotalParticipants());
                ctx.put("class_average_marks", comparison.getAverageMarks());
                ctx.put("highest_marks", comparison.getHighestMarks());
                ctx.put("lowest_marks", comparison.getLowestMarks());
                ctx.put("student_accuracy", comparison.getStudentAccuracy());
                ctx.put("class_accuracy", comparison.getClassAccuracy());
                ctx.put("student_duration_seconds", comparison.getStudentDuration());
                ctx.put("average_duration_seconds", comparison.getAverageDuration());

                // Section-wise comparison
                if (comparison.getSectionWiseComparison() != null) {
                    List<Map<String, Object>> sectionCtx = new ArrayList<>();
                    for (SectionComparisonDto sc : comparison.getSectionWiseComparison()) {
                        Map<String, Object> s = new LinkedHashMap<>();
                        s.put("section_name", sc.getSectionName());
                        s.put("student_marks", sc.getStudentMarks());
                        s.put("section_total", sc.getSectionTotalMarks());
                        s.put("class_average", sc.getSectionAverageMarks());
                        s.put("class_highest", sc.getSectionHighestMarks());
                        s.put("student_accuracy", sc.getStudentAccuracy());
                        s.put("class_accuracy", sc.getClassAccuracy());
                        sectionCtx.add(s);
                    }
                    ctx.put("section_comparison", sectionCtx);
                }

                enrichedData.put("class_context", ctx);
            }
        } catch (Exception e) {
            log.warn("Failed to add comparison context for AI enrichment: {}", e.getMessage());
        }
    }

    /**
     * Build a map of questionId -> QuestionWiseMarks for quick lookup
     */
    private Map<String, QuestionWiseMarks> buildQuestionWiseMarksMap(String assessmentId, String attemptId) {
        Map<String, QuestionWiseMarks> map = new HashMap<>();
        try {
            List<QuestionWiseMarks> qwmList = questionWiseMarksRepository.findByStudentAttemptId(attemptId);
            for (QuestionWiseMarks qwm : qwmList) {
                if (qwm.getQuestion() != null) {
                    map.put(qwm.getQuestion().getId(), qwm);
                }
            }
        } catch (Exception e) {
            log.warn("Failed to load question-wise marks: {}", e.getMessage());
        }
        return map;
    }

    /**
     * Parse submit data JSON and enrich with question/option text content
     */
    private List<Map<String, Object>> enrichSubmitData(String submitDataJson, String assessmentId,
                                                         Map<String, QuestionWiseMarks> qwmMap) {
        List<Map<String, Object>> enrichedSections = new ArrayList<>();

        try {
            JsonNode submitData = objectMapper.readTree(submitDataJson);
            JsonNode sectionsNode = submitData.get("sections");

            if (sectionsNode == null || !sectionsNode.isArray()) {
                return enrichedSections;
            }

            // Fetch all sections at once
            Set<String> sectionIds = new HashSet<>();
            sectionsNode.forEach(sectionNode -> sectionIds.add(sectionNode.get("sectionId").asText()));

            Map<String, Section> sectionMap = new HashMap<>();
            if (!sectionIds.isEmpty()) {
                sectionRepository.findAllById(sectionIds).forEach(section -> sectionMap.put(section.getId(), section));
            }

            for (JsonNode sectionNode : sectionsNode) {
                enrichedSections.add(enrichSection(sectionNode, sectionMap, qwmMap));
            }

        } catch (Exception e) {
            log.error("[DataEnrichment] Error parsing submit data", e);
        }

        return enrichedSections;
    }

    /**
     * Enrich a single section with metadata and questions
     */
    private Map<String, Object> enrichSection(JsonNode sectionNode, Map<String, Section> sectionMap,
                                                Map<String, QuestionWiseMarks> qwmMap) {
        Map<String, Object> enrichedSection = new LinkedHashMap<>();

        try {
            String sectionId = sectionNode.get("sectionId").asText();

            Section section = sectionMap.get(sectionId);
            if (section != null) {
                enrichedSection.put("section_name", section.getName());
                enrichedSection.put("total_marks", section.getTotalMarks());
                enrichedSection.put("cut_off_marks", section.getCutOffMarks());
                enrichedSection.put("marks_per_question", section.getMarksPerQuestion());
            }

            enrichedSection.put("time_elapsed_seconds",
                    sectionNode.has("timeElapsedInSeconds") ? sectionNode.get("timeElapsedInSeconds").asInt() : 0);

            JsonNode questionsNode = sectionNode.get("questions");
            if (questionsNode != null && questionsNode.isArray()) {
                // Per-question max marks live on the section, not on the question or on
                // question_wise_marks, so they have to be carried down - without them the
                // model sees marks_obtained with nothing to weigh it against.
                Double marksPerQuestion = section != null ? section.getMarksPerQuestion() : null;
                enrichedSection.put("questions", enrichQuestions(questionsNode, qwmMap, marksPerQuestion));
            }

        } catch (Exception e) {
            log.error("[DataEnrichment] Error enriching section", e);
        }

        return enrichedSection;
    }

    /**
     * Enrich questions with full text content
     */
    private List<Map<String, Object>> enrichQuestions(JsonNode questionsNode,
                                                       Map<String, QuestionWiseMarks> qwmMap,
                                                       Double marksPerQuestion) {
        List<Map<String, Object>> enrichedQuestions = new ArrayList<>();

        try {
            Set<String> questionIds = new HashSet<>();
            questionsNode.forEach(qNode -> questionIds.add(qNode.get("questionId").asText()));

            Map<String, Question> questionMap = new HashMap<>();
            if (!questionIds.isEmpty()) {
                questionRepository.findAllById(questionIds).forEach(q -> questionMap.put(q.getId(), q));
            }

            // Batch-fetch all options for these questions
            Map<String, List<Option>> optionsByQuestion = new HashMap<>();
            for (String qId : questionIds) {
                optionsByQuestion.put(qId, optionRepository.findByQuestionId(qId));
            }

            for (JsonNode questionNode : questionsNode) {
                String qId = questionNode.get("questionId").asText();
                enrichedQuestions.add(enrichQuestion(questionNode, questionMap, qwmMap,
                        optionsByQuestion.getOrDefault(qId, List.of()), marksPerQuestion));
            }

        } catch (Exception e) {
            log.error("[DataEnrichment] Error enriching questions", e);
        }

        return enrichedQuestions;
    }

    /**
     * Enrich a single question with full text, options, the answer key and what the
     * learner actually chose.
     *
     * <p>The correct answer used to be missing entirely: the payload carried the
     * question, the options, the learner's answer and a CORRECT/INCORRECT status, but
     * never what the right answer was. The prompt asks for a
     * {@code misconception_analysis} with a {@code correct_answer} field per wrong
     * question, so the model had to infer it from the explanation text - or invent it.
     */
    private Map<String, Object> enrichQuestion(JsonNode questionNode, Map<String, Question> questionMap,
                                                Map<String, QuestionWiseMarks> qwmMap, List<Option> options,
                                                Double marksPerQuestion) {
        Map<String, Object> eq = new LinkedHashMap<>();

        try {
            String questionId = questionNode.get("questionId").asText();

            Question question = questionMap.get(questionId);
            if (question != null) {
                eq.put("question_type", question.getQuestionType());
                eq.put("difficulty", question.getDifficulty());

                // Plain text — strip HTML/KaTeX for AI readability
                if (question.getTextData() != null) {
                    eq.put("question_text", stripForAI(question.getTextData().getContent()));
                }
                if (question.getParentRichText() != null) {
                    eq.put("parent_text", stripForAI(question.getParentRichText().getContent()));
                }

                // Options as readable text, one string each — the model never refers to an
                // option by id, so wrapping each label in its own object earned nothing.
                if (!options.isEmpty()) {
                    List<String> optList = new ArrayList<>();
                    for (Option opt : options) {
                        optList.add(opt.getText() != null ? stripForAI(opt.getText().getContent()) : "");
                    }
                    eq.put("options", optList);
                }

                String correctAnswer = extractCorrectAnswer(question.getAutoEvaluationJson(), options);
                if (!correctAnswer.isBlank()) {
                    eq.put("correct_answer", correctAnswer);
                }

                if (question.getExplanationTextData() != null) {
                    eq.put("explanation", stripForAI(question.getExplanationTextData().getContent()));
                }
            }

            // Student's selected answer as readable text
            String studentAnswer = extractStudentAnswer(questionNode.get("responseData"), options);
            eq.put("student_answer", studentAnswer);

            // Marks status from question_wise_marks
            QuestionWiseMarks qwm = qwmMap.get(questionId);
            if (qwm != null) {
                eq.put("status", qwm.getStatus()); // CORRECT, INCORRECT, PARTIAL_CORRECT, PENDING
                eq.put("marks_obtained", qwm.getMarks());
            } else {
                // No marks row at all: unanswered, or not yet evaluated. Say so rather than
                // leaving the field out, which reads as a wrong answer to the model.
                eq.put("status", studentAnswer.isBlank() ? "SKIPPED" : "PENDING");
                eq.put("marks_obtained", 0);
            }
            if (marksPerQuestion != null) {
                eq.put("marks", marksPerQuestion);
            }

            eq.put("time_taken_seconds",
                    questionNode.has("timeTakenInSeconds") ? questionNode.get("timeTakenInSeconds").asInt() : 0);
            eq.put("marked_for_review",
                    questionNode.has("isMarkedForReview") && questionNode.get("isMarkedForReview").asBoolean());

        } catch (Exception e) {
            log.error("[DataEnrichment] Error enriching question: {}", questionNode.get("questionId"), e);
        }

        return eq;
    }

    /**
     * The question's answer key as readable text.
     *
     * <p>Mirrors {@link HtmlBuilderService#extractContent} but resolves option ids
     * against the already-loaded option list instead of issuing a findById per option.
     * Returns "" for anything with no single right answer (CODING) or an unparseable key,
     * so the field is simply omitted rather than filled with something misleading.
     */
    private String extractCorrectAnswer(String autoEvaluationJson, List<Option> options) {
        if (autoEvaluationJson == null || autoEvaluationJson.isBlank()) {
            return "";
        }
        try {
            JsonNode root = objectMapper.readTree(autoEvaluationJson);
            JsonNode data = root.path("data");
            String type = root.path("type").asText("");

            switch (type) {
                case "MCQS", "MCQM", "TRUE_FALSE" -> {
                    return joinOptionText(data.path("correctOptionIds"), options);
                }
                case "ONE_WORD" -> {
                    return stripForAI(data.path("answer").asText(""));
                }
                case "LONG_ANSWER" -> {
                    return stripForAI(data.path("answer").path("content").asText(""));
                }
                case "NUMERIC" -> {
                    JsonNode valid = data.path("validAnswers");
                    return valid.isArray() && !valid.isEmpty() ? valid.get(0).asText() : "";
                }
                default -> {
                    return "";
                }
            }
        } catch (Exception e) {
            log.warn("[DataEnrichment] Could not read the answer key: {}", e.getMessage());
            return "";
        }
    }

    /**
     * What the learner submitted, as readable text.
     *
     * <p>Previously only MCQ option ids and a bare {@code answer} field were handled, so
     * NUMERIC responses (which use {@code validAnswer}) and CODING submissions reached the
     * model as no answer at all — indistinguishable from a skipped question.
     */
    private String extractStudentAnswer(JsonNode responseData, List<Option> options) {
        if (responseData == null || responseData.isNull()) {
            return "";
        }
        try {
            String type = responseData.path("type").asText("");
            if (responseData.has("optionIds")) {
                return joinOptionText(responseData.get("optionIds"), options);
            }
            if ("NUMERIC".equals(type) || responseData.has("validAnswer")) {
                return responseData.path("validAnswer").asText("");
            }
            if ("CODING".equals(type)) {
                return summariseCodingAnswer(responseData);
            }
            return stripForAI(responseData.path("answer").asText(""));
        } catch (Exception e) {
            log.warn("[DataEnrichment] Could not read the learner response: {}", e.getMessage());
            return "";
        }
    }

    /** A CODING submission as one line: the verdict and how many tests passed. */
    private String summariseCodingAnswer(JsonNode responseData) {
        String language = responseData.path("language").asText("");
        String verdict = responseData.path("verdict").asText("");
        int passed = 0;
        int total = 0;
        JsonNode results = responseData.path("testCaseResults");
        if (results.isArray()) {
            for (JsonNode testCase : results) {
                total++;
                if (testCase.path("passed").asBoolean(false)) {
                    passed++;
                }
            }
        }
        if (total == 0) {
            passed = responseData.path("passedCount").asInt(0);
            total = responseData.path("totalCount").asInt(0);
        }
        StringBuilder summary = new StringBuilder();
        if (!language.isEmpty()) {
            summary.append(language).append(" | ");
        }
        if (!verdict.isEmpty()) {
            summary.append(verdict).append(" | ");
        }
        summary.append(passed).append("/").append(total).append(" tests passed");
        return summary.toString();
    }

    private String joinOptionText(JsonNode optionIds, List<Option> options) {
        if (optionIds == null || !optionIds.isArray() || optionIds.isEmpty()) {
            return "";
        }
        Map<String, String> textById = new LinkedHashMap<>();
        for (Option option : options) {
            textById.put(option.getId(), option.getText() != null ? stripForAI(option.getText().getContent()) : "");
        }
        List<String> labels = new ArrayList<>();
        for (JsonNode idNode : optionIds) {
            String label = textById.get(idNode.asText());
            if (label != null && !label.isBlank()) {
                labels.add(label);
            }
        }
        return String.join(", ", labels);
    }

    /**
     * Strip HTML/KaTeX markup from text to produce clean plain text for AI analysis.
     * Reuses HtmlBuilderService's proven stripping logic.
     */
    private String stripForAI(String content) {
        if (content == null || content.isEmpty()) return "";
        return HtmlBuilderService.stripHtmlTags(content);
    }
}
