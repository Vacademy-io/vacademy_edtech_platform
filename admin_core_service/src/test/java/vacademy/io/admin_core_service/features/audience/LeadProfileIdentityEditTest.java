package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.audience.dto.LeadProfileEditRequestDTO;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.audience.service.LeadDeduplicationService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.institute_learner.entity.Student;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Editing a lead's identity (Overview editor, or a Form Response answer that mirrors
 * the lead's own phone/email/name): only a value that actually changes is dedup-checked,
 * the dedupe key keeps both halves, and an enrolled lead's student rows follow.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class LeadProfileIdentityEditTest {

    private static final String RESPONSE_ID = "resp-1";
    private static final String AUDIENCE_ID = "aud-1";
    private static final String INSTITUTE_ID = "inst-1";
    private static final String USER_ID = "user-1";

    @Mock private AudienceResponseRepository audienceResponseRepository;
    @Mock private AudienceRepository audienceRepository;
    @Mock private LeadDeduplicationService leadDeduplicationService;
    @Mock private AuthService authService;
    @Mock private InstituteStudentRepository instituteStudentRepository;
    @InjectMocks private AudienceService audienceService;

    private AudienceResponse response;

    @BeforeEach
    void lead() {
        response = new AudienceResponse();
        response.setId(RESPONSE_ID);
        response.setAudienceId(AUDIENCE_ID);
        response.setUserId(USER_ID);
        when(audienceResponseRepository.findById(RESPONSE_ID)).thenReturn(Optional.of(response));

        Audience audience = new Audience();
        audience.setInstituteId(INSTITUTE_ID);
        when(audienceRepository.findById(AUDIENCE_ID)).thenReturn(Optional.of(audience));

        UserDTO stored = UserDTO.builder()
                .id(USER_ID)
                .fullName("Asha Verma")
                .email("asha@example.com")
                .mobileNumber("919812345678")
                .build();
        when(authService.getUsersFromAuthServiceByUserIds(List.of(USER_ID))).thenReturn(List.of(stored));

        when(leadDeduplicationService.checkDuplicate(anyString(), anyString(), any(), any(), anyString()))
                .thenReturn(Optional.empty());
        when(leadDeduplicationService.findDuplicate(anyString(), anyString())).thenReturn(Optional.empty());
        when(leadDeduplicationService.generateDedupeKey(any(), any()))
                .thenAnswer(inv -> inv.getArgument(0) + "|" + inv.getArgument(1));
        when(instituteStudentRepository.findByUserId(USER_ID)).thenReturn(List.of());
    }

    private static LeadProfileEditRequestDTO edit(String email, String phone) {
        LeadProfileEditRequestDTO request = new LeadProfileEditRequestDTO();
        request.setUserDetails(UserDTO.builder().email(email).mobileNumber(phone).build());
        return request;
    }

    @Test
    @DisplayName("a phone change is dedup-checked alone; the unchanged email is not")
    void onlyChangedHalfIsChecked() {
        audienceService.updateLeadProfile(RESPONSE_ID, edit("asha@example.com", "919900011122"));

        verify(leadDeduplicationService).checkDuplicate(
                eq(INSTITUTE_ID), eq(AUDIENCE_ID), isNull(), eq("919900011122"), eq(RESPONSE_ID));
        assertThat(response.getDedupeKey()).isEqualTo("asha@example.com|919900011122");
    }

    @Test
    @DisplayName("an unchanged identity (formatting only) is not re-checked and keeps its key")
    void unchangedIdentitySkipsDedup() {
        response.setDedupeKey("original");

        audienceService.updateLeadProfile(RESPONSE_ID, edit("ASHA@example.com ", "+91 98123 45678"));

        verify(leadDeduplicationService, never()).checkDuplicate(any(), any(), any(), any(), any());
        assertThat(response.getDedupeKey()).isEqualTo("original");
    }

    @Test
    @DisplayName("an email-only edit keys on the stored phone, not a blank one")
    void keyFallsBackToStoredHalf() {
        audienceService.updateLeadProfile(RESPONSE_ID, edit("asha.v@example.com", null));

        assertThat(response.getDedupeKey()).isEqualTo("asha.v@example.com|919812345678");
    }

    @Test
    @DisplayName("an enrolled lead's student rows take the new mobile; blanks are never copied")
    void studentRowsFollow() {
        Student student = new Student();
        student.setUserId(USER_ID);
        student.setFullName("Asha Verma");
        student.setEmail("asha@example.com");
        student.setMobileNumber("919812345678");
        when(instituteStudentRepository.findByUserId(USER_ID)).thenReturn(List.of(student));

        LeadProfileEditRequestDTO request = edit("asha@example.com", "919900011122");
        request.getUserDetails().setFullName("");
        audienceService.updateLeadProfile(RESPONSE_ID, request);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<Student>> saved = ArgumentCaptor.forClass(List.class);
        verify(instituteStudentRepository).saveAll(saved.capture());
        Student row = saved.getValue().get(0);
        assertThat(row.getMobileNumber()).isEqualTo("919900011122");
        assertThat(row.getFullName()).isEqualTo("Asha Verma");
        verify(authService).updateUser(any(UserDTO.class), eq(USER_ID));
    }

    @Test
    @DisplayName("an answer-only edit leaves the auth user and student rows alone")
    void answerOnlyEditTouchesNoIdentity() {
        audienceService.updateLeadProfile(RESPONSE_ID, new LeadProfileEditRequestDTO());

        verify(authService, never()).updateUser(any(), anyString());
        verify(instituteStudentRepository, never()).saveAll(anyList());
    }
}
