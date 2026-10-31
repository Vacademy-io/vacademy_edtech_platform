package vacademy.io.assessment_service.features.open_evaluation.candidate;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.dto.create_assessment.AssessmentRegistrationsDto;
import vacademy.io.assessment_service.features.assessment.manager.AssessmentParticipantsManager;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.assessment_service.features.open_evaluation.exam.ApiExamStore;
import vacademy.io.assessment_service.features.open_evaluation.exam.OpenFixtures;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.student.dto.BasicParticipantDTO;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ApiCandidateServiceTest {

    private ApiCandidateStore store;
    private ApiExamStore examStore;
    private AssessmentParticipantsManager participants;
    private ApiCandidateService service;

    @BeforeEach
    void setUp() {
        store = mock(ApiCandidateStore.class);
        examStore = mock(ApiExamStore.class);
        participants = mock(AssessmentParticipantsManager.class);
        service = new ApiCandidateService(store, examStore, participants, new ObjectMapper());
        ReflectionTestUtils.setField(service, "entityManager", mock(EntityManager.class));
        when(examStore.findForUpdate(OpenFixtures.INSTITUTE, "exam-1")).thenReturn(Optional.of(OpenFixtures.draft("exam-1")));
    }

    private static ApiCandidateStore.CandidateRow row(String id, String externalId, String name, String roll) {
        return new ApiCandidateStore.CandidateRow(id, OpenFixtures.INSTITUTE, externalId, name, roll, null, null,
                Instant.parse("2026-10-01T09:00:00Z"), Instant.parse("2026-10-01T09:00:00Z"));
    }

    @Test
    void registration_uses_synthetic_user_ids_blank_email_and_the_key_as_source() {
        ApiCandidateStore.CandidateRow a = row("c1", "STU-1", "Aarav Mehta", "10A07");
        ApiCandidateStore.CandidateRow b = row("c2", "STU-2", null, null);
        when(store.registrations(eq("exam-1"), eq(OpenFixtures.INSTITUTE), anyCollection()))
                .thenReturn(Map.of("apic_c2", "reg-2"))
                .thenReturn(Map.of("apic_c1", "reg-1", "apic_c2", "reg-2"));

        ApiCandidateService.Registration r = service.registerRows(OpenFixtures.key(), OpenFixtures.draft("exam-1"),
                List.of(a, b));

        ArgumentCaptor<AssessmentRegistrationsDto> dto = ArgumentCaptor.forClass(AssessmentRegistrationsDto.class);
        ArgumentCaptor<CustomUserDetails> actor = ArgumentCaptor.forClass(CustomUserDetails.class);
        verify(participants).saveParticipantsToAssessment(actor.capture(), dto.capture(), eq("exam-1"),
                eq(OpenFixtures.INSTITUTE), eq("EXAM"));
        assertThat(actor.getValue().getUserId()).isEqualTo("apikey:" + OpenFixtures.KEY_ID);
        AssessmentRegistrationsDto d = dto.getValue();
        assertThat(d.isClosedTest()).isTrue();
        assertThat(d.getNotifyStudent().getBeforeAssessmentGoesLive()).isZero();
        assertThat(d.getNotifyStudent().getWhenAssessmentReportGenerated()).isFalse();
        assertThat(d.getNotifyParent().getBeforeAssessmentGoesLive()).isZero();
        List<BasicParticipantDTO> added = d.getAddedPreRegisterStudentsDetails();
        assertThat(added).hasSize(1); // c2 was already registered
        assertThat(added.get(0).getUserId()).isEqualTo("apic_c1");
        assertThat(added.get(0).getUsername()).isEqualTo("10A07");
        assertThat(added.get(0).getFullName()).isEqualTo("Aarav Mehta");
        assertThat(added.get(0).getEmail()).isEmpty();

        assertThat(r.registered()).isEqualTo(1);
        assertThat(r.alreadyRegistered()).isEqualTo(1);
        assertThat(r.candidates()).extracting(m -> m.get("registration_id")).containsExactly("reg-1", "reg-2");
        verify(examStore).touch("exam-1");
    }

    @Test
    void blind_or_nameless_candidates_are_shown_by_external_id() {
        assertThat(ApiCandidateService.participant(row("c1", "D-0042", "Riya", null), true).getFullName()).isEqualTo("D-0042");
        BasicParticipantDTO p = ApiCandidateService.participant(row("c1", "D-0042", null, null), false);
        assertThat(p.getFullName()).isEqualTo("D-0042");
        assertThat(p.getUsername()).isEqualTo("D-0042");
    }

    @Test
    void nothing_new_means_no_manager_call() {
        when(store.registrations(eq("exam-1"), eq(OpenFixtures.INSTITUTE), anyCollection()))
                .thenReturn(Map.of("apic_c1", "reg-1"));
        ApiCandidateService.Registration r = service.registerRows(OpenFixtures.key(), OpenFixtures.draft("exam-1"),
                List.of(row("c1", "STU-1", "A", null)));
        assertThat(r.registered()).isZero();
        verify(participants, never()).saveParticipantsToAssessment(any(), any(), anyString(), anyString(), anyString());
    }

    @Test
    void unknown_candidate_ids_are_404_with_the_missing_ids() {
        when(store.findByIds(eq(OpenFixtures.INSTITUTE), anyCollection())).thenReturn(List.of(row("c1", "STU-1", "A", null)));
        assertThatThrownBy(() -> service.register(OpenFixtures.key(), "exam-1", null, List.of("c1", "c9")))
                .isInstanceOfSatisfying(OpenApiException.class, ex -> {
                    assertThat(ex.getCode()).isEqualTo(ApiErrorCode.CANDIDATE_NOT_FOUND);
                    assertThat(ex.getDetails().get("candidate_ids")).isEqualTo(List.of("c9"));
                });
    }

    @Test
    void register_needs_exactly_one_of_candidates_or_ids() {
        assertThatThrownBy(() -> service.register(OpenFixtures.key(), "exam-1", null, null))
                .isInstanceOfSatisfying(OpenApiException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(ApiErrorCode.VALIDATION_FAILED));
    }

    @Test
    void a_candidate_with_a_submission_cannot_be_unregistered() {
        when(store.findById(OpenFixtures.INSTITUTE, "c1")).thenReturn(Optional.of(row("c1", "STU-1", "A", null)));
        when(store.registrations(eq("exam-1"), eq(OpenFixtures.INSTITUTE), anyCollection()))
                .thenReturn(Map.of("apic_c1", "reg-1"));
        when(store.hasSubmission("exam-1", "c1")).thenReturn(true);
        assertThatThrownBy(() -> service.unregister(OpenFixtures.key(), "exam-1", "c1"))
                .isInstanceOfSatisfying(OpenApiException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(ApiErrorCode.CANDIDATE_HAS_SUBMISSION));
        verify(participants, never()).saveParticipantsToAssessment(any(), any(), anyString(), anyString(), anyString());
    }

    @Test
    void unregister_removes_the_registration_through_the_manager() {
        when(store.findById(OpenFixtures.INSTITUTE, "c1")).thenReturn(Optional.of(row("c1", "STU-1", "A", null)));
        when(store.registrations(eq("exam-1"), eq(OpenFixtures.INSTITUTE), anyCollection()))
                .thenReturn(Map.of("apic_c1", "reg-1"));
        service.unregister(OpenFixtures.key(), "exam-1", "c1");
        ArgumentCaptor<AssessmentRegistrationsDto> dto = ArgumentCaptor.forClass(AssessmentRegistrationsDto.class);
        verify(participants).saveParticipantsToAssessment(any(), dto.capture(), eq("exam-1"), eq(OpenFixtures.INSTITUTE), eq("EXAM"));
        assertThat(dto.getValue().getDeletedPreRegisterStudentsDetails()).extracting(BasicParticipantDTO::getUserId)
                .containsExactly("apic_c1");
        assertThat(dto.getValue().getAddedPreRegisterStudentsDetails()).isEmpty();
    }

    @Test
    void registration_on_a_finalized_exam_is_refused() {
        when(examStore.findForUpdate(OpenFixtures.INSTITUTE, "exam-1")).thenReturn(Optional.of(
                OpenFixtures.exam("exam-1", "PUBLISHED", "handwritten", LocalDate.of(2026, 10, 1), Instant.now())));
        assertThatThrownBy(() -> service.register(OpenFixtures.key(), "exam-1", null, List.of("c1")))
                .isInstanceOfSatisfying(OpenApiException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(ApiErrorCode.EXAM_FINALIZED));
    }

    @Test
    void search_is_capped_at_500() {
        assertThatThrownBy(() -> service.search(OpenFixtures.key(), java.util.Collections.nCopies(501, "x")))
                .isInstanceOf(OpenApiException.class);
    }
}
