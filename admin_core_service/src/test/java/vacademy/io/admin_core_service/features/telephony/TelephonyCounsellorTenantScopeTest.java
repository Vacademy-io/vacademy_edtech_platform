package vacademy.io.admin_core_service.features.telephony;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.telephony.controller.TelephonyCounsellorEndpointController;
import vacademy.io.admin_core_service.features.telephony.controller.dto.TelephonyCounsellorEndpointDTO;
import vacademy.io.admin_core_service.features.telephony.core.UserMobileResolver;
import vacademy.io.admin_core_service.features.telephony.core.inbound.LastCounsellorInboundRouter;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AirtelCallImport;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCounsellorEndpoint;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCounsellorEndpointRepository;
import vacademy.io.admin_core_service.features.telephony.providers.airtel.AirtelImportPromoter;
import vacademy.io.admin_core_service.features.telephony.spi.dto.InboundRouteRequest;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Counsellor identities used by telephony stay inside one institute: an Airtel extension
 * resolves only within the institute the call record belongs to, is unique there, and a
 * counsellor no longer active in the institute stops receiving inbound callbacks.
 */
class TelephonyCounsellorTenantScopeTest {

    private static TelephonyCounsellorEndpoint ep(String institute, String user, String ext) {
        return TelephonyCounsellorEndpoint.builder().id("ep-" + user).instituteId(institute)
                .counsellorUserId(user).providerType("AIRTEL").extension(ext).enabled(true).build();
    }

    // ── Airtel import attribution ────────────────────────────────────────────────

    private static AirtelImportPromoter promoter(TelephonyCounsellorEndpointRepository repo) {
        AirtelImportPromoter p = new AirtelImportPromoter();
        ReflectionTestUtils.setField(p, "endpointRepo", repo);
        return p;
    }

    @Test
    void anExtensionResolvesOnlyInTheRecordsInstitute() {
        TelephonyCounsellorEndpointRepository repo = mock(TelephonyCounsellorEndpointRepository.class);
        when(repo.findByInstituteIdAndProviderTypeAndExtensionAndEnabledTrue("inst-1", "AIRTEL", "201"))
                .thenReturn(List.of(ep("inst-1", "u-1", "201")));
        when(repo.findByInstituteIdAndProviderTypeAndExtensionAndEnabledTrue("inst-2", "AIRTEL", "201"))
                .thenReturn(List.of());
        AirtelImportPromoter p = promoter(repo);

        AirtelCallImport mine = AirtelCallImport.builder().instituteId("inst-1").sourceExtension("201").build();
        AirtelCallImport theirs = AirtelCallImport.builder().instituteId("inst-2").sourceExtension("201").build();
        assertEquals("u-1", ReflectionTestUtils.invokeMethod(p, "resolveCounsellor", mine));
        assertNull(ReflectionTestUtils.invokeMethod(p, "resolveCounsellor", theirs));
    }

    @Test
    void aDuplicatedExtensionIsAmbiguousNotAGuess() {
        TelephonyCounsellorEndpointRepository repo = mock(TelephonyCounsellorEndpointRepository.class);
        when(repo.findByInstituteIdAndProviderTypeAndExtensionAndEnabledTrue("inst-1", "AIRTEL", "201"))
                .thenReturn(List.of(ep("inst-1", "u-1", "201"), ep("inst-1", "u-2", "201")));
        AirtelCallImport rec = AirtelCallImport.builder().instituteId("inst-1").sourceExtension("201").build();
        assertNull(ReflectionTestUtils.invokeMethod(promoter(repo), "resolveCounsellor", rec));
    }

    @Test
    void aRecordWithoutAnInstituteResolvesNobody() {
        TelephonyCounsellorEndpointRepository repo = mock(TelephonyCounsellorEndpointRepository.class);
        AirtelCallImport rec = AirtelCallImport.builder().sourceExtension("201").build();
        assertNull(ReflectionTestUtils.invokeMethod(promoter(repo), "resolveCounsellor", rec));
        verifyNoInteractions(repo);
    }

    // ── Extension uniqueness on upsert ───────────────────────────────────────────

    @Test
    void anExtensionAlreadyUsedInTheInstituteIsA409() {
        TelephonyCounsellorEndpointRepository repo = mock(TelephonyCounsellorEndpointRepository.class);
        when(repo.findByCounsellorUserIdAndProviderType("u-2", "AIRTEL")).thenReturn(Optional.of(ep("inst-1", "u-2", "300")));
        when(repo.findByInstituteIdAndProviderTypeAndExtension("inst-1", "AIRTEL", "201"))
                .thenReturn(List.of(ep("inst-1", "u-1", "201")));
        TelephonyCounsellorEndpointController c = new TelephonyCounsellorEndpointController();
        ReflectionTestUtils.setField(c, "repo", repo);
        ReflectionTestUtils.setField(c, "authService", mock(AuthService.class));
        ReflectionTestUtils.setField(c, "instituteAccessValidator", mock(InstituteAccessValidator.class));
        TelephonyCounsellorEndpointDTO body = new TelephonyCounsellorEndpointDTO();
        body.setCounsellorUserId("u-2");
        body.setProviderType("AIRTEL");
        body.setExtension("201");

        AuthService auth = (AuthService) ReflectionTestUtils.getField(c, "authService");
        vacademy.io.common.auth.dto.UserDTO holder = new vacademy.io.common.auth.dto.UserDTO();
        holder.setId("u-1");
        holder.setFullName("Priya Sharma");
        holder.setEmail("priya@school.in");
        when(auth.getUsersFromAuthServiceByUserIds(List.of("u-1"))).thenReturn(List.of(holder));
        ConflictException e = assertThrows(ConflictException.class,
                () -> c.upsert("inst-1", body, mock(CustomUserDetails.class)));
        assertTrue(e.getMessage().contains("Priya Sharma (priya@school.in)"), e.getMessage());
        verify(repo, never()).save(any());
        // Re-saving your own extension is not a conflict.
        assertNull(TelephonyCounsellorEndpointController.extensionHolder(repo, "inst-1", "AIRTEL", "201", "u-1"));
        assertEquals("u-1", TelephonyCounsellorEndpointController.extensionHolder(repo, "inst-1", "AIRTEL", " 201 ", "u-2"));
    }

    @Test
    void aDisabledMappingDoesNotBlockTheExtension() {
        TelephonyCounsellorEndpointRepository repo = mock(TelephonyCounsellorEndpointRepository.class);
        TelephonyCounsellorEndpoint off = ep("inst-1", "u-1", "201");
        off.setEnabled(false);
        when(repo.findByInstituteIdAndProviderTypeAndExtension("inst-1", "AIRTEL", "201")).thenReturn(List.of(off));
        assertNull(TelephonyCounsellorEndpointController.extensionHolder(repo, "inst-1", "AIRTEL", "201", "u-2"));
    }

    // ── Inbound "last counsellor" routing ────────────────────────────────────────

    private static LastCounsellorInboundRouter router(AuthService auth) {
        LastCounsellorInboundRouter r = new LastCounsellorInboundRouter();
        TelephonyCallLogRepository logs = mock(TelephonyCallLogRepository.class);
        when(logs.findRecentOutboundAttributionByLeadPhone("inst-1", "+919800000001"))
                .thenReturn(List.<Object[]>of(new Object[]{"c-1", "lead-1", "resp-1"}));
        UserMobileResolver mobiles = mock(UserMobileResolver.class);
        when(mobiles.findVerifiedMobile("c-1")).thenReturn(Optional.of("+919811111111"));
        ReflectionTestUtils.setField(r, "callLogRepo", logs);
        ReflectionTestUtils.setField(r, "mobileResolver", mobiles);
        ReflectionTestUtils.setField(r, "authService", auth);
        return r;
    }

    private static InboundRouteRequest call() {
        return InboundRouteRequest.builder().instituteId("inst-1").fromNumber("+919800000001").build();
    }

    @Test
    void anActiveCounsellorStillGetsTheirLeadsCallback() {
        AuthService auth = mock(AuthService.class);
        when(auth.getRoleMembershipsStrict("c-1")).thenReturn(List.of(
                Map.of("institute_id", "inst-1", "role_name", "COUNSELLOR", "status", "ACTIVE")));
        assertTrue(router(auth).route(call()).isPresent());
    }

    @Test
    void anInvitedCounsellorStillGetsTheirLeadsCallback() {
        AuthService auth = mock(AuthService.class);
        when(auth.getRoleMembershipsStrict("c-1")).thenReturn(List.of(
                Map.of("institute_id", "inst-1", "role_name", "COUNSELLOR", "status", "INVITED")));
        assertTrue(router(auth).route(call()).isPresent());
    }

    @Test
    void aDeactivatedCounsellorIsSkipped() {
        AuthService auth = mock(AuthService.class);
        when(auth.getRoleMembershipsStrict("c-1")).thenReturn(List.of(
                Map.of("institute_id", "inst-1", "role_name", "COUNSELLOR", "status", "DISABLED"),
                Map.of("institute_id", "inst-2", "role_name", "COUNSELLOR", "status", "ACTIVE")));
        assertTrue(router(auth).route(call()).isEmpty());
    }

    @Test
    void anAuthOutageKeepsRoutingAsBefore() {
        AuthService auth = mock(AuthService.class);
        when(auth.getRoleMembershipsStrict(anyString())).thenThrow(new VacademyException("down"));
        assertTrue(router(auth).route(call()).isPresent());
    }
}
