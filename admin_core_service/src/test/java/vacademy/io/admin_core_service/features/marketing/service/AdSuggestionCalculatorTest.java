package vacademy.io.admin_core_service.features.marketing.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.marketing.dto.AdPerformanceDTO;
import vacademy.io.admin_core_service.features.marketing.service.AdSuggestionCalculator.PlatformStat;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

class AdSuggestionCalculatorTest {

    private static PlatformStat stat(String platform, String spend, long admissions) {
        return new PlatformStat(platform, new BigDecimal(spend), admissions);
    }

    @Test
    @DisplayName("Moves 15% of the worst platform's last-7-day spend (rounded down to 1,000) to the cheapest")
    void suggestsMoveFromDearestToCheapest() {
        AdPerformanceDTO.Suggestion s = AdSuggestionCalculator.suggest(
                List.of(stat("META", "146900", 61), stat("GOOGLE", "180000", 60), stat("YOUTUBE", "90000", 21)),
                Map.of("YOUTUBE", new BigDecimal("140000"), "META", new BigDecimal("30000")));

        assertNotNull(s);
        assertEquals("META", s.getBestPlatform());
        assertEquals(new BigDecimal("2408.20"), s.getBestCostPerAdmission());
        assertEquals("YOUTUBE", s.getWorstPlatform());
        assertEquals(new BigDecimal("4285.71"), s.getWorstCostPerAdmission());
        assertEquals(0, new BigDecimal("21000").compareTo(s.getSuggestedAmount()));
    }

    @Test
    @DisplayName("A platform with spend and no admissions is the worst before any costly one")
    void zeroAdmissionPlatformIsWorstFirst() {
        AdPerformanceDTO.Suggestion s = AdSuggestionCalculator.suggest(
                List.of(stat("META", "100000", 40), stat("GOOGLE", "200000", 20), stat("YOUTUBE", "30000", 0)),
                Map.of("YOUTUBE", new BigDecimal("10000")));

        assertNotNull(s);
        assertEquals("META", s.getBestPlatform());
        assertEquals("YOUTUBE", s.getWorstPlatform());
        assertNull(s.getWorstCostPerAdmission());
        assertEquals(0, new BigDecimal("1000").compareTo(s.getSuggestedAmount()));
    }

    @Test
    @DisplayName("No best platform with at least 3 admissions means no advice")
    void needsThreeAdmissionsForBest() {
        assertNull(AdSuggestionCalculator.suggest(
                List.of(stat("META", "50000", 2), stat("GOOGLE", "80000", 1)),
                Map.of("GOOGLE", new BigDecimal("80000"))));
    }

    @Test
    @DisplayName("Platforms under 5% of total spend are never the worst")
    void ignoresTinySpendersForWorst() {
        assertNull(AdSuggestionCalculator.suggest(
                List.of(stat("META", "100000", 50), stat("YOUTUBE", "4000", 0)),
                Map.of("YOUTUBE", new BigDecimal("4000"))));
    }

    @Test
    @DisplayName("Only one platform with spend gives no advice")
    void singlePlatformGivesNothing() {
        assertNull(AdSuggestionCalculator.suggest(
                List.of(stat("META", "100000", 50), stat("GOOGLE", "0", 0)),
                Map.of("META", new BigDecimal("50000"))));
    }

    @Test
    @DisplayName("Advice under 1,000 is dropped")
    void dropsAdviceUnderOneThousand() {
        assertNull(AdSuggestionCalculator.suggest(
                List.of(stat("META", "100000", 50), stat("GOOGLE", "60000", 5)),
                Map.of("GOOGLE", new BigDecimal("6000"))));
    }

    @Test
    @DisplayName("A worst platform that is cheaper per admission than the best gives no advice")
    void noAdviceWhenWorstIsCheaper() {
        assertNull(AdSuggestionCalculator.suggest(
                List.of(stat("META", "100000", 10), stat("GOOGLE", "18000", 2)),
                Map.of("GOOGLE", new BigDecimal("18000"))));
    }

    @Test
    @DisplayName("Suggested amount rounds 15% down to the thousand")
    void suggestedAmountRounding() {
        assertEquals(0, new BigDecimal("2000").compareTo(AdSuggestionCalculator.suggestedAmount(new BigDecimal("19999"))));
        assertEquals(0, new BigDecimal("15000").compareTo(AdSuggestionCalculator.suggestedAmount(new BigDecimal("100000"))));
        assertNull(AdSuggestionCalculator.suggestedAmount(new BigDecimal("6666")));
        assertNull(AdSuggestionCalculator.suggestedAmount(null));
    }
}
