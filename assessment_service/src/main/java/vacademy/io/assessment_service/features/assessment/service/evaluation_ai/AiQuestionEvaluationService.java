package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.QuestionEvaluationDto;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.entity.AiQuestionEvaluation;
import vacademy.io.assessment_service.features.assessment.enums.QuestionEvaluationStatusEnum;
import vacademy.io.assessment_service.features.assessment.repository.AiQuestionEvaluationRepository;
import vacademy.io.assessment_service.features.question_core.entity.Question;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

@Service
@Slf4j
@RequiredArgsConstructor
public class AiQuestionEvaluationService {

        private final AiQuestionEvaluationRepository aiQuestionEvaluationRepository;
        private final ObjectMapper objectMapper;

        /**
         * Create a new question evaluation entry when starting to evaluate a question
         */
        @Transactional
        public AiQuestionEvaluation createQuestionEvaluation(
                        AiEvaluationProcess evaluationProcess,
                        Question question,
                        int questionNumber) {

                AiQuestionEvaluation questionEval = AiQuestionEvaluation.builder()
                                .evaluationProcess(evaluationProcess)
                                .question(question)
                                .questionNumber(questionNumber)
                                .status(QuestionEvaluationStatusEnum.PENDING.name())
                                .startedAt(new Date())
                                .build();

                return aiQuestionEvaluationRepository.save(questionEval);
        }

        /**
         * Clear a process's tracking rows before its (re-)dispatch inserts a new set,
         * keeping the rows a teacher edited. Returns the question ids of the kept rows:
         * the caller inserts no new row for those.
         */
        @Transactional
        public Set<String> resetForRedispatch(String processId) {
                Set<String> kept = new HashSet<>(aiQuestionEvaluationRepository.findEditedQuestionIds(processId));
                int deleted = aiQuestionEvaluationRepository.deleteNonEditedForProcess(processId);
                if (deleted > 0 || !kept.isEmpty()) {
                        log.info("[copy-check] re-dispatch of process {}: {} old tracking row(s) removed, {} edited kept",
                                        processId, deleted, kept.size());
                }
                return kept;
        }

        /**
         * One row per question: the newest (created_at, then id) when a pre-V53 double
         * dispatch left two. Order of first appearance is kept, so a list sorted by
         * question number stays sorted. Totals, the review page and the progress page
         * read through this, so a duplicate can neither be counted twice nor throw.
         */
        public static List<AiQuestionEvaluation> newestPerQuestion(List<AiQuestionEvaluation> rows) {
                if (rows == null || rows.isEmpty()) {
                        return rows == null ? List.of() : rows;
                }
                Map<String, AiQuestionEvaluation> byQuestion = new LinkedHashMap<>();
                List<AiQuestionEvaluation> withoutQuestion = new ArrayList<>();
                for (AiQuestionEvaluation row : rows) {
                        String questionId = row.getQuestion() != null ? row.getQuestion().getId() : null;
                        if (questionId == null) {
                                withoutQuestion.add(row);
                                continue;
                        }
                        byQuestion.merge(questionId, row, (a, b) -> isNewer(b, a) ? b : a);
                }
                if (withoutQuestion.isEmpty() && byQuestion.size() == rows.size()) {
                        return rows;
                }
                List<AiQuestionEvaluation> out = new ArrayList<>(byQuestion.values());
                out.addAll(withoutQuestion);
                return out;
        }

        /** The newest of a question's rows; empty when there is none. */
        public static Optional<AiQuestionEvaluation> newest(List<AiQuestionEvaluation> rows) {
                if (rows == null) {
                        return Optional.empty();
                }
                return rows.stream().reduce((a, b) -> isNewer(b, a) ? b : a);
        }

        private static final Comparator<AiQuestionEvaluation> AGE = Comparator
                        .comparing(AiQuestionEvaluation::getCreatedAt, Comparator.nullsFirst(Comparator.naturalOrder()))
                        .thenComparing(AiQuestionEvaluation::getId, Comparator.nullsFirst(Comparator.naturalOrder()));

        private static boolean isNewer(AiQuestionEvaluation candidate, AiQuestionEvaluation current) {
                return AGE.compare(candidate, current) > 0;
        }

        /**
         * Update question evaluation status
         */
        @Transactional
        public void updateQuestionStatus(String questionEvalId, String status) {
                aiQuestionEvaluationRepository.findById(questionEvalId).ifPresent(questionEval -> {
                        questionEval.setStatus(status);
                        aiQuestionEvaluationRepository.save(questionEval);
                        log.info("Updated question {} status to: {}", questionEval.getQuestionNumber(), status);
                });
        }

        /**
         * Save question evaluation result immediately after grading
         */
        @Transactional
        public void saveQuestionResult(
                        String questionEvalId,
                        QuestionEvaluationDto result,
                        String extractedAnswer) {

                aiQuestionEvaluationRepository.findById(questionEvalId).ifPresent(questionEval -> {
                        try {
                                // Convert result to JSON
                                String resultJson = objectMapper.writeValueAsString(result);

                                // Update all fields
                                questionEval.setEvaluationResultJson(resultJson);
                                questionEval.setMarksAwarded(BigDecimal.valueOf(result.getMarksAwarded()));
                                questionEval.setFeedback(result.getFeedback());
                                questionEval.setExtractedAnswer(extractedAnswer);
                                questionEval.setStatus(QuestionEvaluationStatusEnum.COMPLETED.name());
                                questionEval.setCompletedAt(new Date());

                                aiQuestionEvaluationRepository.save(questionEval);
                                log.info("✅ Saved result for question {} ({}M awarded)",
                                                questionEval.getQuestionNumber(), result.getMarksAwarded());

                        } catch (Exception e) {
                                log.error("Failed to save question result: {}", e.getMessage(), e);
                        }
                });
        }

        /**
         * Mark question as failed with error
         */
        @Transactional
        public void markQuestionFailed(String questionEvalId, String errorMessage) {
                aiQuestionEvaluationRepository.findById(questionEvalId).ifPresent(questionEval -> {
                        questionEval.setStatus(QuestionEvaluationStatusEnum.FAILED.name());
                        questionEval.setCompletedAt(new Date());
                        aiQuestionEvaluationRepository.save(questionEval);
                        log.warn("Marked question {} as FAILED", questionEval.getQuestionNumber());
                });
        }
}
