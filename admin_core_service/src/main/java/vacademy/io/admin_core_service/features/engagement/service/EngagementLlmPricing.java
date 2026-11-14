package vacademy.io.admin_core_service.features.engagement.service;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * USD price of brain tokens, from the ai_models registry (per-1M input/output prices) — the same
 * math JavaLlmBillingService.priceRow uses for ai_token_usage. Prices are cached briefly: the
 * sweep prices every decision and the registry changes rarely.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class EngagementLlmPricing {

    private static final BigDecimal ONE_MILLION = BigDecimal.valueOf(1_000_000);

    private final JdbcTemplate jdbcTemplate;

    /** model id → [input, output] USD per token; empty when the model has no ai_models row. */
    private final Cache<String, Optional<BigDecimal[]>> prices = Caffeine.newBuilder()
            .expireAfterWrite(Duration.ofMinutes(10))
            .maximumSize(200)
            .build();

    /** Cost of one call in USD, or null when the model is unknown or unpriced. Never throws. */
    public BigDecimal costUsd(String model, int tokensIn, int tokensOut) {
        if (model == null || model.isBlank()) {
            return null;
        }
        try {
            BigDecimal[] perToken = prices.get(model, this::load).orElse(null);
            if (perToken == null) {
                return null;
            }
            return perToken[0].multiply(BigDecimal.valueOf(tokensIn))
                    .add(perToken[1].multiply(BigDecimal.valueOf(tokensOut)))
                    .setScale(8, RoundingMode.HALF_UP);
        } catch (Exception e) {
            log.warn("[Engagement] could not price {} tokens: {}", model, e.getMessage());
            return null;
        }
    }

    private Optional<BigDecimal[]> load(String model) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT input_price_per_1m, output_price_per_1m FROM ai_models WHERE model_id = ?", model);
        if (rows.isEmpty()) {
            log.debug("[Engagement] {} is not in ai_models; brain cost stays unpriced", model);
            return Optional.empty();
        }
        return Optional.of(new BigDecimal[]{
                perToken(rows.get(0).get("input_price_per_1m")),
                perToken(rows.get(0).get("output_price_per_1m"))});
    }

    private static BigDecimal perToken(Object per1m) {
        if (per1m == null) {
            return BigDecimal.ZERO;
        }
        BigDecimal v = per1m instanceof BigDecimal b ? b : new BigDecimal(per1m.toString());
        return v.divide(ONE_MILLION, 12, RoundingMode.HALF_UP);
    }
}
