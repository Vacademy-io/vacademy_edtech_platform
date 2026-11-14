package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCopyCheckClient;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.CopyCheckGradeRequestDto;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.repository.OptionRepository;
import vacademy.io.assessment_service.features.rich_text.entity.AssessmentRichTextData;

import java.util.Date;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * A CBE_RESPONSE answer goes to the AI as JSON (the sheet must stay a sheet), against the
 * FULL config - solution and marking scheme included - with the scenario and requirement
 * as text (docs/CBE_RESPONSE_QUESTION.md §5.1).
 */
class CopyCheckOrchestratorCbeTest {

        private static final String CONFIG = "{\"type\":\"CBE_RESPONSE\",\"data\":{\"version\":1,\"parts\":[{\"id\":\"p1\","
                        + "\"label\":\"(a)\",\"kind\":\"SPREADSHEET\",\"marks\":16,\"template\":null,"
                        + "\"solution\":{\"sheet\":{\"sheets\":[{\"name\":\"Sheet1\",\"cells\":{\"B7\":{\"v\":3200}}}]}},"
                        + "\"markingScheme\":[{\"id\":\"m1\",\"label\":\"Goodwill\",\"marks\":2,\"expected\":\"3,200\"}],"
                        + "\"solutionFileId\":\"media-1\"}],\"gradingNotes\":\"Accept ±1 rounding.\"}}";
        private static final String ANSWER = "{\"parts\":{\"p1\":{\"kind\":\"SPREADSHEET\",\"sheet\":{\"sheets\":[{\"name\":\"Sheet1\","
                        + "\"cells\":{\"B7\":{\"v\":3100,\"f\":\"=B1-B2\"}}}]}}}}";

        private AiEvaluationProcessRepository processes;
        private QuestionWiseMarksRepository marks;
        private AiServiceCopyCheckClient client;
        private CopyCheckOrchestratorService service;
        private AiEvaluationProcess process;

        @BeforeEach
        void setUp() {
                processes = mock(AiEvaluationProcessRepository.class);
                marks = mock(QuestionWiseMarksRepository.class);
                client = mock(AiServiceCopyCheckClient.class);
                QuestionAssessmentSectionMappingRepository mappings = mock(QuestionAssessmentSectionMappingRepository.class);
                ObjectMapper json = new ObjectMapper();
                TypedAnswerEvaluation typed = new TypedAnswerEvaluation(new EvaluationUtilityService(json, mappings), mappings,
                                marks, json);
                AiQuestionEvaluationService tracking = mock(AiQuestionEvaluationService.class);
                service = new CopyCheckOrchestratorService(processes, marks, tracking,
                                mock(EvaluationUtilityService.class), client, json,
                                mock(OptionRepository.class), mappings, typed, new NoopTransactionManager(),
                                mock(vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate.class), null);

                Assessment assessment = new Assessment();
                assessment.setId("assessment-1");
                StudentAttempt attempt = new StudentAttempt();
                attempt.setId("attempt-1");
                attempt.setAttemptData("{\"sections\":[]}");
                attempt.setSubmitTime(new Date());
                process = new AiEvaluationProcess();
                process.setId("process-1");
                process.setStudentAttempt(attempt);
                process.setAssessment(assessment);
                process.setClaimedBy("pod-a");
                process.setStatus("DISPATCHED");
                when(processes.findById("process-1")).thenReturn(Optional.of(process));
                when(processes.beginDispatch(eq("process-1"), eq("pod-a"), any())).thenAnswer(i -> {
                        process.setStatus("PROCESSING");
                        return 1;
                });
                when(processes.save(any(AiEvaluationProcess.class))).thenAnswer(i -> i.getArgument(0));
                when(tracking.createQuestionEvaluation(any(), any(), anyInt())).thenReturn(null);
        }

        private static Question cbeQuestion() {
                Question q = new Question();
                q.setId("cbe");
                q.setQuestionType("CBE_RESPONSE");
                q.setAutoEvaluationJson(CONFIG);
                q.setParentRichText(new AssessmentRichTextData(null, "HTML",
                                "<p>Pine Co acquired 80% of Spruce Co.</p><table><tr><td>Cash</td><td>1,200</td></tr></table>"));
                q.setTextData(new AssessmentRichTextData(null, "HTML", "<p>Prepare the consolidated SFP.</p><p>Show workings.</p>"));
                return q;
        }

        @Test
        void questionTextIsScenarioThenRequirementWithLineBreaks() {
                QuestionWiseMarks row = QuestionWiseMarks.builder().question(cbeQuestion()).build();
                CopyCheckGradeRequestDto.QuestionInput input = service.buildQuestionInput(row, 1, null);
                assertThat(input.getQuestionType()).isEqualTo("CBE_RESPONSE");
                assertThat(input.getQuestionText()).isEqualTo(
                                "Scenario:\nPine Co acquired 80% of Spruce Co.\nCash | 1,200\n\n"
                                                + "Requirement:\nPrepare the consolidated SFP.\nShow workings.");
                assertThat(input.getCorrectAnswer()).isNull();
                assertThat(input.getOptions()).isNullOrEmpty();
        }

        @Test
        void aRequirementWithoutAScenarioIsJustTheRequirement() {
                Question q = cbeQuestion();
                q.setParentRichText(null);
                assertThat(CopyCheckOrchestratorService.cbeQuestionText(q))
                                .isEqualTo("Requirement:\nPrepare the consolidated SFP.\nShow workings.");
        }

        @Test
        void modelAnswerIsTheFullConfigDataWithSecrets() throws Exception {
                ObjectMapper json = new ObjectMapper();
                String model = service.referenceAnswerFor(cbeQuestion());
                assertThat(json.readTree(model)).isEqualTo(json.readTree(CONFIG).path("data"));
                assertThat(model).contains("markingScheme", "gradingNotes", "solution");
        }

        @Test
        void dispatchSendsTheAnswerAsJsonNotPlainText() throws Exception {
                QuestionWiseMarks row = QuestionWiseMarks.builder().id("qwm-cbe").question(cbeQuestion())
                                .responseJson("{\"responseData\":{\"type\":\"CBE_RESPONSE\",\"answer\":" + ANSWER + "}}").build();
                when(marks.findByStudentAttemptId("attempt-1")).thenReturn(List.of(row));
                when(marks.findByStudentAttemptIdWithQuestionDetails("attempt-1")).thenReturn(List.of(row));
                when(client.submitGrade(any())).thenReturn("job-1");

                service.dispatch("process-1", "attempt-1", null, "pod-a");

                ArgumentCaptor<CopyCheckGradeRequestDto> sent = ArgumentCaptor.forClass(CopyCheckGradeRequestDto.class);
                verify(client).submitGrade(sent.capture());
                CopyCheckGradeRequestDto request = sent.getValue();
                assertThat(request.getAnswerMode()).isEqualTo("TYPED");
                assertThat(request.getQuestions()).hasSize(1);
                CopyCheckGradeRequestDto.QuestionInput q = request.getQuestions().get(0);
                ObjectMapper json = new ObjectMapper();
                assertThat(q.getQuestionType()).isEqualTo("CBE_RESPONSE");
                assertThat(json.readTree(q.getStudentAnswer())).isEqualTo(json.readTree(ANSWER));
                JsonNode model = json.readTree(q.getModelAnswer());
                assertThat(model.path("gradingNotes").asText()).isEqualTo("Accept ±1 rounding.");
                assertThat(model.path("parts").get(0).path("markingScheme").get(0).path("expected").asText()).isEqualTo("3,200");
                assertThat(q.getQuestionText()).startsWith("Scenario:\n").contains("\n\nRequirement:\n");
        }
}
