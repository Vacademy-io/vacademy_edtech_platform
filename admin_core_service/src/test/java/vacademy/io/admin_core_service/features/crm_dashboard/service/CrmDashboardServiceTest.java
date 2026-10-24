package vacademy.io.admin_core_service.features.crm_dashboard.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.audience.dto.LeadVisibility;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.audience.service.LeadDeduplicationService;
import vacademy.io.admin_core_service.features.audience.service.LeadFollowupService;
import vacademy.io.admin_core_service.features.audience.service.LeadVisibilityResolver;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.counsellor_workbench.service.CounsellorScopeService;
import vacademy.io.admin_core_service.features.crm_dashboard.dto.CrmDashboardRequestDTO;
import vacademy.io.admin_core_service.features.crm_dashboard.dto.CrmDashboardResponseDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class CrmDashboardServiceTest {

    private static final String INSTITUTE = "inst-1";

    private NamedParameterJdbcTemplate jdbc;
    private LeadVisibilityResolver resolver;
    private CounsellorScopeService scopeService;
    private AudienceService audienceService;
    private LeadDeduplicationService dedupService;
    private CrmDashboardService service;
    private CustomUserDetails user;

    @BeforeEach
    void setUp() {
        jdbc = mock(NamedParameterJdbcTemplate.class);
        resolver = mock(LeadVisibilityResolver.class);
        scopeService = mock(CounsellorScopeService.class);
        audienceService = mock(AudienceService.class);
        dedupService = mock(LeadDeduplicationService.class);
        service = new CrmDashboardService(jdbc, mock(PlatformTransactionManager.class), resolver, scopeService,
                audienceService, mock(LeadFollowupService.class), dedupService, mock(AuthService.class));
        user = mock(CustomUserDetails.class);
        when(user.getUserId()).thenReturn("u-1");
    }

    private static CrmDashboardRequestDTO request(String from, String to) {
        CrmDashboardRequestDTO r = new CrmDashboardRequestDTO();
        r.setInstituteId(INSTITUTE);
        r.setFrom(from);
        r.setTo(to);
        r.setNow("2026-10-16T09:00:00Z");
        return r;
    }

    @Test
    @DisplayName("A role granted no lists sees an empty dashboard, like the empty leads list, and nothing is queried")
    void noGrantedListsMeansNothing() {
        when(resolver.resolve(any(), eq(INSTITUTE))).thenReturn(new LeadVisibility(
                LeadVisibility.Mode.AUDIENCE_LIST, null, null, true, List.of(), List.of(), false));

        CrmDashboardResponseDTO res = service.getDashboard(request(null, null), user);

        assertEquals(CrmDashboardService.ALL_BLOCKS.size(), res.getBlocks().size());
        res.getBlocks().values().forEach(v -> assertEquals(Map.of("empty", true), v));
        assertFalse(res.isAdmin());
        verifyNoInteractions(jdbc, audienceService);
    }

    @Test
    @DisplayName("A team filter outside the caller's own scope never widens it: zero, not institute-wide")
    void teamOutsideScopeIsEmpty() {
        when(resolver.resolve(any(), eq(INSTITUTE))).thenReturn(new LeadVisibility(
                LeadVisibility.Mode.COUNSELLOR_TREE, List.of("u-1", "u-2"), null, true, null, List.of(), false));
        when(scopeService.usersInTeams(anyList())).thenReturn(List.of("u-9"));

        CrmDashboardRequestDTO req = request(null, null);
        req.setTeamId("team-x");
        req.setBlocks(List.of("summary", "calls"));
        CrmDashboardResponseDTO res = service.getDashboard(req, user);

        assertEquals(Map.of("empty", true), res.getBlocks().get("summary"));
        assertEquals(Map.of("empty", true), res.getBlocks().get("calls"));
        verifyNoInteractions(jdbc, audienceService);
    }

    @Test
    @DisplayName("Ranges over a year are refused")
    void rangeIsCapped() {
        assertThrows(VacademyException.class,
                () -> service.resolveWindow(request("2025-01-01T00:00:00Z", "2026-10-16T00:00:00Z")));
    }

    @Test
    @DisplayName("Short ranges are compared with the equal period before; long ones are not")
    void comparisonOnlyForShortRanges() {
        CrmDashboardService.Window shortRange = service.resolveWindow(
                request("2026-09-16T00:00:00Z", "2026-10-16T00:00:00Z"));
        assertTrue(shortRange.compare());
        assertEquals("2026-08-17T00:00", shortRange.prevFrom().toString());

        CrmDashboardService.Window longRange = service.resolveWindow(
                request("2026-01-01T00:00:00Z", "2026-10-16T00:00:00Z"));
        assertFalse(longRange.compare());
    }

    @Test
    @DisplayName("Unknown block names are ignored instead of computed")
    void unknownBlocksIgnored() {
        when(resolver.resolve(any(), eq(INSTITUTE))).thenReturn(new LeadVisibility(
                LeadVisibility.Mode.AUDIENCE_LIST, null, null, true, List.of(), List.of(), false));
        CrmDashboardRequestDTO req = request(null, null);
        req.setBlocks(List.of("summary", "drop table"));

        CrmDashboardResponseDTO res = service.getDashboard(req, user);

        assertEquals(List.of("summary"), List.copyOf(res.getBlocks().keySet()));
    }

    @Test
    @DisplayName("Shift weekday is today in the caller's zone, as MON..SUN")
    void shiftWeekdayFollowsCallerZone() {
        CrmDashboardRequestDTO req = new CrmDashboardRequestDTO();
        req.setTimezone("Asia/Kolkata");
        // Friday 20:00 UTC is already Saturday 01:30 in India.
        req.setNow("2026-10-16T20:00:00Z");
        req.setFrom("2026-10-01T00:00:00Z");
        req.setTo("2026-10-16T20:00:00Z");
        assertEquals("SAT", CrmDashboardService.todayDow(service.resolveWindow(req)));
    }

    @Test
    @DisplayName("Requests a few minutes apart share one cache bucket for now-relative blocks")
    void nowBucketGroupsFiveMinutes() {
        CrmDashboardRequestDTO a = new CrmDashboardRequestDTO();
        a.setNow("2026-10-17T10:01:00Z");
        CrmDashboardRequestDTO b = new CrmDashboardRequestDTO();
        b.setNow("2026-10-17T10:04:00Z");
        CrmDashboardRequestDTO c = new CrmDashboardRequestDTO();
        c.setNow("2026-10-17T10:06:00Z");
        long ba = CrmDashboardService.nowBucket(service.resolveWindow(a));
        assertEquals(ba, CrmDashboardService.nowBucket(service.resolveWindow(b)));
        assertFalse(ba == CrmDashboardService.nowBucket(service.resolveWindow(c)));
    }

    @Test
    @DisplayName("The cached lead scope is keyed by institute, user and authorities")
    void scopeKeySeparatesRoleChanges() {
        CustomUserDetails admin = mock(CustomUserDetails.class);
        when(admin.getUserId()).thenReturn("u-1");
        org.mockito.Mockito.doReturn(List.of(new org.springframework.security.core.authority.SimpleGrantedAuthority("ADMIN")))
                .when(admin).getAuthorities();
        CustomUserDetails counsellor = mock(CustomUserDetails.class);
        when(counsellor.getUserId()).thenReturn("u-1");
        org.mockito.Mockito.doReturn(List.of(new org.springframework.security.core.authority.SimpleGrantedAuthority("COUNSELLOR")))
                .when(counsellor).getAuthorities();
        assertFalse(CrmDashboardService.scopeKey(INSTITUTE, admin)
                .equals(CrmDashboardService.scopeKey(INSTITUTE, counsellor)));
        assertFalse(CrmDashboardService.scopeKey(INSTITUTE, admin)
                .equals(CrmDashboardService.scopeKey("other-institute", admin)));
        assertEquals(CrmDashboardService.scopeKey(INSTITUTE, admin), CrmDashboardService.scopeKey(INSTITUTE, admin));
    }

    @Test
    @DisplayName("Status filters are normalised so equal filters share a cache entry; none = no filter")
    void statusCsvNormalised() {
        assertEquals("", CrmDashboardService.statusCsv(null));
        assertEquals("", CrmDashboardService.statusCsv(" , "));
        assertEquals("CALL_BACK,LOST", CrmDashboardService.statusCsv(" LOST,CALL_BACK,LOST "));
    }

    @Test
    @DisplayName("Duplicate filter: none = no filter (old behaviour); AUTO follows the list's Duplicate Leads setting")
    void duplicateFilterResolvesLikeTheList() {
        when(dedupService.duplicatesTabOnly(INSTITUTE)).thenReturn(true);
        assertEquals("", service.duplicateFilter(null, INSTITUTE, null));
        assertEquals("", service.duplicateFilter("bogus", INSTITUTE, null));
        assertEquals("EXCLUDE", service.duplicateFilter("exclude", INSTITUTE, null));
        assertEquals("ONLY", service.duplicateFilter("ONLY", INSTITUTE, null));
        assertEquals("EXCLUDE", service.duplicateFilter("AUTO", INSTITUTE, null));
        // One list: the list query applies no default, so neither do we.
        assertEquals("", service.duplicateFilter("AUTO", INSTITUTE, "aud-1"));

        when(dedupService.duplicatesTabOnly(INSTITUTE)).thenReturn(false);
        assertEquals("", service.duplicateFilter("AUTO", INSTITUTE, null));
    }

    @Test
    @DisplayName("Every vis query carries the list's status and duplicate predicates")
    void visCarriesListFilters() {
        for (String sql : List.of(CrmDashboardSql.visAll(), CrmDashboardSql.visSubmittedIn())) {
            assertTrue(sql.contains(":statusExcludeCsv"));
            assertTrue(sql.contains("COALESCE(ar.is_duplicate, FALSE) = FALSE"));
            assertFalse(sql.contains("%s"));
        }
    }
}
