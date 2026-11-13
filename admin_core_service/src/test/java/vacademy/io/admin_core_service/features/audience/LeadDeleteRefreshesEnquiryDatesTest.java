package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import vacademy.io.admin_core_service.features.audience.dto.LeadDeleteRequestDTO;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.service.AudienceRoleAccessService;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.lang.reflect.Field;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Deleting or restoring a duplicate makes the lead it repeats re-read its enquiry dates (V676),
 * once per lead however many of its duplicates changed. Deleting a lead that is not a duplicate
 * touches no dates, and the delete itself behaves as before.
 */
class LeadDeleteRefreshesEnquiryDatesTest {

    private AudienceService service;
    private AudienceResponseRepository responses;
    private final CustomUserDetails admin = mock(CustomUserDetails.class);

    @BeforeEach
    void setUp() throws Exception {
        service = new AudienceService();
        for (Field f : AudienceService.class.getDeclaredFields()) {
            if (f.isAnnotationPresent(Autowired.class) && !f.getType().isPrimitive()) {
                f.setAccessible(true);
                f.set(service, mock(f.getType()));
            }
        }
        responses = (AudienceResponseRepository) get("audienceResponseRepository");
        when(((AudienceRoleAccessService) get("audienceRoleAccessService")).resolvedCallerRoles(admin, "inst-1"))
                .thenReturn(Set.of("ADMIN"));
        when(admin.getUserId()).thenReturn("admin-1");
    }

    private Object get(String field) throws Exception {
        Field f = AudienceService.class.getDeclaredField(field);
        f.setAccessible(true);
        return f.get(service);
    }

    private static AudienceResponse row(String id, boolean duplicate, String primaryId, String status) {
        AudienceResponse r = new AudienceResponse();
        r.setId(id);
        r.setIsDuplicate(duplicate);
        r.setPrimaryResponseId(primaryId);
        r.setAudienceStatus(status);
        return r;
    }

    private static LeadDeleteRequestDTO request(String... ids) {
        LeadDeleteRequestDTO r = new LeadDeleteRequestDTO();
        r.setInstituteId("inst-1");
        r.setResponseIds(List.of(ids));
        return r;
    }

    @Test
    void deletingDuplicatesRefreshesTheirLeadOnce() {
        when(responses.findAllByInstituteAndIds(eq("inst-1"), any())).thenReturn(List.of(
                row("dup-1", true, "lead-1", "ACTIVE"),
                row("dup-2", true, "lead-1", "ACTIVE"),
                row("lead-2", false, null, "ACTIVE")));

        assertEquals(3, service.deleteLeads(request("dup-1", "dup-2", "lead-2"), admin));

        verify(responses, times(3)).save(any(AudienceResponse.class));
        verify(responses, times(1)).refreshEnquiryDates("lead-1");
        verify(responses, times(1)).refreshEnquiryDates(any());
        verify(responses, times(1)).refreshDuplicateOrder("lead-1");
    }

    @Test
    void deletingALeadThatIsNoDuplicateTouchesNoDates() {
        when(responses.findAllByInstituteAndIds(eq("inst-1"), any())).thenReturn(List.of(
                row("lead-2", false, null, "ACTIVE")));

        assertEquals(1, service.deleteLeads(request("lead-2"), admin));

        verify(responses, never()).refreshEnquiryDates(any());
        verify(responses, never()).refreshDuplicateOrder(any());
    }

    @Test
    void alreadyDeletedDuplicateChangesNothing() {
        when(responses.findAllByInstituteAndIds(eq("inst-1"), any())).thenReturn(List.of(
                row("dup-1", true, "lead-1", "INACTIVE")));

        assertEquals(0, service.deleteLeads(request("dup-1"), admin));

        verify(responses, never()).save(any(AudienceResponse.class));
        verify(responses, never()).refreshEnquiryDates(any());
    }

    @Test
    void restoringADuplicateRefreshesItsLead() {
        when(responses.findAllByInstituteAndIds(eq("inst-1"), any())).thenReturn(List.of(
                row("dup-1", true, "lead-1", "INACTIVE")));

        assertEquals(1, service.restoreLeads(request("dup-1"), admin));

        verify(responses).refreshEnquiryDates("lead-1");
        verify(responses).refreshDuplicateOrder("lead-1");
    }

    @Test
    void aFailedRefreshNeverFailsTheDelete() {
        when(responses.findAllByInstituteAndIds(eq("inst-1"), any())).thenReturn(List.of(
                row("dup-1", true, "lead-1", "ACTIVE")));
        when(responses.refreshEnquiryDates("lead-1")).thenThrow(new RuntimeException("db down"));

        assertEquals(1, service.deleteLeads(request("dup-1"), admin));
    }
}
