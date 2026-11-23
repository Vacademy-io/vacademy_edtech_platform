package vacademy.io.admin_core_service.features.marketing.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.marketing.service.AdSpendRowMapper.SpendRow;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AdSpendRowMapperTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static List<JsonNode> rows(String jsonArray) throws Exception {
        List<JsonNode> out = new ArrayList<>();
        MAPPER.readTree(jsonArray).forEach(out::add);
        return out;
    }

    // ── Meta insights ────────────────────────────────────────────────────────

    @Test
    @DisplayName("Meta insights row maps to one campaign-day; lead actions take the max, not the sum")
    void mapsMetaInsightsRow() throws Exception {
        List<SpendRow> mapped = AdSpendRowMapper.fromMetaInsights(rows("""
                [{"campaign_id":"120210000001","campaign_name":"Admissions 2026","spend":"1234.567",
                  "impressions":"10500","clicks":"321","account_currency":"INR",
                  "actions":[{"action_type":"link_click","value":"321"},
                             {"action_type":"lead","value":"12"},
                             {"action_type":"onsite_conversion.lead_grouped","value":"12"},
                             {"action_type":"leadgen_grouped","value":"11"}],
                  "date_start":"2026-10-05","date_stop":"2026-10-05"}]
                """), "USD");

        assertEquals(1, mapped.size());
        SpendRow row = mapped.get(0);
        assertEquals("120210000001", row.campaignId());
        assertEquals("Admissions 2026", row.campaignName());
        assertEquals("META", row.channel());
        assertEquals(LocalDate.of(2026, 10, 5), row.day());
        assertEquals(new BigDecimal("1234.57"), row.spend());
        assertEquals("INR", row.currency());
        assertEquals(10500L, row.impressions());
        assertEquals(321L, row.clicks());
        assertEquals(new BigDecimal("12.00"), row.platformLeads());
    }

    @Test
    @DisplayName("Meta rows without account_currency fall back to the account currency; no actions = 0 leads")
    void metaFallbacks() throws Exception {
        List<SpendRow> mapped = AdSpendRowMapper.fromMetaInsights(rows("""
                [{"campaign_id":"1","spend":"10","impressions":"5","clicks":"0","date_start":"2026-10-01"}]
                """), "INR");

        assertEquals(1, mapped.size());
        assertEquals("INR", mapped.get(0).currency());
        assertEquals(0, BigDecimal.ZERO.compareTo(mapped.get(0).platformLeads()));
        assertEquals(null, mapped.get(0).campaignName());
    }

    @Test
    @DisplayName("Meta rows with no campaign, no day or nothing but zeros are skipped; repeats are summed")
    void metaSkipsAndMerges() throws Exception {
        List<SpendRow> mapped = AdSpendRowMapper.fromMetaInsights(rows("""
                [{"spend":"10","date_start":"2026-10-01"},
                 {"campaign_id":"2","spend":"10"},
                 {"campaign_id":"3","spend":"0","impressions":"0","clicks":"0","date_start":"2026-10-01"},
                 {"campaign_id":"4","spend":"1.10","impressions":"1","clicks":"1","date_start":"2026-10-02"},
                 {"campaign_id":"4","spend":"2.20","impressions":"2","clicks":"0","date_start":"2026-10-02"}]
                """), "INR");

        assertEquals(1, mapped.size());
        assertEquals("4", mapped.get(0).campaignId());
        assertEquals(new BigDecimal("3.30"), mapped.get(0).spend());
        assertEquals(3L, mapped.get(0).impressions());
        assertEquals(1L, mapped.get(0).clicks());
    }

    @Test
    @DisplayName("metaLeads ignores non-lead actions and bad values")
    void metaLeads() throws Exception {
        assertEquals(0, new BigDecimal("7").compareTo(AdSpendRowMapper.metaLeads(MAPPER.readTree("""
                [{"action_type":"lead","value":"7"},{"action_type":"purchase","value":"99"},
                 {"action_type":"leadgen_grouped","value":"oops"}]
                """))));
        assertEquals(0, BigDecimal.ZERO.compareTo(AdSpendRowMapper.metaLeads(MAPPER.readTree("null"))));
    }

    // ── Google Ads search rows ───────────────────────────────────────────────

    @Test
    @DisplayName("Google row: cost_micros to 2dp HALF_UP, channel from advertising_channel_type, leads = conversions")
    void mapsGoogleSearchRow() throws Exception {
        List<SpendRow> mapped = AdSpendRowMapper.fromGoogleSearch(rows("""
                [{"campaign":{"resourceName":"customers/123/campaigns/987","id":"987","name":"Search - Brand",
                              "advertisingChannelType":"SEARCH"},
                  "metrics":{"costMicros":"1234565000","impressions":"4000","clicks":"250","conversions":12.5},
                  "segments":{"date":"2026-10-07"}},
                 {"campaign":{"id":"555","name":"YT In-stream","advertisingChannelType":"VIDEO"},
                  "metrics":{"costMicros":"5000","impressions":"10"},
                  "segments":{"date":"2026-10-07"}}]
                """), "INR");

        assertEquals(2, mapped.size());
        SpendRow search = mapped.get(0);
        assertEquals("987", search.campaignId());
        assertEquals("Search - Brand", search.campaignName());
        assertEquals("SEARCH", search.channel());
        assertEquals(LocalDate.of(2026, 10, 7), search.day());
        assertEquals(new BigDecimal("1234.57"), search.spend());
        assertEquals("INR", search.currency());
        assertEquals(4000L, search.impressions());
        assertEquals(250L, search.clicks());
        assertEquals(new BigDecimal("12.50"), search.platformLeads());

        SpendRow video = mapped.get(1);
        assertEquals("VIDEO", video.channel());
        assertEquals(new BigDecimal("0.01"), video.spend());
        assertEquals(0L, video.clicks());
        assertEquals(0, BigDecimal.ZERO.compareTo(video.platformLeads()));
    }

    @Test
    @DisplayName("Google rows without a campaign id or date, or with only zeros, are skipped")
    void googleSkips() throws Exception {
        List<SpendRow> mapped = AdSpendRowMapper.fromGoogleSearch(rows("""
                [{"campaign":{"name":"no id"},"metrics":{"costMicros":"1000000"},"segments":{"date":"2026-10-07"}},
                 {"campaign":{"id":"1"},"metrics":{"costMicros":"1000000"}},
                 {"campaign":{"id":"2"},"metrics":{"costMicros":"0","impressions":"0","clicks":"0"},
                  "segments":{"date":"2026-10-07"}}]
                """), "INR");

        assertTrue(mapped.isEmpty());
    }

    @Test
    @DisplayName("The GAQL spend query names every metric and an inclusive date range")
    void googleQuery() {
        String q = AdSpendRowMapper.googleSpendQuery(LocalDate.of(2026, 5, 1), LocalDate.of(2026, 10, 31));
        assertTrue(q.contains("metrics.cost_micros"));
        assertTrue(q.contains("campaign.advertising_channel_type"));
        assertTrue(q.endsWith("segments.date BETWEEN '2026-05-01' AND '2026-10-31'"));
    }

    // ── Meta request windows ─────────────────────────────────────────────────

    @Test
    @DisplayName("Windows up to 90 days are one request; longer ones split into 30-day chunks")
    void metaRequestWindows() {
        LocalDate to = LocalDate.of(2026, 11, 9);
        List<LocalDate[]> single = AdSpendRowMapper.metaRequestWindows(to.minusDays(89), to, 90, 30);
        assertEquals(1, single.size());

        List<LocalDate[]> chunks = AdSpendRowMapper.metaRequestWindows(to.minusDays(180), to, 90, 30);
        assertEquals(7, chunks.size());
        assertEquals(to.minusDays(180), chunks.get(0)[0]);
        assertEquals(to.minusDays(151), chunks.get(0)[1]);
        assertEquals(to.minusDays(150), chunks.get(1)[0]);
        assertEquals(to, chunks.get(6)[0]);
        assertEquals(to, chunks.get(6)[1]);
        assertTrue(AdSpendRowMapper.metaRequestWindows(to, to.minusDays(1), 90, 30).isEmpty());
    }
}
