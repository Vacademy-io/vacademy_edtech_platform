package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.audience.dto.SubmitLeadRequestDTO;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository.LeadOwnerRow;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository.OpenLeadRow;
import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.audience.service.LeadDeduplicationService;
import vacademy.io.admin_core_service.features.audience.service.ManualLeadOwnerGuard;
import vacademy.io.admin_core_service.features.counsellor_workbench.service.CounsellorScopeService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/** A counsellor cannot add by hand a lead another counsellor owns; everyone else can. */
class ManualLeadOwnerGuardTest {

    private LeadDeduplicationService dedup;
    private CounsellorScopeService scope;
    private ManualLeadOwnerGuard guard;
    private CustomUserDetails caller;

    @BeforeEach
    void setUp() {
        AudienceRepository audiences = mock(AudienceRepository.class);
        dedup = mock(LeadDeduplicationService.class);
        scope = mock(CounsellorScopeService.class);
        guard = new ManualLeadOwnerGuard(audiences, dedup, scope);

        Audience audience = new Audience();
        audience.setId("aud-1");
        audience.setInstituteId("inst-1");
        when(audiences.findById("aud-1")).thenReturn(Optional.of(audience));

        caller = mock(CustomUserDetails.class);
        when(caller.getUserId()).thenReturn("counsellor-me");
        when(scope.allCounsellorUserIds("inst-1")).thenReturn(List.of("counsellor-me", "counsellor-other"));
    }

    private SubmitLeadRequestDTO request(String phone) {
        SubmitLeadRequestDTO dto = new SubmitLeadRequestDTO();
        dto.setAudienceId("aud-1");
        UserDTO user = new UserDTO();
        user.setMobileNumber(phone);
        dto.setUserDTO(user);
        return dto;
    }

    private void ownedBy(String counsellorId, String name) {
        LeadOwnerRow row = mock(LeadOwnerRow.class);
        when(row.getCounsellorId()).thenReturn(counsellorId);
        when(row.getCounsellorName()).thenReturn(name);
        when(dedup.findCurrentOwnerByPhone("inst-1", "aud-1", "9876543210")).thenReturn(Optional.of(row));
    }

    @Test
    void anotherCounsellorsLeadIsRefusedWithTheirName() {
        ownedBy("counsellor-other", "Shruti");

        VacademyException e = assertThrows(VacademyException.class,
                () -> guard.checkCanAdd(request("9876543210"), caller));
        assertTrue(e.getMessage().contains("Shruti"));
    }

    @Test
    void ownLeadNewPhoneAndAdminsGoThrough() {
        ownedBy("counsellor-me", "Me");
        assertDoesNotThrow(() -> guard.checkCanAdd(request("9876543210"), caller));

        when(dedup.findCurrentOwnerByPhone(any(), any(), any())).thenReturn(Optional.empty());
        assertDoesNotThrow(() -> guard.checkCanAdd(request("9876543210"), caller));

        ownedBy("counsellor-other", "Shruti");
        when(scope.hasAdminRole(caller, "inst-1")).thenReturn(true);
        assertDoesNotThrow(() -> guard.checkCanAdd(request("9876543210"), caller));
    }

    /** Front desk and other non-counsellor staff add walk-ins as before. */
    @Test
    void staffWhoAreNotCounsellorsGoThrough() {
        ownedBy("counsellor-other", "Shruti");
        when(caller.getUserId()).thenReturn("front-desk");
        assertDoesNotThrow(() -> guard.checkCanAdd(request("9876543210"), caller));
    }

    @Test
    void ownerWhoIsNoLongerACounsellorDoesNotBlock() {
        ownedBy("counsellor-removed", "Gone");
        assertDoesNotThrow(() -> guard.checkCanAdd(request("9876543210"), caller));
    }

    @Test
    void noPhoneOrAFailedLookupLetsTheAddThrough() {
        assertDoesNotThrow(() -> guard.checkCanAdd(request(null), caller));
        // No phone: the owner check never runs (the open-lead check may, for email dedup).
        verify(dedup, never()).findCurrentOwnerByPhone(any(), any(), any());

        when(dedup.findCurrentOwnerByPhone(any(), any(), any())).thenThrow(new RuntimeException("db down"));
        assertDoesNotThrow(() -> guard.checkCanAdd(request("9876543210"), caller));
    }

    // ── blockOpenLeadManualAdd ────────────────────────────────────────────────

    private void openLead(String ownerName, String statusLabel) {
        OpenLeadRow row = mock(OpenLeadRow.class);
        when(row.getCounsellorName()).thenReturn(ownerName);
        when(row.getStatusLabel()).thenReturn(statusLabel);
        when(dedup.findOpenLeadForManualAdd(eq("inst-1"), eq("aud-1"), any(), any())).thenReturn(Optional.of(row));
    }

    /** A lead still being worked is refused with a 409 naming its owner and status. */
    @Test
    void openLeadIsRefusedWithOwnerAndStatus() {
        openLead("Shruti", "Call Back");

        VacademyException e = assertThrows(VacademyException.class,
                () -> guard.checkCanAdd(request("9876543210"), caller));
        assertEquals(HttpStatus.CONFLICT, e.getStatus());
        assertTrue(e.getMessage().contains("Shruti"));
        assertTrue(e.getMessage().contains("Call Back"));
    }

    /** The open-lead rule holds for the counsellor's own lead too, and for an unowned one. */
    @Test
    void openLeadIsRefusedEvenWhenItIsTheirsOrUnowned() {
        ownedBy("counsellor-me", "Me");
        openLead(null, "New");

        VacademyException e = assertThrows(VacademyException.class,
                () -> guard.checkCanAdd(request("9876543210"), caller));
        assertTrue(e.getMessage().contains("not assigned yet"));
    }

    /** Email-only adds are checked too (institutes deduping on email). */
    @Test
    void openLeadMatchedByEmailIsRefused() {
        openLead("Shruti", "Call Back");
        SubmitLeadRequestDTO dto = request(null);
        dto.getUserDTO().setEmail("asha@example.com");

        assertThrows(VacademyException.class, () -> guard.checkCanAdd(dto, caller));
    }

    /** Admins and non-counsellor staff are not held back by the open-lead rule. */
    @Test
    void openLeadRuleSkipsAdminsAndOtherStaff() {
        openLead("Shruti", "Call Back");

        when(scope.hasAdminRole(caller, "inst-1")).thenReturn(true);
        assertDoesNotThrow(() -> guard.checkCanAdd(request("9876543210"), caller));

        when(scope.hasAdminRole(caller, "inst-1")).thenReturn(false);
        when(scope.allCounsellorUserIds("inst-1")).thenReturn(List.of("counsellor-other"));
        assertDoesNotThrow(() -> guard.checkCanAdd(request("9876543210"), caller));
    }

    /** No open lead (every match converted or discarded) — the add goes through. */
    @Test
    void closedLeadCanBeAddedAgain() {
        when(dedup.findOpenLeadForManualAdd(any(), any(), any(), any())).thenReturn(Optional.empty());

        assertDoesNotThrow(() -> guard.checkCanAdd(request("9876543210"), caller));
    }

    /** A failed lookup lets the add through rather than blocking every manual add. */
    @Test
    void openLeadLookupFailureAllowsTheAdd() {
        when(dedup.findOpenLeadForManualAdd(any(), any(), any(), any())).thenThrow(new RuntimeException("db down"));

        assertDoesNotThrow(() -> guard.checkCanAdd(request("9876543210"), caller));
    }
}
