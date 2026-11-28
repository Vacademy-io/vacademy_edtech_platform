package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.agent.service.LLMService;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The brain's token usage reaches the action it produced (V631), summed across the strict-JSON
 * retry and priced from ai_models, so the engagement daily report can show what thinking cost.
 */
class EngagementBrainTokenUsageTest {

    private static final String MODEL = "z-ai/glm-5.3-flash";

    private static EngagementEngine engine() {
        EngagementEngine e = new EngagementEngine();
        e.setInstituteId("6f0c1d1e-0000-4000-8000-000000000001");
        return e;
    }

    private static LLMService.LLMResponse response(String content, int in, int out) {
        return LLMService.LLMResponse.builder()
                .content(content).modelUsed(MODEL).promptTokens(in).completionTokens(out).build();
    }

    /** $1 per 1M input tokens, $2 per 1M output tokens. */
    private static EngagementLlmPricing pricing() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), eq(MODEL))).thenReturn(List.<Map<String, Object>>of(
                Map.of("input_price_per_1m", new BigDecimal("1.000000"),
                        "output_price_per_1m", new BigDecimal("2.000000"))));
        when(jdbc.queryForList(anyString(), eq("unknown/model"))).thenReturn(List.of());
        return new EngagementLlmPricing(jdbc);
    }

    @Nested
    class ProactiveBrain {

        @Test
        void sumsBothAttemptsAndPricesThem() {
            LLMService llm = mock(LLMService.class);
            when(llm.generateChatCompletion(any())).thenReturn(
                    response("not json", 1000, 100),
                    response("{\"decision\":\"NO_OP\",\"rationale\":\"wait\"}", 2000, 200));
            EngagementBrainClient brain = new EngagementBrainClient(llm);
            ReflectionTestUtils.setField(brain, "pricing", pricing());

            EngagementBrainClient.Decision d = brain.decide(engine(), "brief", Map.of(), Instant.now(),
                    Set.of("EMAIL"), List.of());

            assertEquals(3000, d.tokensIn());
            assertEquals(300, d.tokensOut());
            assertEquals(MODEL, d.usage().model());
            // 3000 × $1/1M + 300 × $2/1M = $0.0036
            assertEquals(0, new BigDecimal("0.0036").compareTo(d.usage().costUsd()));
        }

        @Test
        void tokensWithoutPricingStillRecorded() {
            LLMService llm = mock(LLMService.class);
            when(llm.generateChatCompletion(any())).thenReturn(
                    response("{\"decision\":\"NO_OP\",\"rationale\":\"wait\"}", 500, 50));

            EngagementBrainClient.Decision d = new EngagementBrainClient(llm).decide(engine(), "brief",
                    Map.of(), Instant.now(), Set.of("EMAIL"), List.of());

            assertEquals(500, d.tokensIn());
            assertEquals(50, d.tokensOut());
            assertNull(d.usage().costUsd());
        }
    }

    @Nested
    class ReplyBrain {

        @Test
        void replyDecisionCarriesUsage() {
            LLMService llm = mock(LLMService.class);
            when(llm.generateChatCompletion(any())).thenReturn(
                    response("{\"action\":\"ANSWER\",\"reply\":\"Sure, here it is\",\"reason\":\"faq\"}", 800, 80));
            EngagementReplyBrain brain = new EngagementReplyBrain(llm);
            ReflectionTestUtils.setField(brain, "pricing", pricing());

            EngagementReplyBrain.ReplyDecision d = brain.decide(engine(), "brief", "fees?");

            assertEquals(800, d.usage().tokensIn());
            assertEquals(80, d.usage().tokensOut());
            assertEquals(0, new BigDecimal("0.00096").compareTo(d.usage().costUsd()));
        }
    }

    @Nested
    class Stamping {

        @Test
        void appliesUsageToAction() {
            EngagementAction a = new EngagementAction();
            EngagementLlmUsage.applyTo(new EngagementLlmUsage(10, 5, MODEL, new BigDecimal("0.01")), a);

            assertEquals(10, a.getLlmTokensIn());
            assertEquals(5, a.getLlmTokensOut());
            assertEquals(MODEL, a.getLlmModel());
            assertEquals(new BigDecimal("0.01"), a.getLlmCostUsd());
        }

        @Test
        void emptyOrMissingUsageLeavesActionUntouched() {
            EngagementAction a = new EngagementAction();
            EngagementLlmUsage.applyTo(null, a);
            EngagementLlmUsage.applyTo(EngagementLlmUsage.NONE, a);

            assertNull(a.getLlmTokensIn());
            assertNull(a.getLlmModel());
        }

        @Test
        void unknownModelIsUnpricedNotZero() {
            assertNull(pricing().costUsd("unknown/model", 100, 10));
            assertNull(pricing().costUsd(null, 100, 10));
        }
    }
}
