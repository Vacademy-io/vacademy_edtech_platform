package vacademy.io.admin_core_service.features.packages.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.packages.dto.PackageSessionInventoryDTO;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository.SessionInstituteRow;
import vacademy.io.admin_core_service.features.packages.service.PackageSessionService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** Seat and stock counts are for staff of an institute the batch belongs to. */
class PackageSessionInventoryControllerAccessTest {

    private PackageSessionService service;
    private PackageSessionRepository repository;
    private InstituteAccessValidator validator;
    private PackageSessionInventoryController controller;
    private CustomUserDetails user;

    @BeforeEach
    void setUp() {
        service = mock(PackageSessionService.class);
        repository = mock(PackageSessionRepository.class);
        validator = mock(InstituteAccessValidator.class);
        controller = new PackageSessionInventoryController(service, repository, validator);
        user = mock(CustomUserDetails.class);
        // The caller is staff of inst-own only.
        doThrow(new ForbiddenException("Access denied: staff role required"))
                .when(validator).requireInstituteStaff(any(), anyString());
        org.mockito.Mockito.doNothing().when(validator).requireInstituteStaff(user, "inst-own");
    }

    private void belongs(String packageSessionId, String... instituteIds) {
        List<SessionInstituteRow> rows = new java.util.ArrayList<>();
        for (String instituteId : instituteIds) {
            SessionInstituteRow row = mock(SessionInstituteRow.class);
            when(row.getPackageSessionId()).thenReturn(packageSessionId);
            when(row.getInstituteId()).thenReturn(instituteId);
            rows.add(row);
        }
        when(repository.findInstitutesOfPackageSessions(anyCollection())).thenReturn(rows);
    }

    @Test
    void aBatchOfAnotherInstituteCanBeNeitherReadNorChanged() {
        belongs("ps-1", "inst-other");
        PackageSessionInventoryDTO body = new PackageSessionInventoryDTO();

        assertThrows(ForbiddenException.class, () -> controller.updateCapacity("ps-1", body, user));
        assertThrows(ForbiddenException.class, () -> controller.reserveSlot("ps-1", user));
        assertThrows(ForbiddenException.class, () -> controller.releaseSlot("ps-1", user));
        assertThrows(ForbiddenException.class, () -> controller.getAvailability("ps-1", user));

        verifyNoInteractions(service);
    }

    @Test
    void anUnknownBatchIsRefusedTheSameWay() {
        when(repository.findInstitutesOfPackageSessions(anyCollection())).thenReturn(List.of());
        assertThrows(ForbiddenException.class, () -> controller.getAvailability("nope", user));
        verifyNoInteractions(service);
    }

    @Test
    void staffOfAnInstituteTheBatchIsSharedWithPass() {
        belongs("ps-1", "inst-other", "inst-own");
        when(service.getAvailability("ps-1")).thenReturn(Map.of());

        controller.getAvailability("ps-1", user);
        controller.reserveSlot("ps-1", user);

        verify(service).getAvailability("ps-1");
        verify(service).reserveSlot("ps-1");
    }

    @Test
    void theBatchListLeavesOutWhatTheCallerMayNotSee() {
        SessionInstituteRow own = mock(SessionInstituteRow.class);
        when(own.getPackageSessionId()).thenReturn("ps-own");
        when(own.getInstituteId()).thenReturn("inst-own");
        SessionInstituteRow other = mock(SessionInstituteRow.class);
        when(other.getPackageSessionId()).thenReturn("ps-other");
        when(other.getInstituteId()).thenReturn("inst-other");
        when(repository.findInstitutesOfPackageSessions(anyCollection())).thenReturn(List.of(own, other));

        controller.getBatchAvailability(List.of("ps-own", "ps-other", "ps-unknown"), user);

        verify(service).getBatchAvailability(List.of("ps-own"));
    }

    @Test
    void statsNeedStaffOfThatInstitute() {
        assertThrows(ForbiddenException.class, () -> controller.getInventoryStats("inst-other", user));
        verify(service, never()).getInventoryStats(anyString());
    }

    // ── with the real validator: the root flag opens nothing ────────────────

    /**
     * The root flag opens nothing: only staff of the batch's institute may read or change its
     * seat counts.
     */
    @Test
    void aRootUserOfAnotherInstituteCanNeitherReadNorChangeABatch() {
        PackageSessionInventoryController real = new PackageSessionInventoryController(service, repository,
                new InstituteAccessValidator());
        belongs("ps-1", "inst-victim");
        org.springframework.mock.web.MockHttpServletRequest request = new org.springframework.mock.web.MockHttpServletRequest();
        request.addHeader("clientId", "inst-attacker");
        org.springframework.web.context.request.RequestContextHolder.setRequestAttributes(
                new org.springframework.web.context.request.ServletRequestAttributes(request));
        try {
            CustomUserDetails rootLearner = principal(true, "STUDENT");
            CustomUserDetails rootAdminElsewhere = principal(true, "ADMIN");
            for (CustomUserDetails caller : List.of(rootLearner, rootAdminElsewhere)) {
                assertThrows(ForbiddenException.class,
                        () -> real.updateCapacity("ps-1", new PackageSessionInventoryDTO(), caller));
                assertThrows(ForbiddenException.class, () -> real.reserveSlot("ps-1", caller));
                assertThrows(ForbiddenException.class, () -> real.getAvailability("ps-1", caller));
                assertThrows(ForbiddenException.class, () -> real.getInventoryStats("inst-victim", caller));
                real.getBatchAvailability(List.of("ps-1"), caller);
            }
            verify(service, never()).updateInventory(any(), any(), any());
            verify(service, org.mockito.Mockito.times(2)).getBatchAvailability(List.of());
            verify(service, never()).getAvailability(anyString());
        } finally {
            org.springframework.web.context.request.RequestContextHolder.resetRequestAttributes();
        }
    }

    @Test
    void staffOfTheBatchInstitutePassWithTheRealValidatorRootOrNot() {
        PackageSessionInventoryController real = new PackageSessionInventoryController(service, repository,
                new InstituteAccessValidator());
        belongs("ps-1", "inst-own");
        org.springframework.mock.web.MockHttpServletRequest request = new org.springframework.mock.web.MockHttpServletRequest();
        request.addHeader("clientId", "inst-own");
        org.springframework.web.context.request.RequestContextHolder.setRequestAttributes(
                new org.springframework.web.context.request.ServletRequestAttributes(request));
        try {
            real.getAvailability("ps-1", principal(false, "ADMIN"));
            real.getAvailability("ps-1", principal(true, "TEACHER"));
            verify(service, org.mockito.Mockito.times(2)).getAvailability("ps-1");
            // A learner of the same institute is not staff, root or not.
            assertThrows(ForbiddenException.class, () -> real.getAvailability("ps-1", principal(true, "STUDENT")));
        } finally {
            org.springframework.web.context.request.RequestContextHolder.resetRequestAttributes();
        }
    }

    private static CustomUserDetails principal(boolean root, String... authorities) {
        vacademy.io.common.auth.dto.UserServiceDTO dto = new vacademy.io.common.auth.dto.UserServiceDTO();
        dto.setUserId("u-1");
        dto.setUsername("u-1");
        dto.setFullName("Test User");
        dto.setRootUser(root);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }
}
