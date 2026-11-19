package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.entity.AiQuestionEvaluation;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.question_core.entity.Question;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * An online attempt's AI run covers its written answers only; the total must
 * still include the objective questions scored on submit. For an uploaded copy
 * the run covers every question and the total is unchanged: its verdicts.
 */
class TypedAnswerEvaluationTest {

        private QuestionWiseMarksRepository marks;
        private QuestionAssessmentSectionMappingRepository mappings;
        private TypedAnswerEvaluation typed;

        @BeforeEach
        void setUp() {
                marks = mock(QuestionWiseMarksRepository.class);
                mappings = mock(QuestionAssessmentSectionMappingRepository.class);
                ObjectMapper json = new ObjectMapper();
                typed = new TypedAnswerEvaluation(new EvaluationUtilityService(json, mappings), mappings, marks, json);
        }

        private static Question question(String id) {
                Question q = new Question();
                q.setId(id);
                q.setQuestionType("LONG_ANSWER");
                return q;
        }

        private static QuestionWiseMarks stored(String qid, double value) {
                return QuestionWiseMarks.builder().question(question(qid)).marks(value).build();
        }

        private static AiQuestionEvaluation verdict(String qid, String status, Double value) {
                return AiQuestionEvaluation.builder().question(question(qid)).status(status)
                                .marksAwarded(value == null ? null : BigDecimal.valueOf(value)).build();
        }

        private static StudentAttempt attempt(String evaluationType, String attemptData) {
                Assessment assessment = new Assessment();
                assessment.setId("a1");
                assessment.setEvaluationType(evaluationType);
                AssessmentUserRegistration registration = new AssessmentUserRegistration();
                registration.setAssessment(assessment);
                StudentAttempt attempt = new StudentAttempt();
                attempt.setId("att-1");
                attempt.setRegistration(registration);
                attempt.setAttemptData(attemptData);
                return attempt;
        }

        private static StudentAttempt online() {
                return attempt("AUTO", "{\"sections\":[]}");
        }

        @Test
        void onlineTotalIsAiMarksForEssaysPlusAutoMarksForTheRest() {
                when(marks.findByStudentAttemptId("att-1")).thenReturn(List.of(
                                stored("mcq1", 1), stored("mcq2", 1), stored("essay", 2.5)));
                double total = typed.attemptTotal(online(), List.of(verdict("essay", "COMPLETED", 7.5)));
                // 1 + 1 from the MCQs, 7.5 from the AI - never the essay's stored 2.5.
                assertThat(total).isEqualTo(9.5);
        }

        @Test
        void aQuestionTheAiCouldNotGradeCountsForNothingYet() {
                when(marks.findByStudentAttemptId("att-1")).thenReturn(List.of(stored("mcq", 1), stored("essay", 2.5)));
                assertThat(typed.attemptTotal(online(), List.of(verdict("essay", "FAILED", null)))).isEqualTo(1.0);
        }

        @Test
        void anUploadedCopyTotalIsItsVerdictsAsBefore() {
                // Even with a stray stored row the run did not cover: a copy's total
                // is the sum of its verdicts and nothing else, exactly as before.
                when(marks.findByStudentAttemptId("att-1")).thenReturn(List.of(stored("q1", 0), stored("stray", 5)));
                double total = typed.attemptTotal(attempt("MANUAL", "{\"fileId\":\"f1\"}"),
                                List.of(verdict("q1", "COMPLETED", 3.0), verdict("q2", "COMPLETED", 4.0)));
                assertThat(total).isEqualTo(7.0);
                verify(marks, never()).findByStudentAttemptId("att-1");
        }

        @Test
        void aManualEvaluationAttemptWithoutAFileIsAMissingCopyNotTypedAnswers() {
                assertThat(typed.isTypedAttempt(attempt("MANUAL", "{\"sections\":[]}"),
                                attempt("MANUAL", null).getRegistration().getAssessment())).isFalse();
                assertThat(typed.isTypedAttempt(online(), online().getRegistration().getAssessment())).isTrue();
                assertThat(typed.isTypedAttempt(attempt("AUTO", "{\"fileId\":\"f1\"}"),
                                online().getRegistration().getAssessment())).isFalse();
        }

        @Test
        void readsTheTypedAnswerFromTheResponseJson() {
                QuestionWiseMarks row = QuestionWiseMarks.builder()
                                .responseJson("{\"responseData\":{\"type\":\"LONG_ANSWER\",\"answer\":\"Dear Sir\"}}").build();
                assertThat(typed.typedAnswer(row)).isEqualTo("Dear Sir");
                assertThat(typed.typedAnswer(QuestionWiseMarks.builder().responseJson("{}").build())).isNull();
                assertThat(typed.typedAnswer(QuestionWiseMarks.builder().responseJson("not json").build())).isNull();
        }

        @Test
        void onlyAnOptedInOnlineAttemptOnAPaperWithAWrittenQuestionAwaitsTheAi() {
                Assessment on = new Assessment();
                on.setId("a1");
                on.setAiEvaluationEnabled(true);
                on.setEvaluationType("AUTO");
                StudentAttempt online = new StudentAttempt();
                online.setAttemptData("{\"sections\":[]}");
                StudentAttempt uploaded = new StudentAttempt();
                uploaded.setAttemptData("{\"fileId\":\"f1\"}");
                when(mappings.existsQuestionOfTypesInAssessment("a1", TypedAnswerEvaluation.AI_GRADED_TYPES)).thenReturn(true);

                assertThat(typed.awaitsAiGrading(online, on)).isTrue();
                assertThat(typed.awaitsAiGrading(uploaded, on)).isFalse();

                Assessment off = new Assessment();
                off.setId("a2");
                assertThat(typed.awaitsAiGrading(online, off)).isFalse();

                Assessment manualUpload = new Assessment();
                manualUpload.setId("a3");
                manualUpload.setAiEvaluationEnabled(true);
                manualUpload.setEvaluationType("MANUAL");
                assertThat(typed.awaitsAiGrading(online, manualUpload)).isFalse();
                verify(mappings, never()).existsQuestionOfTypesInAssessment("a2", TypedAnswerEvaluation.AI_GRADED_TYPES);

                when(mappings.existsQuestionOfTypesInAssessment(anyString(), anyList())).thenReturn(false);
                assertThat(typed.awaitsAiGrading(online, on)).isFalse();
        }

        // ---- CBE_RESPONSE (Spreadsheet & Written Response) ----

        private static final String CBE_CONFIG = "{\"type\":\"CBE_RESPONSE\",\"data\":{\"parts\":["
                        + "{\"id\":\"p1\",\"label\":\"(a)\",\"kind\":\"SPREADSHEET\",\"marks\":16,"
                        + "\"template\":{\"sheet\":{\"sheets\":[{\"name\":\"Sheet1\",\"cells\":{\"A1\":{\"v\":\"Goodwill\"}}}]}}},"
                        + "{\"id\":\"p2\",\"label\":\"(b)\",\"kind\":\"DOCUMENT\",\"marks\":4}]}}";

        private static QuestionWiseMarks cbeRow(String answerJson) {
                Question q = new Question();
                q.setId("cbe");
                q.setQuestionType("CBE_RESPONSE");
                q.setAutoEvaluationJson(CBE_CONFIG);
                return QuestionWiseMarks.builder().id("qwm-cbe").question(q)
                                .responseJson("{\"questionId\":\"cbe\",\"responseData\":{\"type\":\"CBE_RESPONSE\",\"answer\":"
                                                + answerJson + "}}")
                                .build();
        }

        @Test
        void aCbeAnswerIsHandedOverAsItsJsonObject() throws Exception {
                String answer = "{\"parts\":{\"p1\":{\"kind\":\"SPREADSHEET\",\"sheet\":{\"sheets\":[{\"name\":\"Sheet1\","
                                + "\"cells\":{\"A1\":{\"v\":\"Goodwill\"},\"B1\":{\"v\":3200,\"f\":\"=B5-B6\"}}}]}},"
                                + "\"p2\":{\"kind\":\"DOCUMENT\",\"html\":\"<p>IAS 38 prohibits</p>\"}}}";
                String typedAnswer = typed.typedAnswer(cbeRow(answer));
                assertThat(typedAnswer).isNotNull();
                ObjectMapper json = new ObjectMapper();
                assertThat(json.readTree(typedAnswer)).isEqualTo(json.readTree(answer));
        }

        @Test
        void aBlankCbeAnswerIsNoAnswer() {
                // Only the template's own cell, an empty cell and blank document text.
                assertThat(typed.typedAnswer(cbeRow("{\"parts\":{\"p1\":{\"kind\":\"SPREADSHEET\",\"sheet\":{\"sheets\":"
                                + "[{\"name\":\"Sheet1\",\"cells\":{\"A1\":{\"v\":\"Goodwill\"},\"C3\":{\"v\":\"\"}}}]}},"
                                + "\"p2\":{\"kind\":\"DOCUMENT\",\"html\":\"<p>&nbsp;</p><p><br></p>\"}}}"))).isNull();
                assertThat(typed.typedAnswer(cbeRow("{\"parts\":{}}"))).isNull();
                assertThat(typed.typedAnswer(cbeRow("null"))).isNull();
                assertThat(typed.typedAnswer(cbeRow("\"text\""))).isNull();
        }

        @Test
        void cbeIsAiGraded() {
                Question q = new Question();
                q.setQuestionType("CBE_RESPONSE");
                assertThat(TypedAnswerEvaluation.isAiGraded(q)).isTrue();
        }

        @Test
        void anAnsweredCbeHoldsTheAttemptEvenWithAiEvaluationOff() {
                Assessment off = new Assessment();
                off.setId("a1");
                off.setEvaluationType("AUTO");
                StudentAttempt attempt = online();
                when(mappings.existsQuestionOfTypesInAssessment("a1", TypedAnswerEvaluation.TEACHER_GRADED_TYPES)).thenReturn(true);
                String answered = "{\"parts\":{\"p2\":{\"kind\":\"DOCUMENT\",\"html\":\"<p>IAS 38</p>\"}}}";
                when(marks.findByStudentAttemptId("att-1")).thenReturn(List.of(stored("mcq", 1), cbeRow(answered)));

                assertThat(typed.awaitsAiGrading(attempt, off)).isFalse();
                assertThat(typed.awaitsTeacherGrading(attempt, off)).isTrue();

                // A blank CBE answer holds nothing: the 0 is the right result.
                when(marks.findByStudentAttemptId("att-1")).thenReturn(List.of(stored("mcq", 1), cbeRow("{\"parts\":{}}")));
                assertThat(typed.awaitsTeacherGrading(attempt, off)).isFalse();

                // An uploaded copy / MANUAL assessment keeps its own handling.
                Assessment manual = new Assessment();
                manual.setId("a1");
                manual.setEvaluationType("MANUAL");
                assertThat(typed.awaitsTeacherGrading(attempt, manual)).isFalse();
        }

        private static QuestionWiseMarks longRow(String source, String state, long createdAt) {
                QuestionWiseMarks m = QuestionWiseMarks.builder().question(question("q1")).sectionId("s1").marks(2)
                                .status("CORRECT").marksSource(source).markState(state).build();
                m.setCreatedAt(new java.util.Date(createdAt));
                return m;
        }

        private static QuestionAssessmentSectionMapping mapping(String qid, String sectionId, String status) {
                Section section = new Section();
                section.setId(sectionId);
                QuestionAssessmentSectionMapping m = new QuestionAssessmentSectionMapping();
                m.setQuestion(question(qid));
                m.setSection(section);
                m.setStatus(status);
                return m;
        }

        /** Owner decision 2026-11-19: a keyword-match score waits for the teacher, like CBE. */
        @Test
        void aKeywordScoredLongAnswerHoldsTheAttempt() {
                Assessment off = new Assessment();
                off.setId("a1");
                off.setEvaluationType("AUTO");
                StudentAttempt attempt = online();
                when(marks.findByStudentAttemptId("att-1")).thenReturn(List.of(stored("mcq", 1), longRow("KEYWORD", null, 1)));
                // A paper without a long answer never reads the rows.
                assertThat(typed.awaitsKeywordConfirmation(attempt, off)).isFalse();
                verify(marks, never()).findByStudentAttemptId("att-1");
                when(mappings.existsQuestionOfTypesInAssessment("a1", TypedAnswerEvaluation.KEYWORD_SCORED_TYPES)).thenReturn(true);
                when(mappings.getQuestionAssessmentSectionMappingByAssessmentId("a1"))
                                .thenReturn(List.of(mapping("mcq", "s1", "ACTIVE"), mapping("q1", "s1", "ACTIVE")));
                assertThat(typed.awaitsKeywordConfirmation(attempt, off)).isTrue();

                // No keyword score (no model answer, blank, or an old NULL-source row): no hold.
                when(marks.findByStudentAttemptId("att-1")).thenReturn(List.of(stored("mcq", 1), longRow(null, null, 1)));
                assertThat(typed.awaitsKeywordConfirmation(attempt, off)).isFalse();

                // The newest row is the answer: a teacher confirmed it, an older duplicate is stale.
                when(marks.findByStudentAttemptId("att-1")).thenReturn(List.of(longRow("KEYWORD", null, 1),
                                longRow("MANUAL", "MARKED", 2)));
                assertThat(typed.awaitsKeywordConfirmation(attempt, off)).isFalse();

                // KEYWORD on a non-long-answer question is not this rule.
                QuestionWiseMarks mcq = longRow("KEYWORD", null, 1);
                mcq.getQuestion().setQuestionType("MCQS");
                when(marks.findByStudentAttemptId("att-1")).thenReturn(List.of(mcq));
                assertThat(typed.awaitsKeywordConfirmation(attempt, off)).isFalse();

                // An uploaded copy / MANUAL assessment keeps its own handling.
                when(marks.findByStudentAttemptId("att-1")).thenReturn(List.of(longRow("KEYWORD", null, 1)));
                Assessment manual = new Assessment();
                manual.setId("a1");
                manual.setEvaluationType("MANUAL");
                assertThat(typed.awaitsKeywordConfirmation(attempt, manual)).isFalse();
                assertThat(typed.awaitsKeywordConfirmation(attempt("AUTO", "{\"fileId\":\"sheet-1\",\"sections\":[]}"), off))
                                .isFalse();
        }

        /** A keyword row for a question or section removed from the paper mid-test holds nothing (KW-2). */
        @Test
        void aKeywordRowOffTheLivePaperDoesNotHold() {
                Assessment off = new Assessment();
                off.setId("a1");
                off.setEvaluationType("AUTO");
                StudentAttempt attempt = online();
                when(mappings.existsQuestionOfTypesInAssessment("a1", TypedAnswerEvaluation.KEYWORD_SCORED_TYPES)).thenReturn(true);
                when(marks.findByStudentAttemptId("att-1")).thenReturn(List.of(longRow("KEYWORD", null, 1)));

                // q1's mapping was removed; another long answer (q2) is still live on the paper.
                when(mappings.getQuestionAssessmentSectionMappingByAssessmentId("a1"))
                                .thenReturn(List.of(mapping("q1", "s1", "DELETED"), mapping("q2", "s1", "ACTIVE")));
                assertThat(typed.awaitsKeywordConfirmation(attempt, off)).isFalse();

                // q1 lives on in another section only: the row's own (question, section) is what counts.
                when(mappings.getQuestionAssessmentSectionMappingByAssessmentId("a1"))
                                .thenReturn(List.of(mapping("q1", "s2", "ACTIVE")));
                assertThat(typed.awaitsKeywordConfirmation(attempt, off)).isFalse();

                // On a live mapping the same row still holds.
                when(mappings.getQuestionAssessmentSectionMappingByAssessmentId("a1"))
                                .thenReturn(List.of(mapping("q1", "s1", "ACTIVE"), mapping("q2", "s1", "ACTIVE")));
                assertThat(typed.awaitsKeywordConfirmation(attempt, off)).isTrue();
        }

        @Test
        void aPaperWithoutCbeNeverHoldsForTheTeacher() {
                Assessment off = new Assessment();
                off.setId("a1");
                when(mappings.existsQuestionOfTypesInAssessment(anyString(), anyList())).thenReturn(false);
                assertThat(typed.awaitsTeacherGrading(online(), off)).isFalse();
                verify(marks, never()).findByStudentAttemptId("att-1");
        }
}
