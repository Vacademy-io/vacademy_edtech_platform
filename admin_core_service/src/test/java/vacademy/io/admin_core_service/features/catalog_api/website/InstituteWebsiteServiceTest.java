package vacademy.io.admin_core_service.features.catalog_api.website;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.institute_api.service.InstituteApiAuditWriter;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class InstituteWebsiteServiceTest {

    private static final String INSTITUTE = "inst-1";
    private static final Instant NOW = Instant.parse("2026-10-15T10:00:00Z");

    private InstituteWebsiteRepository repository;
    private TxtLookup txtLookup;
    private InstituteApiAuditWriter audit;
    private InstituteWebsiteService service;

    @BeforeEach
    void setUp() {
        repository = mock(InstituteWebsiteRepository.class);
        txtLookup = mock(TxtLookup.class);
        audit = mock(InstituteApiAuditWriter.class);
        service = new InstituteWebsiteService(repository, txtLookup, audit);
        service.setClock(Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private static CustomUserDetails admin() {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("admin-1");
        dto.setUsername("admin@school.test");
        dto.setAuthorities(List.of("ADMIN"));
        return new CustomUserDetails(dto);
    }

    private static InstituteWebsite row(String status) {
        return InstituteWebsite.builder().id("w1").instituteId(INSTITUTE).host("x.com").status(status)
                .verificationToken("0123456789abcdef0123456789abcdef").createdAt(NOW.minusSeconds(3600)).build();
    }

    // ── add ──────────────────────────────────────────────────────────────────

    @Test
    void addNormalisesAndCreatesAPendingRowWithAFreshToken() {
        when(repository.findByInstituteIdAndHost(INSTITUTE, "www.x.com")).thenReturn(Optional.empty());
        InstituteWebsite saved = service.add(INSTITUTE, "https://WWW.x.com/courses", admin());
        ArgumentCaptor<InstituteWebsite> c = ArgumentCaptor.forClass(InstituteWebsite.class);
        verify(repository).saveAndFlush(c.capture());
        assertSame(saved, c.getValue());
        assertEquals("www.x.com", saved.getHost());
        assertEquals(InstituteWebsite.STATUS_PENDING, saved.getStatus());
        assertTrue(saved.getVerificationToken().matches("^[0-9a-f]{32}$"));
        assertEquals("admin-1", saved.getCreatedBy());
        verify(audit).record(eq(INSTITUTE), any(), eq(InstituteApiAuditWriter.ENTITY_WEBSITE), eq(saved.getId()),
                eq("ADD"), anyString(), any(), any());

        Map<String, Object> view = InstituteWebsiteService.view(saved);
        @SuppressWarnings("unchecked")
        Map<String, Object> dns = (Map<String, Object>) view.get("dns_record");
        assertEquals("TXT", dns.get("type"));
        assertEquals("_vacademy-verification.www.x.com", dns.get("name"));
        assertEquals("vacademy-site-verification=" + saved.getVerificationToken(), dns.get("value"));
        assertEquals("PENDING", view.get("status"));
    }

    @Test
    void anInvalidHostIsA400() {
        VacademyException e = assertThrows(VacademyException.class, () -> service.add(INSTITUTE, "localhost", admin()));
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void addingAnExistingHostReturnsItButARevokedOneIsRefused() {
        InstituteWebsite existing = row(InstituteWebsite.STATUS_VERIFIED);
        when(repository.findByInstituteIdAndHost(INSTITUTE, "x.com")).thenReturn(Optional.of(existing));
        assertSame(existing, service.add(INSTITUTE, "x.com", admin()));

        when(repository.findByInstituteIdAndHost(INSTITUTE, "x.com"))
                .thenReturn(Optional.of(row(InstituteWebsite.STATUS_REVOKED)));
        VacademyException e = assertThrows(VacademyException.class, () -> service.add(INSTITUTE, "x.com", admin()));
        assertEquals(HttpStatus.CONFLICT, e.getStatus());
        assertTrue(e.getMessage().contains("Contact support"));
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void atMostTwentyNonRevokedWebsites() {
        when(repository.findByInstituteIdAndHost(anyString(), anyString())).thenReturn(Optional.empty());
        when(repository.countByInstituteIdAndStatusNot(INSTITUTE, "REVOKED")).thenReturn(20L);
        VacademyException e = assertThrows(VacademyException.class, () -> service.add(INSTITUTE, "y.com", admin()));
        assertEquals(HttpStatus.CONFLICT, e.getStatus());
    }

    // ── verify ───────────────────────────────────────────────────────────────

    @Test
    void verifyMatchesTheExactTxtValue() {
        InstituteWebsite r = row(InstituteWebsite.STATUS_PENDING);
        when(repository.findByIdAndInstituteId("w1", INSTITUTE)).thenReturn(Optional.of(r));
        when(txtLookup.lookupVerificationRecord("x.com")).thenReturn(TxtLookup.Result.found(
                List.of("google-site-verification=zzz", " vacademy-site-verification=0123456789abcdef0123456789abcdef ")));
        when(repository.markVerified("w1", INSTITUTE, NOW)).thenReturn(1);
        InstituteWebsite out = service.verify(INSTITUTE, "w1", admin());
        assertEquals(InstituteWebsite.STATUS_VERIFIED, out.getStatus());
        assertEquals(NOW, out.getVerifiedAt());
        assertNull(out.getLastError());
        verify(audit).record(eq(INSTITUTE), any(), anyString(), eq("w1"), eq("VERIFY"), anyString(), any(), any());
    }

    @Test
    void verifyWithoutARecordStaysPendingWithAHelpfulError() {
        when(repository.findByIdAndInstituteId("w1", INSTITUTE)).thenReturn(Optional.of(row("PENDING")));
        when(txtLookup.lookupVerificationRecord("x.com")).thenReturn(TxtLookup.Result.found(List.of()));
        when(repository.markCheckFailed(eq("w1"), eq(INSTITUTE), eq(NOW), anyString())).thenReturn(1);
        InstituteWebsite out = service.verify(INSTITUTE, "w1", admin());
        assertEquals("PENDING", out.getStatus());
        assertEquals("No TXT record found at _vacademy-verification.x.com yet. DNS changes can take up to an hour.",
                out.getLastError());
        assertEquals(NOW, out.getLastCheckedAt());
        verify(repository, never()).markVerified(anyString(), anyString(), any());
        verifyNoInteractions(audit);
    }

    @Test
    void verifyWithAWrongValueOrAFailedLookupStaysPending() {
        when(repository.findByIdAndInstituteId("w1", INSTITUTE)).thenReturn(Optional.of(row("PENDING")));
        when(repository.markCheckFailed(eq("w1"), eq(INSTITUTE), eq(NOW), anyString())).thenReturn(1);
        when(txtLookup.lookupVerificationRecord("x.com")).thenReturn(TxtLookup.Result.found(
                List.of("vacademy-site-verification=ffffffffffffffffffffffffffffffff")));
        InstituteWebsite wrong = service.verify(INSTITUTE, "w1", admin());
        assertEquals("PENDING", wrong.getStatus());
        assertTrue(wrong.getLastError().contains("not with the expected value"));

        when(repository.findByIdAndInstituteId("w1", INSTITUTE)).thenReturn(Optional.of(row("PENDING")));
        when(txtLookup.lookupVerificationRecord("x.com")).thenReturn(TxtLookup.Result.failure("Cloudflare DNS timed out"));
        InstituteWebsite failed = service.verify(INSTITUTE, "w1", admin());
        assertEquals("PENDING", failed.getStatus());
        assertTrue(failed.getLastError().startsWith("Could not check DNS right now"));
        verify(repository, never()).markVerified(anyString(), anyString(), any());
    }

    @Test
    void aRevokeThatLandsDuringTheLookupWins() {
        when(repository.findByIdAndInstituteId("w1", INSTITUTE))
                .thenReturn(Optional.of(row("PENDING")))
                .thenReturn(Optional.of(row("REVOKED")));
        when(txtLookup.lookupVerificationRecord("x.com")).thenReturn(TxtLookup.Result.found(
                List.of("vacademy-site-verification=0123456789abcdef0123456789abcdef")));
        when(repository.markVerified("w1", INSTITUTE, NOW)).thenReturn(0); // no longer PENDING
        VacademyException e = assertThrows(VacademyException.class, () -> service.verify(INSTITUTE, "w1", admin()));
        assertEquals(HttpStatus.CONFLICT, e.getStatus());
        verifyNoInteractions(audit);
    }

    @Test
    void verifyOfRevokedIs409AndOfVerifiedIsANoOp() {
        when(repository.findByIdAndInstituteId("w1", INSTITUTE)).thenReturn(Optional.of(row("REVOKED")));
        assertEquals(HttpStatus.CONFLICT,
                assertThrows(VacademyException.class, () -> service.verify(INSTITUTE, "w1", admin())).getStatus());
        when(repository.findByIdAndInstituteId("w1", INSTITUTE)).thenReturn(Optional.of(row("VERIFIED")));
        assertEquals("VERIFIED", service.verify(INSTITUTE, "w1", admin()).getStatus());
        verifyNoInteractions(txtLookup);
    }

    @Test
    void anotherInstitutesRowIsNotFound() {
        when(repository.findByIdAndInstituteId("w1", "inst-2")).thenReturn(Optional.empty());
        assertEquals(HttpStatus.NOT_FOUND,
                assertThrows(VacademyException.class, () -> service.verify("inst-2", "w1", admin())).getStatus());
        assertEquals(HttpStatus.NOT_FOUND,
                assertThrows(VacademyException.class, () -> service.remove("inst-2", "w1", admin())).getStatus());
        verifyNoInteractions(txtLookup);
        verify(repository, never()).deleteUnlessRevoked(anyString(), anyString());
    }

    // ── remove ───────────────────────────────────────────────────────────────

    @Test
    void removeDeletesButNeverARevokedRow() {
        when(repository.findByIdAndInstituteId("w1", INSTITUTE)).thenReturn(Optional.of(row("VERIFIED")));
        when(repository.deleteUnlessRevoked("w1", INSTITUTE)).thenReturn(1);
        service.remove(INSTITUTE, "w1", admin());
        verify(audit).record(eq(INSTITUTE), any(), anyString(), eq("w1"), eq("REMOVE"), anyString(), any(), any());

        when(repository.findByIdAndInstituteId("w1", INSTITUTE)).thenReturn(Optional.of(row("REVOKED")));
        assertEquals(HttpStatus.CONFLICT,
                assertThrows(VacademyException.class, () -> service.remove(INSTITUTE, "w1", admin())).getStatus());
        verify(repository, times(1)).deleteUnlessRevoked("w1", INSTITUTE);
    }

    @Test
    void removeRacingARevokeIsRefused() {
        when(repository.findByIdAndInstituteId("w1", INSTITUTE))
                .thenReturn(Optional.of(row("PENDING")))
                .thenReturn(Optional.of(row("REVOKED")));
        when(repository.deleteUnlessRevoked("w1", INSTITUTE)).thenReturn(0);
        assertEquals(HttpStatus.CONFLICT,
                assertThrows(VacademyException.class, () -> service.remove(INSTITUTE, "w1", admin())).getStatus());
        verifyNoInteractions(audit);
    }

    // ── super admin ──────────────────────────────────────────────────────────

    @Test
    void revokeNeedsAReasonAndRestoreGoesBackToVerifiedWhenItWasVerified() {
        InstituteWebsite r = row("VERIFIED");
        r.setVerifiedAt(NOW.minusSeconds(60));
        when(repository.findById("w1")).thenReturn(Optional.of(r));
        assertEquals(HttpStatus.BAD_REQUEST,
                assertThrows(VacademyException.class, () -> service.revoke("w1", " ", admin())).getStatus());

        InstituteWebsite revoked = service.revoke("w1", "phishing site", admin());
        assertEquals("REVOKED", revoked.getStatus());
        assertEquals("phishing site", revoked.getRevokedReason());
        assertEquals("admin-1", revoked.getRevokedBy());
        assertEquals(NOW, revoked.getRevokedAt());

        InstituteWebsite restored = service.restore("w1", admin());
        assertEquals("VERIFIED", restored.getStatus());
        assertNull(restored.getRevokedReason());
        verify(audit).record(eq(INSTITUTE), any(), anyString(), eq("w1"), eq("REVOKE"), anyString(), any(), any());
        verify(audit).record(eq(INSTITUTE), any(), anyString(), eq("w1"), eq("RESTORE"), anyString(), any(), any());
    }

    @Test
    void restoreOfANeverVerifiedRowIsPending() {
        when(repository.findById("w1")).thenReturn(Optional.of(row("REVOKED")));
        assertEquals("PENDING", service.restore("w1", admin()).getStatus());
    }

    // ── verified hosts (origin lock) ─────────────────────────────────────────

    @Test
    void verifiedHostsAreCachedAndInvalidatedOnChange() {
        when(repository.findVerifiedHosts(INSTITUTE)).thenReturn(List.of("x.com"));
        assertEquals(Set.of("x.com"), service.verifiedHosts(INSTITUTE));
        assertEquals(Set.of("x.com"), service.verifiedHosts(INSTITUTE));
        verify(repository, times(1)).findVerifiedHosts(INSTITUTE);

        InstituteWebsite r = row("VERIFIED");
        when(repository.findById("w1")).thenReturn(Optional.of(r));
        service.revoke("w1", "abuse", admin());
        when(repository.findVerifiedHosts(INSTITUTE)).thenReturn(List.of());
        assertEquals(Set.of(), service.verifiedHosts(INSTITUTE));
        verify(repository, times(2)).findVerifiedHosts(INSTITUTE);
    }

    @Test
    void verifiedHostsExpireAfterSixtySeconds() {
        when(repository.findVerifiedHosts(INSTITUTE)).thenReturn(List.of("x.com"));
        service.verifiedHosts(INSTITUTE);
        service.setClock(Clock.fixed(NOW.plusSeconds(61), ZoneOffset.UTC));
        service.verifiedHosts(INSTITUTE);
        verify(repository, times(2)).findVerifiedHosts(INSTITUTE);
    }
}
