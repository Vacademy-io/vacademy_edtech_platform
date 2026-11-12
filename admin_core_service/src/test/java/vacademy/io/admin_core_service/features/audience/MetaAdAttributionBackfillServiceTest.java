package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import vacademy.io.admin_core_service.features.audience.dto.NormalizedLeadData;
import vacademy.io.admin_core_service.features.audience.entity.FormWebhookConnector;
import vacademy.io.admin_core_service.features.audience.repository.FormWebhookConnectorRepository;
import vacademy.io.admin_core_service.features.audience.service.MetaAdAttributionBackfillService;
import vacademy.io.admin_core_service.features.audience.strategy.MetaLeadAdsStrategy;

import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * One-time fill of ad columns on older Meta leads: match by phone (email without one) in the
 * time window, closest first, each of our leads once; dry run writes nothing.
 */
class MetaAdAttributionBackfillServiceTest {

    private static final String INST = "inst-1";
    private static final long T = OffsetDateTime.parse("2026-11-09T15:36:36Z").toEpochSecond();

    private JdbcTemplate jdbc;
    private FormWebhookConnectorRepository connectors;
    private MetaLeadAdsStrategy meta;
    private MetaAdAttributionBackfillService service;

    @BeforeEach
    void setUp() {
        jdbc = mock(JdbcTemplate.class);
        connectors = mock(FormWebhookConnectorRepository.class);
        meta = mock(MetaLeadAdsStrategy.class);
        service = new MetaAdAttributionBackfillService(jdbc, connectors, meta);
    }

    // ── helpers ──────────────────────────────────────────────────────────

    private static Object ours(String id, String phone10, String email, long createdAt) throws Exception {
        Class<?> c = Class.forName(MetaAdAttributionBackfillService.class.getName() + "$OurLead");
        Constructor<?> k = c.getDeclaredConstructor(String.class, String.class, String.class, long.class);
        k.setAccessible(true);
        return k.newInstance(id, phone10, email, createdAt);
    }

    @SuppressWarnings("unchecked")
    private static String match(NormalizedLeadData lead, List<Object> ours, Set<String> used) throws Exception {
        Method m = MetaAdAttributionBackfillService.class.getDeclaredMethod("match",
                NormalizedLeadData.class, List.class, Set.class);
        m.setAccessible(true);
        Object r = m.invoke(null, lead, ours, used);
        if (r == null) return null;
        Method id = r.getClass().getDeclaredMethod("id");
        id.setAccessible(true);
        return (String) id.invoke(r);
    }

    private static NormalizedLeadData metaLead(String phone, String email, String created) {
        return NormalizedLeadData.builder()
                .phone(phone).email(email).platformCreatedTime(created)
                .adCampaignId("c1").adCampaignName("Camp").adSetId("s1").adSetName("Set")
                .adId("a1").adName("Ad").adFormId("f1")
                .build();
    }

    // ── matching ─────────────────────────────────────────────────────────

    @Test
    void matchesSamePhoneClosestInWindow() throws Exception {
        List<Object> ours = List.of(
                ours("far", "9876543210", null, T + 3600),
                ours("near", "9876543210", null, T + 30),
                ours("other", "9000000000", null, T));
        assertEquals("near", match(metaLead("919876543210", null, "2026-11-09T15:36:36+0000"), ours, new HashSet<>()));
    }

    @Test
    void skipsUsedLeadsAndOutsideWindow() throws Exception {
        List<Object> ours = List.of(
                ours("used", "9876543210", null, T + 10),
                ours("tooEarly", "9876543210", null, T - 3600),
                ours("tooLate", "9876543210", null, T + 4 * 86400));
        Set<String> used = new HashSet<>(Set.of("used"));
        assertNull(match(metaLead("919876543210", null, "2026-11-09T15:36:36+0000"), ours, used));
    }

    @Test
    void emailOnlyWhenMetaLeadHasNoPhone() throws Exception {
        List<Object> ours = List.of(ours("byMail", null, "asha@example.com", T + 60));
        assertEquals("byMail", match(metaLead(null, "Asha@Example.com ", "2026-11-09T15:36:36+0000"), ours, new HashSet<>()));
        // With a phone, a different phone never matches on email.
        assertNull(match(metaLead("919111111111", "asha@example.com", "2026-11-09T15:36:36+0000"), ours, new HashSet<>()));
    }

    @Test
    void noTimeNoMatch() throws Exception {
        List<Object> ours = List.of(ours("x", "9876543210", null, T));
        assertNull(match(metaLead("919876543210", null, null), ours, new HashSet<>()));
        assertNull(match(metaLead("919876543210", null, "not a time"), ours, new HashSet<>()));
    }

    // ── the run ──────────────────────────────────────────────────────────

    @SuppressWarnings("unchecked")
    private void givenOneConnectorAndLeads(List<Object> ours, List<NormalizedLeadData> fetched) {
        when(jdbc.query(anyString(), any(RowMapper.class), eq(INST), any())).thenReturn((List) new ArrayList<>(ours));
        when(jdbc.queryForList(anyString(), eq(String.class), eq(INST), eq("META_LEAD_ADS"))).thenReturn(List.of("conn-1"));
        FormWebhookConnector c = new FormWebhookConnector();
        c.setId("conn-1");
        c.setPlatformFormName("Form A");
        when(connectors.findAllById(List.of("conn-1"))).thenReturn(List.of(c));
        when(meta.fetchLeadsSince(eq(c), anyLong(), anyInt()))
                .thenReturn(new MetaLeadAdsStrategy.LeadPullResult(fetched, false));
    }

    @Test
    void dryRunCountsAndWritesNothing() throws Exception {
        givenOneConnectorAndLeads(List.of(ours("r1", "9876543210", null, T + 5)),
                List.of(metaLead("919876543210", null, "2026-11-09T15:36:36+0000")));

        MetaAdAttributionBackfillService.Result r = service.backfill(INST, null, true);

        assertEquals(1, r.fetched());
        assertEquals(1, r.matched());
        assertEquals(0, r.updated());
        assertEquals(0, r.unmatched());
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test
    void realRunWritesOnlyMatchedRows() throws Exception {
        givenOneConnectorAndLeads(List.of(ours("r1", "9876543210", null, T + 5), ours("r2", "9111111111", null, T)),
                List.of(metaLead("919876543210", null, "2026-11-09T15:36:36+0000"),
                        NormalizedLeadData.builder().phone("919222222222").platformCreatedTime("2026-11-09T15:36:36+0000").build()));
        when(jdbc.update(anyString(), any(Object[].class))).thenReturn(1);

        MetaAdAttributionBackfillService.Result r = service.backfill(INST, 30, false);

        assertEquals(2, r.fetched());
        assertEquals(1, r.withAdIds());
        assertEquals(1, r.matched());
        assertEquals(1, r.updated());
        assertEquals(1, r.unmatched());
        assertEquals(30, r.days());
        verify(jdbc, times(1)).update(anyString(), eq("c1"), eq("Camp"), eq("s1"), eq("Set"),
                eq("a1"), eq("Ad"), eq("f1"), eq("r1"));
    }

    @Test
    void aFailingFormIsReportedAndTheRestContinue() throws Exception {
        givenOneConnectorAndLeads(List.of(), List.of());
        when(meta.fetchLeadsSince(any(), anyLong(), anyInt())).thenThrow(new RuntimeException("token revoked"));

        MetaAdAttributionBackfillService.Result r = service.backfill(INST, 200, true);

        assertEquals(90, r.days());
        assertEquals(1, r.connectors().size());
        assertEquals("token revoked", r.connectors().get(0).error());
    }
}
