package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCopyCheckClient;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.CopyIntakeService;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.CopyCheckCallbackDto;
import vacademy.io.assessment_service.features.assessment.entity.AiQuestionEvaluation;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.repository.AiQuestionEvaluationRepository;
import vacademy.io.assessment_service.features.assessment.repository.CopyCheckLayoutRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.CopyCheckGradeRequestDto;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCharge;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.repository.OptionRepository;

import java.math.BigDecimal;
import java.util.Date;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Owner decision 2026-11-18: "CBE answers always go to AI". An online attempt with a
 * non-blank CBE_RESPONSE answer is queued for AI marking on submit / time-out even when
 * the test's "Evaluate submissions with AI" is off - nothing else can mark it - and that
 * run grades the CBE answers only. Everything else keeps its old behaviour.
 */
class CbeAlwaysAiGradedTest {

        private static final String CBE_CONFIG = "{\"type\":\"CBE_RESPONSE\",\"data\":{\"parts\":["
                        + "{\"id\":\"p1\",\"label\":\"(a)\",\"kind\":\"SPREADSHEET\",\"marks\":16,"
                        + "\"template\":{\"sheet\":{\"sheets\":[{\"name\":\"Sheet1\",\"cells\":{\"A1\":{\"v\":\"Goodwill\"}}}]}}},"
                        + "{\"id\":\"p2\",\"label\":\"(b)\",\"kind\":\"DOCUMENT\",\"marks\":4}]}}";
        private static final String ANSWERED = "{\"parts\":{\"p2\":{\"kind\":\"DOCUMENT\",\"html\":\"<p>IAS 38 prohibits</p>\"}}}";
        /** Only the template's own cell and blank text: nothing beyond the template. */
        private static final String BLANK = "{\"parts\":{\"p1\":{\"kind\":\"SPREADSHEET\",\"sheet\":{\"sheets\":"
                        + "[{\"name\":\"Sheet1\",\"cells\":{\"A1\":{\"v\":\"Goodwill\"}}}]}},"
                        + "\"p2\":{\"kind\":\"DOCUMENT\",\"html\":\"<p>&nbsp;</p>\"}}}";

        private QuestionAssessmentSectionMappingRepository mappings;
        private QuestionWiseMarksRepository marks;
        private TypedAnswerEvaluation typed;

        @BeforeEach
        void setUp() {
                mappings = mock(QuestionAssessmentSectionMappingRepository.class);
                marks = mock(QuestionWiseMarksRepository.class);
                ObjectMapper json = new ObjectMapper();
                typed = new TypedAnswerEvaluation(new EvaluationUtilityService(json, mappings), mappings, marks, json);
                when(mappings.existsQuestionOfTypesInAssessment("a1", TypedAnswerEvaluation.TEACHER_GRADED_TYPES))
                                .thenReturn(true);
                when(mappings.getQuestionAssessmentSectionMappingByAssessmentId("a1"))
                                .thenReturn(List.of(mapping(cbe("cbe")), mapping(question("essay", "LONG_ANSWER"))));
        }

        private static Question question(String id, String type) {
                Question q = new Question();
                q.setId(id);
                q.setQuestionType(type);
                return q;
        }

        private static Question cbe(String id) {
                Question q = question(id, "CBE_RESPONSE");
                q.setAutoEvaluationJson(CBE_CONFIG);
                return q;
        }

        private static QuestionAssessmentSectionMapping mapping(Question q) {
                QuestionAssessmentSectionMapping m = new QuestionAssessmentSectionMapping();
                m.setQuestion(q);
                m.setStatus("ACTIVE");
                return m;
        }

        private static Assessment assessment(Boolean aiEnabled, String evaluationType) {
                Assessment a = new Assessment();
                a.setId("a1");
                a.setAiEvaluationEnabled(aiEnabled);
                a.setEvaluationType(evaluationType);
                return a;
        }

        /** attempt_data with the CBE answer (and an essay) as the player submits it. */
        private static StudentAttempt online(String cbeAnswer) {
                StudentAttempt attempt = new StudentAttempt();
                attempt.setId("att-1");
                attempt.setAttemptData("{\"sections\":[{\"sectionId\":\"s1\",\"questions\":["
                                + "{\"questionId\":\"essay\",\"responseData\":{\"type\":\"LONG_ANSWER\",\"answer\":\"Dear Sir\"}},"
                                + "{\"questionId\":\"cbe\",\"responseData\":{\"type\":\"CBE_RESPONSE\",\"answer\":" + cbeAnswer + "}}"
                                + "]}]}");
                return attempt;
        }

        // ---------------------------------------------------------------- the decision

        @Test
        void anAnsweredCbeGoesToTheAiWithTheSwitchOff() {
                assertThat(typed.cbeAlwaysAiGraded(online(ANSWERED), assessment(null, "AUTO"))).isTrue();
                assertThat(typed.cbeAlwaysAiGraded(online(ANSWERED), assessment(false, "AUTO"))).isTrue();
        }

        @Test
        void aCbeAnswerSavedAsAJsonStringStillCounts() throws Exception {
                String asString = new ObjectMapper().writeValueAsString(ANSWERED);
                assertThat(typed.cbeAlwaysAiGraded(online(asString), assessment(null, "AUTO"))).isTrue();
        }

        @Test
        void aBlankCbeAnswerCostsNothing() {
                assertThat(typed.cbeAlwaysAiGraded(online(BLANK), assessment(null, "AUTO"))).isFalse();
                assertThat(typed.cbeAlwaysAiGraded(online("{\"parts\":{}}"), assessment(null, "AUTO"))).isFalse();
                assertThat(typed.cbeAlwaysAiGraded(online("null"), assessment(null, "AUTO"))).isFalse();
        }

        @Test
        void anOptedInTestIsLeftToItsOwnRule() {
                assertThat(typed.cbeAlwaysAiGraded(online(ANSWERED), assessment(true, "AUTO"))).isFalse();
        }

        @Test
        void aManualUploadTestOrAnUploadedSheetIsUntouched() {
                assertThat(typed.cbeAlwaysAiGraded(online(ANSWERED), assessment(null, "MANUAL"))).isFalse();
                StudentAttempt uploaded = online(ANSWERED);
                uploaded.setAttemptData("{\"fileId\":\"f1\",\"sections\":[{\"questions\":[{\"questionId\":\"cbe\","
                                + "\"responseData\":{\"answer\":" + ANSWERED + "}}]}]}");
                assertThat(typed.cbeAlwaysAiGraded(uploaded, assessment(null, "AUTO"))).isFalse();
        }

        @Test
        void anAttemptWithNoCbeShapedAnswerNeverReachesTheDatabase() {
                // An MCQ / essay paper: the hourly sweep and every submit stay query-free.
                StudentAttempt mcq = new StudentAttempt();
                mcq.setId("att-2");
                mcq.setAttemptData("{\"sections\":[{\"questions\":[{\"questionId\":\"q1\","
                                + "\"responseData\":{\"type\":\"MCQS\",\"optionIds\":[\"o1\"]}},"
                                + "{\"questionId\":\"essay\",\"responseData\":{\"answer\":\"Dear Sir\"}}]}]}");
                assertThat(typed.cbeAlwaysAiGraded(mcq, assessment(null, "AUTO"))).isFalse();
                verify(mappings, never()).existsQuestionOfTypesInAssessment(anyString(), anyList());
                verify(mappings, never()).getQuestionAssessmentSectionMappingByAssessmentId(anyString());
        }

        @Test
        void theTypeIsThePapersNotWhatTheClientSent() {
                // A {parts} answer on a question the paper says is a long answer is not a CBE.
                StudentAttempt forged = new StudentAttempt();
                forged.setId("att-3");
                forged.setAttemptData("{\"sections\":[{\"questions\":[{\"questionId\":\"essay\","
                                + "\"responseData\":{\"type\":\"CBE_RESPONSE\",\"answer\":" + ANSWERED + "}}]}]}");
                assertThat(typed.cbeAlwaysAiGraded(forged, assessment(null, "AUTO"))).isFalse();
        }

        @Test
        void aDeletedCbeQuestionDoesNotCount() {
                QuestionAssessmentSectionMapping deleted = mapping(cbe("cbe"));
                deleted.setStatus("DELETED");
                when(mappings.getQuestionAssessmentSectionMappingByAssessmentId("a1")).thenReturn(List.of(deleted));
                assertThat(typed.cbeAlwaysAiGraded(online(ANSWERED), assessment(null, "AUTO"))).isFalse();
        }

        @Test
        void unreadableAttemptDataIsNoAnswerNotAnError() {
                StudentAttempt broken = online(ANSWERED);
                broken.setAttemptData("not json");
                assertThat(typed.cbeAlwaysAiGraded(broken, assessment(null, "AUTO"))).isFalse();
        }

        @Test
        void onlyAnAutomaticRunOnASwitchedOffTestIsCbeOnly() {
                AiEvaluationProcess automatic = new AiEvaluationProcess();
                assertThat(TypedAnswerEvaluation.cbeOnlyRun(automatic, assessment(null, "AUTO"))).isTrue();
                assertThat(TypedAnswerEvaluation.cbeOnlyRun(automatic, assessment(true, "AUTO"))).isFalse();

                AiEvaluationProcess teacher = new AiEvaluationProcess();
                teacher.setTriggeredBy("teacher-1");
                assertThat(TypedAnswerEvaluation.cbeOnlyRun(teacher, assessment(null, "AUTO"))).isFalse();

                AiEvaluationProcess partner = new AiEvaluationProcess();
                partner.setApiKeyId("key-1");
                assertThat(TypedAnswerEvaluation.cbeOnlyRun(partner, assessment(null, "AUTO"))).isFalse();
        }

        // ---------------------------------------------------------------- the enqueuer

        private AiEvaluationSubmissionEnqueuer enqueuer(AiEvaluationProcessRepository repository) {
                AiEvaluationSubmissionEnqueuer enqueuer = new AiEvaluationSubmissionEnqueuer(repository, typed);
                ReflectionTestUtils.setField(enqueuer, "onSubmitEnabled", true);
                when(repository.findActiveByAttemptId(anyString(), anyList())).thenReturn(List.of());
                when(repository.save(any(AiEvaluationProcess.class))).thenAnswer(i -> {
                        AiEvaluationProcess p = i.getArgument(0);
                        p.setId("process-1");
                        return p;
                });
                return enqueuer;
        }

        @Test
        void aSubmitWithAnAnsweredCbeIsQueuedOnTheTypedLaneWithTheSwitchOff() {
                AiEvaluationProcessRepository repository = mock(AiEvaluationProcessRepository.class);
                assertThat(enqueuer(repository).enqueueIfEnabled(online(ANSWERED), assessment(null, "AUTO")))
                                .isEqualTo("process-1");
                ArgumentCaptor<AiEvaluationProcess> saved = ArgumentCaptor.forClass(AiEvaluationProcess.class);
                verify(repository).save(saved.capture());
                assertThat(saved.getValue().getLane()).isEqualTo("TYPED");
                assertThat(saved.getValue().getStatus()).isEqualTo("PENDING");
                // Automatic: no teacher, no key - so the run is CBE-only.
                assertThat(saved.getValue().getTriggeredBy()).isNull();
                assertThat(saved.getValue().getApiKeyId()).isNull();
        }

        @Test
        void aSubmitWithABlankCbeIsNotQueued() {
                AiEvaluationProcessRepository repository = mock(AiEvaluationProcessRepository.class);
                assertThat(enqueuer(repository).enqueueIfEnabled(online(BLANK), assessment(null, "AUTO"))).isNull();
                verify(repository, never()).save(any(AiEvaluationProcess.class));
        }

        @Test
        void aManualUploadTestIsStillNeverQueuedWithTheSwitchOff() {
                AiEvaluationProcessRepository repository = mock(AiEvaluationProcessRepository.class);
                assertThat(enqueuer(repository).enqueueIfEnabled(online(ANSWERED), assessment(null, "MANUAL"))).isNull();
                verify(repository, never()).save(any(AiEvaluationProcess.class));
        }

        @Test
        void anAttemptTheAiAlreadyFinishedIsNotQueuedAgain() {
                // A submit retry landing after a 4-second CBE run, or a submit after the
                // time-out sweep already queued and finished the attempt.
                AiEvaluationProcessRepository repository = mock(AiEvaluationProcessRepository.class);
                AiEvaluationSubmissionEnqueuer enqueuer = enqueuer(repository);
                AiEvaluationProcess done = new AiEvaluationProcess();
                done.setId("done-1");
                done.setStatus("COMPLETED");
                when(repository.findActiveByAttemptId("att-1", AiEvaluationSubmissionEnqueuer.FINISHED_STATUSES))
                                .thenReturn(List.of(done));
                assertThat(enqueuer.enqueueIfEnabled(online(ANSWERED), assessment(null, "AUTO"))).isNull();
                verify(repository, never()).save(any(AiEvaluationProcess.class));
        }

        @Test
        void aReleasedResultIsNotQueuedEvenForCbe() {
                AiEvaluationProcessRepository repository = mock(AiEvaluationProcessRepository.class);
                StudentAttempt released = online(ANSWERED);
                released.setReportReleaseStatus("RELEASED");
                assertThat(enqueuer(repository).enqueueIfEnabled(released, assessment(null, "AUTO"))).isNull();
                verify(repository, never()).save(any(AiEvaluationProcess.class));
        }

        // ---------------------------------------------------------------- the run

        private CopyCheckOrchestratorService orchestrator(AiEvaluationProcessRepository processes,
                        AiServiceCopyCheckClient client, AiEvaluationCreditGate credits) {
                AiQuestionEvaluationService tracking = mock(AiQuestionEvaluationService.class);
                when(tracking.resetForRedispatch(any())).thenReturn(Set.of());
                return new CopyCheckOrchestratorService(processes, marks, tracking,
                                mock(EvaluationUtilityService.class), client, new ObjectMapper(),
                                mock(OptionRepository.class), mappings, typed, new NoopTransactionManager(), credits, null);
        }

        private static QuestionWiseMarks row(Question q, String answerJson) {
                return QuestionWiseMarks.builder().id("qwm-" + q.getId()).question(q)
                                .responseJson("{\"questionId\":\"" + q.getId() + "\",\"responseData\":{\"answer\":" + answerJson + "}}")
                                .build();
        }

        private AiEvaluationProcess claimed(AiEvaluationProcessRepository processes, Assessment assessment,
                        String triggeredBy) {
                StudentAttempt attempt = online(ANSWERED);
                attempt.setSubmitTime(new Date(System.currentTimeMillis() - 3_600_000L));
                AiEvaluationProcess process = new AiEvaluationProcess();
                process.setId("process-1");
                process.setStudentAttempt(attempt);
                process.setAssessment(assessment);
                process.setInstituteId("inst-1");
                process.setClaimedBy("pod-a");
                process.setStatus("DISPATCHED");
                process.setTriggeredBy(triggeredBy);
                when(processes.findById("process-1")).thenReturn(Optional.of(process));
                when(processes.save(any(AiEvaluationProcess.class))).thenAnswer(i -> i.getArgument(0));
                when(processes.beginDispatch(eq("process-1"), eq("pod-a"), any())).thenAnswer(i -> {
                        process.setStatus("PROCESSING");
                        return 1;
                });
                List<QuestionWiseMarks> rows = List.of(
                                row(question("mcq", "MCQS"), "null"),
                                row(question("essay", "LONG_ANSWER"), "\"Dear Sir\""),
                                row(cbe("cbe"), ANSWERED),
                                row(cbe("cbe-blank"), BLANK));
                when(marks.findByStudentAttemptId("att-1")).thenReturn(rows);
                when(marks.findByStudentAttemptIdWithQuestionDetails("att-1")).thenReturn(rows);
                return process;
        }

        private static List<String> sentQuestionIds(AiServiceCopyCheckClient client) {
                ArgumentCaptor<CopyCheckGradeRequestDto> sent = ArgumentCaptor.forClass(CopyCheckGradeRequestDto.class);
                verify(client).submitGrade(sent.capture());
                return sent.getValue().getQuestions().stream().map(CopyCheckGradeRequestDto.QuestionInput::getQuestionId)
                                .toList();
        }

        @Test
        void anAutomaticRunOnASwitchedOffTestGradesAndPricesTheAnsweredCbeOnly() {
                AiEvaluationProcessRepository processes = mock(AiEvaluationProcessRepository.class);
                AiServiceCopyCheckClient client = mock(AiServiceCopyCheckClient.class);
                AiEvaluationCreditGate credits = mock(AiEvaluationCreditGate.class);
                AiEvaluationProcess process = claimed(processes, assessment(null, "AUTO"), null);
                when(client.submitGrade(any())).thenReturn("job-1");

                orchestrator(processes, client, credits).dispatch("process-1", "att-1", null, "pod-a");

                assertThat(sentQuestionIds(client)).containsExactly("cbe");
                assertThat(process.getQuestionsTotal()).isEqualTo(1);
                // Priced for the one answer it reads - not the essay, not the blank CBE - and
                // the balance is enforced: the institute never opted in to AI.
                verify(credits).checkAtDispatch(eq("inst-1"), isNull(), isNull(), eq(AiEvaluationCharge.dashboardTyped(1)),
                                eq(false), eq(true));
        }

        @Test
        void aTeacherTriggeredRunStillGradesEveryWrittenAnswer() {
                AiEvaluationProcessRepository processes = mock(AiEvaluationProcessRepository.class);
                AiServiceCopyCheckClient client = mock(AiServiceCopyCheckClient.class);
                claimed(processes, assessment(null, "AUTO"), "teacher-1");
                when(client.submitGrade(any())).thenReturn("job-1");

                orchestrator(processes, client, mock(AiEvaluationCreditGate.class))
                                .dispatch("process-1", "att-1", null, "pod-a");

                assertThat(sentQuestionIds(client)).containsExactlyInAnyOrder("essay", "cbe", "cbe-blank");
        }

        @Test
        void anOptedInTestKeepsGradingEveryWrittenAnswer() {
                AiEvaluationProcessRepository processes = mock(AiEvaluationProcessRepository.class);
                AiServiceCopyCheckClient client = mock(AiServiceCopyCheckClient.class);
                claimed(processes, assessment(true, "AUTO"), null);
                when(client.submitGrade(any())).thenReturn("job-1");

                orchestrator(processes, client, mock(AiEvaluationCreditGate.class))
                                .dispatch("process-1", "att-1", null, "pod-a");

                assertThat(sentQuestionIds(client)).containsExactlyInAnyOrder("essay", "cbe", "cbe-blank");
        }

        // ---------------------------------------------------------------- review fixes

        @Test
        void aRunATeacherStoppedIsNotRestartedByAResubmit() {
                AiEvaluationProcessRepository repository = mock(AiEvaluationProcessRepository.class);
                AiEvaluationSubmissionEnqueuer enqueuer = enqueuer(repository);
                AiEvaluationProcess stopped = new AiEvaluationProcess();
                stopped.setId("stopped-1");
                stopped.setStatus("CANCELLED");
                when(repository.findActiveByAttemptId("att-1", AiEvaluationSubmissionEnqueuer.FINISHED_STATUSES))
                                .thenReturn(List.of(stopped));
                assertThat(enqueuer.enqueueIfEnabled(online(ANSWERED), assessment(null, "AUTO"))).isNull();
                verify(repository, never()).save(any(AiEvaluationProcess.class));
        }

        @Test
        void afterAFailedRunMarksATeacherSetByHandAreNotOverwrittenByAnAutomaticRun() {
                AiEvaluationProcessRepository repository = mock(AiEvaluationProcessRepository.class);
                AiEvaluationSubmissionEnqueuer enqueuer = enqueuer(repository);
                AiEvaluationProcess failed = new AiEvaluationProcess();
                failed.setId("failed-1");
                failed.setStatus("FAILED");
                when(repository.findActiveByAttemptId("att-1", AiEvaluationSubmissionEnqueuer.FINISHED_STATUSES))
                                .thenReturn(List.of(failed));
                QuestionWiseMarks reviewed = row(cbe("cbe"), ANSWERED);
                reviewed.setMarksSource("AI_REVIEWED");
                when(marks.findByStudentAttemptId("att-1")).thenReturn(List.of(reviewed));
                assertThat(enqueuer.enqueueIfEnabled(online(ANSWERED), assessment(null, "AUTO"))).isNull();
                verify(repository, never()).save(any(AiEvaluationProcess.class));

                // Not reviewed by hand: the failed run is retried by the resubmit.
                reviewed.setMarksSource(null);
                assertThat(enqueuer.enqueueIfEnabled(online(ANSWERED), assessment(null, "AUTO"))).isEqualTo("process-1");
        }

        @Test
        void aRunQueuedWhileTheSwitchWasOnKeepsGradingTheLongAnswerAfterItIsTurnedOff() {
                // A long-answer-only attempt queued (and held) while AI evaluation was on;
                // the admin turns it off before dispatch. The CBE rule never queues an
                // attempt without a CBE answer, so this run is not CBE-only.
                AiEvaluationProcessRepository processes = mock(AiEvaluationProcessRepository.class);
                AiServiceCopyCheckClient client = mock(AiServiceCopyCheckClient.class);
                AiEvaluationProcess process = claimed(processes, assessment(null, "AUTO"), null);
                process.getStudentAttempt().setAttemptData("{\"sections\":[{\"questions\":["
                                + "{\"questionId\":\"essay\",\"responseData\":{\"answer\":\"Dear Sir\"}}]}]}");
                when(client.submitGrade(any())).thenReturn("job-1");

                orchestrator(processes, client, mock(AiEvaluationCreditGate.class))
                                .dispatch("process-1", "att-1", null, "pod-a");

                assertThat(sentQuestionIds(client)).containsExactlyInAnyOrder("essay", "cbe", "cbe-blank");
        }

        @Test
        void aRunIsHandedBackWhileTheMarksRowsStillHoldTheLiveSyncedAnswer() {
                AiEvaluationProcessRepository processes = mock(AiEvaluationProcessRepository.class);
                AiServiceCopyCheckClient client = mock(AiServiceCopyCheckClient.class);
                AiEvaluationCreditGate credits = mock(AiEvaluationCreditGate.class);
                AiEvaluationProcess process = claimed(processes, assessment(null, "AUTO"), null);
                // Submitted a moment ago; the submit-time marks job has not replaced the
                // CBE row the live sync wrote a minute before (an older, blank answer).
                process.getStudentAttempt().setSubmitTime(new Date());
                QuestionWiseMarks stale = row(cbe("cbe"), BLANK);
                when(marks.findByStudentAttemptId("att-1")).thenReturn(List.of(stale));

                CopyCheckOrchestratorService service = orchestrator(processes, client, credits);
                service.dispatch("process-1", "att-1", null, "pod-a");

                verify(processes).handBackClaim(eq("process-1"), eq("pod-a"), any());
                verify(client, never()).submitGrade(any());

                // The marks job caught up: same answer as attempt_data, so it is sent.
                stale.setResponseJson("{\"questionId\":\"cbe\",\"responseData\":{\"type\":\"CBE_RESPONSE\",\"answer\":"
                                + ANSWERED + "}}");
                when(marks.findByStudentAttemptIdWithQuestionDetails("att-1")).thenReturn(List.of(stale));
                when(client.submitGrade(any())).thenReturn("job-1");
                service.dispatch("process-1", "att-1", null, "pod-a");
                assertThat(sentQuestionIds(client)).containsExactly("cbe");
        }

        @Test
        void aCompletedCbeOnlyRunIsHeldForTheTeacherNotMarkedCompleted() {
                // COMPLETED would let "release after the assessment ends" publish the AI's
                // marks unreviewed on a test that never opted in to AI.
                AiEvaluationProcessRepository processes = mock(AiEvaluationProcessRepository.class);
                AiQuestionEvaluationRepository tracking = mock(AiQuestionEvaluationRepository.class);
                StudentAttemptRepository attempts = mock(StudentAttemptRepository.class);
                CopyCheckCallbackService service = new CopyCheckCallbackService(processes, mock(CopyIntakeService.class),
                                tracking, mock(CopyCheckLayoutRepository.class), marks, attempts,
                                mock(AiEvaluationCancellationService.class), typed, new ObjectMapper());

                StudentAttempt attempt = online(ANSWERED);
                Assessment off = assessment(null, "AUTO");
                AssessmentUserRegistration registration = new AssessmentUserRegistration();
                registration.setAssessment(off);
                attempt.setRegistration(registration);
                when(attempts.findById("att-1")).thenReturn(Optional.of(attempt));
                AiEvaluationProcess process = new AiEvaluationProcess();
                process.setId("process-1");
                process.setStatus("EVALUATING");
                process.setStudentAttempt(attempt);
                process.setAssessment(off);
                when(processes.findById("process-1")).thenReturn(Optional.of(process));
                Question cbe = cbe("cbe");
                when(tracking.findByEvaluationProcessIdOrderByQuestionNumberAsc("process-1")).thenReturn(List.of(
                                AiQuestionEvaluation.builder().question(cbe).status("COMPLETED")
                                                .marksAwarded(BigDecimal.valueOf(12)).build()));

                service.onComplete(CopyCheckCallbackDto.Complete.builder().processId("process-1").build());
                assertThat(attempt.getResultStatus()).isEqualTo("EVALUATING");
                assertThat(attempt.getTotalMarks()).isEqualTo(12.0);

                // A teacher's run, or an opted-in test, completes the attempt as before.
                process.setStatus("EVALUATING");
                process.setTriggeredBy("teacher-1");
                service.onComplete(CopyCheckCallbackDto.Complete.builder().processId("process-1").build());
                assertThat(attempt.getResultStatus()).isEqualTo("COMPLETED");
        }
}
