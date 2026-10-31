package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import vacademy.io.assessment_service.features.assessment.copy_intake.entity.AiCopyIntakeItem;
import vacademy.io.assessment_service.features.assessment.copy_intake.repository.AiCopyIntakeItemRepository;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentInstituteMapping;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentInstituteMappingRepository;
import vacademy.io.assessment_service.features.assessment.service.AssessmentWorkflowEventPublisher;
import vacademy.io.assessment_service.features.auth_service.service.AuthService;
import vacademy.io.assessment_service.features.notification.dto.NotificationDTO;
import vacademy.io.assessment_service.features.notification.service.NotificationService;
import vacademy.io.common.auth.dto.UserWithRolesDTO;

/**
 * A finished AI check must reach the staff (bell + email + automation) exactly
 * once, grouped per assessment, and never before the wave of uploads it belongs
 * to has settled — the notice exists so someone reviews and releases; ten
 * emails for ten copies would be ignored.
 */
class AiEvaluationCompletionNotifierTest {

        private AiEvaluationProcessRepository processes;
        private AiCopyIntakeItemRepository intakeItems;
        private AssessmentInstituteMappingRepository mappings;
        private AuthService auth;
        private NotificationService notifications;
        private AssessmentWorkflowEventPublisher workflows;
        private AiEvaluationCompletionNotifier notifier;

        private final Assessment assessment = new Assessment();

        @BeforeEach
        void setUp() {
                processes = mock(AiEvaluationProcessRepository.class);
                intakeItems = mock(AiCopyIntakeItemRepository.class);
                mappings = mock(AssessmentInstituteMappingRepository.class);
                auth = mock(AuthService.class);
                notifications = mock(NotificationService.class);
                workflows = mock(AssessmentWorkflowEventPublisher.class);
                notifier = new AiEvaluationCompletionNotifier(processes, intakeItems, mappings, auth, notifications,
                                workflows);
                ReflectionTestUtils.setField(notifier, "settleMinutes", 2L);
                ReflectionTestUtils.setField(notifier, "maxWaitMinutes", 30L);
                ReflectionTestUtils.setField(notifier, "dashboardBaseUrl", "https://dash.example");

                assessment.setId("a1");
                assessment.setName("Half Yearly Mock");
                assessment.setPlayMode("EXAM");
                assessment.setAssessmentVisibility("PRIVATE");

                when(intakeItems.findFirstByProcessId(anyString())).thenReturn(Optional.empty());
                when(processes.claimForNotice(anyList(), any())).thenAnswer(inv -> ((List<?>) inv.getArgument(0)).size());
                when(processes.countActiveForAssessment(anyString(), anyList())).thenReturn(0L);
                when(mappings.findByAssessmentIdAndInstituteId(anyString(), anyString())).thenReturn(Optional.empty());
                // Build the stubbed user BEFORE stubbing the repository call: nesting a
                // when() inside another when()'s argument is an unfinished stubbing to Mockito.
                UserWithRolesDTO admin = user("admin-1", "admin@x.io", "Asha Admin");
                when(auth.getUsersByRoles(anyList(), anyString())).thenReturn(List.of(admin));
        }

        private static UserWithRolesDTO user(String id, String email, String name) {
                // The DTO only has an all-args constructor with 18 fields; a mock is clearer.
                UserWithRolesDTO u = mock(UserWithRolesDTO.class);
                when(u.getId()).thenReturn(id);
                when(u.getEmail()).thenReturn(email);
                when(u.getFullName()).thenReturn(name);
                return u;
        }

        private AiEvaluationProcess process(String id, String status, long minutesAgo, String triggeredBy) {
                AssessmentUserRegistration reg = new AssessmentUserRegistration();
                reg.setInstituteId("inst");
                StudentAttempt attempt = new StudentAttempt();
                attempt.setId("att-" + id);
                attempt.setRegistration(reg);
                AiEvaluationProcess p = new AiEvaluationProcess();
                p.setId(id);
                p.setAssessment(assessment);
                p.setStudentAttempt(attempt);
                p.setStatus(status);
                p.setCompletedAt(Date.from(Instant.now().minus(minutesAgo, ChronoUnit.MINUTES)));
                p.setTriggeredBy(triggeredBy);
                return p;
        }

        @Test
        void announces_a_settled_wave_once_with_counts_on_every_channel() {
                when(processes.findUnnotifiedSettled(anyList())).thenReturn(List.of(
                                process("p1", "COMPLETED", 5, null),
                                process("p2", "COMPLETED", 4, null),
                                process("p3", "FAILED", 3, null)));

                notifier.announceSettledChecks();

                verify(processes).claimForNotice(eq(List.of("p1", "p2", "p3")), any());
                ArgumentCaptor<String> title = ArgumentCaptor.forClass(String.class);
                ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
                verify(notifications).sendSystemAlertToUsers(eq("inst"), eq(List.of("admin-1")), title.capture(), body.capture());
                assertThat(title.getValue()).isEqualTo("AI check finished for Half Yearly Mock - 1 copy needs your attention");
                assertThat(body.getValue()).contains("2 copies checked by AI, 1 could not be checked")
                                .contains("Release Result").contains("learners see nothing until you do");

                ArgumentCaptor<NotificationDTO> mail = ArgumentCaptor.forClass(NotificationDTO.class);
                verify(notifications).sendEmailToUsersReporting(mail.capture(), eq("inst"));
                assertThat(mail.getValue().getUsers()).hasSize(1);
                assertThat(mail.getValue().getUsers().get(0).getChannelId()).isEqualTo("admin@x.io");
                // the shared staff layout: numbers in a table, the release reminder, one button
                assertThat(mail.getValue().getBody()).contains("Checked by AI").contains(">2<")
                                .contains("Could not be checked").contains(">1<")
                                .contains("1 copy could not be checked by the AI and need a teacher.")
                                .contains("Learners see nothing yet")
                                .contains("Open the results")
                                .doesNotContain("Vacademy")
                                .contains("https://dash.example/assessment/assessment-list/assessment-details/a1/EXAM/PRIVATE/submissions");

                @SuppressWarnings("unchecked")
                ArgumentCaptor<Map<String, Object>> payload = ArgumentCaptor.forClass(Map.class);
                verify(workflows).publishAiEvaluationBatchCompleted(eq(assessment), eq("inst"), eq(null), payload.capture());
                assertThat(payload.getValue()).containsEntry("checkedCopies", 2L).containsEntry("failedCopies", 1L)
                                .containsEntry("batchStatus", "NEEDS_REVIEW").containsEntry("mode", "AUTO_ON_SUBMIT");
        }

        @Test
        void waits_while_the_wave_is_still_settling_or_other_copies_are_still_running() {
                when(processes.findUnnotifiedSettled(anyList())).thenReturn(List.of(process("p1", "COMPLETED", 1, null)));
                notifier.announceSettledChecks();
                verify(processes, never()).claimForNotice(anyList(), any());
                verify(notifications, never()).sendSystemAlertToUsers(anyString(), anyList(), anyString(), anyString());

                when(processes.findUnnotifiedSettled(anyList())).thenReturn(List.of(process("p1", "COMPLETED", 5, null)));
                when(processes.countActiveForAssessment(eq("a1"), anyList())).thenReturn(3L);
                notifier.announceSettledChecks();
                verify(processes, never()).claimForNotice(anyList(), any());
        }

        @Test
        void a_straggler_cannot_hold_the_notice_back_past_the_cap() {
                when(processes.findUnnotifiedSettled(anyList())).thenReturn(List.of(process("p1", "COMPLETED", 31, null)));
                when(processes.countActiveForAssessment(eq("a1"), anyList())).thenReturn(1L);
                notifier.announceSettledChecks();
                verify(processes).claimForNotice(eq(List.of("p1")), any());
                verify(notifications).sendSystemAlertToUsers(eq("inst"), anyList(), anyString(), anyString());
        }

        @Test
        void bulk_intake_copies_are_marked_but_left_to_the_batch_notice() {
                when(processes.findUnnotifiedSettled(anyList())).thenReturn(List.of(process("p1", "COMPLETED", 5, null)));
                when(intakeItems.findFirstByProcessId("p1")).thenReturn(Optional.of(new AiCopyIntakeItem()));
                notifier.announceSettledChecks();
                verify(processes).claimForNotice(eq(List.of("p1")), any());
                verify(notifications, never()).sendSystemAlertToUsers(anyString(), anyList(), anyString(), anyString());
                verify(workflows, never()).publishAiEvaluationBatchCompleted(any(), anyString(), any(), any());
        }

        @Test
        void another_replica_claiming_first_means_silence_here() {
                when(processes.findUnnotifiedSettled(anyList())).thenReturn(List.of(process("p1", "COMPLETED", 5, null)));
                when(processes.claimForNotice(anyList(), any())).thenReturn(0);
                notifier.announceSettledChecks();
                verify(notifications, never()).sendSystemAlertToUsers(anyString(), anyList(), anyString(), anyString());
        }

        @Test
        void the_teacher_who_pressed_the_button_and_named_evaluators_are_told_before_admins() {
                AssessmentInstituteMapping mapping = new AssessmentInstituteMapping();
                mapping.setCommaSeparatedEvaluationUserIds("eval-1, admin-1");
                when(mappings.findByAssessmentIdAndInstituteId("a1", "inst")).thenReturn(Optional.of(mapping));

                List<AiEvaluationCompletionNotifier.Recipient> who = notifier.recipients("inst", "a1", Set.of("teacher-9"));

                assertThat(who).extracting(AiEvaluationCompletionNotifier.Recipient::id)
                                .containsExactly("teacher-9", "eval-1", "admin-1");
                // the admin listing filled in the address for the named admin; unknown ids stay bell-only
                assertThat(who.get(2).email()).isEqualTo("admin@x.io");
                assertThat(who.get(0).email()).isNull();
        }

        @Test
        void a_teacher_triggered_check_is_labelled_so_and_reaches_that_teacher() {
                when(processes.findUnnotifiedSettled(anyList())).thenReturn(List.of(process("p1", "COMPLETED", 5, "teacher-9")));
                notifier.announceSettledChecks();
                verify(notifications).sendSystemAlertToUsers(eq("inst"), eq(List.of("teacher-9", "admin-1")), anyString(), anyString());
                @SuppressWarnings("unchecked")
                ArgumentCaptor<Map<String, Object>> payload = ArgumentCaptor.forClass(Map.class);
                verify(workflows, times(1)).publishAiEvaluationBatchCompleted(any(), anyString(), any(), payload.capture());
                assertThat(payload.getValue()).containsEntry("mode", "TEACHER_TRIGGERED");
        }
}
