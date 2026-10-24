package vacademy.io.admin_core_service.features.credits.client;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.math.BigDecimal;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Client for communicating with the AI Service's credit management endpoints.
 * 
 * This client handles:
 * - Initializing credits for new institutes
 * - Checking credit balance (pre-flight)
 * - Deducting credits after AI operations
 */
@Slf4j
@Service
public class CreditClient {

    private final RestTemplate restTemplate;
    private final String aiServiceUrl;
    /**
     * Service-to-service shared secret for /credits/v1/internal/* endpoints
     * (credit pack purchase fulfillment). Empty string in dev disables the
     * Python-side check via 503 — set INTERNAL_SERVICE_TOKEN in prod.
     */
    private final String internalServiceToken;

    /**
     * Usage-limit gate calls only: connect 500 ms + read 1000 ms, so a slow or hung ai_service
     * costs a caller at most ~1.5 s before the gate gives up and lets the work run. The shared
     * RestTemplate has no timeouts at all, which is fine for charges but not for a pre-check.
     */
    private final RestTemplate limitsRestTemplate;
    /** The nightly counter rebuild scans weeks of events; it gets minutes, not seconds. */
    private final RestTemplate rebuildRestTemplate;

    /** Which institutes have limits on; null (plain unit tests) = always ask ai_service. */
    private volatile AiLimitsPolicyIndex limitsPolicyIndex;

    /** Which institutes have a LIVE AI plan; null (plain unit tests) = none, never ask. */
    private volatile AiPlanSubscriptionIndex planSubscriptionIndex;

    /** Last time an authorize failure was logged (the gate logs at most once a minute). */
    private final AtomicLong lastAuthorizeFailureLog = new AtomicLong(0L);

    static final String AUTHORIZE_PATH = "/ai-service/internal/metering/v1/authorize";
    static final String REBUILD_PATH = "/ai-service/internal/metering/v1/counters/rebuild";
    static final String CHECK_PATH = "/ai-service/credits/v1/check";
    static final String PLANS_ROLL_PATH = "/ai-service/internal/plans/v1/roll";
    static final int LIMITS_CONNECT_TIMEOUT_MS = 500;
    static final int LIMITS_READ_TIMEOUT_MS = 1000;
    static final long AUTHORIZE_FAILURE_LOG_INTERVAL_MS = 60_000L;

    @Autowired
    public CreditClient(
            RestTemplate restTemplate,
            @Value("${ai.service.url:http://localhost:8077}") String aiServiceUrl,
            @Value("${ai.service.internal-token:}") String internalServiceToken) {
        this(restTemplate, aiServiceUrl, internalServiceToken,
                timeoutRestTemplate(LIMITS_CONNECT_TIMEOUT_MS, LIMITS_READ_TIMEOUT_MS),
                timeoutRestTemplate(5_000, 300_000));
    }

    /** Tests: explicit templates for the limit gate and the counter rebuild. */
    CreditClient(RestTemplate restTemplate, String aiServiceUrl, String internalServiceToken,
            RestTemplate limitsRestTemplate, RestTemplate rebuildRestTemplate) {
        this.restTemplate = restTemplate;
        this.aiServiceUrl = aiServiceUrl;
        this.internalServiceToken = internalServiceToken;
        this.limitsRestTemplate = limitsRestTemplate;
        this.rebuildRestTemplate = rebuildRestTemplate;
    }

    @Autowired(required = false)
    public void setLimitsPolicyIndex(AiLimitsPolicyIndex limitsPolicyIndex) {
        this.limitsPolicyIndex = limitsPolicyIndex;
    }

    @Autowired(required = false)
    public void setPlanSubscriptionIndex(AiPlanSubscriptionIndex planSubscriptionIndex) {
        this.planSubscriptionIndex = planSubscriptionIndex;
    }

    private static RestTemplate timeoutRestTemplate(int connectMs, int readMs) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(connectMs);
        factory.setReadTimeout(readMs);
        return new RestTemplate(factory);
    }

    /**
     * Initialize credits for a new institute (gives them 200 initial credits).
     * Called asynchronously when an institute is created.
     */
    @Async
    public CompletableFuture<Void> initializeCreditsAsync(String instituteId) {
        return CompletableFuture.runAsync(() -> {
            try {
                initializeCredits(instituteId);
            } catch (Exception e) {
                log.error("Failed to initialize credits for institute {}: {}", instituteId, e.getMessage());
            }
        });
    }

    /**
     * Initialize credits for a new institute (synchronous).
     */
    public void initializeCredits(String instituteId) {
        try {
            String url = aiServiceUrl + "/ai-service/credits/v1/institutes/" + instituteId + "/initialize";

            // ai_service only accepts this from a signed-in user or a service holding the token.
            HttpHeaders headers = buildInternalHeaders();

            HttpEntity<String> request = new HttpEntity<>("{}", headers);

            @SuppressWarnings("unchecked")
            ResponseEntity<Map<String, Object>> response = restTemplate.exchange(
                    url,
                    HttpMethod.POST,
                    request,
                    (Class<Map<String, Object>>) (Class<?>) Map.class);

            if (response.getStatusCode().is2xxSuccessful()) {
                log.info("Successfully initialized credits for institute {}", instituteId);
            } else {
                log.warn("Failed to initialize credits for institute {}: {}", instituteId, response.getStatusCode());
            }
        } catch (RestClientException e) {
            log.error("Error calling credit initialization API for institute {}: {}", instituteId, e.getMessage());
        }
    }

    /**
     * Check if institute has sufficient credits for an operation.
     * 
     * @param instituteId     The institute ID
     * @param requestType     Type of request (content, image, embedding, etc.)
     * @param model           The model being used (for pricing multiplier)
     * @param estimatedTokens Estimated token count
     * @return true if sufficient credits, false otherwise
     */
    public boolean checkCredits(String instituteId, String requestType, String model, int estimatedTokens) {
        return checkCredits(instituteId, requestType, model, estimatedTokens, null);
    }

    /**
     * {@link #checkCredits(String, String, String, int)} carrying optional usage-metering
     * fields ({@link MeteringFields}). A null {@code metering} sends exactly the body above.
     */
    public boolean checkCredits(String instituteId, String requestType, String model, int estimatedTokens,
            MeteringFields metering) {
        try {
            String url = aiServiceUrl + "/ai-service/credits/v1/check";

            HttpHeaders headers = buildInternalHeaders();

            Map<String, Object> body = Map.of(
                    "institute_id", instituteId,
                    "request_type", requestType,
                    "model", model != null ? model : "",
                    "estimated_tokens", estimatedTokens);
            body = withMetering(body, metering);

            HttpEntity<Map<String, Object>> request = new HttpEntity<>(body, headers);

            @SuppressWarnings("unchecked")
            ResponseEntity<Map<String, Object>> response = restTemplate.exchange(
                    url,
                    HttpMethod.POST,
                    request,
                    (Class<Map<String, Object>>) (Class<?>) Map.class);

            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                Boolean hasSufficientCredits = (Boolean) response.getBody().get("has_sufficient_credits");
                return hasSufficientCredits != null && hasSufficientCredits;
            }

            // If check fails, allow the request (fail open)
            log.warn("Credit check failed for institute {}, allowing request", instituteId);
            return true;

        } catch (HttpClientErrorException e) {
            if (isUsageLimitRefusal(e)) {
                // An AI usage limit (HTTP 429 AI_USAGE_LIMIT) is an intended refusal, not a
                // failure: the caller's own authorize() gate makes the decision, as before.
                log.debug("Credit check for institute {} answered by a usage limit (429)", instituteId);
                return true;
            }
            log.error("Error checking credits for institute {}: {}", instituteId, e.getMessage());
            return true;
        } catch (Exception e) {
            log.error("Error checking credits for institute {}: {}", instituteId, e.getMessage());
            // Fail open - allow the request if we can't check
            return true;
        }
    }

    /** HTTP 429 whose JSON body says {@code "error": "AI_USAGE_LIMIT"}. */
    static boolean isUsageLimitRefusal(HttpClientErrorException e) {
        if (e == null || e.getStatusCode().value() != 429) {
            return false;
        }
        String body = e.getResponseBodyAsString();
        return body != null && body.replace(" ", "").contains("\"error\":\"AI_USAGE_LIMIT\"");
    }

    /**
     * Deduct credits after an AI operation (async).
     * 
     * @param instituteId      The institute ID
     * @param requestType      Type of request (content, image, embedding, etc.)
     * @param model            The model used
     * @param promptTokens     Number of prompt tokens
     * @param completionTokens Number of completion tokens
     * @param usageLogId       Optional link to ai_token_usage record
     */
    @Async
    public CompletableFuture<Void> deductCreditsAsync(
            String instituteId,
            String requestType,
            String model,
            int promptTokens,
            int completionTokens,
            String usageLogId) {
        return deductCreditsAsync(instituteId, requestType, model, promptTokens, completionTokens, usageLogId, null);
    }

    /** {@link #deductCreditsAsync} carrying optional usage-metering fields (null = the body above). */
    @Async
    public CompletableFuture<Void> deductCreditsAsync(
            String instituteId,
            String requestType,
            String model,
            int promptTokens,
            int completionTokens,
            String usageLogId,
            MeteringFields metering) {
        return CompletableFuture.runAsync(() -> {
            try {
                deductCredits(instituteId, requestType, model, promptTokens, completionTokens, usageLogId, metering);
            } catch (Exception e) {
                log.error("Failed to deduct credits for institute {}: {}", instituteId, e.getMessage());
            }
        });
    }

    /**
     * Deduct credits after an AI operation (synchronous).
     */
    public void deductCredits(
            String instituteId,
            String requestType,
            String model,
            int promptTokens,
            int completionTokens,
            String usageLogId) {
        deductCredits(instituteId, requestType, model, promptTokens, completionTokens, usageLogId, null);
    }

    /** {@link #deductCredits} carrying optional usage-metering fields (null = the body above). */
    public void deductCredits(
            String instituteId,
            String requestType,
            String model,
            int promptTokens,
            int completionTokens,
            String usageLogId,
            MeteringFields metering) {
        try {
            String url = aiServiceUrl + "/ai-service/credits/v1/deduct";

            // /deduct is internal-token-gated — see deductPrecomputed.
            HttpHeaders headers = buildInternalHeaders();

            Map<String, Object> body = Map.of(
                    "institute_id", instituteId,
                    "request_type", requestType != null ? requestType : "content",
                    "model", model != null ? model : "unknown",
                    "prompt_tokens", promptTokens,
                    "completion_tokens", completionTokens,
                    "usage_log_id", usageLogId != null ? usageLogId : "");
            body = withMetering(body, metering);

            HttpEntity<Map<String, Object>> request = new HttpEntity<>(body, headers);

            @SuppressWarnings("unchecked")
            ResponseEntity<Map<String, Object>> response = restTemplate.exchange(
                    url,
                    HttpMethod.POST,
                    request,
                    (Class<Map<String, Object>>) (Class<?>) Map.class);

            if (response.getStatusCode().is2xxSuccessful()) {
                log.debug("Successfully deducted credits for institute {}", instituteId);
            } else {
                log.warn("Failed to deduct credits for institute {}: {}", instituteId, response.getStatusCode());
            }
        } catch (RestClientException e) {
            log.error("Error deducting credits for institute {}: {}", instituteId, e.getMessage());
        }
    }

    /**
     * Token-metered deduction WITH per-user attribution (academy-credits Phase 3).
     *
     * <p>Same pricing path as {@link #deductCredits} — ai_service prices the real token
     * counts against the model's USD rates — but it also carries who the spend belongs
     * to, so the row shows up in the per-user AI usage screens instead of as an
     * unattributed system charge, and a {@code batchId} so related charges can be
     * grouped (the chatbot passes the flow id).
     *
     * <p>{@code allow_negative} is true: the tokens were already burned at the provider
     * by the time we get here, so a charge for delivered work must never be silently
     * dropped because a concurrent spend slipped the balance below the pre-flight
     * estimate. Affordability is gated BEFORE the call (see hasActiveCredits).
     *
     * @param subjectUserId who the work was about when that differs from the actor
     *                      (a chatbot reply is FOR the learner, not the bot)
     * @return true when ai_service acknowledged the deduction
     */
    public boolean deductAttributedTokenUsage(
            String instituteId,
            String requestType,
            String model,
            int promptTokens,
            int completionTokens,
            String usageLogId,
            String userId,
            String userRole,
            String subjectUserId,
            String description,
            String batchId) {
        return deductAttributedTokenUsage(instituteId, requestType, model, promptTokens, completionTokens,
                usageLogId, userId, userRole, subjectUserId, description, batchId, null);
    }

    /**
     * {@link #deductAttributedTokenUsage} with an idempotency key: ai_service no-ops a repeated
     * key (credit_transactions.external_reference_id, V243 partial unique), so a retried or
     * replayed charge lands once. A null/blank key sends exactly the body above.
     */
    public boolean deductAttributedTokenUsage(
            String instituteId,
            String requestType,
            String model,
            int promptTokens,
            int completionTokens,
            String usageLogId,
            String userId,
            String userRole,
            String subjectUserId,
            String description,
            String batchId,
            String idempotencyKey) {
        return deductAttributedTokenUsage(instituteId, requestType, model, promptTokens, completionTokens,
                usageLogId, userId, userRole, subjectUserId, description, batchId, idempotencyKey, true);
    }

    /**
     * {@link #deductAttributedTokenUsage} choosing {@code allow_negative}. Pass false for a
     * caller with no pre-flight affordability gate: ai_service then applies the charge only
     * when the balance covers it (and reports success=false otherwise).
     */
    public boolean deductAttributedTokenUsage(
            String instituteId,
            String requestType,
            String model,
            int promptTokens,
            int completionTokens,
            String usageLogId,
            String userId,
            String userRole,
            String subjectUserId,
            String description,
            String batchId,
            String idempotencyKey,
            boolean allowNegative) {
        return deductAttributedTokenUsage(instituteId, requestType, model, promptTokens, completionTokens,
                usageLogId, userId, userRole, subjectUserId, description, batchId, idempotencyKey, allowNegative,
                null);
    }

    /**
     * {@link #deductAttributedTokenUsage} carrying optional usage-metering fields
     * ({@link MeteringFields}). A null {@code metering} sends exactly the body above; the
     * metering fields never replace user_id / user_role / subject_user_id / batch_id.
     */
    public boolean deductAttributedTokenUsage(
            String instituteId,
            String requestType,
            String model,
            int promptTokens,
            int completionTokens,
            String usageLogId,
            String userId,
            String userRole,
            String subjectUserId,
            String description,
            String batchId,
            String idempotencyKey,
            boolean allowNegative,
            MeteringFields metering) {
        try {
            String url = aiServiceUrl + "/ai-service/credits/v1/deduct";

            HttpHeaders headers = buildInternalHeaders();

            Map<String, Object> body = new HashMap<>();
            body.put("institute_id", instituteId);
            body.put("request_type", requestType != null ? requestType : "content");
            body.put("model", model != null ? model : "unknown");
            body.put("prompt_tokens", promptTokens);
            body.put("completion_tokens", completionTokens);
            body.put("allow_negative", allowNegative);
            // Null-safe puts: HashMap (not Map.of) precisely so the optional
            // attribution fields can be omitted rather than sent as "".
            if (usageLogId != null && !usageLogId.isBlank()) body.put("usage_log_id", usageLogId);
            if (userId != null && !userId.isBlank()) body.put("user_id", userId);
            if (userRole != null && !userRole.isBlank()) body.put("user_role", userRole);
            if (subjectUserId != null && !subjectUserId.isBlank()) body.put("subject_user_id", subjectUserId);
            if (description != null && !description.isBlank()) body.put("description", clampDescription(description));
            if (batchId != null && !batchId.isBlank()) body.put("batch_id", batchId);
            if (idempotencyKey != null && !idempotencyKey.isBlank()) body.put("idempotency_key", idempotencyKey);
            MeteringFields.applyTo(metering, body);

            HttpEntity<Map<String, Object>> request = new HttpEntity<>(body, headers);

            @SuppressWarnings("unchecked")
            ResponseEntity<Map<String, Object>> response = restTemplate.exchange(
                    url,
                    HttpMethod.POST,
                    request,
                    (Class<Map<String, Object>>) (Class<?>) Map.class);

            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                if (Boolean.TRUE.equals(response.getBody().get("success"))) {
                    return true;
                }
                log.warn("Attributed deduction not applied for institute {} ({}): {}",
                        instituteId, requestType, response.getBody().get("message"));
                return false;
            }
            log.warn("Attributed deduction HTTP {} for institute {} ({})",
                    response.getStatusCode(), instituteId, requestType);
            return false;
        } catch (Exception e) {
            log.error("Error in attributed deduction for institute {} ({}): {}",
                    instituteId, requestType, e.getMessage());
            return false;
        }
    }

    /** Fire-and-forget variant of {@link #deductAttributedTokenUsage}. */
    @Async
    public CompletableFuture<Void> deductAttributedTokenUsageAsync(
            String instituteId,
            String requestType,
            String model,
            int promptTokens,
            int completionTokens,
            String usageLogId,
            String userId,
            String userRole,
            String subjectUserId,
            String description,
            String batchId) {
        return CompletableFuture.runAsync(() -> deductAttributedTokenUsage(
                instituteId, requestType, model, promptTokens, completionTokens,
                usageLogId, userId, userRole, subjectUserId, description, batchId));
    }

    /**
     * Fire-and-forget {@link #deductAttributedTokenUsage} with usage-metering fields
     * (same allow_negative=true and no idempotency key as the variant above).
     */
    @Async
    public CompletableFuture<Void> deductAttributedTokenUsageAsync(
            String instituteId,
            String requestType,
            String model,
            int promptTokens,
            int completionTokens,
            String usageLogId,
            String userId,
            String userRole,
            String subjectUserId,
            String description,
            String batchId,
            MeteringFields metering) {
        return CompletableFuture.runAsync(() -> deductAttributedTokenUsage(
                instituteId, requestType, model, promptTokens, completionTokens,
                usageLogId, userId, userRole, subjectUserId, description, batchId, null, true, metering));
    }

    /** ai_service validates description at 500 chars; an over-long one fails the whole charge. */
    private static String clampDescription(String description) {
        return description.length() <= 500 ? description : description.substring(0, 499) + "…";
    }

    /**
     * Deduct a PRECOMPUTED credit amount (the caller already priced the work — e.g.
     * per-minute call metering) with an idempotency key. ai_service short-circuits a
     * repeated key against credit_transactions.external_reference_id (V243 partial
     * unique), so retries/replays charge exactly once. allow_negative because these are
     * post-paid charges for already-delivered work (same convention as transcription /
     * call_intelligence): the wallet may go negative rather than the charge dropping.
     * No usage_log_id is sent, so the ai_token_usage request_type CHECK is never in play.
     *
     * @return true if ai_service acknowledged the deduction (or an idempotent replay)
     */
    public boolean deductPrecomputed(
            String instituteId,
            String requestType,
            String description,
            java.math.BigDecimal credits,
            String idempotencyKey) {
        return deductPrecomputed(instituteId, requestType, description, credits, idempotencyKey, null);
    }

    /**
     * {@link #deductPrecomputed} carrying optional usage-metering fields ({@link MeteringFields}).
     * A null {@code metering} sends exactly the body above (user_role stays SYSTEM).
     */
    public boolean deductPrecomputed(
            String instituteId,
            String requestType,
            String description,
            java.math.BigDecimal credits,
            String idempotencyKey,
            MeteringFields metering) {
        try {
            String url = aiServiceUrl + "/ai-service/credits/v1/deduct";

            // /deduct is internal-token-gated (it honors precomputed_credits +
            // allow_negative and the /ai-service/ prefix is publicly routed).
            HttpHeaders headers = buildInternalHeaders();

            Map<String, Object> body = new java.util.HashMap<>();
            body.put("institute_id", instituteId);
            body.put("request_type", requestType);
            body.put("model", "system");
            body.put("precomputed_credits", credits);
            body.put("description", description);
            body.put("idempotency_key", idempotencyKey);
            body.put("allow_negative", true);
            body.put("user_role", "SYSTEM");
            MeteringFields.applyTo(metering, body);

            HttpEntity<Map<String, Object>> request = new HttpEntity<>(body, headers);

            @SuppressWarnings("unchecked")
            ResponseEntity<Map<String, Object>> response = restTemplate.exchange(
                    url,
                    HttpMethod.POST,
                    request,
                    (Class<Map<String, Object>>) (Class<?>) Map.class);

            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                Object success = response.getBody().get("success");
                if (Boolean.TRUE.equals(success)) return true;
                log.warn("Precomputed deduction not applied for institute {} key {}: {}",
                        instituteId, idempotencyKey, response.getBody().get("message"));
                return false;
            }
            log.warn("Precomputed deduction HTTP {} for institute {} key {}",
                    response.getStatusCode(), instituteId, idempotencyKey);
            return false;
        } catch (RestClientException e) {
            log.error("Error in precomputed deduction for institute {} key {}: {}",
                    instituteId, idempotencyKey, e.getMessage());
            return false;
        }
    }

    /**
     * Get current credit balance for an institute.
     *
     * @param instituteId The institute ID
     * @return Map with balance info, or null if failed
     */
    public Map<String, Object> getBalance(String instituteId) {
        try {
            String url = aiServiceUrl + "/ai-service/credits/v1/institutes/" + instituteId + "/balance";

            // /balance requires auth. We have no caller JWT to forward here — most
            // callers are schedulers (EngagementDispatchJob, AiCallService) — so we
            // authenticate as a service. Without this the read 401s, getBalance
            // returns null, and every fail-closed affordability gate blocks.
            HttpHeaders headers = buildInternalHeaders();

            HttpEntity<String> request = new HttpEntity<>(headers);

            @SuppressWarnings("unchecked")
            ResponseEntity<Map<String, Object>> response = restTemplate.exchange(
                    url,
                    HttpMethod.GET,
                    request,
                    (Class<Map<String, Object>>) (Class<?>) Map.class);

            if (response.getStatusCode().is2xxSuccessful()) {
                return response.getBody();
            }

            return null;
        } catch (Exception e) {
            log.error("Error getting balance for institute {}: {}", instituteId, e.getMessage());
            return null;
        }
    }

    /**
     * Grant credits to an institute (super admin action).
     *
     * The caller (SuperAdminCreditController) has already enforced isRootUser, and
     * ai_service's /grant accepts either a ROOT_ADMIN JWT or the internal service
     * token. We authenticate with the token — there is no JWT on this RestTemplate
     * to forward — and pass actingUserId so the transaction is attributed to the
     * real super admin instead of "system".
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> grantCredits(String instituteId, Double amount, String description,
            String actingUserId) {
        try {
            String url = aiServiceUrl + "/ai-service/credits/v1/institutes/" + instituteId + "/grant";

            HttpHeaders headers = buildInternalHeaders();

            Map<String, Object> body = new HashMap<>();
            body.put("amount", amount);
            body.put("description", description != null ? description : "Super admin grant");
            body.put("acting_user_id", actingUserId);

            HttpEntity<Map<String, Object>> request = new HttpEntity<>(body, headers);

            ResponseEntity<Map<String, Object>> response = restTemplate.exchange(
                    url,
                    HttpMethod.POST,
                    request,
                    (Class<Map<String, Object>>) (Class<?>) Map.class);

            if (response.getStatusCode().is2xxSuccessful()) {
                log.info("Successfully granted {} credits to institute {}", amount, instituteId);
                return response.getBody();
            }

            log.warn("Failed to grant credits for institute {}: {}", instituteId, response.getStatusCode());
            return Map.of("success", false, "message", "Credit grant failed");
        } catch (RestClientException e) {
            log.error("Error granting credits for institute {}: {}", instituteId, e.getMessage());
            return Map.of("success", false, "message", e.getMessage());
        }
    }

    /**
     * Deduct credits from an institute (super admin action). Internal-token
     * authenticated for the same reason as {@link #grantCredits}.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> deductCreditsAdmin(String instituteId, Double amount, String description,
            String actingUserId) {
        try {
            String url = aiServiceUrl + "/ai-service/credits/v1/institutes/" + instituteId + "/deduct-admin";

            HttpHeaders headers = buildInternalHeaders();

            Map<String, Object> body = new HashMap<>();
            body.put("amount", amount);
            body.put("description", description != null ? description : "Super admin deduction");
            body.put("acting_user_id", actingUserId);

            HttpEntity<Map<String, Object>> request = new HttpEntity<>(body, headers);

            ResponseEntity<Map<String, Object>> response = restTemplate.exchange(
                    url,
                    HttpMethod.POST,
                    request,
                    (Class<Map<String, Object>>) (Class<?>) Map.class);

            if (response.getStatusCode().is2xxSuccessful()) {
                log.info("Successfully deducted {} credits from institute {}", amount, instituteId);
                return response.getBody();
            }

            log.warn("Failed to deduct credits for institute {}: {}", instituteId, response.getStatusCode());
            return Map.of("success", false, "message", "Credit deduction failed");
        } catch (RestClientException e) {
            log.error("Error deducting credits for institute {}: {}", instituteId, e.getMessage());
            return Map.of("success", false, "message", e.getMessage());
        }
    }
    /**
     * The institute's current balance, or EMPTY when it could not be read (the
     * credits service is down, 401s, or answers without a usable
     * {@code current_balance}).
     *
     * <p>Exists because {@link #hasActiveCredits} collapses those two cases into
     * one {@code false}, which is the right default for autonomous spend (an
     * unreadable balance must not authorise a charge nobody approved) but the
     * wrong one for a human pressing a Call button: there, the same {@code false}
     * would turn a credits-service blip into "nobody on the platform can dial".
     * A caller that needs to tell "out of credits" from "don't know" reads this
     * and picks its own failure direction — see
     * {@code CallOrchestrator.assertVoiceCreditsAvailable}.
     */
    public Optional<Double> readBalance(String instituteId) {
        if (instituteId == null || instituteId.isBlank()) {
            return Optional.empty();
        }

        Map<String, Object> balance = getBalance(instituteId);
        if (balance == null || balance.get("current_balance") == null) {
            return Optional.empty();
        }
        Object currentBalanceObj = balance.get("current_balance");
        if (currentBalanceObj instanceof Number n) {
            return Optional.of(n.doubleValue());
        }
        if (currentBalanceObj instanceof String s) {
            try {
                return Optional.of(Double.parseDouble(s));
            } catch (NumberFormatException e) {
                log.error("Failed to parse current_balance string: {}", currentBalanceObj);
            }
        }
        // An unparseable value is "unknown", not zero: reporting 0 here would make
        // a malformed payload look exactly like a genuinely empty wallet.
        return Optional.empty();
    }

    /**
     * Check if an institute has active credits (> 0).
     *
     * <p>Fails CLOSED: an unreadable balance answers false, so callers that gate
     * autonomous spend on this (chatbot, engagement dispatch, AI calling) stop
     * rather than run unpriced work.
     *
     * @param instituteId The institute ID
     * @return true if balance > 0, false otherwise
     */
    public boolean hasActiveCredits(String instituteId) {
        return readBalance(instituteId).orElse(0.0) > 0.0;
    }

    // ========================================================================
    // AI Credit Pack Purchase Fulfillment (called from PlatformRazorpayWebHookService
    // after a Razorpay payment.captured / refund.processed event lands)
    //
    // These hit /credits/v1/internal/* endpoints which are gated by the
    // X-Internal-Service-Token header (NOT by JWT/ROOT_ADMIN). Idempotency
    // is handled on the Python side via the V243 partial UNIQUE index on
    // credit_transactions.external_reference_id.
    // ========================================================================

    /**
     * Thrown when ai_service did not confirm a payment grant (non-2xx, transport error, or a 2xx
     * body with {@code success: false}). The platform webhook lets it escape so Razorpay
     * retries; nothing has been marked PAID yet (F1).
     */
    public static class PaymentGrantException extends RuntimeException {
        public PaymentGrantException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    /**
     * Grant credits to fulfill a successful Razorpay credit-pack payment.
     *
     * <p>Throws {@link PaymentGrantException} unless ai_service confirms the grant (F1): the
     * caller must not mark the payment PAID before this returns. Safe to repeat: the grant is
     * idempotent on {@code razorpayPaymentId} (V243 partial UNIQUE on
     * credit_transactions.external_reference_id; a repeat answers {@code already_processed}).
     *
     * @param instituteId          buyer
     * @param credits              amount granted
     * @param razorpayPaymentId    Razorpay payment_id — used as the dedup key on
     *                             credit_transactions.external_reference_id
     * @param platformPaymentId    our platform_payment.id — populated on
     *                             credit_transactions.reference_id for reverse lookup
     * @param packCode             pack code snapshot (for the description), nullable
     * @return parsed AI-service response (never a failure)
     * @throws PaymentGrantException when the grant is not confirmed
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> grantFromPayment(
            String instituteId,
            BigDecimal credits,
            String razorpayPaymentId,
            String platformPaymentId,
            String packCode) {
        ResponseEntity<Map<String, Object>> response;
        try {
            String url = aiServiceUrl + "/ai-service/credits/v1/internal/grant-from-payment";

            HttpHeaders headers = buildInternalHeaders();

            Map<String, Object> body = new HashMap<>();
            body.put("institute_id", instituteId);
            body.put("amount", credits);
            body.put("external_reference_id", razorpayPaymentId);
            body.put("platform_payment_id", platformPaymentId);
            body.put("pack_code", packCode);
            body.put("description", "Credit pack purchase via Razorpay (" + (packCode != null ? packCode : "?") + ")");

            HttpEntity<Map<String, Object>> request = new HttpEntity<>(body, headers);
            response = restTemplate.exchange(
                    url, HttpMethod.POST, request,
                    (Class<Map<String, Object>>) (Class<?>) Map.class);
        } catch (RestClientException e) {
            log.error("grantFromPayment failed for institute {} payment_id {}: {}",
                    instituteId, razorpayPaymentId, e.getMessage());
            throw new PaymentGrantException("Credit grant failed for payment " + razorpayPaymentId
                    + ": " + e.getMessage(), e);
        }

        if (!response.getStatusCode().is2xxSuccessful()) {
            log.warn("grantFromPayment returned non-2xx for institute {}: {}",
                    instituteId, response.getStatusCode());
            throw new PaymentGrantException("Credit grant for payment " + razorpayPaymentId
                    + " returned " + response.getStatusCode(), null);
        }
        Map<String, Object> respBody = response.getBody();
        if (respBody != null && Boolean.FALSE.equals(respBody.get("success"))) {
            throw new PaymentGrantException("Credit grant for payment " + razorpayPaymentId
                    + " was refused: " + respBody.get("message"), null);
        }
        Object already = respBody == null ? null : respBody.get("already_processed");
        log.info("Granted {} credits to institute {} (razorpay_payment_id={}, already_processed={})",
                credits, instituteId, razorpayPaymentId, already);
        return respBody != null ? respBody : Map.of("success", true);
    }

    /**
     * Reverse a credit pack purchase (full or partial refund).
     *
     * @param instituteId          buyer
     * @param creditsToRefund      amount to deduct (can pro-rate for partial refund)
     * @param razorpayRefundId     Razorpay refund_id — dedup key (distinct from
     *                             the original payment_id, so it won't collide
     *                             with the PURCHASE row in the unique index)
     * @param platformPaymentId    our platform_payment.id
     * @param packCode             pack code snapshot
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> refundFromPayment(
            String instituteId,
            BigDecimal creditsToRefund,
            String razorpayRefundId,
            String platformPaymentId,
            String packCode) {
        try {
            String url = aiServiceUrl + "/ai-service/credits/v1/internal/refund-from-payment";

            HttpHeaders headers = buildInternalHeaders();

            Map<String, Object> body = new HashMap<>();
            body.put("institute_id", instituteId);
            body.put("amount", creditsToRefund);
            body.put("external_reference_id", razorpayRefundId);
            body.put("platform_payment_id", platformPaymentId);
            body.put("pack_code", packCode);
            body.put("description", "Refund for credit pack (" + (packCode != null ? packCode : "?") + ")");

            HttpEntity<Map<String, Object>> request = new HttpEntity<>(body, headers);
            ResponseEntity<Map<String, Object>> response = restTemplate.exchange(
                    url, HttpMethod.POST, request,
                    (Class<Map<String, Object>>) (Class<?>) Map.class);

            if (response.getStatusCode().is2xxSuccessful()) {
                log.info("Refunded {} credits from institute {} (razorpay_refund_id={})",
                        creditsToRefund, instituteId, razorpayRefundId);
                return response.getBody();
            }
            log.warn("refundFromPayment returned non-2xx for institute {}: {}",
                    instituteId, response.getStatusCode());
            return Map.of("success", false, "message", "AI service returned " + response.getStatusCode());

        } catch (RestClientException e) {
            log.error("refundFromPayment failed for institute {} refund_id {}: {}",
                    instituteId, razorpayRefundId, e.getMessage());
            return Map.of("success", false, "message", e.getMessage());
        }
    }

    // ========================================================================
    // AI usage limits (ai_service internal/metering/v1). Fail OPEN everywhere: any error,
    // timeout or odd answer = allow, exactly today's behaviour.
    // ========================================================================

    /** {@link #authorize(String, String, String, MeteringFields, String, BigDecimal, boolean)} with no estimate. */
    public AuthorizeResult authorize(String instituteId, String useCase, String requestType,
            MeteringFields metering, String actorUserId) {
        return authorize(instituteId, useCase, requestType, metering, actorUserId, null, false);
    }

    /**
     * Ask ai_service whether a usage limit allows this AI operation. Never throws.
     *
     * <p>For an institute without limits switched on (see {@link AiLimitsPolicyIndex}) this
     * returns {@link AuthorizeResult#ALLOW_NONE} at once, with no HTTP call. Otherwise one
     * POST with a ~1.5 s budget; a failure, timeout, non-2xx or unreadable answer also
     * returns ALLOW_NONE (logged at most once a minute).
     *
     * @param useCase         the ai_use_case_catalog key (e.g. learner_analytics)
     * @param requestType     the legacy request_type, may be null
     * @param metering        actor / subject / surface fields, same snake_case names as on
     *                        /deduct; may be null
     * @param actorUserId     the user the work is for, when there is one (USER-scoped limits)
     * @param estimateCredits optional estimate; null lets ai_service use the catalog's
     * @param reserve         hold the estimate against the limit until the charge lands
     */
    public AuthorizeResult authorize(String instituteId, String useCase, String requestType,
            MeteringFields metering, String actorUserId, BigDecimal estimateCredits, boolean reserve) {
        try {
            if (instituteId == null || instituteId.isBlank() || useCase == null || useCase.isBlank()) {
                return AuthorizeResult.ALLOW_NONE;
            }
            AiLimitsPolicyIndex index = limitsPolicyIndex;
            if (index != null && !index.mayHaveLimits(instituteId)) {
                return AuthorizeResult.ALLOW_NONE;
            }
            Map<String, Object> body = authorizeBody(instituteId, useCase, requestType, metering, actorUserId,
                    estimateCredits, reserve);

            @SuppressWarnings("unchecked")
            ResponseEntity<Map<String, Object>> response = limitsRestTemplate.exchange(
                    aiServiceUrl + AUTHORIZE_PATH,
                    HttpMethod.POST,
                    new HttpEntity<>(body, buildInternalHeaders()),
                    (Class<Map<String, Object>>) (Class<?>) Map.class);

            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                logAuthorizeFailure(instituteId, useCase, "HTTP " + response.getStatusCode().value());
                return AuthorizeResult.ALLOW_NONE;
            }
            return parseAuthorize(response.getBody());
        } catch (Exception e) {
            logAuthorizeFailure(instituteId, useCase, e.getClass().getSimpleName() + ": " + e.getMessage());
            return AuthorizeResult.ALLOW_NONE;
        }
    }

    /** The authorize request body; package-private for tests. */
    static Map<String, Object> authorizeBody(String instituteId, String useCase, String requestType,
            MeteringFields metering, String actorUserId, BigDecimal estimateCredits, boolean reserve) {
        Map<String, Object> body = new HashMap<>();
        body.put("institute_id", instituteId);
        body.put("use_case", useCase);
        if (requestType != null && !requestType.isBlank()) body.put("request_type", requestType);
        if (actorUserId != null && !actorUserId.isBlank()) body.put("actor_user_id", actorUserId);
        // Unlike /deduct, the subject is not a ledger column here, so it goes top-level too
        // (ai_service may check a learner's caps for on-behalf work).
        if (metering != null && metering.subjectUserId() != null && !metering.subjectUserId().isBlank()) {
            body.put("subject_user_id", metering.subjectUserId());
        }
        if (estimateCredits != null) body.put("estimate_credits", estimateCredits);
        body.put("reserve", reserve);
        MeteringFields.applyTo(metering, body);
        return body;
    }

    /**
     * Only an explicit {@code allow: false} refuses. A missing or non-boolean allow is
     * read as allowed (fail open).
     */
    @SuppressWarnings("unchecked")
    static AuthorizeResult parseAuthorize(Map<String, Object> resp) {
        boolean allow = !Boolean.FALSE.equals(resp.get("allow"));
        Object d = resp.get("decision");
        String decision = d == null || d.toString().isBlank() ? AuthorizeResult.NONE : d.toString().trim();
        Object b = resp.get("block");
        Map<String, Object> block = b instanceof Map<?, ?> m ? (Map<String, Object>) m : null;
        if (allow) {
            return new AuthorizeResult(true, decision, null);
        }
        return new AuthorizeResult(false, decision, block != null ? block : Map.of());
    }

    private void logAuthorizeFailure(String instituteId, String useCase, String why) {
        long now = System.currentTimeMillis();
        long last = lastAuthorizeFailureLog.get();
        if (now - last >= AUTHORIZE_FAILURE_LOG_INTERVAL_MS && lastAuthorizeFailureLog.compareAndSet(last, now)) {
            log.warn("[ai-limits] authorize failed for institute {} use case {} ({}); allowing (fail open). "
                    + "Further failures are logged at most once a minute.", instituteId, useCase, why);
        }
    }

    /**
     * Ask ai_service to recompute the current limit-counter windows from ai_usage_event and
     * fix any drift ({@code POST /internal/metering/v1/counters/rebuild?days=}). Returns the
     * report, or null on any failure (logged). Never throws.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> rebuildUsageCounters(int days) {
        try {
            ResponseEntity<Map<String, Object>> response = rebuildRestTemplate.exchange(
                    aiServiceUrl + REBUILD_PATH + "?days=" + days,
                    HttpMethod.POST,
                    new HttpEntity<>("{}", buildInternalHeaders()),
                    (Class<Map<String, Object>>) (Class<?>) Map.class);
            if (response.getStatusCode().is2xxSuccessful()) {
                return response.getBody() != null ? response.getBody() : Map.of();
            }
            log.warn("[ai-limits] counter rebuild returned HTTP {}", response.getStatusCode().value());
            return null;
        } catch (Exception e) {
            log.warn("[ai-limits] counter rebuild failed: {}", e.getMessage());
            return null;
        }
    }

    // ========================================================================
    // AI subscription plans. Fail SAFE everywhere: any error, timeout or odd answer = "not
    // covered", i.e. the caller's wallet check decides, exactly as today.
    // ========================================================================

    /**
     * Whether the institute's LIVE AI plan covers this operation (INCLUDED, or paid from the
     * plan's allowance), so a pre-check may let it run although the wallet is empty. Never
     * throws.
     *
     * <p>Only for INCLUDABLE / allowance features (chatbot replies, learner reports, copy
     * check ...). AI calling and telephony never ask: they are always charged.
     *
     * <p>For an institute without a LIVE subscription (see {@link AiPlanSubscriptionIndex}) this
     * returns false at once, with no HTTP call. Otherwise one {@code POST /credits/v1/check} on
     * the ~1.5 s limits template; ai_service's check is plan-aware (it answers sufficient
     * without the balance requirement when the plan covers the estimate). Covered only on
     * explicit evidence: {@code has_sufficient_credits} true AND either a
     * {@code billing_mode} of INCLUDED / ALLOWANCE ({@code plan_covered: true} also counts),
     * or, for a positive estimate, a balance below it or a {@code balance_after} equal to the
     * balance (neither of which today's balance comparison can answer as sufficient). Anything
     * else, including a failure, is false.
     *
     * @param requestType     the legacy request_type the charge will use (chatbot, analytics ...)
     * @param model           the model about to run, may be null (the feature's default chain)
     * @param estimatedTokens prompt + completion estimate; at least 1 is sent
     * @param userId          the user the work is done by / for, may be null
     * @param metering        use_case, actor and subject fields, may be null
     */
    public boolean planCovers(String instituteId, String requestType, String model, int estimatedTokens,
            String userId, MeteringFields metering) {
        try {
            if (instituteId == null || instituteId.isBlank() || requestType == null || requestType.isBlank()) {
                return false;
            }
            AiPlanSubscriptionIndex index = planSubscriptionIndex;
            if (index == null || !index.mayHaveLivePlan(instituteId)) {
                return false;
            }
            Map<String, Object> body = new HashMap<>();
            body.put("institute_id", instituteId);
            body.put("request_type", requestType);
            body.put("model", model != null ? model : "");
            body.put("estimated_tokens", Math.max(1, estimatedTokens));
            if (userId != null && !userId.isBlank()) body.put("user_id", userId);
            // A check writes no ledger row, so (as on authorize) the subject may go top-level:
            // per-learner fair-use caps (user_cap_basis SUBJECT) are counted against it.
            if (metering != null && metering.subjectUserId() != null && !metering.subjectUserId().isBlank()) {
                body.put("subject_user_id", metering.subjectUserId());
            }
            MeteringFields.applyTo(metering, body);

            @SuppressWarnings("unchecked")
            ResponseEntity<Map<String, Object>> response = limitsRestTemplate.exchange(
                    aiServiceUrl + CHECK_PATH,
                    HttpMethod.POST,
                    new HttpEntity<>(body, buildInternalHeaders()),
                    (Class<Map<String, Object>>) (Class<?>) Map.class);
            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                return false;
            }
            boolean covered = isPlanCovered(response.getBody());
            if (covered) {
                log.info("[ai-plans] institute {} ({}) covered by its AI plan; wallet balance not required",
                        instituteId, requestType);
            }
            return covered;
        } catch (Exception e) {
            // A usage-limit 429, a timeout, ai_service down: not covered, today's wallet rule decides.
            log.debug("[ai-plans] plan check for institute {} ({}) failed; wallet decides: {}",
                    instituteId, requestType, e.getMessage());
            return false;
        }
    }

    /** The covered rule on a /credits/v1/check answer; package-private for tests. */
    static boolean isPlanCovered(Map<String, Object> resp) {
        if (resp == null || !Boolean.TRUE.equals(resp.get("has_sufficient_credits"))) {
            return false;
        }
        Object mode = resp.get("billing_mode");
        if (mode != null) {
            String m = mode.toString().trim().toUpperCase(java.util.Locale.ROOT);
            return "INCLUDED".equals(m) || "ALLOWANCE".equals(m);
        }
        if (Boolean.TRUE.equals(resp.get("plan_covered"))) {
            return true;
        }
        BigDecimal balance = decimalOrNull(resp.get("current_balance"));
        BigDecimal cost = decimalOrNull(resp.get("estimated_cost"));
        if (balance == null || cost == null || cost.signum() <= 0) {
            return false;
        }
        // Today: sufficient = balance >= cost and balance_after = balance - cost. Sufficient
        // with balance < cost, or a positive cost that leaves the balance untouched, is the
        // plan's answer (ai_service's covered check reports balance_after = current balance).
        BigDecimal after = decimalOrNull(resp.get("balance_after"));
        return balance.compareTo(cost) < 0 || (after != null && after.compareTo(balance) == 0);
    }

    private static BigDecimal decimalOrNull(Object v) {
        if (v instanceof BigDecimal b) return b;
        if (v instanceof Number n) return new BigDecimal(n.toString());
        if (v instanceof String s && !s.isBlank()) {
            try {
                return new BigDecimal(s.trim());
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return null;
    }

    /**
     * Ask ai_service to roll AI plan subscriptions forward ({@code POST
     * /internal/plans/v1/roll}: next periods, pending plan changes, cancellations, expiries;
     * idempotent). Returns the report, or null on any failure (logged). Never throws.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> rollAiPlans() {
        try {
            ResponseEntity<Map<String, Object>> response = rebuildRestTemplate.exchange(
                    aiServiceUrl + PLANS_ROLL_PATH,
                    HttpMethod.POST,
                    new HttpEntity<>("{}", buildInternalHeaders()),
                    (Class<Map<String, Object>>) (Class<?>) Map.class);
            if (response.getStatusCode().is2xxSuccessful()) {
                return response.getBody() != null ? response.getBody() : Map.of();
            }
            log.warn("[ai-plans] roll returned HTTP {}", response.getStatusCode().value());
            return null;
        } catch (Exception e) {
            log.warn("[ai-plans] roll failed: {}", e.getMessage());
            return null;
        }
    }

    /**
     * The base body unchanged when there are no metering fields (same immutable map, same
     * failure modes as before); otherwise a mutable copy with the metering fields added.
     */
    static Map<String, Object> withMetering(Map<String, Object> base, MeteringFields metering) {
        if (metering == null) {
            return base;
        }
        Map<String, Object> body = new HashMap<>(base);
        MeteringFields.applyTo(metering, body);
        return body;
    }

    private HttpHeaders buildInternalHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        // Always send the header — Python side returns 401 if missing/wrong, or
        // 503 if the server itself doesn't have INTERNAL_SERVICE_TOKEN configured.
        headers.set("X-Internal-Service-Token", internalServiceToken == null ? "" : internalServiceToken);
        return headers;
    }
}
