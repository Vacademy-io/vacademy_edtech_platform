package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import vacademy.io.admin_core_service.features.audience.dto.LeadProfileEditRequestDTO;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.entity.LeadContactHistory;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadContactHistoryRepository;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.audience.service.LeadDeduplicationService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.common.auth.dto.UserDTO;

import java.lang.reflect.Field;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * A lead profile edit that replaces a phone number keeps the old one in
 * lead_contact_history, so Check Lead can still find the lead by it.
 */
class LeadProfileEditPhoneHistoryTest {

    private AudienceService service;
    private LeadContactHistoryRepository history;
    private AudienceResponse response;

    @BeforeEach
    void setUp() throws Exception {
        service = new AudienceService();
        for (Field f : AudienceService.class.getDeclaredFields()) {
            if (f.isAnnotationPresent(Autowired.class) && !f.getType().isPrimitive()) {
                f.setAccessible(true);
                f.set(service, mock(f.getType()));
            }
        }
        history = (LeadContactHistoryRepository) get("leadContactHistoryRepository");
        response = new AudienceResponse();
        response.setId("resp-1");
        response.setAudienceId("aud-1");
        response.setUserId("user-1");
        response.setParentMobile("+91 98765 43210");
        when(((AudienceResponseRepository) get("audienceResponseRepository")).findById("resp-1"))
                .thenReturn(Optional.of(response));
        Audience audience = new Audience();
        audience.setId("aud-1");
        audience.setInstituteId("inst-1");
        when(((AudienceRepository) get("audienceRepository")).findById("aud-1")).thenReturn(Optional.of(audience));
        LeadDeduplicationService dedup = (LeadDeduplicationService) get("leadDeduplicationService");
        when(dedup.checkDuplicate(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        when(dedup.findDuplicate(any(), any())).thenReturn(Optional.empty());
        UserDTO login = new UserDTO();
        login.setId("user-1");
        login.setMobileNumber("7377074039");
        when(((AuthService) get("authService")).getUsersFromAuthServiceByUserIds(List.of("user-1")))
                .thenReturn(List.of(login));
    }

    private Object get(String field) throws Exception {
        Field f = AudienceService.class.getDeclaredField(field);
        f.setAccessible(true);
        return f.get(service);
    }

    @SuppressWarnings("unchecked")
    private List<LeadContactHistory> saved() {
        ArgumentCaptor<List<LeadContactHistory>> captor = ArgumentCaptor.forClass(List.class);
        verify(history).saveAll(captor.capture());
        return captor.getValue();
    }

    @Test
    void replacedEnquiryNumberIsKept() {
        service.updateLeadProfile("resp-1", LeadProfileEditRequestDTO.builder().parentMobile("9000000001").build());

        List<LeadContactHistory> rows = saved();
        assertEquals(1, rows.size());
        assertEquals("9876543210", rows.get(0).getOldPhoneLast10());
        assertEquals("inst-1", rows.get(0).getInstituteId());
        assertEquals("resp-1", rows.get(0).getAudienceResponseId());
        assertEquals("9000000001", rows.get(0).getNewValue());
    }

    @Test
    void replacedLoginNumberIsKept() {
        UserDTO updates = new UserDTO();
        updates.setMobileNumber("9000000002");

        service.updateLeadProfile("resp-1", LeadProfileEditRequestDTO.builder().userDetails(updates).build());

        List<LeadContactHistory> rows = saved();
        assertEquals(1, rows.size());
        assertEquals("7377074039", rows.get(0).getOldPhoneLast10());
    }

    /** Same number in another format, or no phone change at all: nothing is written. */
    @Test
    void unchangedNumberWritesNothing() {
        service.updateLeadProfile("resp-1", LeadProfileEditRequestDTO.builder().parentMobile("9876543210").build());
        service.updateLeadProfile("resp-1", LeadProfileEditRequestDTO.builder().parentName("Ravi").build());

        verify(history, never()).saveAll(any());
    }

    @Test
    void historyFailureDoesNotFailTheEdit() {
        when(history.saveAll(any())).thenThrow(new RuntimeException("db blip"));

        service.updateLeadProfile("resp-1", LeadProfileEditRequestDTO.builder().parentMobile("9000000001").build());

        verify((AudienceResponseRepository) getQuiet("audienceResponseRepository")).save(response);
    }

    private Object getQuiet(String field) {
        try {
            return get(field);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
