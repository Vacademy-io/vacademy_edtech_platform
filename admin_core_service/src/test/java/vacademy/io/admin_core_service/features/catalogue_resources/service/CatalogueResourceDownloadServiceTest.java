package vacademy.io.admin_core_service.features.catalogue_resources.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.audience.service.AudienceRoleAccessService;
import vacademy.io.admin_core_service.features.counsellor_workbench.service.CounsellorScopeService;
import vacademy.io.admin_core_service.features.suborg.service.SubOrgLeadScopeService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.catalogue_resources.dto.ResourceDownloadReport;
import vacademy.io.admin_core_service.features.catalogue_resources.dto.ResourceDownloadRequest;
import vacademy.io.admin_core_service.features.catalogue_resources.entity.CatalogueResourceDownload;
import vacademy.io.admin_core_service.features.catalogue_resources.repository.CatalogueResourceDownloadRepository;
import vacademy.io.common.auth.dto.UserDTO;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * A freebie download must land on the right lead (or on nobody), never twice
 * for one click burst, and never fail the visitor's page.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class CatalogueResourceDownloadServiceTest {

    private static final String INST = "inst-1";
    private static final String GATE = "aud-freebies";
    private static final String DRIVE = "https://drive.google.com/file/d/abc/view";

    @Mock private CatalogueResourceDownloadRepository repository;
    @Mock private AuthService authService;
    @Mock private InstituteAccessValidator accessValidator;
    @Mock private AudienceRoleAccessService audienceRoleAccessService;
    @Mock private CounsellorScopeService counsellorScopeService;
    @Mock private SubOrgLeadScopeService subOrgLeadScopeService;
    @InjectMocks private CatalogueResourceDownloadService service;

    private ResourceDownloadRequest request(String email, String phone) {
        ResourceDownloadRequest r = new ResourceDownloadRequest();
        r.setInstituteId(INST);
        r.setAudienceId(GATE);
        r.setPageRoute("free-resources");
        r.setResourceTitle("Phonics Worksheet");
        r.setResourceUrl(DRIVE);
        r.setEmail(email);
        r.setMobileNumber(phone);
        return r;
    }

    private CatalogueResourceDownload saved() {
        ArgumentCaptor<CatalogueResourceDownload> c = ArgumentCaptor.forClass(CatalogueResourceDownload.class);
        verify(repository).save(c.capture());
        return c.getValue();
    }

    @Test
    @DisplayName("a known email ties the download to that lead")
    void knownEmail() {
        when(repository.audienceInInstitute(GATE, INST)).thenReturn(List.of(GATE));
        when(repository.findLeadByEmail(INST, GATE, "parent@example.com"))
                .thenReturn(List.<Object[]>of(new Object[] {"resp-1", "user-1"}));

        service.record(request(" parent@example.com ", null));

        CatalogueResourceDownload d = saved();
        assertEquals("resp-1", d.getAudienceResponseId());
        assertEquals("user-1", d.getUserId());
        assertEquals(GATE, d.getAudienceId());
        assertEquals(DRIVE, d.getResourceUrl());
    }

    @Test
    @DisplayName("no email falls back to the last 10 digits of the phone within the gate list")
    void phoneFallback() {
        when(repository.audienceInInstitute(GATE, INST)).thenReturn(List.of(GATE));
        when(repository.findLeadByPhone(GATE, "9876543210"))
                .thenReturn(List.<Object[]>of(new Object[] {"resp-2", "user-2"}));

        service.record(request(null, "+91 98765-43210"));

        assertEquals("resp-2", saved().getAudienceResponseId());
    }

    @Test
    @DisplayName("the same lead opening the same file again within the window is one download")
    void repeatClick() {
        when(repository.audienceInInstitute(GATE, INST)).thenReturn(List.of(GATE));
        when(repository.findLeadByEmail(any(), any(), any()))
                .thenReturn(List.<Object[]>of(new Object[] {"resp-1", "user-1"}));
        when(repository.countRecent(eq("resp-1"), eq(DRIVE), any(Timestamp.class))).thenReturn(1L);

        service.record(request("parent@example.com", null));

        verify(repository, never()).save(any());
    }

    @Test
    @DisplayName("a visitor with no form filled still counts, against nobody")
    void anonymous() {
        when(repository.audienceInInstitute(GATE, INST)).thenReturn(List.of(GATE));

        service.record(request(null, null));

        CatalogueResourceDownload d = saved();
        assertNull(d.getAudienceResponseId());
    }

    @Test
    @DisplayName("a gate list from another institute is not kept on the row")
    void foreignAudience() {
        when(repository.audienceInInstitute(GATE, INST)).thenReturn(List.of());

        service.record(request(null, null));

        assertNull(saved().getAudienceId());
    }

    @Test
    @DisplayName("a broken database never reaches the visitor")
    void neverThrows() {
        when(repository.audienceInInstitute(any(), any())).thenThrow(new RuntimeException("db down"));
        assertDoesNotThrow(() -> service.record(request("parent@example.com", null)));
        assertDoesNotThrow(() -> service.record(null));
    }

    private CustomUserDetails admin() {
        CustomUserDetails user = mock(CustomUserDetails.class);
        when(user.getUserId()).thenReturn("admin-1");
        when(audienceRoleAccessService.resolveForCaller(user, INST))
                .thenReturn(AudienceRoleAccessService.EffectiveAccess.defaultMode());
        when(subOrgLeadScopeService.subOrgScopedCounsellorUserIds("admin-1")).thenReturn(List.of());
        when(counsellorScopeService.isScopedCaller(INST, user)).thenReturn(false);
        return user;
    }

    @Test
    @DisplayName("report: a counsellor-scoped caller gets nothing, not every lead's phone")
    void reportScopedCaller() {
        CustomUserDetails user = admin();
        when(counsellorScopeService.isScopedCaller(INST, user)).thenReturn(true);

        ResourceDownloadReport report = service.report(user, INST, GATE, 90);

        assertTrue(report.getLeads().isEmpty());
        verify(repository, never()).byLead(any(), any(), any());
    }

    @Test
    @DisplayName("report: a sub-org admin gets nothing")
    void reportSubOrgAdmin() {
        CustomUserDetails user = admin();
        when(subOrgLeadScopeService.subOrgScopedCounsellorUserIds("admin-1")).thenReturn(List.of("admin-1", "m-2"));

        assertTrue(service.report(user, INST, null, 90).getLeads().isEmpty());
        verify(repository, never()).byLead(any(), any(), any());
    }

    @Test
    @DisplayName("report: one row per lead with distinct freebies newest first and the auth name")
    void reportPerLead() {
        when(repository.totals(eq(INST), isNull(), any())).thenReturn(List.<Object[]>of(new Object[] {5L, 1L}));
        when(repository.byResource(eq(INST), isNull(), any())).thenReturn(List.of());
        String sep = String.valueOf((char) 31);
        when(repository.byLead(eq(INST), isNull(), any())).thenReturn(List.<Object[]>of(new Object[] {
                "resp-1", "user-1", null, "parent@example.com", "9876543210", "Freebies", 5L,
                "Rhymes" + sep + "Phonics Worksheet" + sep + "Rhymes" + sep + "https://youtu.be/x",
                Timestamp.valueOf(LocalDateTime.of(2026, 10, 8, 4, 30))}));
        UserDTO user = new UserDTO();
        user.setId("user-1");
        user.setFullName("Asha Verma");
        when(authService.getUsersFromAuthServiceByUserIds(List.of("user-1"))).thenReturn(List.of(user));

        ResourceDownloadReport report = service.report(admin(), INST, " ", 90);

        assertEquals(5, report.getTotalDownloads());
        ResourceDownloadReport.LeadRow row = report.getLeads().get(0);
        assertEquals("Asha Verma", row.getName());
        assertEquals(List.of("Rhymes", "Phonics Worksheet", "https://youtu.be/x"), row.getResources());
        assertEquals("2026-10-08T04:30:00Z", row.getLastDownloadedAt());
    }

    @Test
    @DisplayName("lead profile: one lead's freebies, newest first, as instants")
    void forLead() {
        when(repository.forLead(INST, "user-1")).thenReturn(List.<Object[]>of(
                new Object[] {"Rhymes", "https://youtu.be/x", Timestamp.valueOf(LocalDateTime.of(2026, 10, 8, 5, 0))},
                new Object[] {null, DRIVE, Timestamp.valueOf(LocalDateTime.of(2026, 10, 7, 9, 15))}));

        var rows = service.forLead(admin(), INST, " user-1 ");

        assertEquals(2, rows.size());
        assertEquals("Rhymes", rows.get(0).getTitle());
        assertEquals("2026-10-08T05:00:00Z", rows.get(0).getDownloadedAt());
        assertEquals(DRIVE, rows.get(1).getUrl());
        assertTrue(service.forLead(admin(), INST, null).isEmpty());
    }
}
