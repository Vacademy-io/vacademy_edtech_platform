package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.audience.service.AutoLeadListProvisioner;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.common.auth.dto.UserDTO;

import java.lang.reflect.Field;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * A public live-session registrant lands in that session's own list, and the same capture
 * serves open assessments with their own lead source.
 */
class AutoListLeadCaptureTest {

    private AudienceService service;
    private AutoLeadListProvisioner provisioner;
    private AudienceResponseRepository responses;
    private Audience sessionList;

    @BeforeEach
    void setUp() throws Exception {
        service = new AudienceService();
        for (Field f : AudienceService.class.getDeclaredFields()) {
            if (f.isAnnotationPresent(Autowired.class) && !f.getType().isPrimitive()) {
                f.setAccessible(true);
                f.set(service, mock(f.getType()));
            }
        }
        provisioner = (AutoLeadListProvisioner) get("autoLeadListProvisioner");
        responses = (AudienceResponseRepository) get("audienceResponseRepository");
        AuthService auth = (AuthService) get("authService");

        sessionList = new Audience();
        sessionList.setId("aud-sess-1");
        sessionList.setInstituteId("inst-1");
        sessionList.setStatus("ACTIVE");
        sessionList.setCampaignName("Physics Masterclass - Public Live Session");

        UserDTO user = new UserDTO();
        user.setId("user-1");
        user.setEmail("asha@example.com");
        when(auth.createUserFromAuthService(any(), eq("inst-1"), anyBoolean())).thenReturn(user);
        when(responses.save(any(AudienceResponse.class))).thenAnswer(inv -> {
            AudienceResponse r = inv.getArgument(0);
            r.setId("resp-1");
            return r;
        });
    }

    private Object get(String field) throws Exception {
        Field f = AudienceService.class.getDeclaredField(field);
        f.setAccessible(true);
        return f.get(service);
    }

    private AudienceResponse saved() {
        ArgumentCaptor<AudienceResponse> captor = ArgumentCaptor.forClass(AudienceResponse.class);
        verify(responses).save(captor.capture());
        return captor.getValue();
    }

    @Test
    void liveSessionRegistrantGoesToThatSessionsOwnList() {
        when(provisioner.getOrCreate("inst-1", "Public Live Session", "sess-1", "Physics Masterclass"))
                .thenReturn(sessionList);

        String id = service.submitLiveClassLead("inst-1", "Asha Rao", "asha@example.com", "+919876543210",
                Map.of(), "sess-1", "Physics Masterclass");

        assertEquals("resp-1", id);
        AudienceResponse lead = saved();
        assertEquals("aud-sess-1", lead.getAudienceId());
        assertEquals("LIVE_SESSION", lead.getSourceType());
        assertEquals("sess-1", lead.getSourceId());
    }

    @Test
    void aPausedSessionListCapturesNothing() {
        sessionList.setStatus("INACTIVE");
        when(provisioner.getOrCreate(any(), any(), any(), any())).thenReturn(sessionList);

        assertNull(service.submitLiveClassLead("inst-1", "Asha Rao", "asha@example.com", null,
                Map.of(), "sess-1", "Physics Masterclass"));
        verify(responses, never()).save(any(AudienceResponse.class));
    }

    @Test
    void openAssessmentLeadCarriesItsOwnSource() {
        Audience testList = new Audience();
        testList.setId("aud-test-1");
        testList.setInstituteId("inst-1");
        testList.setStatus("ACTIVE");

        String id = service.submitLeadToAutoList(testList, "Asha Rao", "asha@example.com", "+919876543210",
                Map.of(), "OPEN_ASSESSMENT", "test-1");

        assertEquals("resp-1", id);
        AudienceResponse lead = saved();
        assertEquals("aud-test-1", lead.getAudienceId());
        assertEquals("OPEN_ASSESSMENT", lead.getSourceType());
        assertEquals("test-1", lead.getSourceId());
        verifyNoInteractions(provisioner);
    }
}
