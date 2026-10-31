package vacademy.io.admin_core_service.features.super_admin.service;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class LlmCostFromTokensTest {

    private static final Map<String, Double> CARD = Map.of(
            "llm", 0.59, "llm_in_per_mtok", 28.68, "llm_cached_per_mtok", 2.868, "llm_out_per_mtok", 239.0);

    @Test
    void priceTheCallsOwnTokens() {
        // Call 0504b1c7 (2026-09-30): 81,976 prompt tokens, 28,507 cached, 408 out.
        assertEquals(1.71, SuperAdminCallService.llmFromTokens(CARD, new long[]{81976, 28507, 408}), 0.01);
        // Call f6764346: 115,083 / 48,646 / 477.
        assertEquals(2.16, SuperAdminCallService.llmFromTokens(CARD, new long[]{115083, 48646, 477}), 0.01);
    }

    @Test
    void noUsageOrNoRatesFallsBackToTheMinuteRate() {
        assertNull(SuperAdminCallService.llmFromTokens(CARD, null));
        assertNull(SuperAdminCallService.llmFromTokens(Map.of("llm", 0.59), new long[]{1000, 0, 10}));
    }

    private static final Map<String, Double> CARD_WITH_GEMMA = Map.of(
            "llm", 0.59, "llm_in_per_mtok", 28.68, "llm_cached_per_mtok", 2.868, "llm_out_per_mtok", 239.0,
            "llm_in_per_mtok@sarvam/gemma4", 35.0, "llm_cached_per_mtok@sarvam/gemma4", 10.0,
            "llm_out_per_mtok@sarvam/gemma4", 90.0);

    @Test
    void aCallIsPricedAtTheRatesOfTheModelItTalkedOn() {
        // 2026-10-26 15:10 UTC, on gemma4: 35,574 prompt tokens, 35,232 cached, 158 out.
        // The Gemini card read Rs 0.15; Sarvam bills Rs 0.38.
        long[] usage = {35574, 35232, 158};
        assertEquals(0.379, SuperAdminCallService.llmFromTokens(CARD_WITH_GEMMA, usage, "sarvam/gemma4"), 0.001);
        assertEquals(0.379, SuperAdminCallService.llmFromTokens(CARD_WITH_GEMMA, usage, " Sarvam/Gemma4 "), 0.001);
        assertEquals(0.149, SuperAdminCallService.llmFromTokens(CARD_WITH_GEMMA, usage, "vertex/gemini-2.5-flash"), 0.001);
    }

    @Test
    void aModelWithoutItsOwnRatesAndOlderCallsKeepTheGeminiCard() {
        long[] usage = {81976, 28507, 408};
        assertEquals(1.71, SuperAdminCallService.llmFromTokens(CARD_WITH_GEMMA, usage, null), 0.01);
        assertEquals(1.71, SuperAdminCallService.llmFromTokens(CARD_WITH_GEMMA, usage, ""), 0.01);
        assertEquals(1.71, SuperAdminCallService.llmFromTokens(CARD_WITH_GEMMA, usage, "bedrock/moonshotai.kimi-k2.5"), 0.01);
        // Only two of a model's three rates: not half its own and half Gemini's.
        Map<String, Double> partial = new java.util.HashMap<>(CARD);
        partial.put("llm_in_per_mtok@sarvam/gemma4", 35.0);
        partial.put("llm_out_per_mtok@sarvam/gemma4", 90.0);
        assertEquals(1.71, SuperAdminCallService.llmFromTokens(partial, usage, "sarvam/gemma4"), 0.01);
    }

    @Test
    void cachedNeverExceedsPrompt() {
        double v = SuperAdminCallService.llmFromTokens(CARD, new long[]{1000, 5000, 0});
        assertEquals(1000 * 2.868 / 1_000_000d, v, 1e-9);
    }
}
