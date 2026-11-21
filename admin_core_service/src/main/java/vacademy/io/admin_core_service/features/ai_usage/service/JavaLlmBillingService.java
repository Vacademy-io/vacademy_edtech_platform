package vacademy.io.admin_core_service.features.ai_usage.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.ai_usage.entity.AiTokenUsage;
import vacademy.io.admin_core_service.features.ai_usage.enums.ApiProvider;
import vacademy.io.admin_core_service.features.ai_usage.enums.RequestType;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.credits.client.MeteringFields;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Charging for LLMService calls whose caller does not bill them itself - the admin agent and
 * the workflow drafter. Today those calls write an ai_token_usage row with no price and no
 * credit_transactions row; a Claude agent call is free to the institute. Callers that bill
 * their own way or are free by product decision set {@code LLMService.CTX_BILLED_BY_CALLER}
 * and never reach this class: the voice-agent prompt assistant (flat fee) and the three
 * engagement brain callers (auto-replies free, proactive sends carry a per-message fee).
 *
 * <p>Switched by the platform setting {@value #SETTING_KEY} ("true" | "false", absent =
 * false, read with a 60 s cache). While it is false nothing here runs and LLMService records
 * usage exactly as before. While it is true the usage row is written, priced from ai_models
 * (per-token USD, the same unit ai_service writes), and charged through ai_service's
 * token-metered /deduct - so credits come from the same cost + markup formula as every other
 * feature, whichever gateway served the call. The charge is idempotent on the usage row id,
 * so a retry can never charge twice. It is NOT allowed to take the balance below zero: these
 * callers have no pre-flight affordability gate, so a charge the balance cannot cover is
 * dropped and logged rather than driving an institute ever further negative.
 */
@Slf4j
@Service
public class JavaLlmBillingService {

    public static final String SETTING_KEY = "billing.java_agent_charge";
    /** credit_transactions.external_reference_id for one usage row's charge. */
    static final String IDEMPOTENCY_PREFIX = "java-llm-usage:";
    /** Metering use case when the caller names none (same default as LLMService). */
    static final String DEFAULT_USE_CASE = "admin_agent";

    private static final Duration SETTING_TTL = Duration.ofSeconds(60);
    private static final BigDecimal ONE_MILLION = BigDecimal.valueOf(1_000_000L);

    private final JdbcTemplate jdbcTemplate;
    private final AiTokenUsageService usageService;
    private final CreditClient creditClient;

    private volatile boolean enabled = false;
    private volatile long loadedAt = 0L;

    public JavaLlmBillingService(JdbcTemplate jdbcTemplate, AiTokenUsageService usageService,
                                 CreditClient creditClient) {
        this.jdbcTemplate = jdbcTemplate;
        this.usageService = usageService;
        this.creditClient = creditClient;
    }

    /** The switch. A failed read keeps the last value (false until a read succeeds). */
    public boolean isEnabled() {
        long now = System.currentTimeMillis();
        if (now - loadedAt < SETTING_TTL.toMillis()) {
            return enabled;
        }
        try {
            List<String> rows = jdbcTemplate.queryForList(
                    "SELECT setting_value::text FROM ai_platform_settings WHERE setting_key = ?",
                    String.class, SETTING_KEY);
            enabled = !rows.isEmpty() && parseFlag(rows.get(0));
        } catch (Exception e) {
            log.warn("[LLM-Billing] Could not read {}: {}", SETTING_KEY, e.getMessage());
        }
        loadedAt = now;
        return enabled;
    }

    /** jsonb text: "true" (enum string), true (bool) - anything else is off. */
    static boolean parseFlag(String raw) {
        if (raw == null) {
            return false;
        }
        String v = raw.trim();
        if (v.length() >= 2 && v.startsWith("\"") && v.endsWith("\"")) {
            v = v.substring(1, v.length() - 1).trim();
        }
        return "true".equalsIgnoreCase(v);
    }

    /** {@link #recordAndCharge} off the request thread; never throws. */
    @Async
    public void recordAndChargeAsync(RequestType requestType, String model, int promptTokens,
                                     int completionTokens, UUID instituteId, UUID userId) {
        recordAndChargeAsync(requestType, model, promptTokens, completionTokens, instituteId, userId, null);
    }

    /**
     * {@link #recordAndChargeAsync} naming the LLMService use case the call served
     * ({@code LLMService.CTX_USE_CASE}); it is reported to usage metering only and
     * changes nothing about the charge. Null = {@value #DEFAULT_USE_CASE}.
     */
    @Async
    public void recordAndChargeAsync(RequestType requestType, String model, int promptTokens,
                                     int completionTokens, UUID instituteId, UUID userId, String useCase) {
        try {
            recordAndCharge(requestType, model, promptTokens, completionTokens, instituteId, userId, useCase);
        } catch (Exception e) {
            log.error("[LLM-Billing] Failed to record/charge {} usage on {}: {}", requestType, model, e.getMessage());
        }
    }

    /**
     * Write the usage row, price it, and charge it. Pricing and charging are independent:
     * a model missing from ai_models still gets charged (ai_service has its own fallback
     * rate), and a failed charge leaves the priced row for reconciliation.
     *
     * @return the usage row, or null when it could not be written (then nothing is charged)
     */
    public AiTokenUsage recordAndCharge(RequestType requestType, String model, int promptTokens,
                                        int completionTokens, UUID instituteId, UUID userId) {
        return recordAndCharge(requestType, model, promptTokens, completionTokens, instituteId, userId, null);
    }

    /** {@link #recordAndCharge} with the use case reported to usage metering (null = admin_agent). */
    public AiTokenUsage recordAndCharge(RequestType requestType, String model, int promptTokens,
                                        int completionTokens, UUID instituteId, UUID userId, String useCase) {
        AiTokenUsage saved = usageService.recordUsage(ApiProvider.OPENAI, requestType, model,
                promptTokens, completionTokens, instituteId, userId);
        if (saved == null || saved.getId() == null) {
            return saved;
        }
        try {
            priceRow(saved.getId(), model, promptTokens, completionTokens);
        } catch (Exception e) {
            log.warn("[LLM-Billing] Could not price usage row {} ({}): {}", saved.getId(), model, e.getMessage());
        }
        if (instituteId == null) {
            log.info("[LLM-Billing] Usage row {} has no institute; nothing to charge", saved.getId());
            return saved;
        }
        String user = userId == null ? null : userId.toString();
        boolean ok = creditClient.deductAttributedTokenUsage(
                instituteId.toString(),
                requestType.getValue(),
                model,
                promptTokens,
                completionTokens,
                saved.getId().toString(),
                user,
                user != null ? "ADMIN" : "SYSTEM",
                null,
                requestType.getValue() + " using " + model,
                null,
                IDEMPOTENCY_PREFIX + saved.getId(),
                false,
                metering(useCase, user));
        if (!ok) {
            log.warn("[LLM-Billing] Charge not applied for usage row {} (institute {}): ai_service refused it "
                    + "(insufficient balance - charges never go negative here) or was unreachable",
                    saved.getId(), instituteId);
        }
        return saved;
    }

    /**
     * Usage-metering fields for one charge: the signed-in user on the admin app, or a
     * system call when there is none. The role is left for ai_service / the nightly
     * role backfill (the ledger's "ADMIN" is a billing label, not a looked-up role).
     */
    static MeteringFields metering(String useCase, String userId) {
        String uc = useCase != null && !useCase.isBlank() ? useCase : DEFAULT_USE_CASE;
        return userId != null
                ? MeteringFields.user(uc, MeteringFields.SURFACE_ADMIN_APP).build()
                : MeteringFields.system(uc).build();
    }

    /**
     * input/output/total price on the usage row, per token in USD - the unit ai_service writes
     * (ai_models holds per-1M prices). Only fills a row that has no price yet.
     */
    void priceRow(UUID usageId, String model, int promptTokens, int completionTokens) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT input_price_per_1m, output_price_per_1m FROM ai_models WHERE model_id = ?", model);
        if (rows.isEmpty()) {
            log.warn("[LLM-Billing] {} is not in ai_models; usage row {} stays unpriced", model, usageId);
            return;
        }
        BigDecimal input = perToken(rows.get(0).get("input_price_per_1m"));
        BigDecimal output = perToken(rows.get(0).get("output_price_per_1m"));
        BigDecimal total = input.multiply(BigDecimal.valueOf(promptTokens))
                .add(output.multiply(BigDecimal.valueOf(completionTokens)))
                .setScale(10, RoundingMode.HALF_UP);
        jdbcTemplate.update(
                "UPDATE ai_token_usage SET input_token_price = ?, output_token_price = ?, total_price = ? "
                        + "WHERE id = ? AND total_price IS NULL",
                input, output, total, usageId);
    }

    static BigDecimal perToken(Object per1m) {
        if (per1m == null) {
            return BigDecimal.ZERO.setScale(10);
        }
        BigDecimal v = per1m instanceof BigDecimal b ? b : new BigDecimal(per1m.toString());
        return v.divide(ONE_MILLION, 10, RoundingMode.HALF_UP);
    }
}
