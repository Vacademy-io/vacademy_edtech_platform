package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.assessment.entity.AiQuestionEvaluation;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.util.CbeAnswers;
import vacademy.io.assessment_service.features.question_core.util.CbeConfigRedactor;

import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.learner_assessment.constants.AttemptJsonConstants;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * AI evaluation of an ONLINE attempt: the learner typed an essay, letter or
 * email in the test player instead of uploading an answer sheet.
 *
 * The copy-check pipeline grades an uploaded PDF and every question on it. An
 * online attempt has no PDF, and its objective questions were already scored
 * exactly on submit, so only the written answers go to the AI (as text, see
 * ai_service copy_check/typed_answers.py) and the attempt total is those AI
 * marks plus the auto-scored marks of everything else.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class TypedAnswerEvaluation {

    /** Question types the AI grades on an online attempt. */
    public static final List<String> AI_GRADED_TYPES = List.of("LONG_ANSWER", CbeConfigRedactor.CBE_TYPE);

    /**
     * Question types that are never auto-scored (always 0 / PENDING on submit), so an
     * attempt that answered one is held for the teacher even when the assessment's AI
     * evaluation is off - otherwise the 0 would be auto-released as the result.
     */
    public static final List<String> TEACHER_GRADED_TYPES = List.of(CbeConfigRedactor.CBE_TYPE);

    private final EvaluationUtilityService evaluationUtilityService;
    private final QuestionAssessmentSectionMappingRepository questionMappingRepository;
    private final QuestionWiseMarksRepository questionWiseMarksRepository;
    private final ObjectMapper objectMapper;

    /** Internal choice ("any 4 of 5"); null in unit tests that do not need it. */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private DashboardChoiceGroups choiceGroups;

    public boolean hasAnswerSheet(StudentAttempt attempt) {
        if (attempt == null || attempt.getAttemptData() == null) return false;
        String fileId = evaluationUtilityService.extractFileId(attempt.getAttemptData());
        return fileId != null && !fileId.isBlank();
    }

    /**
     * An online attempt: typed in the player, no uploaded sheet. A MANUAL-evaluation
     * assessment is the PDF-upload player - an attempt there without a file is a
     * missing copy, not typed answers, and keeps its old handling.
     */
    public boolean isTypedAttempt(StudentAttempt attempt, Assessment assessment) {
        return assessment != null
                && !"MANUAL".equalsIgnoreCase(assessment.getEvaluationType())
                && !hasAnswerSheet(attempt);
    }

    public static boolean isAiGraded(Question question) {
        return question != null && question.getQuestionType() != null
                && AI_GRADED_TYPES.contains(question.getQuestionType().toUpperCase());
    }

    /**
     * An online attempt the AI will grade: the assessment opted in, nothing was
     * uploaded, and the paper has a written question. Such an attempt is held
     * for the teacher like a checked copy - its written answers carry only the
     * word-overlap score until the AI (and then the teacher) has read them.
     */
    public boolean awaitsAiGrading(StudentAttempt attempt, Assessment assessment) {
        if (attempt == null || assessment == null) return false;
        if (!Boolean.TRUE.equals(assessment.getAiEvaluationEnabled())) return false;
        if (!isTypedAttempt(attempt, assessment)) return false;
        try {
            return questionMappingRepository.existsQuestionOfTypesInAssessment(assessment.getId(), AI_GRADED_TYPES);
        } catch (Exception e) {
            log.warn("[AI-EVAL-TYPED] could not check written questions for assessment {}: {}",
                    assessment.getId(), e.getMessage());
            return false;
        }
    }

    /**
     * Owner decision 2026-11-18, "CBE answers always go to AI": an online attempt that
     * answered a CBE_RESPONSE question is sent to AI marking on submit even when the
     * test's "Evaluate submissions with AI" is off. Nothing else can mark such an answer
     * (it is stored 0 / PENDING and the attempt is held, see {@link #awaitsTeacherGrading}),
     * so without this the attempt waited forever. True only when the switch is OFF -
     * an opted-in test is queued by its own rule ({@link #awaitsAiGrading}) - and only
     * for an answer beyond the template, so a blank answer never costs credits.
     */
    public boolean cbeAlwaysAiGraded(StudentAttempt attempt, Assessment assessment) {
        if (attempt == null || assessment == null) return false;
        if (Boolean.TRUE.equals(assessment.getAiEvaluationEnabled())) return false;
        return answeredCbe(attempt, assessment);
    }

    /**
     * Whether the learner's answers (attempt_data, the JSON the player submitted) hold a
     * non-blank answer to a CBE_RESPONSE question of this paper. Read from attempt_data,
     * not question_wise_marks: on submit those rows are written by an async job that may
     * not have run yet. Like the marks calculation, the first node of a question id wins.
     * The type comes from the paper's own question, never from what the client sent.
     */
    public boolean answeredCbe(StudentAttempt attempt, Assessment assessment) {
        if (attempt == null || assessment == null || assessment.getId() == null) return false;
        if (!isTypedAttempt(attempt, assessment)) return false;
        String attemptData = attempt.getAttemptData();
        if (attemptData == null || attemptData.isBlank()) return false;
        try {
            // Cheap pre-filter, no database: a CBE answer is an object with "parts".
            Map<String, JsonNode> candidates = new LinkedHashMap<>();
            JsonNode root = objectMapper.readTree(attemptData);
            for (JsonNode section : root.path(AttemptJsonConstants.sections)) {
                for (JsonNode question : section.path(AttemptJsonConstants.questions)) {
                    String questionId = question.path(AttemptJsonConstants.questionId).asText(null);
                    if (questionId == null || candidates.containsKey(questionId)) continue;
                    JsonNode answer = CbeAnswers.answerObject(question.path("responseData").path("answer"));
                    candidates.put(questionId, answer != null && answer.path("parts").isObject() ? answer : null);
                }
            }
            candidates.values().removeIf(java.util.Objects::isNull);
            if (candidates.isEmpty()) return false;
            if (!questionMappingRepository.existsQuestionOfTypesInAssessment(assessment.getId(), TEACHER_GRADED_TYPES)) {
                return false;
            }
            for (QuestionAssessmentSectionMapping mapping : questionMappingRepository
                    .getQuestionAssessmentSectionMappingByAssessmentId(assessment.getId())) {
                Question q = mapping.getQuestion();
                if (q == null || "DELETED".equalsIgnoreCase(mapping.getStatus())
                        || !CbeConfigRedactor.isCbe(q.getQuestionType())) {
                    continue;
                }
                JsonNode answer = candidates.get(q.getId());
                if (answer != null && CbeAnswers.isAnswered(answer, CbeAnswers.configData(q.getAutoEvaluationJson()))) {
                    return true;
                }
            }
            return false;
        } catch (Exception e) {
            log.warn("[AI-EVAL-TYPED] could not read CBE answers of attempt {}: {}", attempt.getId(), e.getMessage());
            return false;
        }
    }

    /**
     * An AUTOMATIC run (queued on submit or at time-out, not by a teacher and not by a
     * partner API key) on an online attempt of a test whose AI evaluation is OFF. Such a
     * run exists only because of {@link #cbeAlwaysAiGraded}, so it grades the CBE answers
     * and nothing else: long answers keep their submit-time score, as they always did
     * with the switch off, and are not charged for.
     */
    public static boolean cbeOnlyRun(AiEvaluationProcess process, Assessment assessment) {
        if (process == null) return false;
        if (assessment != null && Boolean.TRUE.equals(assessment.getAiEvaluationEnabled())) return false;
        boolean teacher = process.getTriggeredBy() != null && !process.getTriggeredBy().isBlank();
        boolean partner = process.getApiKeyId() != null && !process.getApiKeyId().isBlank();
        return !teacher && !partner;
    }

    /** Whether a run grades this question: every AI-graded type, or only CBE in a CBE-only run. */
    public static boolean gradedInRun(Question question, boolean cbeOnly) {
        if (!isAiGraded(question)) return false;
        return !cbeOnly || CbeConfigRedactor.isCbe(question.getQuestionType());
    }

    /**
     * One row per question, the first in the given order. The same question can sit in
     * two sections of one paper (the create-test wizard saved every section twice once,
     * 2026-11-18): it is graded once - one tracking row, which the unique constraint
     * (process, question) requires - and the verdict is applied to each of its
     * question_wise_marks rows. Rows without a question are kept as they are.
     */
    public static List<QuestionWiseMarks> oncePerQuestion(List<QuestionWiseMarks> rows) {
        if (rows == null || rows.size() < 2) return rows;
        Set<String> seen = new HashSet<>();
        List<QuestionWiseMarks> out = new ArrayList<>(rows.size());
        for (QuestionWiseMarks row : rows) {
            String questionId = row.getQuestion() != null ? row.getQuestion().getId() : null;
            if (questionId == null || seen.add(questionId)) {
                out.add(row);
            }
        }
        return out.size() == rows.size() ? rows : out;
    }

    /**
     * An online attempt that answered a question nobody auto-scores (CBE_RESPONSE). It
     * is held - result PENDING, report not released - whether or not AI evaluation is on:
     * its stored 0 is a placeholder, not a mark. Decided on the question's own type
     * (question_wise_marks -> question), never on the type the client sent.
     */
    public boolean awaitsTeacherGrading(StudentAttempt attempt, Assessment assessment) {
        if (attempt == null || assessment == null || attempt.getId() == null) return false;
        if (!isTypedAttempt(attempt, assessment)) return false;
        try {
            if (!questionMappingRepository.existsQuestionOfTypesInAssessment(assessment.getId(), TEACHER_GRADED_TYPES)) {
                return false;
            }
            for (QuestionWiseMarks marks : questionWiseMarksRepository.findByStudentAttemptId(attempt.getId())) {
                Question q = marks.getQuestion();
                if (q != null && q.getQuestionType() != null
                        && TEACHER_GRADED_TYPES.contains(q.getQuestionType().toUpperCase())
                        && typedAnswer(marks) != null) {
                    return true;
                }
            }
            return false;
        } catch (Exception e) {
            log.warn("[AI-EVAL-TYPED] could not check teacher-graded answers for attempt {}: {}",
                    attempt.getId(), e.getMessage());
            return false;
        }
    }

    /**
     * The text the learner typed, from question_wise_marks.response_json ({responseData: {answer}}).
     * For a CBE_RESPONSE question the answer is an object ({parts: {...}}): it comes back as
     * its JSON string, or null when every part is blank (nothing beyond the template).
     */
    public String typedAnswer(QuestionWiseMarks marks) {
        if (marks == null || marks.getResponseJson() == null || marks.getResponseJson().isBlank()) return null;
        if (isCbeQuestion(marks)) {
            return cbeAnswer(marks);
        }
        try {
            JsonNode answer = objectMapper.readTree(marks.getResponseJson()).path("responseData").path("answer");
            return answer.isValueNode() && !answer.isNull() ? answer.asText() : null;
        } catch (Exception e) {
            log.warn("[AI-EVAL-TYPED] unreadable response_json on question_wise_marks {}: {}",
                    marks.getId(), e.getMessage());
            return null;
        }
    }

    private static boolean isCbeQuestion(QuestionWiseMarks marks) {
        try {
            Question q = marks.getQuestion();
            return q != null && CbeConfigRedactor.isCbe(q.getQuestionType());
        } catch (Exception e) {
            return false;
        }
    }

    private String cbeAnswer(QuestionWiseMarks marks) {
        try {
            JsonNode answer = CbeAnswers.answerFromResponseJson(marks.getResponseJson());
            if (answer == null) return null;
            JsonNode config = CbeAnswers.configData(marks.getQuestion().getAutoEvaluationJson());
            if (!CbeAnswers.isAnswered(answer, config)) return null;
            return objectMapper.writeValueAsString(answer);
        } catch (Exception e) {
            log.warn("[AI-EVAL-TYPED] unreadable CBE answer on question_wise_marks {}: {}",
                    marks.getId(), e.getMessage());
            return null;
        }
    }

    /**
     * The attempt total after an AI run: the AI's graded verdicts - exactly as before
     * for an uploaded copy. For an online attempt the run covers only the written
     * answers, so the stored marks of every other question (scored on submit) are
     * added. Questions the AI could not grade count for nothing until a teacher
     * grades them.
     */
    public double attemptTotal(StudentAttempt attempt, List<AiQuestionEvaluation> processRows) {
        double total = 0.0;
        Set<String> coveredByRun = new HashSet<>();
        // Internal choice: the extra answers in an "any N of M" group are graded but
        // not counted. Empty for an assessment without groups - the total as before.
        Set<String> notCounted = notCounted(attempt, processRows);
        Assessment assessment = attempt != null && attempt.getRegistration() != null
                ? attempt.getRegistration().getAssessment() : null;
        boolean typed = attempt != null && attempt.getId() != null && isTypedAttempt(attempt, assessment);
        List<QuestionWiseMarks> stored = typed ? questionWiseMarksRepository.findByStudentAttemptId(attempt.getId())
                : List.of();
        // A question that sits in two sections has a marks row per section, and the
        // submit-time total (and the paper's total marks) count each section. It is
        // graded once (oncePerQuestion), so its verdict counts once per SECTION it sits
        // in - not per row: question_wise_marks has no unique (attempt, question,
        // section) key and old duplicate rows of one section exist (V34), which the
        // submit-time total counts once. 1 for every question of a normal paper.
        Map<String, Set<String>> sectionsPerQuestion = new HashMap<>();
        for (QuestionWiseMarks marks : stored) {
            if (marks.getQuestion() == null) continue;
            String sectionId = sectionIdOf(marks);
            sectionsPerQuestion.computeIfAbsent(marks.getQuestion().getId(), k -> new HashSet<>())
                    .add(sectionId != null ? sectionId : "row-" + System.identityHashCode(marks));
        }
        Map<String, Integer> rowsPerQuestion = new HashMap<>();
        sectionsPerQuestion.forEach((questionId, sections) -> rowsPerQuestion.put(questionId, sections.size()));
        for (AiQuestionEvaluation row : processRows) {
            int times = 1;
            if (row.getQuestion() != null) {
                coveredByRun.add(row.getQuestion().getId());
                if (notCounted.contains(row.getQuestion().getId())) continue;
                times = Math.max(1, rowsPerQuestion.getOrDefault(row.getQuestion().getId(), 1));
            }
            if ("COMPLETED".equals(row.getStatus()) && row.getMarksAwarded() != null) {
                total += row.getMarksAwarded().doubleValue() * times;
            }
        }
        if (!typed) return total;
        for (QuestionWiseMarks marks : stored) {
            if (marks.getQuestion() != null && !coveredByRun.contains(marks.getQuestion().getId())) {
                total += marks.getMarks();
            }
        }
        return total;
    }

    private static String sectionIdOf(QuestionWiseMarks marks) {
        if (marks.getSectionId() != null) return marks.getSectionId();
        return marks.getSection() != null ? marks.getSection().getId() : null;
    }

    /**
     * The scope of a run, decided the same way at dispatch, pricing and completion: true
     * when the run grades the attempt's answered CBE questions only. That is an automatic
     * run on a test whose AI evaluation is off ({@link #cbeOnlyRun}) on an attempt that
     * answered a CBE question - the only kind of attempt the CBE rule queues. An
     * automatic run on an attempt WITHOUT a CBE answer can only have been queued while
     * the switch was on (it was turned off before dispatch), so it keeps grading every
     * written answer as it was queued to.
     */
    public boolean gradesCbeOnly(AiEvaluationProcess process) {
        if (process == null) return false;
        Assessment assessment = process.getAssessment();
        StudentAttempt attempt = process.getStudentAttempt();
        if (assessment == null && attempt != null && attempt.getRegistration() != null) {
            assessment = attempt.getRegistration().getAssessment();
        }
        return cbeOnlyRun(process, assessment) && answeredCbe(attempt, assessment);
    }

    /**
     * Whether the attempt's marks rows still hold an older copy of a written answer than
     * the submitted attempt_data: the 60-second live sync writes response_json, and the
     * async marks job that runs on submit replaces it - possibly after the AI poller
     * has already picked the attempt up. Compared per AI-graded question on the answer
     * the player sent (responseData), first node of a question id wins as in the marks
     * calculation. Rows the AI or a teacher already marked are frozen by design
     * (StudentAttemptService.isEvaluatorMarked) and are not compared.
     */
    public boolean answersBehindSubmit(StudentAttempt attempt, List<QuestionWiseMarks> rows) {
        if (attempt == null || rows == null || rows.isEmpty()) return false;
        String attemptData = attempt.getAttemptData();
        if (attemptData == null || attemptData.isBlank()) return false;
        try {
            Map<String, JsonNode> submitted = new HashMap<>();
            for (JsonNode section : objectMapper.readTree(attemptData).path(AttemptJsonConstants.sections)) {
                for (JsonNode question : section.path(AttemptJsonConstants.questions)) {
                    String questionId = question.path(AttemptJsonConstants.questionId).asText(null);
                    if (questionId != null) submitted.putIfAbsent(questionId, question.path("responseData"));
                }
            }
            for (QuestionWiseMarks row : rows) {
                if (!isAiGraded(row.getQuestion())) continue;
                if ("AI".equals(row.getMarksSource()) || "AI_REVIEWED".equals(row.getMarksSource())) continue;
                JsonNode sent = submitted.get(row.getQuestion().getId());
                if (sent == null) continue;
                JsonNode stored = row.getResponseJson() == null || row.getResponseJson().isBlank()
                        ? com.fasterxml.jackson.databind.node.MissingNode.getInstance()
                        : objectMapper.readTree(row.getResponseJson()).path("responseData");
                if (!sent.equals(stored)) return true;
            }
            return false;
        } catch (Exception e) {
            log.warn("[AI-EVAL-TYPED] could not compare stored answers of attempt {}: {}", attempt.getId(),
                    e.getMessage());
            return false;
        }
    }

    /**
     * Whether a teacher has already set a mark an AI run would overwrite: on the AI
     * review page (AI_REVIEWED), or from the submission view (TEACHER) on a written /
     * CBT question. A teacher's mark on an MCQ is never touched by an AI run, so it
     * does not stop one.
     */
    public boolean hasTeacherReviewedMarks(StudentAttempt attempt) {
        if (attempt == null || attempt.getId() == null) return false;
        return questionWiseMarksRepository.findByStudentAttemptId(attempt.getId()).stream()
                .anyMatch(marks -> "AI_REVIEWED".equals(marks.getMarksSource())
                        || ("TEACHER".equals(marks.getMarksSource()) && isAiGraded(marks.getQuestion())));
    }

    /**
     * The questions an "any N of M" choice group leaves out of the total for these
     * marks, exactly as {@link #attemptTotal} decides it. Empty without groups.
     */
    public Set<String> notCountedQuestionIds(StudentAttempt attempt, List<AiQuestionEvaluation> rows) {
        return notCounted(attempt, rows);
    }

    private Set<String> notCounted(StudentAttempt attempt, List<AiQuestionEvaluation> rows) {
        if (choiceGroups == null || attempt == null || attempt.getRegistration() == null
                || attempt.getRegistration().getAssessment() == null) {
            return Set.of();
        }
        return choiceGroups.notCounted(attempt.getRegistration().getAssessment().getId(), rows);
    }
}
