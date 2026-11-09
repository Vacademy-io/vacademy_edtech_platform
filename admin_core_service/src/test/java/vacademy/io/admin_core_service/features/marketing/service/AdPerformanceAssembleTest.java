package vacademy.io.admin_core_service.features.marketing.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.marketing.dto.AdPerformanceDTO;
import vacademy.io.admin_core_service.features.marketing.entity.AdAccount;
import vacademy.io.admin_core_service.features.marketing.service.AdPerformanceReportService.AttributionFact;
import vacademy.io.admin_core_service.features.marketing.service.AdPerformanceReportService.SpendFact;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AdPerformanceAssembleTest {

    private static final LocalDate FROM = LocalDate.of(2026, 10, 1);
    private static final LocalDate TO = LocalDate.of(2026, 10, 3);

    private static SpendFact spend(String account, String platform, String channel, String campaign, LocalDate day,
                                   String amount) {
        return new SpendFact(account, AdPerformanceReportService.reportPlatform(platform, channel), channel, campaign,
                "Campaign " + campaign, day, "INR", new BigDecimal(amount), 10, 100, BigDecimal.ONE);
    }

    @Test
    @DisplayName("Folds spend and attribution into platform, daily and campaign rows")
    void assembles() {
        AdPerformanceDTO dto = AdPerformanceReportService.assemble(FROM, TO,
                List.of(spend("a1", "META", "META", "m1", FROM, "1000.00"),
                        spend("a1", "META", "META", "m1", TO, "500.00"),
                        spend("g1", "GOOGLE", "SEARCH", "s1", FROM, "300.00"),
                        spend("g1", "GOOGLE", "VIDEO", "v1", FROM, "200.00")),
                List.of(new AttributionFact("E", "META", FROM, "m1", 4),
                        new AttributionFact("E", "META", TO, null, 1),
                        new AttributionFact("A", "META", TO, "m1", 1),
                        new AttributionFact("E", "GOOGLE", FROM, "s1", 3),
                        new AttributionFact("E", null, FROM, null, 7),
                        new AttributionFact("A", null, TO, null, 2)));

        assertEquals("INR", dto.getCurrency());
        assertFalse(dto.isMixedCurrency());
        assertEquals(new BigDecimal("2000.00"), dto.getTotals().getSpend());
        assertEquals(8, dto.getTotals().getEnquiries());
        assertEquals(1, dto.getTotals().getAdmissions());
        assertEquals(new BigDecimal("250.00"), dto.getTotals().getCostPerEnquiry());
        assertEquals(7, dto.getUnattributed().getEnquiries());
        assertEquals(2, dto.getUnattributed().getAdmissions());

        assertEquals(List.of("META", "GOOGLE", "YOUTUBE"),
                dto.getPlatforms().stream().map(AdPerformanceDTO.PlatformRow::getPlatform).toList());
        AdPerformanceDTO.PlatformRow meta = dto.getPlatforms().get(0);
        assertEquals(new BigDecimal("1500.00"), meta.getSpend());
        assertEquals(5, meta.getEnquiries());
        assertEquals(new BigDecimal("300.00"), meta.getCostPerEnquiry());
        assertEquals(new BigDecimal("1500.00"), meta.getCostPerAdmission());
        assertEquals(1, meta.getAccounts());
        AdPerformanceDTO.PlatformRow youtube = dto.getPlatforms().get(2);
        assertEquals(new BigDecimal("200.00"), youtube.getSpend());
        assertNull(youtube.getCostPerEnquiry());

        // 3 days x 3 shown platforms, zero-filled.
        assertEquals(9, dto.getDaily().size());
        AdPerformanceDTO.DailyRow metaDay3 = dto.getDaily().stream()
                .filter(d -> d.getDay().equals(TO) && d.getPlatform().equals("META")).findFirst().orElseThrow();
        assertEquals(new BigDecimal("500.00"), metaDay3.getSpend());
        assertEquals(1, metaDay3.getEnquiries());
        assertEquals(1, metaDay3.getAdmissions());

        // Meta: the campaign first, then the "not matched" row.
        List<AdPerformanceDTO.CampaignRow> metaCampaigns = dto.getCampaigns().stream()
                .filter(c -> c.getPlatform().equals("META")).toList();
        assertEquals(2, metaCampaigns.size());
        assertEquals("m1", metaCampaigns.get(0).getCampaignId());
        assertEquals(4, metaCampaigns.get(0).getEnquiries());
        assertNull(metaCampaigns.get(1).getCampaignId());
        assertEquals(1, metaCampaigns.get(1).getEnquiries());
        assertTrue(dto.getCampaigns().stream().anyMatch(c -> "v1".equals(c.getCampaignId())
                && "YOUTUBE".equals(c.getPlatform()) && "VIDEO".equals(c.getChannel())));
    }

    @Test
    @DisplayName("Platforms with nothing to show are left out; no spend means no costs")
    void hidesEmptyPlatforms() {
        AdPerformanceDTO dto = AdPerformanceReportService.assemble(FROM, TO, List.of(),
                List.of(new AttributionFact("E", "META", FROM, null, 2)));

        assertEquals(1, dto.getPlatforms().size());
        assertNull(dto.getPlatforms().get(0).getCostPerEnquiry());
        assertNull(dto.getTotals().getCostPerEnquiry());
        assertNull(dto.getCurrency());
        assertNull(dto.getSuggestion());
        assertEquals(3, dto.getDaily().size());
    }

    private static SpendFact spendIn(String currency, String platform, String amount) {
        return new SpendFact("acc-" + platform, platform, platform, "c-" + platform, "Campaign", TO, currency,
                new BigDecimal(amount), 10, 100, BigDecimal.ONE);
    }

    @Test
    @DisplayName("Budget advice is given for one currency, never across currencies")
    void noSuggestionAcrossCurrencies() {
        List<AttributionFact> admissions = List.of(new AttributionFact("A", "META", TO, "c-META", 30));

        AdPerformanceDTO sameCurrency = AdPerformanceReportService.assemble(FROM, TO,
                List.of(spendIn("INR", "META", "300000.00"), spendIn("INR", "GOOGLE", "20000.00")), admissions);
        assertNotNull(sameCurrency.getSuggestion());
        assertEquals("META", sameCurrency.getSuggestion().getBestPlatform());

        AdPerformanceDTO mixed = AdPerformanceReportService.assemble(FROM, TO,
                List.of(spendIn("INR", "META", "300000.00"), spendIn("USD", "GOOGLE", "20000.00")), admissions);
        assertTrue(mixed.isMixedCurrency());
        assertNull(mixed.getSuggestion());
    }

    @Test
    @DisplayName("Report cache version changes when a sync finishes or the account set changes")
    void dataVersionTracksSyncs() {
        AdAccount a = AdAccount.builder().id("a").status("ACTIVE").lastSyncedAt(Instant.ofEpochSecond(100)).build();
        AdAccount b = AdAccount.builder().id("b").status("ACTIVE").build();
        String version = AdPerformanceReportService.dataVersion(List.of(a, b));

        assertEquals(version, AdPerformanceReportService.dataVersion(List.of(b, a)));
        assertNotEquals(version, AdPerformanceReportService.dataVersion(List.of(a)));
        AdAccount synced = AdAccount.builder().id("a").status("ACTIVE").lastSyncedAt(Instant.ofEpochSecond(200)).build();
        assertNotEquals(version, AdPerformanceReportService.dataVersion(List.of(synced, b)));
        AdAccount errored = AdAccount.builder().id("b").status("ERROR").build();
        assertNotEquals(version, AdPerformanceReportService.dataVersion(List.of(a, errored)));
    }
}
