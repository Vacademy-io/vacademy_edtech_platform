package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.audience.dto.LeadProfileEditRequestDTO;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.audience.service.LeadDeduplicationService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;
import vacademy.io.admin_core_service.features.learner.service.LearnerProfileEditGuard;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The e-mail and mobile number edited on a lead are the sign-in identifiers of the lead's whole
 * account. Staff of the lead's institute change them only when the account is a learner or lead
 * of that institute alone; an account that also belongs elsewhere needs ADMIN there too.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class LeadProfileAccountIdentityTest {

    private static final String RESPONSE_ID = "resp-1";
    private static final String AUDIENCE_ID = "aud-1";
    private static final String HERE = "inst-1";
    private static final String ELSEWHERE = "inst-2";
    private static final String LEAD_USER = "user-1";
    private static final String COUNSELLOR = "counsellor-1";

    @Mock private AudienceResponseRepository audienceResponseRepository;
    @Mock private AudienceRepository audienceRepository;
    @Mock private LeadDeduplicationService leadDeduplicationService;
    @Mock private AuthService authService;
    @Mock private InstituteStudentRepository instituteStudentRepository;
    @InjectMocks private AudienceService audienceService;

    private final Map<String, List<Map<String, String>>> roleRows = new HashMap<>();

    @BeforeEach
    void lead() {
        ReflectionTestUtils.setField(audienceService, "learnerProfileEditGuard", new LearnerProfileEditGuard(authService));
        when(authService.getRoleMembershipsStrict(anyString()))
                .thenAnswer(inv -> roleRows.getOrDefault(inv.<String>getArgument(0), List.of()));

        AudienceResponse response = new AudienceResponse();
        response.setId(RESPONSE_ID);
        response.setAudienceId(AUDIENCE_ID);
        response.setUserId(LEAD_USER);
        when(audienceResponseRepository.findById(RESPONSE_ID)).thenReturn(Optional.of(response));
        Audience audience = new Audience();
        audience.setInstituteId(HERE);
        when(audienceRepository.findById(AUDIENCE_ID)).thenReturn(Optional.of(audience));

        when(authService.getUsersFromAuthServiceByUserIds(List.of(LEAD_USER))).thenReturn(List.of(UserDTO.builder()
                .id(LEAD_USER).fullName("Asha Verma").email("asha@example.com").mobileNumber("919812345678").build()));
        when(leadDeduplicationService.checkDuplicate(anyString(), anyString(), any(), any(), anyString()))
                .thenReturn(Optional.empty());
        when(leadDeduplicationService.findDuplicate(anyString(), anyString())).thenReturn(Optional.empty());
        when(instituteStudentRepository.findByUserId(LEAD_USER)).thenReturn(List.of());
        role(COUNSELLOR, HERE, "COUNSELLOR");
        role(COUNSELLOR, HERE, "STUDENT");
    }

    private void role(String userId, String institute, String role) {
        Map<String, String> row = new HashMap<>();
        row.put("institute_id", institute);
        row.put("role_name", role);
        row.put("status", "ACTIVE");
        roleRows.computeIfAbsent(userId, k -> new ArrayList<>()).add(row);
    }

    private static CustomUserDetails caller(String userId) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(userId);
        dto.setUsername(userId);
        dto.setRootUser(true); // every account carries the root flag; it must not count here
        dto.setAuthorities(List.of("COUNSELLOR"));
        return new CustomUserDetails(dto);
    }

    private static LeadProfileEditRequestDTO edit(String email, String phone, String name) {
        LeadProfileEditRequestDTO request = new LeadProfileEditRequestDTO();
        request.setUserDetails(UserDTO.builder().email(email).mobileNumber(phone).fullName(name).build());
        return request;
    }

    @Test
    void emailOfAnAccountThatIsStaffInAnotherInstituteIsNotChanged() {
        role(LEAD_USER, HERE, "STUDENT");
        role(LEAD_USER, ELSEWHERE, "ADMIN");

        assertThatThrownBy(() -> audienceService.updateLeadProfile(RESPONSE_ID,
                edit("someone.else@example.com", "919812345678", null), caller(COUNSELLOR)))
                .isInstanceOf(VacademyException.class)
                .satisfies(e -> assertThat(((VacademyException) e).getStatus().value()).isEqualTo(403));
        verify(authService, never()).updateUser(any(), anyString());
        verify(instituteStudentRepository, never()).saveAll(anyList());
    }

    @Test
    void mobileOfALearnerOfAnotherInstituteIsNotChangedByStaffOfThisOneOnly() {
        role(LEAD_USER, ELSEWHERE, "STUDENT");

        assertThatThrownBy(() -> audienceService.updateLeadProfile(RESPONSE_ID,
                edit("asha@example.com", "919900011122", null), caller(COUNSELLOR)))
                .isInstanceOf(VacademyException.class);
        verify(authService, never()).updateUser(any(), anyString());
    }

    @Test
    void adminOfEveryInstituteTheAccountBelongsToMayChangeIt() {
        role(LEAD_USER, HERE, "STUDENT");
        role(LEAD_USER, ELSEWHERE, "STUDENT");
        role("admin-1", HERE, "ADMIN");
        role("admin-1", ELSEWHERE, "ADMIN");

        audienceService.updateLeadProfile(RESPONSE_ID, edit("asha.v@example.com", null, null), caller("admin-1"));

        verify(authService).updateUser(any(UserDTO.class), eq(LEAD_USER));
    }

    @Test
    void staffChangeTheContactOfALeadOfThisInstituteOnly() {
        role(LEAD_USER, HERE, "STUDENT");

        audienceService.updateLeadProfile(RESPONSE_ID, edit("asha.v@example.com", "919900011122", null),
                caller(COUNSELLOR));

        verify(authService).updateUser(any(UserDTO.class), eq(LEAD_USER));
    }

    @Test
    void staffChangeTheContactOfALeadWithNoInstituteRole() {
        audienceService.updateLeadProfile(RESPONSE_ID, edit("asha.v@example.com", null, null), caller(COUNSELLOR));

        verify(authService).updateUser(any(UserDTO.class), eq(LEAD_USER));
    }

    @Test
    void unchangedContactWithANewNameNeedsNoIdentityCheck() {
        role(LEAD_USER, HERE, "STUDENT");

        audienceService.updateLeadProfile(RESPONSE_ID, edit("asha@example.com", "+91 98123 45678", "Asha V"),
                caller(COUNSELLOR));

        verify(authService, never()).getRoleMembershipsStrict(anyString());
        verify(authService).updateUser(any(UserDTO.class), eq(LEAD_USER));
    }
}
