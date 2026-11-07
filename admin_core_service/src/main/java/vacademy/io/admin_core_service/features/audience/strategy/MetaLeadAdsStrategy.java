package vacademy.io.admin_core_service.features.audience.strategy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.netty.channel.ChannelOption;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.http.MediaType;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.reactive.function.BodyInserters;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.netty.http.client.HttpClient;
import vacademy.io.admin_core_service.features.audience.dto.NormalizedLeadData;
import vacademy.io.admin_core_service.features.audience.dto.OAuthTokenResult;
import vacademy.io.admin_core_service.features.audience.dto.PlatformFormField;
import vacademy.io.admin_core_service.features.audience.dto.WebhookSubscriptionResult;
import vacademy.io.admin_core_service.features.audience.entity.FormWebhookConnector;
import vacademy.io.admin_core_service.features.audience.service.TokenEncryptionService;
import vacademy.io.common.exceptions.VacademyException;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.*;
import java.util.function.Predicate;

/**
 * Ad platform strategy for Meta Lead Ads (Facebook + Instagram).
 *
 * Webhook flow:
 * 1. GET  → hub.challenge verification (handled at controller level using this strategy)
 * 2. POST → verify X-Hub-Signature-256, parse leadgen events, fetch full lead from Graph API
 *
 * OAuth flow:
 * 1. Redirect user to Meta OAuth URL
 * 2. Exchange code for short-lived token
 * 3. Exchange short-lived for long-lived (~60 days) token
 * 4. Fetch user's pages and let them pick which page to subscribe
 * 5. Get Page access token and subscribe page to lead webhooks
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class MetaLeadAdsStrategy implements AdPlatformStrategy {

    private static final String VENDOR_CODE = "META_LEAD_ADS";
    private static final String GRAPH_API_BASE = "https://graph.facebook.com/v21.0";
    private static final String META_OAUTH_BASE = "https://www.facebook.com/v21.0/dialog/oauth";
    private static final String META_TOKEN_URL = "https://graph.facebook.com/v21.0/oauth/access_token";
    private static final String HMAC_SHA256 = "HmacSHA256";

    // Field-name candidates for the identity fields we lift out of a lead.
    // ALIASES are matched whole (case-insensitively) and in order, so the canonical
    // Meta key always wins when a form happens to carry both. TOKENS are the looser
    // substring fallback for author-renamed questions ("Your Phone", "mobile no").
    private static final List<String> PHONE_ALIASES = List.of(
            "phone_number", "phone", "mobile_number", "mobile", "contact_number",
            "whatsapp_number", "phone_no", "contact_no");
    private static final List<String> PHONE_TOKENS = List.of("phone", "mobile", "whatsapp");

    private static final List<String> EMAIL_ALIASES = List.of(
            "email", "email_address", "e-mail", "mail_id", "email_id");
    private static final List<String> EMAIL_TOKENS = List.of("email", "e-mail");

    // Name is alias-only. Live forms ask "name_of_school_/_organisation?" and
    // "school_/_organisation_name", so a substring match on "name" would file the
    // school as the lead's own name. Building a name out of first/last is NOT done
    // here either — LeadEnricher.composeFullName already owns that downstream, and
    // a second implementation would suppress its write to the other name aliases.
    private static final List<String> NAME_ALIASES = List.of(
            "full_name", "full name", "name", "your_name");

    // A TOKEN-matched key must also carry a value of the right shape, so a question
    // like "do_you_have_a_whatsapp_number?" answered "Yes" can never be filed as the
    // lead's phone. Aliases are exempt: an exact "phone_number" is trusted as-is,
    // which keeps junk like Meta's own "<test lead: dummy data>" behaving as before.
    private static final Predicate<String> PHONE_SHAPED =
            v -> v.replaceAll("[^0-9]", "").length() >= 7;
    private static final Predicate<String> EMAIL_SHAPED = v -> v.contains("@");

    // Permissions needed for Lead Ads. business_management + pages_manage_ads are
    // requested so the connecting account can be recognised as a full Page admin
    // (and so the app can register as a leadgen CRM); the actual blocker if missing
    // is the MANAGE page task, surfaced separately at page-selection time.
    private static final String OAUTH_SCOPE =
            "pages_show_list,pages_read_engagement,leads_retrieval,pages_manage_metadata,pages_manage_ads,business_management";

    /** Page task Meta requires to subscribe a Page to lead webhooks (Full control). */
    private static final String MANAGE_TASK = "MANAGE";

    /** Shown when a Page can be selected but its connected account can't receive leads. */
    private static final String NEEDS_FULL_CONTROL_MSG =
            "This account has Leads access to this Page but not Full control, which Facebook "
            + "requires to auto-sync leads. Ask a Page admin to grant your account Full control "
            + "(Business Settings → Pages → People → Full control), then reconnect.";

    @Value("${meta.app.id:}")
    private String appId;

    @Value("${meta.app.secret:}")
    private String appSecret;

    @Value("${meta.oauth.redirect.uri:}")
    private String defaultRedirectUri;

    @Value("${meta.webhook.verify.token:}")
    private String configuredVerifyToken;

    /**
     * Facebook Login for Business Configuration ID. When set, the OAuth dialog uses
     * this configuration (which defines the requested permissions + the Page-asset
     * selection step) instead of a raw scope list. This is what makes regular
     * (non-app-role) users able to grant Page access AND makes the selected Pages
     * enumerable from the token's granular_scopes. Empty = legacy scope-based flow.
     */
    @Value("${meta.login.config.id:}")
    private String loginConfigId;

    /**
     * Master switch for the config-based Login-for-Business (Path 2) flow. When
     * false, the classic scope-based OAuth (Path 1) is used even if a config id is
     * present — so we can keep {@code META_LOGIN_CONFIG_ID} stored while temporarily
     * reverting to Path 1 (e.g. while pages_manage_ads App Review is pending), then
     * flip back to Path 2 by setting it true again. Default true.
     */
    @Value("${meta.login.config.enabled:true}")
    private boolean loginConfigEnabled;

    private final WebClient.Builder webClientBuilder;
    private final ObjectMapper objectMapper;
    private final TokenEncryptionService tokenEncryptionService;

    /**
     * WebClient with explicit connect + response timeouts. Reactor Netty applies no
     * read/response timeout by default, so a half-open graph.facebook.com socket
     * would make a blocking .block() hang forever — which is especially dangerous
     * for the scheduled poller (it would wedge the shared scheduler thread and stop
     * ALL Meta polling until the pod restarts). The 20s response timeout surfaces as
     * an exception the callers already handle (poll → per-connector catch preserves
     * the cursor for retry).
     */
    private WebClient webClient;

    @jakarta.annotation.PostConstruct
    void initWebClient() {
        HttpClient httpClient = HttpClient.create()
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 10000)
                .responseTimeout(Duration.ofSeconds(20));
        this.webClient = webClientBuilder.clone()
                .clientConnector(new ReactorClientHttpConnector(httpClient))
                .build();
    }

    @Override
    public String getVendorCode() {
        return VENDOR_CODE;
    }

    // ── Webhook verification ─────────────────────────────────────────────────

    @Override
    public boolean verifyWebhookSignature(String signatureHeader, String rawBody) {
        if (signatureHeader == null || !signatureHeader.startsWith("sha256=")) {
            log.warn("Missing or malformed X-Hub-Signature-256 header");
            return false;
        }
        String receivedSig = signatureHeader.substring("sha256=".length());
        try {
            Mac mac = Mac.getInstance(HMAC_SHA256);
            mac.init(new SecretKeySpec(appSecret.getBytes(StandardCharsets.UTF_8), HMAC_SHA256));
            byte[] digest = mac.doFinal(rawBody.getBytes(StandardCharsets.UTF_8));
            String expected = bytesToHex(digest);
            return expected.equalsIgnoreCase(receivedSig);
        } catch (Exception e) {
            log.error("Meta HMAC-SHA256 verification failed", e);
            return false;
        }
    }

    @Override
    public Optional<String> handleVerificationChallenge(Map<String, String> queryParams,
            String ignoredParam) {
        String mode = queryParams.get("hub.mode");
        String incomingToken = queryParams.get("hub.verify_token");
        String challenge = queryParams.get("hub.challenge");
        // Compare incoming token against the app-configured secret, not against itself
        if ("subscribe".equals(mode)
                && configuredVerifyToken != null
                && !configuredVerifyToken.isBlank()
                && configuredVerifyToken.equals(incomingToken)) {
            return Optional.ofNullable(challenge);
        }
        log.warn("Meta hub.challenge failed: mode={}, tokenMatch={}", mode,
                configuredVerifyToken != null && configuredVerifyToken.equals(incomingToken));
        return Optional.empty();
    }

    // ── Lead extraction ──────────────────────────────────────────────────────

    @Override
    public List<NormalizedLeadData> extractAndFetchLeads(String rawBody,
            FormWebhookConnector connector) {
        List<NormalizedLeadData> results = new ArrayList<>();
        try {
            JsonNode root = objectMapper.readTree(rawBody);
            // Meta payload structure: {"object":"page","entry":[{"changes":[{"field":"leadgen","value":{...}}]}]}
            JsonNode entry = root.path("entry");
            for (JsonNode e : entry) {
                for (JsonNode change : e.path("changes")) {
                    if (!"leadgen".equals(change.path("field").asText())) continue;
                    JsonNode val = change.path("value");
                    String leadgenId = val.path("leadgen_id").asText(null);
                    String formId = val.path("form_id").asText(null);
                    if (leadgenId == null) continue;
                    try {
                        NormalizedLeadData lead = fetchLeadFromGraph(leadgenId, connector);
                        if (lead != null) results.add(lead);
                    } catch (Exception ex) {
                        log.error("Failed to fetch Meta lead {} from form {}", leadgenId, formId, ex);
                    }
                }
            }
        } catch (Exception e) {
            log.error("Failed to parse Meta webhook payload", e);
        }
        return results;
    }

    private NormalizedLeadData fetchLeadFromGraph(String leadgenId,
            FormWebhookConnector connector) {
        if (connector.getOauthAccessTokenEnc() == null) {
            log.error("No access token for connector {}", connector.getId());
            return null;
        }
        String pageToken = tokenEncryptionService.decrypt(connector.getOauthAccessTokenEnc());
        String url = GRAPH_API_BASE + "/" + leadgenId + "?access_token=" + pageToken
                + "&fields=field_data,created_time,ad_id,form_id";

        JsonNode leadNode = webClient
                .get().uri(url)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .block();

        if (leadNode == null) return null;
        return buildNormalizedLead(leadgenId, leadNode, connector);
    }

    /**
     * Build a NormalizedLeadData from a single Graph lead node. Shared by the
     * webhook path (one lead fetched by leadgen_id) and the poller (each lead from
     * the /{form_id}/leads edge) so BOTH normalize identically — same phone
     * normalization, same platformLeadId. That identical normalization is exactly
     * what makes running the poller alongside the webhook dedup-safe: the same
     * person resolves to the same synthesized user, so the existing
     * existsByAudienceIdAndUserId guard collapses the duplicate with no extra row.
     */
    private NormalizedLeadData buildNormalizedLead(String platformLeadId, JsonNode leadNode,
            FormWebhookConnector connector) {
        Map<String, String> fields = new LinkedHashMap<>();
        for (JsonNode fieldData : leadNode.path("field_data")) {
            String name = fieldData.path("name").asText();
            String value = fieldData.path("values").path(0).asText("");
            fields.put(name, value);
        }

        // Extract email/phone/name from raw fields BEFORE mapping transforms the keys.
        // Meta's canonical keys (EMAIL, FULL_NAME, PHONE_NUMBER) are only a
        // convention — the form author renames them freely, and a form whose phone
        // question is called "phone" used to resolve to null here, so the lead was
        // created with no mobile number even though the answer still reached
        // custom_field_values through the connector mapping. Resolve by alias, then
        // by substring, the way GenericFormWebhookStrategy already does.
        Map.Entry<String, String> emailField = findField(fields, EMAIL_ALIASES, EMAIL_TOKENS, EMAIL_SHAPED);
        Map.Entry<String, String> phoneField = findField(fields, PHONE_ALIASES, PHONE_TOKENS, PHONE_SHAPED);
        Map.Entry<String, String> nameField = findField(fields, NAME_ALIASES, null, null);

        String rawEmail = emailField != null ? emailField.getValue() : null;
        String rawPhone = phoneField != null ? phoneField.getValue() : null;
        String rawName = nameField != null ? nameField.getValue() : null;

        // Normalize phone: Meta Graph API returns "+919876543210" — strip non-digits,
        // prepend country code 91 for 10-digit Indian numbers. Rewrite the key that
        // actually matched, otherwise the raw "+91…" leaks through to the stored
        // custom field value while the user record carries the normalized one.
        if (rawPhone != null && !rawPhone.isBlank()) {
            String cleaned = rawPhone.replaceAll("[^0-9]", "");
            String normalizedPhone = cleaned.length() == 10 ? "91" + cleaned : cleaned;
            rawPhone = normalizedPhone;
            String phoneKey = phoneField.getKey();
            fields.replaceAll((k, v) -> k.equalsIgnoreCase(phoneKey) ? normalizedPhone : v);
        }

        // Apply field mapping from connector (transforms keys for audience custom fields)
        Map<String, String> mappedFields = applyFieldMapping(fields, connector.getFieldMappingJson());

        return NormalizedLeadData.builder()
                .platformLeadId(platformLeadId)
                .fields(mappedFields)
                .email(rawEmail)
                .phone(rawPhone)
                .fullName(rawName)
                .sourceType(connector.getProducesSourceType() != null
                        ? connector.getProducesSourceType() : "FACEBOOK_ADS")
                .targetAudienceId(connector.getAudienceId())
                .testLead(false)
                .build();
    }

    /**
     * PULL leads for a form created after {@code sinceEpochSeconds} (Meta
     * time_created filter, unix seconds). This is the poller's data source. It
     * authorizes off the stored Page token's own leads_retrieval permission, NOT
     * the CRM push assignment in Lead Access Manager, so it keeps working for pages
     * where realtime webhook delivery is blocked ("CRM access revoked").
     *
     * Follows paging.next up to {@code maxPages}; if the cap is hit with more pages
     * remaining the result is flagged {@code truncated} so the caller keeps its
     * cursor (Meta returns newest-first, so the un-fetched pages are the OLDEST
     * leads — advancing past them would strand them). Throws VacademyException if
     * Meta returns an error (e.g. token expired/revoked); the caller keeps the
     * cursor for retry and should surface the failure (log + Sentry alert).
     */
    public LeadPullResult fetchLeadsSince(FormWebhookConnector connector,
            long sinceEpochSeconds, int maxPages) {
        List<NormalizedLeadData> out = new ArrayList<>();
        if (connector.getOauthAccessTokenEnc() == null) {
            log.error("No access token for connector {} — cannot poll leads", connector.getId());
            return new LeadPullResult(out, false);
        }
        String formId = connector.getPlatformFormId();
        if (formId == null || formId.isBlank()) {
            log.warn("Connector {} has no platform_form_id — cannot poll leads", connector.getId());
            return new LeadPullResult(out, false);
        }
        String pageToken = tokenEncryptionService.decrypt(connector.getOauthAccessTokenEnc());

        String filter = "[{\"field\":\"time_created\",\"operator\":\"GREATER_THAN\",\"value\":"
                + sinceEpochSeconds + "}]";
        // NOTE: build a URI ourselves and hand WebClient a java.net.URI (not a String).
        // Passing a String to .uri(...) runs it through DefaultUriBuilderFactory, which
        // RE-encodes our already-percent-encoded 'filtering' value (%5B → %255B). Meta
        // then can't parse the filter, silently ignores it, and returns EVERY lead. A
        // pre-built URI is sent verbatim — single-encoded — so the time filter sticks.
        String url = GRAPH_API_BASE + "/" + formId + "/leads"
                + "?access_token=" + pageToken
                + "&fields=id,created_time,field_data,ad_id,form_id"
                + "&limit=100"
                + "&filtering=" + URLEncoder.encode(filter, StandardCharsets.UTF_8);

        int pages = 0;
        while (url != null && !url.isBlank() && pages < maxPages) {
            final URI pageUri = URI.create(url);
            JsonNode response = webClient
                    .get().uri(pageUri)
                    .exchangeToMono(resp -> resp.bodyToMono(JsonNode.class))
                    .block();
            pages++;
            if (response == null) break;
            if (response.has("error")) {
                String msg = response.path("error").path("message").asText("unknown error");
                throw new VacademyException("Meta lead poll failed for form " + formId + ": " + msg);
            }
            for (JsonNode leadNode : response.path("data")) {
                String leadId = leadNode.path("id").asText(null);
                if (leadId == null) continue;
                try {
                    out.add(buildNormalizedLead(leadId, leadNode, connector));
                } catch (Exception ex) {
                    log.error("Failed to normalize polled lead {} for connector {}",
                            leadId, connector.getId(), ex);
                }
            }
            // Meta's paging.next is a full, already-encoded URL — also handed to
            // WebClient as a URI so it isn't re-encoded.
            url = response.path("paging").path("next").asText(null);
        }
        // Truncated = we stopped because of the page cap while Meta still had a next
        // page. Meta returns /leads newest-first, so the UN-fetched pages are the
        // OLDEST leads — the caller must NOT advance its cursor past them, or they'd
        // be stranded forever (a GREATER_THAN-only filter can never reach back to them).
        boolean truncated = pages >= maxPages && url != null && !url.isBlank();
        if (truncated) {
            log.warn("Meta poll for connector {} hit page cap {} — {} lead(s) fetched, older "
                    + "leads remain; cursor will NOT advance so they're retried",
                    connector.getId(), maxPages, out.size());
        }
        return new LeadPullResult(out, truncated);
    }

    /** Result of a lead pull: the normalized leads plus whether the page cap cut it
     *  short (older leads remain unfetched — see fetchLeadsSince). */
    public record LeadPullResult(List<NormalizedLeadData> leads, boolean truncated) {}

    // ── OAuth flow ───────────────────────────────────────────────────────────

    @Override
    public String buildOAuthUrl(String stateToken, String redirectUri) {
        String uri = redirectUri != null ? redirectUri : defaultRedirectUri;
        try {
            String base = META_OAUTH_BASE
                    + "?client_id=" + appId
                    + "&redirect_uri=" + URLEncoder.encode(uri, StandardCharsets.UTF_8)
                    + "&state=" + URLEncoder.encode(stateToken, StandardCharsets.UTF_8)
                    + "&response_type=code";
            if (loginConfigEnabled && loginConfigId != null && !loginConfigId.isBlank()) {
                // Facebook Login for Business: the Configuration defines the requested
                // permissions and the Page-asset selection. config_id makes Meta return
                // the selected Pages as asset-scoped grants (readable from the token's
                // granular_scopes) — the only reliable way to enumerate business-owned
                // Pages, which /me/accounts omits for regular users. No scope param: the
                // configuration owns the permission list.
                return base
                        + "&config_id=" + URLEncoder.encode(loginConfigId, StandardCharsets.UTF_8)
                        + "&override_default_response_type=true";
            }
            // Legacy classic-scope flow (no Configuration set).
            return base + "&scope=" + URLEncoder.encode(OAUTH_SCOPE, StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new VacademyException("Failed to build Meta OAuth URL: " + e.getMessage());
        }
    }

    @Override
    public OAuthTokenResult exchangeCodeForToken(String code, String redirectUri) {
        // Step 1: exchange code → access token
        String initial = exchangeCodeForShortLivedToken(code, redirectUri);

        // Step 2: upgrade to a long-lived (~60 day) token via fb_exchange_token.
        try {
            return exchangeForLongLivedToken(initial);
        } catch (Exception e) {
            // System-user (Business Login / Tech-Provider config) tokens are already
            // long-lived and do NOT support the fb_exchange_token upgrade — it 4xxs.
            // In config-based mode, fall back to the initial token; in the classic scope
            // flow a long-lived failure is a genuine error, so rethrow there.
            if (!loginConfigEnabled || loginConfigId == null || loginConfigId.isBlank()) throw e;
            log.warn("Long-lived exchange failed with config_id set (system-user token?); "
                    + "using the initial token: {}", e.getMessage());
            return OAuthTokenResult.builder()
                    .accessToken(initial)
                    .expiresAt(LocalDateTime.now().plusDays(60))
                    .build();
        }
    }

    private String exchangeCodeForShortLivedToken(String code, String redirectUri) {
        // POST to keep client_secret and code out of server access logs
        MultiValueMap<String, String> params = new LinkedMultiValueMap<>();
        params.add("client_id", appId);
        params.add("client_secret", appSecret);
        params.add("redirect_uri", redirectUri);
        params.add("code", code);

        JsonNode response = webClient
                .post().uri(META_TOKEN_URL)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body(BodyInserters.fromFormData(params))
                .retrieve()
                .bodyToMono(JsonNode.class)
                .block();

        if (response == null || !response.has("access_token")) {
            throw new VacademyException("Failed to obtain Meta short-lived token");
        }
        return response.path("access_token").asText();
    }

    private OAuthTokenResult exchangeForLongLivedToken(String shortLivedToken) {
        // POST to keep client_secret out of server access logs
        MultiValueMap<String, String> params = new LinkedMultiValueMap<>();
        params.add("grant_type", "fb_exchange_token");
        params.add("client_id", appId);
        params.add("client_secret", appSecret);
        params.add("fb_exchange_token", shortLivedToken);

        JsonNode response = webClient
                .post().uri(META_TOKEN_URL)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body(BodyInserters.fromFormData(params))
                .retrieve()
                .bodyToMono(JsonNode.class)
                .block();

        if (response == null || !response.has("access_token")) {
            throw new VacademyException("Failed to obtain Meta long-lived token");
        }

        String token = response.path("access_token").asText();
        long expiresInSeconds = response.path("expires_in").asLong(5184000L); // default 60 days
        LocalDateTime expiresAt = LocalDateTime.now().plusSeconds(expiresInSeconds);

        return OAuthTokenResult.builder()
                .accessToken(token)
                .expiresAt(expiresAt)
                .build();
    }

    @Override
    public List<Map<String, String>> listConnectableAccounts(String accessToken) {
        // tasks tells us whether the connecting user is a full Page admin. The MANAGE
        // task is required to POST /{page}/subscribed_apps; an account with only
        // MANAGE_LEADS/ADVERTISE can read leads but the subscribe fails with #200,
        // so the connector would silently never receive leads. We surface this to
        // the UI (has_manage / tasks) so it can warn before the admin connects.
        String url = GRAPH_API_BASE + "/me/accounts?access_token=" + accessToken
                + "&fields=id,name,access_token,tasks&limit=200";

        JsonNode response = webClient
                .get().uri(url)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .block();

        List<Map<String, String>> pages = new ArrayList<>();
        if (response == null) return pages;

        for (JsonNode page : response.path("data")) {
            Map<String, String> p = new LinkedHashMap<>();
            p.put("id", page.path("id").asText());
            p.put("name", page.path("name").asText());
            p.put("access_token", page.path("access_token").asText());

            List<String> tasks = new ArrayList<>();
            for (JsonNode t : page.path("tasks")) tasks.add(t.asText());
            p.put("tasks", String.join(",", tasks));
            p.put("has_manage", String.valueOf(tasks.contains(MANAGE_TASK)));

            pages.add(p);
        }
        return pages;
    }

    /**
     * Page IDs the connecting user granted this app, read from the token's
     * granular_scopes.target_ids (asset-scoped grants). This is how config_id-based
     * Facebook Login for Business exposes the Pages the user selected — those Pages
     * do NOT appear in /me/accounts for regular users when they're business-owned.
     * Requires the app secret (to build the debug_token app access token).
     */
    public List<String> listGrantedPageIds(String userToken) {
        List<String> ids = new ArrayList<>();
        if (appSecret == null || appSecret.isBlank()) return ids;
        // App access token = "{app-id}|{app-secret}"; the pipe is pre-encoded as %7C so
        // URI.create accepts it and WebClient sends it verbatim (no double-encoding).
        String url = GRAPH_API_BASE + "/debug_token"
                + "?input_token=" + userToken
                + "&access_token=" + appId + "%7C" + appSecret;
        JsonNode resp;
        try {
            resp = webClient.get().uri(URI.create(url))
                    .exchangeToMono(r -> r.bodyToMono(JsonNode.class))
                    .block();
        } catch (Exception e) {
            log.warn("debug_token call failed while reading granted page IDs: {}", e.getMessage());
            return ids;
        }
        if (resp == null || resp.has("error")) return ids;
        for (JsonNode scope : resp.path("data").path("granular_scopes")) {
            for (JsonNode target : scope.path("target_ids")) {
                String id = target.asText(null);
                if (id != null && !id.isBlank() && !ids.contains(id)) ids.add(id);
            }
        }
        return ids;
    }

    /**
     * Discover the Pages this user can connect, merging two sources so it works for
     * BOTH classic logins (app-role users) and Login-for-Business grants:
     *   1. GET /me/accounts — returns Pages for app-role/classic users (with tasks).
     *   2. Pages granted via Login for Business — enumerated from the token's
     *      granular_scopes.target_ids and fetched directly ({@link #fetchPageById}),
     *      because business-owned Pages are omitted from /me/accounts for regular users.
     * Deduplicated by Page id. Each entry carries id, name, access_token (+ tasks when known).
     */
    public List<Map<String, String>> discoverConnectablePages(String userToken) {
        List<Map<String, String>> pages = new ArrayList<>();
        // /me/accounts throws for tokens that don't support it (e.g. a system-user
        // token has no personal Pages edge) — don't let that abort discovery; the
        // granular-scopes path below is the one that matters for Login for Business.
        try {
            pages.addAll(listConnectableAccounts(userToken));
        } catch (Exception e) {
            log.warn("/me/accounts enumeration failed (expected for system-user tokens): {}",
                    e.getMessage());
        }
        Set<String> seen = new HashSet<>();
        for (Map<String, String> p : pages) seen.add(p.get("id"));

        for (String pageId : listGrantedPageIds(userToken)) {
            if (pageId == null || seen.contains(pageId)) continue;
            try {
                Map<String, String> page = fetchPageById(pageId, userToken); // id, name, access_token
                // We can't read tasks on a Page node directly. The user granted
                // pages_manage_metadata and selected this Page, so assume MANAGE; the
                // page-subscribe step is the real gate and reports #200 if that's wrong.
                page.put("tasks", MANAGE_TASK);
                page.put("has_manage", "true");
                pages.add(page);
                seen.add(pageId);
            } catch (Exception e) {
                log.warn("Login-for-Business page {} could not be resolved: {}",
                        pageId, e.getMessage());
            }
        }
        return pages;
    }

    /**
     * Fetch just the display name of a single Lead Gen Form. Used by the
     * one-time backfill endpoint that populates platform_form_name on
     * connectors created before that column existed. Returns null on any
     * failure (form deleted, token expired, etc.) so the caller can skip
     * gracefully without aborting the whole batch.
     */
    public String fetchFormName(String formId, String pageAccessToken) {
        try {
            String url = GRAPH_API_BASE + "/" + formId
                    + "?access_token=" + pageAccessToken
                    + "&fields=name";
            JsonNode response = webClient
                    .get().uri(url)
                    .retrieve()
                    .bodyToMono(JsonNode.class)
                    .block();
            if (response == null) return null;
            String name = response.path("name").asText(null);
            return (name == null || name.isBlank()) ? null : name;
        } catch (Exception e) {
            log.warn("Failed to fetch form name for formId={}: {}", formId, e.getMessage());
            return null;
        }
    }

    /**
     * Fetch a single Page directly by its ID using the connecting USER token,
     * returning {id, name, access_token} (the Page access token).
     *
     * Fallback for when {@code /me/accounts} doesn't enumerate the Page — which
     * happens for business-owned Pages granted via Facebook Login for Business: they
     * only appear in /me/accounts for app-role users (testers/devs), not regular
     * users. The Page is still directly readable with pages_read_engagement, so the
     * admin supplies the Page ID (shown in Meta's connect dialog) and we resolve it.
     */
    public Map<String, String> fetchPageById(String pageId, String userToken) {
        String url = GRAPH_API_BASE + "/" + pageId
                + "?access_token=" + userToken
                + "&fields=id,name,access_token";
        JsonNode node;
        try {
            node = webClient.get().uri(url)
                    .exchangeToMono(resp -> resp.bodyToMono(JsonNode.class))
                    .block();
        } catch (Exception e) {
            throw new VacademyException("Couldn't reach Facebook to load that Page: " + e.getMessage());
        }
        if (node == null) {
            throw new VacademyException("No response from Facebook for Page " + pageId);
        }
        if (node.has("error")) {
            String msg = node.path("error").path("message").asText("unknown error");
            throw new VacademyException("Facebook couldn't load Page " + pageId + ": " + msg);
        }
        String token = node.path("access_token").asText(null);
        if (token == null || token.isBlank()) {
            throw new VacademyException("Facebook didn't return an access token for this Page. "
                    + "Make sure you granted this app access to the Page during login, and that "
                    + "you selected the correct Page ID.");
        }
        Map<String, String> page = new LinkedHashMap<>();
        page.put("id", node.path("id").asText(pageId));
        page.put("name", node.path("name").asText("Facebook Page"));
        page.put("access_token", token);
        return page;
    }

    /** Upper bound on leadgen_forms pages fetched for the form picker (100 forms per page). */
    private static final int MAX_FORM_LIST_PAGES = 20;

    /**
     * List all lead gen forms for a Facebook Page.
     * Returns [{id, name, status}] — no tokens exposed.
     *
     * Meta returns only 25 forms per page by default, newest first, so without
     * following paging.next a Page with many forms hides its OLDER forms from the
     * picker — including forms that live ads are still collecting leads on.
     */
    public List<Map<String, String>> listPageForms(String pageId, String pageAccessToken) {
        String url = GRAPH_API_BASE + "/" + pageId + "/leadgen_forms"
                + "?access_token=" + pageAccessToken
                + "&fields=id,name,status"
                + "&limit=100";

        List<Map<String, String>> forms = new ArrayList<>();
        int pages = 0;
        while (url != null && !url.isBlank() && pages < MAX_FORM_LIST_PAGES) {
            // Meta's paging.next is a full, already-encoded URL — hand WebClient a URI
            // so it isn't re-encoded.
            JsonNode response = webClient
                    .get().uri(URI.create(url))
                    .retrieve()
                    .bodyToMono(JsonNode.class)
                    .block();
            pages++;
            if (response == null) break;

            for (JsonNode form : response.path("data")) {
                Map<String, String> f = new LinkedHashMap<>();
                f.put("id", form.path("id").asText());
                f.put("name", form.path("name").asText("Unnamed Form"));
                f.put("status", form.path("status").asText("ACTIVE"));
                forms.add(f);
            }
            url = response.path("paging").path("next").asText(null);
        }
        if (pages >= MAX_FORM_LIST_PAGES && url != null && !url.isBlank()) {
            log.warn("Form list for page {} hit page cap {} — {} form(s) listed, older forms omitted",
                    pageId, MAX_FORM_LIST_PAGES, forms.size());
        }
        return forms;
    }

    @Override
    public List<PlatformFormField> fetchFormFields(String formId, String accessToken) {
        String url = GRAPH_API_BASE + "/" + formId + "?access_token=" + accessToken
                + "&fields=questions,name";

        JsonNode response = webClient
                .get().uri(url)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .block();

        List<PlatformFormField> fields = new ArrayList<>();
        if (response == null) return fields;

        for (JsonNode q : response.path("questions")) {
            String type = q.path("type").asText("TEXT");
            String key = q.path("key").asText(q.path("label").asText("").toLowerCase().replace(" ", "_"));
            String label = q.path("label").asText(key);
            fields.add(PlatformFormField.builder()
                    .key(key)
                    .label(label)
                    .type(type)
                    .standardField(!"CUSTOM".equals(type))
                    .build());
        }
        return fields;
    }

    @Override
    public WebhookSubscriptionResult subscribePageToWebhooks(FormWebhookConnector connector,
            String decryptedToken) {
        // Subscribe the page to leadgen webhook events.
        // NOTE: Graph returns the {"error":{...}} body with a 4xx for the common
        // failure (#200 — connecting account lacks the MANAGE/Full-control task),
        // so we use exchangeToMono to read the body on ANY status instead of
        // letting retrieve() throw and lose the reason.
        String pageId = connector.getPlatformPageId();
        String url = GRAPH_API_BASE + "/" + pageId + "/subscribed_apps"
                + "?subscribed_fields=leadgen"
                + "&access_token=" + decryptedToken;

        JsonNode response;
        try {
            response = webClient
                    .post().uri(url)
                    .exchangeToMono(resp -> resp.bodyToMono(JsonNode.class))
                    .block();
        } catch (Exception e) {
            log.error("Page subscription call failed for page {}: {}", pageId, e.getMessage());
            return WebhookSubscriptionResult.failure(null, e.getMessage(),
                    "Couldn't reach Facebook to link this Page. Try again, or reconnect.");
        }

        if (response != null && response.path("success").asBoolean(false)) {
            log.info("Successfully subscribed Meta page {} to leadgen webhooks", pageId);
            return WebhookSubscriptionResult.ok();
        }

        JsonNode err = response != null ? response.path("error") : null;
        String code = err != null ? err.path("code").asText(null) : null;
        String msg = err != null ? err.path("message").asText("Unknown error") : "No response from Facebook";
        String remediation = "200".equals(code)
                ? NEEDS_FULL_CONTROL_MSG
                : "Couldn't link this Page to Vacademy for lead delivery: " + msg;
        log.warn("Page subscription FAILED for page {} (code={}): {}", pageId, code, msg);
        return WebhookSubscriptionResult.failure(code, msg, remediation);
    }

    // ── Health probes (used by the connection health check) ───────────────────

    /** App ID this integration runs as — used to check the page's subscribed_apps. */
    public String getAppId() {
        return appId;
    }

    /**
     * Returns empty if this app IS subscribed to the page for leadgen, otherwise
     * a human message explaining the gap (the usual cause = the account that
     * connected lacks Full control, so the subscribe never took).
     */
    public Optional<String> findSubscriptionIssue(String pageId, String pageToken) {
        String url = GRAPH_API_BASE + "/" + pageId + "/subscribed_apps?access_token=" + pageToken;
        JsonNode response;
        try {
            response = webClient
                    .get().uri(url)
                    .exchangeToMono(resp -> resp.bodyToMono(JsonNode.class))
                    .block();
        } catch (Exception e) {
            return Optional.of("Couldn't read this Page's app subscriptions from Facebook: " + e.getMessage());
        }
        if (response == null) {
            return Optional.of("No response from Facebook when reading Page subscriptions.");
        }
        if (response.has("error")) {
            return Optional.of("Facebook rejected the subscription check: "
                    + response.path("error").path("message").asText("unknown error"));
        }
        for (JsonNode app : response.path("data")) {
            if (appId != null && appId.equals(app.path("id").asText())) {
                for (JsonNode f : app.path("subscribed_fields")) {
                    if ("leadgen".equals(f.asText())) return Optional.empty();
                }
                return Optional.of("This Page is linked to Vacademy but not for the 'leadgen' "
                        + "field. Click Re-subscribe.");
            }
        }
        return Optional.of("This Page isn't linked to Vacademy for lead delivery. "
                + NEEDS_FULL_CONTROL_MSG);
    }

    /**
     * Returns empty if leads can be READ for this form, otherwise a human message.
     * Meta error #100/#10/#200 here usually means Lead Access wasn't granted.
     */
    public Optional<String> findLeadReadIssue(String formId, String pageToken) {
        String url = GRAPH_API_BASE + "/" + formId + "/leads?limit=1&access_token=" + pageToken;
        JsonNode response;
        try {
            response = webClient
                    .get().uri(url)
                    .exchangeToMono(resp -> resp.bodyToMono(JsonNode.class))
                    .block();
        } catch (Exception e) {
            return Optional.of("Couldn't read leads from Facebook: " + e.getMessage());
        }
        if (response == null) {
            return Optional.of("No response from Facebook when reading leads.");
        }
        if (response.has("error")) {
            String msg = response.path("error").path("message").asText("unknown error");
            return Optional.of("Facebook won't return leads for this form (Lead Access may not be "
                    + "granted): " + msg);
        }
        // 200 with data (even empty) means read access works.
        return Optional.empty();
    }

    @Override
    public Optional<OAuthTokenResult> refreshToken(FormWebhookConnector connector,
            String decryptedCurrentToken) {
        // Meta long-lived tokens can be refreshed by exchanging them for new long-lived tokens
        try {
            OAuthTokenResult result = exchangeForLongLivedToken(decryptedCurrentToken);
            return Optional.of(result);
        } catch (Exception e) {
            log.error("Failed to refresh Meta token for connector {}", connector.getId(), e);
            return Optional.empty();
        }
    }

    // ── Field mapping ────────────────────────────────────────────────────────

    private Map<String, String> applyFieldMapping(Map<String, String> rawFields,
            String fieldMappingJson) {
        if (fieldMappingJson == null || fieldMappingJson.isBlank()) return rawFields;

        try {
            JsonNode mappingRoot = objectMapper.readTree(fieldMappingJson);
            JsonNode mappings = mappingRoot.path("mappings");
            Map<String, String> result = new LinkedHashMap<>();

            for (JsonNode mapping : mappings) {
                String platformKey = mapping.path("platform_key").asText(null);
                String target = mapping.path("target").asText(null);
                if (platformKey == null || target == null) continue;

                String value = rawFields.get(platformKey);
                if (value == null) continue;

                // Target format: "STANDARD:parent_name" or "CUSTOM:field_key"
                if (target.startsWith("STANDARD:")) {
                    result.put(target.substring("STANDARD:".length()), value);
                } else if (target.startsWith("CUSTOM:")) {
                    result.put(target.substring("CUSTOM:".length()), value);
                } else {
                    result.put(target, value);
                }
            }

            String action = mappingRoot.path("unmapped_field_action").asText("DISCARD");
            if (!"DISCARD".equals(action)) {
                // KEEP_ORIGINAL: include unmapped fields with original keys
                for (Map.Entry<String, String> e : rawFields.entrySet()) {
                    result.putIfAbsent(e.getKey(), e.getValue());
                }
            }
            return result;
        } catch (Exception e) {
            log.error("Failed to apply field mapping, using raw fields", e);
            return rawFields;
        }
    }

    // ── Utilities ────────────────────────────────────────────────────────────

    /**
     * Resolve one logical field out of a Meta lead's answers. Tries each alias as a
     * whole-key case-insensitive match in the order given, then — when {@code tokens}
     * is non-null — falls back to a substring match on the key, accepting it only if
     * {@code tokenValueShape} also passes. Blank answers never match, so an empty
     * "phone" question cannot shadow a filled "mobile" one.
     *
     * Returns the entry rather than the value because the caller has to know which
     * key matched in order to write the normalized value back onto it.
     */
    private Map.Entry<String, String> findField(Map<String, String> map, List<String> aliases,
            List<String> tokens, Predicate<String> tokenValueShape) {
        for (String alias : aliases) {
            for (Map.Entry<String, String> e : map.entrySet()) {
                if (e.getKey().equalsIgnoreCase(alias) && hasText(e.getValue())) return e;
            }
        }
        if (tokens != null) {
            for (Map.Entry<String, String> e : map.entrySet()) {
                String key = e.getKey().toLowerCase(Locale.ROOT);
                for (String token : tokens) {
                    if (key.contains(token) && hasText(e.getValue())
                            && (tokenValueShape == null || tokenValueShape.test(e.getValue()))) {
                        return e;
                    }
                }
            }
        }
        return null;
    }

    private boolean hasText(String s) {
        return s != null && !s.isBlank();
    }

    private String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }
}
