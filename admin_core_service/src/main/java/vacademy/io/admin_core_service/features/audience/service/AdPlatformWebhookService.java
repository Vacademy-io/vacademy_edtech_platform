package vacademy.io.admin_core_service.features.audience.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.audience.dto.NormalizedLeadData;
import vacademy.io.admin_core_service.features.audience.dto.OAuthTokenResult;
import vacademy.io.admin_core_service.features.audience.dto.ProcessedFormDataDTO;
import vacademy.io.admin_core_service.features.audience.entity.FormWebhookConnector;
import vacademy.io.admin_core_service.features.audience.repository.FormWebhookConnectorRepository;
import vacademy.io.admin_core_service.features.audience.strategy.AdPlatformStrategy;
import vacademy.io.admin_core_service.features.audience.strategy.GoogleLeadFormStrategy;
import vacademy.io.admin_core_service.features.audience.strategy.MetaLeadAdsStrategy;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.logging.SentryLogger;

import java.time.LocalDateTime;
import java.util.*;

/**
 * Orchestrates ad platform webhook processing:
 * 1. Looks up the connector by platform_form_id + vendor
 * 2. Delegates signature verification to the strategy
 * 3. Extracts and normalizes leads via the strategy
 * 4. Applies routing rules to resolve target audience
 * 5. Submits leads to AudienceService
 */
@Service
@Slf4j
public class AdPlatformWebhookService {

    @Autowired
    private List<AdPlatformStrategy> strategies;

    @Autowired
    private FormWebhookConnectorRepository connectorRepository;

    @Autowired
    private AudienceService audienceService;

    @Autowired
    private TokenEncryptionService tokenEncryptionService;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private LeadEnricher leadEnricher;

    @Autowired
    private MetaLeadAdsStrategy metaLeadAdsStrategy;

    @Autowired
    private GoogleLeadFormStrategy googleLeadFormStrategy;

    @Autowired
    private AdCampaignRouteService campaignRouteService;

    // ── Strategy registry (built once at startup via @PostConstruct) ─────────

    private Map<String, AdPlatformStrategy> strategyMap;

    @jakarta.annotation.PostConstruct
    void initStrategyMap() {
        Map<String, AdPlatformStrategy> map = new HashMap<>();
        for (AdPlatformStrategy s : strategies) {
            map.put(s.getVendorCode(), s);
        }
        this.strategyMap = map;
        log.info("Registered {} ad platform strategies: {}", map.size(), map.keySet());
    }

    private AdPlatformStrategy getStrategy(String vendorCode) {
        AdPlatformStrategy s = strategyMap.get(vendorCode);
        if (s == null) throw new VacademyException("No strategy for vendor: " + vendorCode);
        return s;
    }

    // ── Meta webhook handling ─────────────────────────────────────────────────

    /**
     * Handle Meta hub.challenge verification GET request.
     * The strategy compares hub.verify_token against the app-configured secret.
     */
    public Optional<String> handleMetaVerificationChallenge(Map<String, String> queryParams) {
        AdPlatformStrategy strategy = getStrategy("META_LEAD_ADS");
        // Pass null — the strategy ignores this param and uses its @Value-injected secret
        return strategy.handleVerificationChallenge(queryParams, null);
    }

    /**
     * Handle Meta webhook POST asynchronously.
     * Returns immediately after queuing; lead processing happens in background.
     */
    /**
     * @param rawBody         webhook body (read by controller before async dispatch)
     * @param signatureHeader value of X-Hub-Signature-256 header (read by controller from live request)
     */
    @Async("workflowTaskExecutor")
    public void handleMetaWebhookAsync(String rawBody, String signatureHeader) {
        try {
            AdPlatformStrategy strategy = getStrategy("META_LEAD_ADS");

            // Verify HMAC-SHA256 signature FIRST — uses only app secret, no DB lookup
            if (!strategy.verifyWebhookSignature(signatureHeader, rawBody)) {
                log.error("Meta webhook HMAC-SHA256 verification failed — request rejected");
                return;
            }

            // Parse and process each leadgen event
            JsonNode root = objectMapper.readTree(rawBody);
            for (JsonNode entry : root.path("entry")) {
                for (JsonNode change : entry.path("changes")) {
                    if (!"leadgen".equals(change.path("field").asText())) continue;
                    JsonNode val = change.path("value");
                    String formId = val.path("form_id").asText(null);
                    if (formId == null) continue;

                    Optional<FormWebhookConnector> connectorOpt = connectorRepository
                            .findByPlatformFormIdAndVendorAndIsActiveTrue(formId, "META_LEAD_ADS");

                    if (connectorOpt.isEmpty()) {
                        log.warn("No active META_LEAD_ADS connector for form_id={}", formId);
                        continue;
                    }
                    processLeadsFromStrategy(strategy, rawBody, connectorOpt.get());
                }
            }
        } catch (Exception e) {
            log.error("Error processing Meta webhook", e);
        }
    }


    // ── Google webhook handling ───────────────────────────────────────────────

    /** HTTP status + message the controller answers Google with. */
    public record GoogleWebhookResult(int status, String message) {
        static GoogleWebhookResult ok() { return new GoogleWebhookResult(200, null); }
    }

    /**
     * Handle a Google Lead Form webhook identified by googleKey (= connector.vendorId).
     *
     * Deliberately SYNCHRONOUS (unlike Meta): Google retries a 5XX and drops a 4XX, so
     * the status has to reflect what actually happened to the lead. The old async version
     * answered 200 before even looking up the key, which made Google's "Send test data"
     * report success for a wrong key and turned every processing failure into a lead lost
     * with nothing but a log line. Same synchronous shape as the Zoho form webhook.
     *
     * Outcomes: unknown key → 404, unreadable JSON → 400, google_key mismatch → 401
     * (config errors, a retry can't fix them); test lead → 200, nothing created; real
     * lead saved (or deduped / discarded by routing) → 200; anything else → 500 + Sentry,
     * so Google redelivers. A redelivery is safe: the lead resolves to the same user and
     * the per-audience duplicate guard drops it if the first attempt did land.
     */
    public GoogleWebhookResult handleGoogleWebhook(String googleKey, String rawBody) {
        FormWebhookConnector connector = connectorRepository
                .findFirstByVendorAndVendorIdAndIsActiveTrueOrderByUpdatedAtDesc("GOOGLE_LEAD_ADS", googleKey)
                .orElse(null);
        if (connector == null) {
            // The key is a credential — log only enough of it to match a support ticket.
            log.warn("Google lead webhook for unknown key {}…", keyHint(googleKey));
            return new GoogleWebhookResult(404,
                    "No active connector for this webhook URL. Copy the URL again from Settings → Ad Integrations.");
        }

        JsonNode root;
        try {
            root = objectMapper.readTree(rawBody);
        } catch (Exception e) {
            root = null;
        }
        if (root == null || !root.isObject()) {
            log.warn("Unreadable Google lead payload for connector {}", connector.getId());
            return new GoogleWebhookResult(400, "Request body is not a JSON object");
        }

        if (!googleLeadFormStrategy.googleKeyMatches(root, connector.getVendorId())) {
            log.warn("google_key mismatch for connector {}", connector.getId());
            recordGoogleDelivery(connector, "ACTION_REQUIRED",
                    "Google reached this connector, but the Key on the Google Ads lead form does not match. "
                            + "Copy the key again from Setup & status.");
            return new GoogleWebhookResult(401,
                    "The Key set on the Google Ads lead form does not match this connector's key.");
        }

        if (root.path("is_test").asBoolean(false)) {
            // Acknowledge so Google's "Send test data" shows success, but create nothing:
            // a test lead would otherwise become a real user, enter the workflows and
            // email the admins.
            log.info("Google test lead received for connector {} — acknowledged, not saved", connector.getId());
            recordGoogleDelivery(connector, "ACTIVE", null);
            return GoogleWebhookResult.ok();
        }

        String leadId = root.path("lead_id").asText(null);
        try {
            List<NormalizedLeadData> leads = googleLeadFormStrategy.extractAndFetchLeads(rawBody, connector);
            if (leads.isEmpty()) {
                // extractAndFetchLeads only returns empty when its own parsing threw.
                throw new IllegalStateException("Google lead payload produced no lead");
            }
            String unroutableCampaign = null;
            for (NormalizedLeadData lead : leads) {
                // Each campaign can feed its own list; unmapped ones use the catch-all.
                if (campaignRouteService.autoCreatesLists(connector)) {
                    try {
                        campaignRouteService.ensureAutoList(connector, lead.getCampaignId());
                    } catch (Exception e) {
                        // Never lose the lead over its list: it falls back to the catch-all.
                        log.warn("Could not auto-create a list for campaign {} on connector {}: {}",
                                lead.getCampaignId(), connector.getId(), e.getMessage());
                    }
                }
                AdCampaignRouteService.RouteDecision route =
                        campaignRouteService.decide(connector, lead.getCampaignId());
                lead.setRoutedAudienceId(route.audienceId());
                if (route.unusableAudienceId() != null) unroutableCampaign = lead.getCampaignId();
                submitNormalizedLead(lead, connector);
                campaignRouteService.recordLead(connector, lead.getCampaignId());
            }
            if (unroutableCampaign != null) {
                recordGoogleDelivery(connector, "ACTION_REQUIRED", "Campaign " + unroutableCampaign
                        + " is routed to a list that was deleted or is no longer active, so its leads are "
                        + "going to the main list. Pick another list for it in Setup & status.");
            } else {
                recordGoogleDelivery(connector, "ACTIVE", null);
            }
            return GoogleWebhookResult.ok();
        } catch (Exception e) {
            // Our own validation messages ("Audience campaign is not active") tell the admin
            // what to fix; anything else is ours to fix, and Sentry already has it.
            String reason = e instanceof VacademyException && StringUtils.hasText(e.getMessage())
                    ? e.getMessage().replaceAll("[.\\s]+$", "")
                    : "an unexpected error; our team has been alerted";
            recordGoogleDelivery(connector, "ACTION_REQUIRED",
                    "Google delivered a lead but it could not be saved: " + reason + ". Google will retry.");
            log.error("Failed to ingest Google lead {} for connector {}", leadId, connector.getId(), e);
            Map<String, String> tags = new LinkedHashMap<>();
            tags.put("feature", "ad_platform_connector");
            tags.put("vendor", "GOOGLE_LEAD_ADS");
            tags.put("connector_id", connector.getId());
            if (connector.getInstituteId() != null) tags.put("institute_id", connector.getInstituteId());
            if (leadId != null) tags.put("platform_lead_id", leadId);
            SentryLogger.logError(e, "Google lead ingest failed — Google will retry", tags);
            return new GoogleWebhookResult(500, "Lead could not be saved; please retry");
        }
    }

    /**
     * Stamp the latest delivery outcome on the connector for the admin's Setup & status
     * view (and the connector table's Action-needed badge). Best effort: a failed write
     * must never change what Google is told.
     */
    private void recordGoogleDelivery(FormWebhookConnector connector, String status, String detail) {
        try {
            connectorRepository.updateDeliveryStatus(connector.getId(), LocalDateTime.now(), status, detail);
        } catch (Exception e) {
            log.warn("Could not record Google delivery status for connector {}: {}",
                    connector.getId(), e.getMessage());
        }
    }

    private static String keyHint(String key) {
        return key == null ? "null" : key.substring(0, Math.min(4, key.length()));
    }

    // ── Core processing ───────────────────────────────────────────────────────

    private void processLeadsFromStrategy(AdPlatformStrategy strategy, String rawBody,
            FormWebhookConnector connector) {
        List<NormalizedLeadData> leads = strategy.extractAndFetchLeads(rawBody, connector);
        for (NormalizedLeadData lead : leads) {
            try {
                submitNormalizedLead(lead, connector);
            } catch (Exception e) {
                log.error("Failed to submit lead {} from connector {}",
                        lead.getPlatformLeadId(), connector.getId(), e);
            }
        }
    }

    // ── Polling (PULL fallback for the webhook PUSH) ──────────────────────────

    /**
     * PULL new leads for a Meta connector created after {@code sinceEpochSeconds}
     * and run each through the SAME normalize→route→submit pipeline the webhook
     * uses. Reusing that pipeline is what makes the poller dedup-safe alongside
     * realtime delivery (same lead → same synthesized user → the existing
     * existsByAudienceIdAndUserId guard drops the duplicate, no extra row, no
     * re-fired workflow).
     *
     * Throws (via the strategy) if Meta returns an error — the caller keeps the
     * cursor where it was so the leads are retried on the next poll, and should
     * surface the failure (log + Sentry alert). This method does NOT itself write
     * connection_status; the scheduled job / manual endpoint own that.
     *
     * @return {@link PollResult} with the count fetched, whether the page cap cut
     *         the pull short (caller must not advance the cursor if truncated), and
     *         the newest lead id (for the caller's targeted cursor write).
     */
    public PollResult pollMetaConnector(FormWebhookConnector connector, long sinceEpochSeconds,
            int maxPages) {
        MetaLeadAdsStrategy.LeadPullResult pull =
                metaLeadAdsStrategy.fetchLeadsSince(connector, sinceEpochSeconds, maxPages);
        List<NormalizedLeadData> leads = pull.leads();
        for (NormalizedLeadData lead : leads) {
            try {
                submitNormalizedLead(lead, connector);
            } catch (Exception e) {
                log.error("Failed to submit polled lead {} from connector {}",
                        lead.getPlatformLeadId(), connector.getId(), e);
            }
        }
        // Meta returns /leads newest-first, so data[0] is the most recent. The caller
        // persists this via a targeted update (never a full-entity save that could
        // clobber another scheduler's concurrent write to this row).
        String newestLeadId = leads.isEmpty() ? null : leads.get(0).getPlatformLeadId();
        if (!leads.isEmpty()) {
            log.info("Poll ingested {} lead(s) for connector {} (form {})",
                    leads.size(), connector.getId(), connector.getPlatformFormId());
        }
        return new PollResult(leads.size(), pull.truncated(), newestLeadId);
    }

    /** Outcome of a poll: count fetched, whether the page cap cut it short (older
     *  leads remain — caller keeps its cursor so they're retried), and the newest
     *  lead id for the caller's targeted cursor write. */
    public record PollResult(int fetched, boolean truncated, String newestLeadId) {}

    // Note: @Transactional omitted intentionally — self-invocation from @Async bypasses AOP.
    // audienceService.submitLeadFromFormWebhook() is itself @Transactional.
    private void submitNormalizedLead(NormalizedLeadData lead, FormWebhookConnector connector) {
        // A campaign route (Google) wins; otherwise resolve the connector's routing rules.
        String audienceId = StringUtils.hasText(lead.getRoutedAudienceId())
                ? lead.getRoutedAudienceId()
                : resolveAudience(lead, connector);
        if (audienceId == null) {
            log.info("No matching audience for lead {} — discarded per no_match_action",
                    lead.getPlatformLeadId());
            return;
        }

        // Build ProcessedFormDataDTO for AudienceService
        Map<String, String> formFields = new LinkedHashMap<>(lead.getFields());
        // Ensure standard keys are in formFields
        if (StringUtils.hasText(lead.getEmail())) formFields.put("email", lead.getEmail());
        if (StringUtils.hasText(lead.getPhone())) formFields.put("phoneNumber", lead.getPhone());
        if (StringUtils.hasText(lead.getFullName())) formFields.put("fullName", lead.getFullName());

        // Compose Full Name from first/last (when the form has them separately)
        // before merging connector defaults so the form value always wins.
        leadEnricher.composeFullName(formFields);
        leadEnricher.mergeDefaults(formFields, connector.getDefaultValuesJson());

        Map<String, String> metadata = new LinkedHashMap<>();
        metadata.put("platform_lead_id", lead.getPlatformLeadId() != null ? lead.getPlatformLeadId() : "");
        metadata.put("source_type", lead.getSourceType() != null ? lead.getSourceType() : "");
        metadata.put("is_test", String.valueOf(lead.isTestLead()));
        // Campaign attribution — AudienceService stores source_id on the lead and the
        // utm_* keys as a utm_attribution row.
        if (StringUtils.hasText(lead.getCampaignId())) metadata.put("source_id", lead.getCampaignId());
        if (lead.getUtmParams() != null) metadata.putAll(lead.getUtmParams());

        ProcessedFormDataDTO processedData = ProcessedFormDataDTO.builder()
                .email(lead.getEmail())
                .fullName(lead.getFullName())
                .phone(lead.getPhone())
                .formFields(formFields)
                .metadata(metadata)
                .build();

        audienceService.submitLeadFromFormWebhook(audienceId, processedData, connector.getVendor());
        log.info("Lead {} submitted to audience {} via {}", lead.getPlatformLeadId(),
                audienceId, connector.getVendor());
    }

    /**
     * Evaluate routing rules JSON against the lead's fields to find the target audience.
     * Falls back to connector.audienceId if no rules match.
     *
     * Routing rules format:
     * {
     *   "rules": [
     *     {
     *       "priority": 1,
     *       "conditions": [{"field_key":"course","operator":"EQUALS","value":"Math"}],
     *       "condition_logic": "AND",
     *       "target_audience_id": "uuid"
     *     }
     *   ],
     *   "default_audience_id": "uuid",
     *   "no_match_action": "USE_DEFAULT"  // or "DISCARD"
     * }
     */
    private String resolveAudience(NormalizedLeadData lead, FormWebhookConnector connector) {
        String rulesJson = connector.getRoutingRulesJson();
        if (!StringUtils.hasText(rulesJson)) {
            return connector.getAudienceId();
        }

        try {
            JsonNode root = objectMapper.readTree(rulesJson);
            JsonNode rules = root.path("rules");

            // Sort by priority ascending
            List<JsonNode> sortedRules = new ArrayList<>();
            rules.forEach(sortedRules::add);
            sortedRules.sort(Comparator.comparingInt(r -> r.path("priority").asInt(Integer.MAX_VALUE)));

            Map<String, String> fields = lead.getFields();

            for (JsonNode rule : sortedRules) {
                if (evaluateRule(rule, fields)) {
                    return rule.path("target_audience_id").asText(null);
                }
            }

            // No rule matched
            String noMatchAction = root.path("no_match_action").asText("USE_DEFAULT");
            if ("DISCARD".equals(noMatchAction)) return null;
            return root.path("default_audience_id").asText(connector.getAudienceId());
        } catch (Exception e) {
            log.error("Failed to evaluate routing rules, using default audience", e);
            return connector.getAudienceId();
        }
    }

    private boolean evaluateRule(JsonNode rule, Map<String, String> fields) {
        JsonNode conditions = rule.path("conditions");
        String logic = rule.path("condition_logic").asText("AND");

        List<Boolean> results = new ArrayList<>();
        for (JsonNode cond : conditions) {
            results.add(evaluateCondition(cond, fields));
        }

        // Empty conditions never match — prevents misconfigured rules from catching all leads
        if (results.isEmpty()) return false;

        if ("OR".equals(logic)) return results.stream().anyMatch(Boolean::booleanValue);
        return results.stream().allMatch(Boolean::booleanValue);
    }

    private boolean evaluateCondition(JsonNode cond, Map<String, String> fields) {
        String fieldKey = cond.path("field_key").asText(null);
        String operator = cond.path("operator").asText("EQUALS");
        String expected = cond.path("value").asText(null);

        if (fieldKey == null || expected == null) return false;
        String actual = fields.getOrDefault(fieldKey, "");

        return switch (operator) {
            case "EQUALS" -> expected.equalsIgnoreCase(actual);
            case "NOT_EQUALS" -> !expected.equalsIgnoreCase(actual);
            case "CONTAINS" -> actual.toLowerCase().contains(expected.toLowerCase());
            case "NOT_CONTAINS" -> !actual.toLowerCase().contains(expected.toLowerCase());
            case "STARTS_WITH" -> actual.toLowerCase().startsWith(expected.toLowerCase());
            default -> false;
        };
    }

    // ── OAuth / connector management ──────────────────────────────────────────

    /**
     * Save a new ad platform connector after OAuth completes.
     * Called from MetaOAuthController after the user selects a page and configures mapping.
     */
    @Transactional
    public FormWebhookConnector saveConnector(FormWebhookConnector connector,
            OAuthTokenResult tokenResult) {
        if (tokenResult != null && StringUtils.hasText(tokenResult.getAccessToken())) {
            String encrypted = tokenEncryptionService.encrypt(tokenResult.getAccessToken());
            connector.setOauthAccessTokenEnc(encrypted);
            connector.setOauthTokenExpiresAt(tokenResult.getExpiresAt());
        }
        connector.setConnectionStatus("ACTIVE");
        FormWebhookConnector saved = connectorRepository.save(connector);
        log.info("Saved ad platform connector id={} vendor={}", saved.getId(), saved.getVendor());
        return saved;
    }

    /**
     * Refresh an expiring Meta token.
     */
    @Transactional
    public void refreshMetaToken(FormWebhookConnector connector) {
        if (connector.getOauthAccessTokenEnc() == null) return;
        try {
            String currentToken = tokenEncryptionService.decrypt(connector.getOauthAccessTokenEnc());
            AdPlatformStrategy strategy = getStrategy(connector.getVendor());
            Optional<OAuthTokenResult> result = strategy.refreshToken(connector, currentToken);
            if (result.isPresent()) {
                OAuthTokenResult r = result.get();
                connector.setOauthAccessTokenEnc(tokenEncryptionService.encrypt(r.getAccessToken()));
                connector.setOauthTokenExpiresAt(r.getExpiresAt());
                connectorRepository.save(connector);
                log.info("Refreshed token for connector {}", connector.getId());
            } else {
                // Graph-side refresh failed (the strategy caught the error and
                // returned empty). This used to be swallowed silently — the token
                // would keep failing to refresh every night until it actually
                // expired and leads (webhook AND poll) quietly stopped. Surface it.
                log.error("Meta token refresh returned no token for connector {} — "
                        + "token may be revoked/invalid", connector.getId());
                Map<String, String> tags = new LinkedHashMap<>();
                tags.put("feature", "ad_platform_connector");
                tags.put("vendor", connector.getVendor());
                tags.put("connector_id", connector.getId());
                if (connector.getInstituteId() != null) {
                    tags.put("institute_id", connector.getInstituteId());
                }
                SentryLogger.logWarning(
                        "Meta token refresh failed (no token returned) for connector "
                                + connector.getId() + " institute=" + connector.getInstituteId()
                                + " — leads will stop when the current token expires.",
                        tags);
            }
        } catch (Exception e) {
            log.error("Failed to refresh token for connector {}", connector.getId(), e);
            connector.setConnectionStatus("TOKEN_EXPIRED");
            connectorRepository.save(connector);
        }
    }
}
