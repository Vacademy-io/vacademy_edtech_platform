package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import vacademy.io.admin_core_service.features.audience.dto.SubmitLeadRequestDTO;
import vacademy.io.admin_core_service.features.audience.dto.SubmitLeadWithEnquiryRequestDTO;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.audience.service.LeadDeduplicationService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.common.auth.dto.UserDTO;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The lead and enquiry forms need no login, and the user in their body is passed on to
 * auth-service, which saves the role names it carries. A lead is a contact: whatever the body
 * names, no staff role reaches auth-service.
 */
class LeadSubmitGrantsNoStaffRoleTest {

    private AudienceService service;
    private AuthService authService;

    @BeforeEach
    void setUp() throws Exception {
        service = new AudienceService();
        for (Field f : AudienceService.class.getDeclaredFields()) {
            if (f.isAnnotationPresent(Autowired.class) && !f.getType().isPrimitive()) {
                f.setAccessible(true);
                f.set(service, mock(f.getType()));
            }
        }
        authService = (AuthService) get("authService");

        Audience audience = new Audience();
        audience.setId("aud-1");
        audience.setInstituteId("inst-1");
        audience.setStatus("ACTIVE");
        audience.setCampaignName("Website");
        when(((AudienceRepository) get("audienceRepository")).findById("aud-1")).thenReturn(Optional.of(audience));

        UserDTO created = new UserDTO();
        created.setId("user-new");
        created.setEmail("new@example.com");
        created.setFullName("Asha Rao");
        when(authService.createUserFromAuthService(any(), eq("inst-1"), anyBoolean())).thenReturn(created);
        when(((LeadDeduplicationService) get("leadDeduplicationService")).checkDuplicate(any(), any(), any(), any()))
                .thenReturn(Optional.empty());
        when(((AudienceResponseRepository) get("audienceResponseRepository")).save(any(AudienceResponse.class)))
                .thenAnswer(inv -> {
                    AudienceResponse r = inv.getArgument(0);
                    r.setId("resp-new");
                    return r;
                });
    }

    private Object get(String field) throws Exception {
        Field f = AudienceService.class.getDeclaredField(field);
        f.setAccessible(true);
        return f.get(service);
    }

    private static UserDTO body(String email, String... roles) {
        UserDTO user = new UserDTO();
        user.setEmail(email);
        user.setFullName("Asha Rao");
        user.setMobileNumber("+919000000001");
        user.setPassword("chosen-by-caller");
        user.setRoles(new ArrayList<>(List.of(roles)));
        return user;
    }

    private List<String> rolesSentToAuth() {
        ArgumentCaptor<UserDTO> sent = ArgumentCaptor.forClass(UserDTO.class);
        verify(authService).createUserFromAuthService(sent.capture(), eq("inst-1"), anyBoolean());
        return sent.getValue().getRoles();
    }

    @Test
    void leadSubmitDropsStaffRoleNames() {
        try {
            service.submitLead(SubmitLeadRequestDTO.builder().audienceId("aud-1").sourceType("WEBSITE")
                    .userDTO(body("new@example.com", "ADMIN", "TEACHER")).build());
        } catch (RuntimeException afterTheUserStep) {
            // what happens after the user is created is not this test's subject
        }
        assertEquals(List.of(), rolesSentToAuth());
    }

    @Test
    void whatTheLeadFormsSendIsPassedOnUnchanged() {
        // the forms in the repository send an empty list; a missing list stays missing
        try {
            service.submitLead(SubmitLeadRequestDTO.builder().audienceId("aud-1").sourceType("WEBSITE")
                    .userDTO(body("new@example.com")).build());
        } catch (RuntimeException afterTheUserStep) {
            // as above
        }
        assertEquals(List.of(), rolesSentToAuth());

        org.mockito.Mockito.clearInvocations(authService);
        UserDTO noList = body("new@example.com");
        noList.setRoles(null);
        try {
            service.submitLead(SubmitLeadRequestDTO.builder().audienceId("aud-1").sourceType("WEBSITE")
                    .userDTO(noList).build());
        } catch (RuntimeException afterTheUserStep) {
            // as above
        }
        org.junit.jupiter.api.Assertions.assertNull(rolesSentToAuth());
    }

    @Test
    void leadSubmitV2DropsStaffRoleNames() {
        try {
            service.submitLeadV2(SubmitLeadRequestDTO.builder().audienceId("aud-1").sourceType("WEBSITE")
                    .userDTO(body("new@example.com", "ADMIN", "STUDENT")).build());
        } catch (RuntimeException afterTheUserStep) {
            // as above
        }
        assertEquals(List.of("STUDENT"), rolesSentToAuth());
    }

    @Test
    @SuppressWarnings("unchecked")
    void enquirySubmitDropsStaffRoleNamesForParentAndChild() {
        SubmitLeadWithEnquiryRequestDTO request = new SubmitLeadWithEnquiryRequestDTO();
        request.setAudienceId("aud-1");
        request.setParentUserDTO(body("parent@example.com", "ADMIN"));
        request.setChildUserDTO(body("child@example.com", "TEACHER", "STUDENT"));
        try {
            service.submitLeadWithEnquiry(request);
        } catch (RuntimeException afterTheUserStep) {
            // as above
        }
        ArgumentCaptor<List<UserDTO>> sent = ArgumentCaptor.forClass(List.class);
        verify(authService).createMultipleUsers(sent.capture(), eq("inst-1"), anyBoolean());
        assertEquals(List.of(), sent.getValue().get(0).getRoles());
        assertEquals(List.of("STUDENT"), sent.getValue().get(1).getRoles());
    }
}
