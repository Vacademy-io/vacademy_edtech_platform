package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.databind.ObjectMapper;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import vacademy.io.assessment_service.core.exception.VacademyException;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.AdoptQuestionsRequest;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.AdoptQuestionsResponse;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.assessment.repository.SectionRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.bulk_entry_services.QuestionAssessmentSectionMappingService;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.open_evaluation.policy.ApiCandidatePolicy;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.repository.QuestionRepository;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * Give an already-published offline test real questions, days after it was created.
 *
 * The slide-level create form can provision a test with one placeholder question
 * ("Upload your answer sheet.") when the teacher did not switch AI checking on.
 * The AI checker grades per question, so such a test cannot be AI-checked at
 * all. This swaps the placeholder for the digitised paper's questions — same
 * section, so nothing the attempts point at changes — turns AI checking on, and
 * gives every already-uploaded sheet the per-question rows the checker reads.
 *
 * Sheets a teacher has already graded by hand are left exactly as they are:
 * their placeholder row carries the mark, and adding question rows next to it
 * would double-count.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class AiEvaluationRetrofitService {

        private static final String ACTIVE = "ACTIVE";
        private static final String DELETED = "DELETED";
        private static final String ENDED = "ENDED";

        private final AssessmentRepository assessmentRepository;
        private final QuestionAssessmentSectionMappingRepository mappingRepository;
        private final QuestionAssessmentSectionMappingService mappingService;
        private final SectionRepository sectionRepository;
        private final QuestionRepository questionRepository;
        private final StudentAttemptRepository studentAttemptRepository;
        private final QuestionWiseMarksRepository questionWiseMarksRepository;
        private final AiEvaluationService aiEvaluationService;
        private final EvaluationAccessValidator accessValidator;
        private final ObjectMapper objectMapper;

        /** Internal choice ("any 4 of 5"); absent in unit tests that do not need it. */
        @org.springframework.beans.factory.annotation.Autowired(required = false)
        private DashboardChoiceGroups choiceGroups;

        /** Institute-scoped read of the placeholder state, for the UI. */
        public boolean isPlaceholderOnly(String instituteId, String assessmentId) {
                return assessmentRepository.findByAssessmentIdAndInstituteId(assessmentId, instituteId)
                                .map(aiEvaluationService::isPlaceholderOnly)
                                .orElseThrow(() -> new VacademyException("Assessment not found"));
        }

        @Transactional
        public AdoptQuestionsResponse adoptQuestions(CustomUserDetails user, String instituteId, String assessmentId,
                        AdoptQuestionsRequest request) {
                accessValidator.requireInstituteMembership(user, instituteId);
                Assessment assessment = assessmentRepository.findByAssessmentIdAndInstituteId(assessmentId, instituteId)
                                .orElseThrow(() -> new VacademyException("Assessment not found"));
                // A partner-API exam's questions are owned by the API and frozen once open (spec 7.1).
                if (ApiCandidatePolicy.isApiExam(assessment)) {
                        throw new VacademyException("This exam is managed by the API; change its questions through the API.");
                }

                List<AdoptQuestionsRequest.AdoptedQuestion> incoming = request != null && request.getQuestions() != null
                                ? request.getQuestions()
                                : List.of();
                if (incoming.isEmpty()) {
                        throw new VacademyException("No questions to add");
                }
                for (AdoptQuestionsRequest.AdoptedQuestion q : incoming) {
                        if (q.getQuestionId() == null || q.getQuestionId().isBlank()) {
                                throw new VacademyException("Every question needs an id");
                        }
                        if (q.getMarks() == null || q.getMarks() <= 0) {
                                throw new VacademyException("Every question needs marks greater than 0");
                        }
                        if (!questionRepository.existsById(q.getQuestionId())) {
                                throw new VacademyException("Question not found: " + q.getQuestionId());
                        }
                }

                if (!aiEvaluationService.isPlaceholderOnly(assessment)) {
                        throw new VacademyException(
                                        "This test already has its own questions. Manage them under Questions instead.");
                }

                // The single live mapping IS the placeholder (isPlaceholderOnly just said so).
                QuestionAssessmentSectionMapping placeholder = mappingRepository
                                .getQuestionAssessmentSectionMappingByAssessmentId(assessmentId).stream()
                                .filter(m -> m.getStatus() == null || !DELETED.equalsIgnoreCase(m.getStatus()))
                                .findFirst()
                                .orElseThrow(() -> new VacademyException("Placeholder question not found"));
                Section section = placeholder.getSection();
                String placeholderQuestionId = placeholder.getQuestion().getId();

                // Swap the questions inside the SAME section: attempts, marks rows and
                // the learner's view all reference the section, never a new one.
                mappingService.softDeleteMappingsByQuestionIdsAndSectionId(List.of(placeholderQuestionId),
                                section.getId());
                List<QuestionAssessmentSectionMapping> mappings = new ArrayList<>();
                double total = 0;
                int order = 1;
                for (AdoptQuestionsRequest.AdoptedQuestion q : incoming) {
                        QuestionAssessmentSectionMapping mapping = new QuestionAssessmentSectionMapping();
                        mapping.setId(UUID.randomUUID().toString());
                        mapping.setSection(section);
                        mapping.setStatus(ACTIVE);
                        mapping.setQuestion(new Question(q.getQuestionId()));
                        mapping.setQuestionOrder(order++);
                        mapping.setQuestionDurationInMin(0);
                        mapping.setMarkingJson(markingJson(q));
                        mappings.add(mapping);
                        total += q.getMarks();
                }
                mappingService.addMultipleMappings(mappings);
                // "Answer any FOUR of these five": the paper is out of its maximum under the
                // choice, not every question added up. Without groups, as before.
                List<AdoptQuestionsRequest.ChoiceGroup> groups = request.getChoiceGroups();
                if (groups != null && !groups.isEmpty() && choiceGroups != null) {
                        Map<String, Double> marksById = new java.util.LinkedHashMap<>();
                        for (AdoptQuestionsRequest.AdoptedQuestion q : incoming) {
                                marksById.put(q.getQuestionId(), q.getMarks());
                        }
                        total = choiceGroups.replace(assessmentId, groups.stream()
                                        .map(g -> new DashboardChoiceGroups.GroupInput(g.getLabel(), g.getQuestionIds(),
                                                        g.getAttempt(), g.getPolicy()))
                                        .toList(), marksById);
                }
                section.setTotalMarks(total);
                sectionRepository.save(section);

                assessment.setAiEvaluationEnabled(true);
                // The copy-check reads the uploaded file; the create form left this blank
                // on the manual path.
                assessment.setSubmissionType("PDF");
                assessmentRepository.save(assessment);

                // Every sheet already uploaded gets a row per new question so the checker
                // has something to write into; its ungraded placeholder row goes.
                List<String> ready = new ArrayList<>();
                int leftAsGraded = 0;
                int inProgress = 0;
                List<StudentAttempt> attempts = studentAttemptRepository
                                .findAllParticipantsFromAssessmentAndStatusNotIn(assessmentId, List.of(DELETED));
                for (StudentAttempt attempt : attempts) {
                        if (!ENDED.equalsIgnoreCase(attempt.getStatus())) {
                                inProgress++;
                                continue;
                        }
                        List<QuestionWiseMarks> rows = questionWiseMarksRepository.findByStudentAttemptId(attempt.getId());
                        List<QuestionWiseMarks> placeholderRows = rows.stream()
                                        .filter(r -> r.getQuestion() != null
                                                        && placeholderQuestionId.equals(r.getQuestion().getId()))
                                        .toList();
                        boolean gradedByHand = placeholderRows.stream().anyMatch(this::isGraded);
                        if (gradedByHand) {
                                leftAsGraded++;
                                continue;
                        }
                        if (!placeholderRows.isEmpty()) {
                                questionWiseMarksRepository.deleteAll(placeholderRows);
                        }
                        java.util.Set<String> present = new java.util.HashSet<>();
                        rows.forEach(r -> {
                                if (r.getQuestion() != null) present.add(r.getQuestion().getId());
                        });
                        List<QuestionWiseMarks> created = new ArrayList<>();
                        for (QuestionAssessmentSectionMapping mapping : mappings) {
                                String questionId = mapping.getQuestion().getId();
                                if (present.contains(questionId)) continue;
                                created.add(QuestionWiseMarks.builder()
                                                .assessment(assessment)
                                                .studentAttempt(attempt)
                                                .question(questionRepository.getReferenceById(questionId))
                                                .section(section)
                                                .status("PENDING")
                                                .marks(0)
                                                .build());
                        }
                        if (!created.isEmpty()) {
                                questionWiseMarksRepository.saveAll(created);
                        }
                        ready.add(attempt.getId());
                }

                log.info("[ai-retrofit] assessment={} questions={} total={} ready={} graded-by-hand={} in-progress={}",
                                assessmentId, mappings.size(), total, ready.size(), leftAsGraded, inProgress);
                return AdoptQuestionsResponse.builder()
                                .assessmentId(assessmentId)
                                .questionsMapped(mappings.size())
                                .totalMarks(total)
                                .attemptIdsReady(ready)
                                .attemptsLeftAsGraded(leftAsGraded)
                                .attemptsInProgress(inProgress)
                                .build();
        }

        /** A placeholder row a teacher has already scored, by hand or by AI. */
        boolean isGraded(QuestionWiseMarks row) {
                return "evaluated".equalsIgnoreCase(row.getStatus())
                                || row.getMarks() > 0
                                || row.getAiEvaluatedAt() != null;
        }

        /** Same shape the wizard writes for a section question (convertStep2Data). */
        String markingJson(AdoptQuestionsRequest.AdoptedQuestion q) {
                String type = q.getQuestionType() == null || q.getQuestionType().isBlank() ? "LONG_ANSWER"
                                : q.getQuestionType();
                try {
                        return objectMapper.writeValueAsString(Map.of(
                                        "type", type,
                                        "data", Map.of(
                                                        "totalMark", stripTrailingZero(q.getMarks()),
                                                        "negativeMark", "0",
                                                        "negativeMarkingPercentage", "")));
                } catch (Exception e) {
                        throw new VacademyException("Could not build the marking scheme for " + q.getQuestionId());
                }
        }

        private static String stripTrailingZero(double marks) {
                return marks == Math.rint(marks) ? String.valueOf((long) marks) : String.valueOf(marks);
        }
}
