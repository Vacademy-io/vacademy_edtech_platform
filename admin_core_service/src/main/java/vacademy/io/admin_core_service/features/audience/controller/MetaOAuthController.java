package vacademy.io.admin_core_service.features.audience.controller;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.audience.dto.AdConnectorSetupRequest;
import vacademy.io.admin_core_service.features.audience.dto.CampaignRouteUpdateRequest;
import vacademy.io.admin_core_service.features.audience.dto.CampaignRouteUpdateResponse;
import vacademy.io.admin_core_service.features.audience.dto.CampaignRoutesResponse;
import vacademy.io.admin_core_service.features.audience.dto.ConnectorHealthDTO;
import vacademy.io.admin_core_service.features.audience.dto.ConnectorListItemDTO;
import vacademy.io.admin_core_service.features.audience.dto.ConnectorUpdateRequest;
import vacademy.io.admin_core_service.features.audience.dto.MetaPageDTO;
import vacademy.io.admin_core_service.features.audience.dto.OAuthTokenResult;
import vacademy.io.admin_core_service.features.audience.dto.PlatformFormField;
import vacademy.io.admin_core_service.features.audience.dto.WebhookSubscriptionResult;
import vacademy.io.admin_core_service.features.audience.entity.FormWebhookConnector;
import vacademy.io.admin_core_service.features.audience.entity.OAuthConnectState;
import vacademy.io.admin_core_service.features.audience.repository.AdCampaignRouteRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.FormWebhookConnectorRepository;
import vacademy.io.admin_core_service.features.audience.repository.OAuthConnectStateRepository;
import vacademy.io.admin_core_service.features.audience.service.AdCampaignRouteService;
import vacademy.io.admin_core_service.features.audience.service.AdPlatformWebhookService;
import vacademy.io.admin_core_service.features.audience.service.MetaConnectorHealthService;
import vacademy.io.admin_core_service.features.audience.service.OAuthRedirectResolver;
import vacademy.io.admin_core_service.features.audience.service.TokenEncryptionService;
import vacademy.io.admin_core_service.features.audience.strategy.MetaLeadAdsStrategy;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Authenticated endpoints for Meta Lead Ads OAuth integration.
 *
 * ── Security model ───────────────────────────────────────────────────────────
 * Access tokens are NEVER returned to the browser. The flow is:
 *
 *   1. POST /initiate
 *        ← Admin frontend calls this (authenticated)
 *        → Server creates oauth_connect_state (PENDING), returns {oauth_url, session_key}
 *        → Frontend redirects the browser tab to oauth_url
 *
 *   2. GET /callback?code=...&state=...
 *        ← Meta redirects the browser here (no JWT — listed as public)
 *        → Server validates state record, exchanges code, fetches pages
 *        → Encrypts user token + per-page tokens, stores in oauth_connect_state (AUTHORIZED)
 *        → Redirects browser to frontend with ?session_key=UUID (no token in URL)
 *
 *   3. GET /session/{sessionKey}/pages
 *        ← Frontend calls this (authenticated) to show the page selector
 *        → Server decrypts pages JSON, returns [{id, name}] — NO tokens
 *
 *   4. GET /forms/{formId}/fields?pageAccessToken=... (kept for pre-connector field inspection)
 *        ← Frontend calls this (authenticated) before saving connector
 *        → Proxies Meta Graph API, returns field list — frontend never stores the token
 *
 *   5. POST /connector
 *        ← Frontend calls with {session_key, selected_page_id, form_id, mapping, ...}
 *        → Server resolves page access token from session, creates connector, keeps session AUTHORIZED (TTL refreshed) for more connectors
 *        → Subscribes page to Meta leadgen webhooks
 *
 *   6. POST /google/connector  (no OAuth — server-generated static key)
 *
 * Tenant scope: every endpoint that names an institute or a connector requires the
 * caller to be STAFF of that institute (requireInstituteStaff — no root bypass, since
 * learners are created as root users). Before this, any logged-in user could list,
 * edit or disconnect another institute's connectors, read their Google keys, and
 * re-point a Google key to their own audience.
 */
@RestController
@RequestMapping("/admin-core-service/v1/oauth/meta")
@RequiredArgsConstructor
@Slf4j
public class MetaOAuthController {

    private final MetaLeadAdsStrategy metaStrategy;
    private final AdPlatformWebhookService adPlatformWebhookService;
    private final MetaConnectorHealthService connectorHealthService;
    private final OAuthConnectStateRepository stateRepository;
    private final FormWebhookConnectorRepository connectorRepository;
    private final TokenEncryptionService tokenEncryptionService;
    private final OAuthRedirectResolver redirectResolver;
    private final ObjectMapper objectMapper;
    private final InstituteAccessValidator instituteAccessValidator;
    private final AudienceRepository audienceRepository;
    private final AdCampaignRouteService campaignRouteService;
    private final AdCampaignRouteRepository campaignRouteRepository;

    private static final SecureRandom GOOGLE_KEY_RANDOM = new SecureRandom();
    /** A caller-supplied Google key must look like a generated one: long and URL-safe. */
    private static final java.util.regex.Pattern GOOGLE_KEY_PATTERN =
            java.util.regex.Pattern.compile("^[A-Za-z0-9_-]{24,128}$");

    @Value("${meta.oauth.redirect.uri:}")
    private String metaRedirectUri;

    @Value("${meta.webhook.verify.token:}")
    private String metaWebhookVerifyToken;

    // ── Step 1: Initiate ─────────────────────────────────────────────────────

    /**
     * Creates an OAuth state record and returns the Meta consent URL.
     * The frontend redirects the user (or opens a popup) to oauth_url.
     */
    @PostMapping("/initiate")
    @Transactional
    public ResponseEntity<Map<String, String>> initiateOAuth(
            @RequestParam String instituteId,
            @RequestParam(required = false) String audienceId,
            @RequestParam(required = false) String initiatedBy,
            @RequestParam(required = false) String frontendOrigin,
            @RequestHeader(value = "Origin", required = false) String originHeader,
            @RequestHeader(value = "Referer", required = false) String refererHeader,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);

        // Remember which frontend origin started the flow so /callback can send the
        // browser back to the SAME (white-label) domain. Explicit param wins; else
        // fall back to the Origin/Referer of this authenticated request.
        String requestedOrigin = redirectResolver.normalizeOrigin(
                frontendOrigin != null && !frontendOrigin.isBlank() ? frontendOrigin
                        : (originHeader != null && !originHeader.isBlank() ? originHeader : refererHeader));

        OAuthConnectState state = OAuthConnectState.builder()
                .instituteId(instituteId)
                .vendor("META_LEAD_ADS")
                .audienceId(audienceId)
                .initiatedBy(initiatedBy)
                .frontendOrigin(requestedOrigin)
                .expiresAt(LocalDateTime.now().plusMinutes(10))
                .sessionStatus("PENDING")
                .build();

        OAuthConnectState saved = stateRepository.save(state);
        String oauthUrl = metaStrategy.buildOAuthUrl(saved.getId(), metaRedirectUri);

        log.info("Initiated Meta OAuth for institute={}, state={}", instituteId, saved.getId());
        return ResponseEntity.ok(Map.of(
                "oauth_url", oauthUrl,
                "session_key", saved.getId()
        ));
    }

    // ── Step 2: Callback (browser redirect from Meta — no JWT) ───────────────

    /**
     * Meta redirects the browser here after the admin grants permission.
     * All token handling is server-side. The browser is immediately redirected
     * to the admin frontend with only the session_key as a query parameter.
     */
    @GetMapping("/callback")
    @Transactional
    public ResponseEntity<Void> oauthCallback(
            @RequestParam String code,
            @RequestParam(required = false) String state,
            @RequestParam(value = "error", required = false) String error) {

        // Resolve where to send the browser back to FIRST, so even error redirects
        // land on the origin the client started from (the state row carries it).
        String redirectBase = resolveRedirectBaseForState(state);

        // Meta sends error param if user denied access
        if (error != null) {
            log.warn("Meta OAuth denied by user: {}", error);
            return redirectToFrontend(redirectBase, "error=" + error);
        }

        if (state == null) {
            log.error("Meta OAuth callback received without state param");
            return redirectToFrontend(redirectBase, "error=missing_state");
        }

        // Validate the state record (prevents CSRF)
        OAuthConnectState stateRecord = stateRepository
                .findValidById(state, LocalDateTime.now())
                .orElse(null);

        if (stateRecord == null) {
            log.error("Meta OAuth callback: state={} not found or expired", state);
            return redirectToFrontend(redirectBase, "error=invalid_state");
        }

        try {
            // Exchange code → short-lived → long-lived user token (server-side only)
            OAuthTokenResult tokenResult = metaStrategy.exchangeCodeForToken(code, metaRedirectUri);
            String userToken = tokenResult.getAccessToken();

            // Fetch pages the user can connect (server-side, token never leaves).
            // Merges /me/accounts (app-role/classic users) with Login-for-Business
            // granular grants (business-owned Pages that /me/accounts omits for
            // regular users) so both flows surface the selected Page.
            List<Map<String, String>> rawPages = metaStrategy.discoverConnectablePages(userToken);

            // Encrypt per-page access tokens and build the pages JSON to store
            List<Map<String, String>> pagesForStorage = new ArrayList<>();
            for (Map<String, String> page : rawPages) {
                String pageToken = page.get("access_token");
                if (pageToken == null || pageToken.isBlank()) {
                    log.warn("Skipping page {} — no access_token returned by Meta",
                            page.get("id"));
                    continue;
                }
                Map<String, String> entry = new LinkedHashMap<>();
                entry.put("id", page.get("id"));
                entry.put("name", page.get("name"));
                entry.put("token_enc", tokenEncryptionService.encrypt(pageToken));
                // Carry the connecting user's page tasks so the page selector can warn
                // about pages that lack the MANAGE (Full control) task — those can read
                // leads but Meta rejects the webhook subscribe (#200), so they'd never
                // actually deliver leads.
                if (page.get("tasks") != null) entry.put("tasks", page.get("tasks"));
                if (page.get("has_manage") != null) entry.put("has_manage", page.get("has_manage"));
                pagesForStorage.add(entry);
            }

            // Encrypt the entire pages JSON blob
            String pagesJson = objectMapper.writeValueAsString(pagesForStorage);
            String pagesJsonEnc = tokenEncryptionService.encrypt(pagesJson);

            // Encrypt user token
            String userTokenEnc = tokenEncryptionService.encrypt(userToken);

            // Update state record: PENDING → AUTHORIZED
            stateRecord.setUserTokenEnc(userTokenEnc);
            stateRecord.setPagesJsonEnc(pagesJsonEnc);
            stateRecord.setSessionStatus("AUTHORIZED");
            // Extend expiry — admin now needs time to configure mapping before saving
            stateRecord.setExpiresAt(LocalDateTime.now().plusMinutes(30));
            stateRepository.save(stateRecord);

            log.info("Meta OAuth authorized for state={}, {} pages found",
                    state, rawPages.size());

            return redirectToFrontend(redirectBase, "session_key=" + state);

        } catch (Exception e) {
            log.error("Meta OAuth callback processing failed for state={}", state, e);
            stateRecord.setSessionStatus("EXPIRED");
            stateRepository.save(stateRecord);
            return redirectToFrontend(redirectBase, "error=server_error");
        }
    }

    /**
     * Resolve the validated frontend base URL for a callback, from the (possibly
     * expired) state row's stored origin + institute. Tolerant: any miss falls
     * back to the configured default inside {@link OAuthRedirectResolver}.
     */
    private String resolveRedirectBaseForState(String stateId) {
        if (stateId == null) {
            return redirectResolver.resolveRedirectBase(null, null);
        }
        OAuthConnectState s = stateRepository.findById(stateId).orElse(null);
        return redirectResolver.resolveRedirectBase(
                s != null ? s.getInstituteId() : null,
                s != null ? s.getFrontendOrigin() : null);
    }

    // ── Step 3: Pages list (safe — no tokens) ────────────────────────────────

    /**
     * Returns the list of Facebook Pages for the admin to pick from.
     * Only id and name are returned — the page access tokens stay server-side.
     */
    @GetMapping("/session/{sessionKey}/pages")
    public ResponseEntity<List<MetaPageDTO>> getSessionPages(
            @PathVariable String sessionKey) {

        OAuthConnectState state = stateRepository
                .findValidById(sessionKey, LocalDateTime.now())
                .orElseThrow(() -> new VacademyException(
                        "Session not found or expired. Please reconnect Meta."));

        if (!"AUTHORIZED".equals(state.getSessionStatus())) {
            throw new VacademyException("OAuth session not yet authorized");
        }

        List<MetaPageDTO> pages = decryptAndListPages(state)
                .stream()
                .map(this::toPageDTO)
                .collect(Collectors.toList());

        return ResponseEntity.ok(pages);
    }

    // ── Step 3b: Resolve a Page by ID (fallback when /me/accounts is empty) ──

    /**
     * Resolve a Facebook Page directly by its ID and add it to the session.
     *
     * Fallback for business-owned Pages that Facebook Login for Business does NOT
     * return via {@code /me/accounts} for regular (non-app-role) users. The Page is
     * still directly readable with pages_read_engagement, so the admin supplies the
     * Page ID (shown in Meta's connect dialog) and we fetch it with the session's user
     * token, store its encrypted Page token, and return it — so the rest of the flow
     * (list forms → save connector) works unchanged.
     */
    @PostMapping("/session/{sessionKey}/pages/resolve")
    @Transactional
    public ResponseEntity<MetaPageDTO> resolvePageById(
            @PathVariable String sessionKey,
            @RequestParam String pageId) {

        OAuthConnectState state = stateRepository
                .findValidById(sessionKey, LocalDateTime.now())
                .orElseThrow(() -> new VacademyException(
                        "Session not found or expired. Please reconnect Meta."));
        if (!"AUTHORIZED".equals(state.getSessionStatus())) {
            throw new VacademyException("OAuth session not yet authorized");
        }
        if (state.getUserTokenEnc() == null) {
            throw new VacademyException("No user token on this session — please reconnect Meta.");
        }
        String cleanPageId = pageId == null ? null : pageId.trim();
        if (cleanPageId == null || cleanPageId.isBlank()) {
            throw new VacademyException("Page ID is required");
        }

        String userToken = tokenEncryptionService.decrypt(state.getUserTokenEnc());

        // Fetch the Page directly (id, name, access_token) with the user token.
        Map<String, String> page = metaStrategy.fetchPageById(cleanPageId, userToken);

        // Add/replace it in the session's stored pages so resolvePageToken() works later.
        List<Map<String, String>> pages;
        try {
            pages = decryptAndListPages(state);
        } catch (Exception e) {
            pages = new ArrayList<>();
        }
        pages.removeIf(p -> cleanPageId.equals(p.get("id")));

        Map<String, String> entry = new LinkedHashMap<>();
        entry.put("id", page.get("id"));
        entry.put("name", page.get("name"));
        entry.put("token_enc", tokenEncryptionService.encrypt(page.get("access_token")));
        // Tasks aren't readable on a Page node; the admin granted pages_manage_metadata
        // and supplied this Page, so assume Full control — the subscribe step is the
        // real gate and reports #200 if that's wrong.
        entry.put("tasks", "MANAGE");
        entry.put("has_manage", "true");
        pages.add(entry);

        try {
            state.setPagesJsonEnc(tokenEncryptionService.encrypt(
                    objectMapper.writeValueAsString(pages)));
        } catch (Exception e) {
            throw new VacademyException("Failed to store resolved page: " + e.getMessage());
        }
        state.setExpiresAt(LocalDateTime.now().plusMinutes(30));
        stateRepository.save(state);

        log.info("Resolved Meta page {} ({}) by ID for session {}",
                cleanPageId, page.get("name"), sessionKey);
        return ResponseEntity.ok(toPageDTO(entry));
    }

    // ── Step 4a: List forms for a page ──────────────────────────────────────

    /**
     * List all lead gen forms for a given Facebook Page.
     * Returns [{id, name, status}] — no tokens exposed.
     */
    @GetMapping("/session/{sessionKey}/pages/{pageId}/forms")
    public ResponseEntity<List<Map<String, String>>> listPageForms(
            @PathVariable String sessionKey,
            @PathVariable String pageId) {

        OAuthConnectState state = stateRepository
                .findValidById(sessionKey, LocalDateTime.now())
                .orElseThrow(() -> new VacademyException("Session not found or expired"));

        String pageToken = resolvePageToken(state, pageId);
        List<Map<String, String>> forms = metaStrategy.listPageForms(pageId, pageToken);
        return ResponseEntity.ok(forms);
    }

    // ── Step 4b: Form fields ─────────────────────────────────────────────────

    /**
     * Proxy to fetch field definitions for a lead gen form.
     * The session_key is used to look up the page access token server-side —
     * the frontend never holds the token.
     */
    @GetMapping("/session/{sessionKey}/forms/{formId}/fields")
    public ResponseEntity<List<PlatformFormField>> getFormFields(
            @PathVariable String sessionKey,
            @PathVariable String formId,
            @RequestParam String pageId) {

        OAuthConnectState state = stateRepository
                .findValidById(sessionKey, LocalDateTime.now())
                .orElseThrow(() -> new VacademyException("Session not found or expired"));

        String pageToken = resolvePageToken(state, pageId);
        List<PlatformFormField> fields = metaStrategy.fetchFormFields(formId, pageToken);
        return ResponseEntity.ok(fields);
    }

    // ── Step 5: Save connector ────────────────────────────────────────────────

    /**
     * Creates the FormWebhookConnector using the token from the OAuth session.
     * The session is kept AUTHORIZED (and its TTL refreshed) so the admin can add
     * multiple form→audience connectors from a single OAuth connection. It expires
     * naturally via expires_at — no longer single-use.
     */
    @PostMapping("/connector")
    @Transactional
    @Auditable(
            entityType = "LEAD_CONNECTOR",
            action = "CREATE",
            entityIdExpr = "#result?.body != null ? #result.body['connector_id'] : null",
            // This mapping answers a missing sessionKey/formId with a 400-carrying
            // ResponseEntity instead of throwing, and the aspect only ever sees a
            // successful return — without this guard a rejected request would be
            // logged as a connector that was created.
            conditionExpr = "#result?.body != null and #result.body['connector_id'] != null",
            // The body carries OAuth session keys — never persist it.
            payload = Auditable.PayloadMode.NONE,
            descriptionExpr = "'connected Meta lead form ' + (#request?.platformFormName "
                    + "?: #request?.platformFormId) + (#request?.audienceId != null ? ' to audience ' "
                    + "+ @crmAuditNarrator.audienceFor(#request.audienceId) : '')")
    public ResponseEntity<Map<String, String>> saveConnector(
            @RequestBody AdConnectorSetupRequest request,
            @RequestAttribute("user") CustomUserDetails user) {

        if (request.getSessionKey() == null || request.getSelectedPageId() == null) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "sessionKey and selectedPageId are required"));
        }
        if (request.getPlatformFormId() == null) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "platformFormId is required"));
        }

        OAuthConnectState state = stateRepository
                .findValidById(request.getSessionKey(), LocalDateTime.now())
                .orElseThrow(() -> new VacademyException(
                        "Session not found or expired. Please reconnect Meta."));

        if (!"AUTHORIZED".equals(state.getSessionStatus())) {
            throw new VacademyException("OAuth session is not in AUTHORIZED state");
        }

        // Resolve page name and page access token from session (token stays server-side)
        String pageToken = resolvePageToken(state, request.getSelectedPageId());
        String pageName = resolvePageName(state, request.getSelectedPageId());

        // Determine institute from session if not provided in request
        String instituteId = request.getInstituteId() != null
                ? request.getInstituteId() : state.getInstituteId();
        String audienceId = request.getAudienceId() != null
                ? request.getAudienceId() : state.getAudienceId();
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        requireAudiencesInInstitute(instituteId, audienceId, request.getRoutingRulesJson());

        // Upsert: update if connector already exists for this vendor + formId
        FormWebhookConnector connector = connectorRepository
                .findByVendorAndVendorId("META_LEAD_ADS", request.getPlatformFormId())
                .orElse(FormWebhookConnector.builder()
                        .vendor("META_LEAD_ADS")
                        .vendorId(request.getPlatformFormId())
                        .build());

        connector.setInstituteId(instituteId);
        connector.setAudienceId(audienceId);
        connector.setPlatformPageId(request.getSelectedPageId());
        connector.setPlatformFormId(request.getPlatformFormId());
        if (request.getPlatformFormName() != null) {
            connector.setPlatformFormName(request.getPlatformFormName());
        }
        connector.setRoutingRulesJson(request.getRoutingRulesJson());
        connector.setFieldMappingJson(request.getFieldMappingJson());
        if (request.getDefaultValuesJson() != null) {
            connector.setDefaultValuesJson(request.getDefaultValuesJson());
        }
        connector.setProducesSourceType(request.getProducesSourceType() != null
                ? request.getProducesSourceType() : "FACEBOOK_ADS");
        connector.setConnectionStatus("ACTIVE");
        connector.setWebhookVerifyToken(metaWebhookVerifyToken);
        connector.setIsActive(true);

        OAuthTokenResult tokenResult = OAuthTokenResult.builder()
                .accessToken(pageToken)
                .expiresAt(LocalDateTime.now().plusDays(60))
                .build();

        FormWebhookConnector saved = adPlatformWebhookService.saveConnector(connector, tokenResult);

        // Subscribe the page to receive leadgen webhooks. This is the step that,
        // when it fails (Meta #200 — the connecting account lacks Full control of
        // the Page), used to be swallowed, leaving the connector falsely ACTIVE
        // with zero leads ever arriving. Capture the result and reflect it so the
        // admin gets an honest status + remediation instead of silent breakage.
        WebhookSubscriptionResult subResult;
        try {
            subResult = metaStrategy.subscribePageToWebhooks(saved, pageToken);
        } catch (Exception e) {
            log.warn("Page webhook subscription threw for page={}: {}",
                    request.getSelectedPageId(), e.getMessage());
            subResult = WebhookSubscriptionResult.failure(null, e.getMessage(),
                    "Couldn't link this Page to Vacademy. Try reconnecting.");
        }

        if (!subResult.isSuccess()) {
            saved.setConnectionStatus("ACTION_REQUIRED");
            saved.setStatusDetail(subResult.getRemediation());
            connectorRepository.save(saved);
        }

        // Keep the session AUTHORIZED so the admin can add more form→audience
        // connectors without re-running OAuth. Refresh the TTL on each save so an
        // actively-working admin doesn't hit the expiry mid-setup. The session
        // still expires naturally via expires_at (cleaned up by the scheduled job).
        state.setExpiresAt(LocalDateTime.now().plusMinutes(30));
        stateRepository.save(state);

        log.info("Meta connector created: id={}, page={} ({}), form={}, subscribed={}",
                saved.getId(), pageName, request.getSelectedPageId(),
                request.getPlatformFormId(), subResult.isSuccess());

        Map<String, String> body = new LinkedHashMap<>();
        body.put("connector_id", saved.getId());
        body.put("page_name", pageName != null ? pageName : request.getSelectedPageId());
        body.put("status", saved.getConnectionStatus());
        body.put("subscribed", String.valueOf(subResult.isSuccess()));
        body.put("message", subResult.isSuccess()
                ? "Meta Lead Ads connector created and the Page is linked for lead delivery."
                : subResult.getRemediation());
        return ResponseEntity.ok(body);
    }

    // ── Google connector (no OAuth) ───────────────────────────────────────────

    @PostMapping("/google/connector")
    @Auditable(
            entityType = "LEAD_CONNECTOR",
            action = "CREATE",
            entityIdExpr = "#result?.body != null ? #result.body['connector_id'] : null",
            // Same 400-without-throwing shape as the Meta connector above.
            conditionExpr = "#result?.body != null and #result.body['connector_id'] != null",
            // googleKey is a credential — keep it out of the audit table.
            payload = Auditable.PayloadMode.NONE,
            descriptionExpr = "'connected a Google lead form' + (#request?.audienceId != null "
                    + "? ' to audience ' + @crmAuditNarrator.audienceFor(#request.audienceId) : '')")
    public ResponseEntity<Map<String, String>> saveGoogleConnector(
            @RequestBody AdConnectorSetupRequest request,
            @RequestAttribute("user") CustomUserDetails user) {

        if (request.getAudienceId() == null) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "audienceId is required"));
        }
        instituteAccessValidator.requireInstituteStaff(user, request.getInstituteId());
        requireAudiencesInInstitute(request.getInstituteId(), request.getAudienceId(),
                request.getRoutingRulesJson());

        // The key is the webhook's only credential, so by default the server mints it
        // (32 URL-safe chars from SecureRandom). An admin-typed key like "my-leads-1" was
        // guessable, and anyone holding it could inject leads that run the workflows.
        String googleKey = request.getGoogleKey();
        if (googleKey == null || googleKey.isBlank()) {
            googleKey = newGoogleKey();
        } else if (!GOOGLE_KEY_PATTERN.matcher(googleKey).matches()) {
            return ResponseEntity.badRequest().body(Map.of("error",
                    "googleKey must be 24-128 letters, digits, '-' or '_'. Leave it empty to generate one."));
        }

        // Upsert within the caller's institute only. The key used to be matched across
        // ALL institutes, so saving someone else's key re-pointed their connector (and
        // their leads) at the caller's audience.
        Optional<FormWebhookConnector> existing =
                connectorRepository.findByVendorAndVendorId("GOOGLE_LEAD_ADS", googleKey);
        if (existing.isPresent() && !request.getInstituteId().equals(existing.get().getInstituteId())) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error",
                    "This key is already used by another connector. Leave the key empty to generate a new one."));
        }
        final String key = googleKey;
        FormWebhookConnector connector = existing.orElseGet(() -> FormWebhookConnector.builder()
                .vendor("GOOGLE_LEAD_ADS")
                .vendorId(key)
                .build());

        connector.setInstituteId(request.getInstituteId());
        connector.setAudienceId(request.getAudienceId());
        // The connector list builds the "copy webhook URL" action from platform_form_id.
        connector.setPlatformFormId(googleKey);
        // The name the list shows instead of the key (which is a credential).
        if (request.getPlatformFormName() != null) {
            connector.setPlatformFormName(cleanConnectorName(request.getPlatformFormName()));
        }
        connector.setRoutingRulesJson(request.getRoutingRulesJson());
        connector.setFieldMappingJson(request.getFieldMappingJson());
        connector.setProducesSourceType("GOOGLE_ADS");
        connector.setConnectionStatus("ACTIVE");
        connector.setIsActive(true);

        FormWebhookConnector saved = adPlatformWebhookService.saveConnector(connector, null);

        return ResponseEntity.ok(Map.of(
                "connector_id", saved.getId(),
                "google_key", googleKey,
                "webhook_url", "/admin-core-service/api/v1/webhook/google/" + googleKey,
                "status", "ACTIVE",
                "message", "Google Lead Form connector created. Paste the webhook URL and the key into Google Ads."
        ));
    }

    /** Trimmed, at most the column's 255 chars; blank clears the name. */
    private static String cleanConnectorName(String name) {
        String trimmed = name.trim();
        if (trimmed.isEmpty()) return null;
        return trimmed.length() > 255 ? trimmed.substring(0, 255) : trimmed;
    }

    /** 24 random bytes → 32 URL-safe characters. */
    private static String newGoogleKey() {
        byte[] bytes = new byte[24];
        GOOGLE_KEY_RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    // ── Tenant scope ──────────────────────────────────────────────────────────

    /** Load a connector the caller may act on: they must be staff of its institute. */
    private FormWebhookConnector loadConnectorForStaff(String connectorId, CustomUserDetails user) {
        FormWebhookConnector connector = connectorRepository.findById(connectorId)
                .orElseThrow(() -> new VacademyException("Connector not found"));
        instituteAccessValidator.requireInstituteStaff(user, connector.getInstituteId());
        return connector;
    }

    /**
     * Every audience a connector can deliver into — its default plus any routing-rule
     * target — must belong to the connector's institute, or a connector could feed
     * leads into another institute's audience. Malformed routing JSON is left alone:
     * the webhook falls back to the (checked) default audience when it can't parse it.
     */
    private void requireAudiencesInInstitute(String instituteId, String audienceId, String routingRulesJson) {
        Set<String> audienceIds = new LinkedHashSet<>();
        if (audienceId != null && !audienceId.isBlank()) audienceIds.add(audienceId);
        if (routingRulesJson != null && !routingRulesJson.isBlank()) {
            try {
                JsonNode root = objectMapper.readTree(routingRulesJson);
                String fallback = root.path("default_audience_id").asText(null);
                if (fallback != null && !fallback.isBlank()) audienceIds.add(fallback);
                for (JsonNode rule : root.path("rules")) {
                    String target = rule.path("target_audience_id").asText(null);
                    if (target != null && !target.isBlank()) audienceIds.add(target);
                }
            } catch (Exception e) {
                log.warn("Unparseable routing_rules_json on connector save — not validating its targets");
            }
        }
        for (String id : audienceIds) {
            boolean sameInstitute = audienceRepository.findById(id)
                    .map(a -> instituteId.equals(a.getInstituteId()))
                    .orElse(false);
            if (!sameInstitute) {
                throw new VacademyException("Audience " + id + " does not belong to this institute");
            }
        }
    }

    // ── Connector list + deactivate (both platforms) ────────────────────────

    /**
     * List all active ad-platform connectors for an institute.
     * Returns safe data — no encrypted tokens.
     */
    @GetMapping("/connectors")
    public ResponseEntity<List<ConnectorListItemDTO>> listConnectors(
            @RequestParam String instituteId,
            @RequestParam(name = "includeAllVendors", defaultValue = "false") boolean includeAllVendors,
            @RequestAttribute("user") CustomUserDetails user) {
        // The DTO carries vendorId — for Google that is the webhook key itself.
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        List<FormWebhookConnector> connectors = connectorRepository
                .findByInstituteIdAndIsActiveTrue(instituteId);

        // Default keeps the Integrations screen's existing behaviour (ad platforms only).
        // includeAllVendors=true surfaces every connector — incl. Zoho/Google/Microsoft
        // forms — for the Center Management screen, which edits per-center metadata.
        List<ConnectorListItemDTO> result = connectors.stream()
                .filter(c -> includeAllVendors
                        || "META_LEAD_ADS".equals(c.getVendor())
                        || "GOOGLE_LEAD_ADS".equals(c.getVendor()))
                .map(ConnectorListItemDTO::from)
                .collect(Collectors.toList());

        // Google rows: how many campaigns still need a list (their leads go to the catch-all).
        List<String> googleIds = result.stream()
                .filter(c -> "GOOGLE_LEAD_ADS".equals(c.getVendor()))
                .map(ConnectorListItemDTO::getId)
                .toList();
        if (!googleIds.isEmpty()) {
            Map<String, Integer> unmapped = new HashMap<>();
            for (Object[] row : campaignRouteRepository.countUnmapped(googleIds)) {
                unmapped.put((String) row[0], ((Number) row[1]).intValue());
            }
            result.forEach(c -> {
                if ("GOOGLE_LEAD_ADS".equals(c.getVendor())) {
                    c.setUnmappedCampaigns(unmapped.getOrDefault(c.getId(), 0));
                }
            });
        }
        return ResponseEntity.ok(result);
    }

    /**
     * Deactivate (soft-delete) a connector. Leads will stop flowing immediately.
     */
    @DeleteMapping("/connectors/{connectorId}")
    @Transactional
    @Auditable(
            entityType = "LEAD_CONNECTOR",
            action = "DELETE",
            entityIdExpr = "#connectorId",
            descriptionExpr = "'disconnected a lead connector'")
    public ResponseEntity<Map<String, String>> deactivateConnector(
            @PathVariable String connectorId,
            @RequestAttribute("user") CustomUserDetails user) {
        FormWebhookConnector connector = loadConnectorForStaff(connectorId, user);
        connector.setIsActive(false);
        connector.setConnectionStatus("REVOKED");
        connectorRepository.save(connector);
        log.info("Deactivated connector id={} vendor={}", connectorId, connector.getVendor());
        return ResponseEntity.ok(Map.of("status", "deactivated"));
    }

    /**
     * Fetch a single connector for editing. Returns the same safe DTO as the list endpoint
     * (no encrypted tokens) plus default_values_json so the admin UI can edit per-center metadata.
     */
    @GetMapping("/connectors/{connectorId}")
    public ResponseEntity<ConnectorListItemDTO> getConnector(@PathVariable String connectorId,
            @RequestAttribute("user") CustomUserDetails user) {
        FormWebhookConnector connector = loadConnectorForStaff(connectorId, user);
        return ResponseEntity.ok(ConnectorListItemDTO.from(connector));
    }

    /**
     * Update editable fields on a connector. Currently exposes default_values_json — the
     * per-connector metadata (e.g. center name, schedule link, school phone) merged into
     * form payloads at webhook time. Validates that the body is a JSON object before saving.
     */
    @PutMapping("/connectors/{connectorId}")
    @Transactional
    @Auditable(
            entityType = "LEAD_CONNECTOR",
            action = "UPDATE",
            entityIdExpr = "#connectorId",
            descriptionExpr = "'updated lead connector ' + (#result?.body?.platformFormName ?: #connectorId)")
    public ResponseEntity<ConnectorListItemDTO> updateConnector(
            @PathVariable String connectorId,
            @RequestBody ConnectorUpdateRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        FormWebhookConnector connector = loadConnectorForStaff(connectorId, user);

        if (request.getPlatformFormName() != null) {
            connector.setPlatformFormName(cleanConnectorName(request.getPlatformFormName()));
        }

        if (request.getDefaultValuesJson() != null) {
            String trimmed = request.getDefaultValuesJson().trim();
            if (trimmed.isEmpty()) {
                connector.setDefaultValuesJson(null);
            } else {
                com.fasterxml.jackson.databind.JsonNode node;
                try {
                    node = objectMapper.readTree(trimmed);
                } catch (Exception e) {
                    throw new VacademyException(
                            "default_values_json must be a valid JSON object: " + e.getMessage());
                }
                // The V207 enrichment trigger reads default_values_json as a JSON object
                // (jsonb_each_text). Reject arrays/primitives so we never persist a shape
                // that would silently produce no enrichment.
                if (node == null || !node.isObject()) {
                    throw new VacademyException(
                            "default_values_json must be a JSON object (e.g. {\"center name\":\"...\"})");
                }
                connector.setDefaultValuesJson(trimmed);
            }
        }

        FormWebhookConnector saved = connectorRepository.save(connector);
        log.info("Updated connector id={} vendor={}", saved.getId(), saved.getVendor());
        return ResponseEntity.ok(ConnectorListItemDTO.from(saved));
    }

    // ── Google campaign → lead list routing ──────────────────────────────────

    /** A Google connector's campaigns and the list each one's leads go to. */
    @GetMapping("/connectors/{connectorId}/campaign-routes")
    public ResponseEntity<CampaignRoutesResponse> campaignRoutes(
            @PathVariable String connectorId,
            @RequestAttribute("user") CustomUserDetails user) {
        FormWebhookConnector connector = loadGoogleConnectorForStaff(connectorId, user);
        return ResponseEntity.ok(campaignRouteService.list(connector));
    }

    /**
     * Route one campaign to an existing list or a new one, optionally moving its existing
     * leads. Also how an admin maps a campaign id before its first lead arrives.
     */
    @PutMapping("/connectors/{connectorId}/campaign-routes/{campaignId}")
    @Auditable(
            entityType = "LEAD_CONNECTOR",
            action = "UPDATE",
            entityIdExpr = "#connectorId",
            descriptionExpr = "'routed Google campaign ' + #campaignId + ' to a lead list'")
    public ResponseEntity<CampaignRouteUpdateResponse> updateCampaignRoute(
            @PathVariable String connectorId,
            @PathVariable String campaignId,
            @RequestBody CampaignRouteUpdateRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        FormWebhookConnector connector = loadGoogleConnectorForStaff(connectorId, user);
        return ResponseEntity.ok(campaignRouteService.update(connector, campaignId, request, user));
    }

    /** Remove a campaign added by mistake (only while it has sent no leads). */
    @DeleteMapping("/connectors/{connectorId}/campaign-routes/{campaignId}")
    @Auditable(
            entityType = "LEAD_CONNECTOR",
            action = "UPDATE",
            entityIdExpr = "#connectorId",
            descriptionExpr = "'removed Google campaign ' + #campaignId + ' from a connector'")
    public ResponseEntity<Map<String, String>> deleteCampaignRoute(
            @PathVariable String connectorId,
            @PathVariable String campaignId,
            @RequestAttribute("user") CustomUserDetails user) {
        FormWebhookConnector connector = loadGoogleConnectorForStaff(connectorId, user);
        campaignRouteService.delete(connector, campaignId);
        return ResponseEntity.ok(Map.of("status", "deleted"));
    }

    /** Turn "a new list for each new campaign" on or off for a Google connector. */
    @PutMapping("/connectors/{connectorId}/campaign-auto-lists")
    @Auditable(
            entityType = "LEAD_CONNECTOR",
            action = "UPDATE",
            entityIdExpr = "#connectorId",
            descriptionExpr = "'changed automatic lead lists per Google campaign'")
    public ResponseEntity<CampaignRoutesResponse> setCampaignAutoLists(
            @PathVariable String connectorId,
            @RequestBody Map<String, Boolean> body,
            @RequestAttribute("user") CustomUserDetails user) {
        FormWebhookConnector connector = loadGoogleConnectorForStaff(connectorId, user);
        boolean enabled = body != null && Boolean.TRUE.equals(body.get("enabled"));
        return ResponseEntity.ok(campaignRouteService.setAutoCreateLists(connector, enabled));
    }

    private FormWebhookConnector loadGoogleConnectorForStaff(String connectorId, CustomUserDetails user) {
        FormWebhookConnector connector = loadConnectorForStaff(connectorId, user);
        if (!"GOOGLE_LEAD_ADS".equals(connector.getVendor())) {
            throw new VacademyException("Campaign routing is only available for Google Lead Form connectors");
        }
        return connector;
    }

    // ── Connection health + re-subscribe ─────────────────────────────────────

    /**
     * Live health check ("Test connection") for a connector. Verifies the whole
     * lead-delivery chain — token, page→app subscription, lead-read access, and a
     * recent-lead heartbeat — and reflects a broken subscription into the
     * connector's status so the list view stays honest.
     */
    @GetMapping("/connectors/{connectorId}/health")
    public ResponseEntity<ConnectorHealthDTO> connectorHealth(@PathVariable String connectorId,
            @RequestAttribute("user") CustomUserDetails user) {
        loadConnectorForStaff(connectorId, user);
        return ResponseEntity.ok(connectorHealthService.checkHealth(connectorId));
    }

    /**
     * Re-attempt the page→app webhook subscription using the connector's stored
     * token. Use after granting the connecting account Full control of the Page
     * (fixes the #200 case) — no need to redo the whole OAuth.
     */
    @PostMapping("/connectors/{connectorId}/resubscribe")
    @Transactional
    @Auditable(
            entityType = "LEAD_CONNECTOR",
            action = "RESUBSCRIBE",
            entityIdExpr = "#connectorId",
            descriptionExpr = "'re-subscribed a lead connector to its page webhook'")
    public ResponseEntity<Map<String, String>> resubscribeConnector(
            @PathVariable String connectorId,
            @RequestAttribute("user") CustomUserDetails user) {
        FormWebhookConnector connector = loadConnectorForStaff(connectorId, user);
        if (!"META_LEAD_ADS".equals(connector.getVendor())) {
            throw new VacademyException("Re-subscribe is only supported for Meta connectors");
        }
        if (connector.getOauthAccessTokenEnc() == null) {
            throw new VacademyException(
                    "No stored token for this connector — reconnect the Page first.");
        }

        String pageToken = tokenEncryptionService.decrypt(connector.getOauthAccessTokenEnc());
        WebhookSubscriptionResult result = metaStrategy.subscribePageToWebhooks(connector, pageToken);

        if (result.isSuccess()) {
            connector.setConnectionStatus("ACTIVE");
            connector.setStatusDetail(null);
        } else {
            connector.setConnectionStatus("ACTION_REQUIRED");
            connector.setStatusDetail(result.getRemediation());
        }
        connector.setLastCheckedAt(LocalDateTime.now());
        connectorRepository.save(connector);

        Map<String, String> body = new LinkedHashMap<>();
        body.put("connector_id", connector.getId());
        body.put("status", connector.getConnectionStatus());
        body.put("subscribed", String.valueOf(result.isSuccess()));
        body.put("message", result.isSuccess()
                ? "Page re-subscribed — leads will now flow."
                : result.getRemediation());
        return ResponseEntity.ok(body);
    }

    // ── Manual lead poll (PULL) ──────────────────────────────────────────────

    /**
     * Pull leads for a Meta connector on demand via GET /{form_id}/leads, for the
     * last {@code sinceMinutes} minutes, and ingest them through the same pipeline
     * as the webhook. Use this when realtime push is blocked (Meta CRM access
     * revoked) to sync leads immediately, or to backfill history that arrived
     * before the connector/poller existed (pass a large sinceMinutes — Meta retains
     * ~90 days). Already-delivered leads dedup, so it's safe to run repeatedly.
     *
     * Advances the recurring poller's cursor to now on success so the scheduled job
     * continues seamlessly from here.
     *
     * Deliberately NOT @Transactional: each lead is submitted in its own
     * transaction (via AudienceService), exactly like the webhook path, so one bad
     * lead can't roll back the whole batch — and the blocking Graph API calls never
     * hold a DB connection.
     */
    @PostMapping("/connectors/{connectorId}/poll")
    public ResponseEntity<Map<String, Object>> pollConnectorNow(
            @PathVariable String connectorId,
            @RequestParam(required = false, defaultValue = "1440") int sinceMinutes,
            @RequestAttribute("user") CustomUserDetails user) {
        FormWebhookConnector connector = loadConnectorForStaff(connectorId, user);
        if (!"META_LEAD_ADS".equals(connector.getVendor())) {
            throw new VacademyException("Polling is only supported for Meta connectors");
        }
        if (connector.getOauthAccessTokenEnc() == null) {
            throw new VacademyException("No stored token for this connector — reconnect the Page first.");
        }

        LocalDateTime pollStart = LocalDateTime.now();
        long sinceEpoch = pollStart.minusMinutes(Math.max(1, sinceMinutes)).toEpochSecond(ZoneOffset.UTC);

        AdPlatformWebhookService.PollResult result;
        try {
            // Generous page cap for manual backfill — a deep history pull can span many
            // pages (500 * 100 = up to 50k leads in one go).
            result = adPlatformWebhookService.pollMetaConnector(connector, sinceEpoch, 500);
        } catch (Exception e) {
            throw new VacademyException("Meta lead poll failed: " + e.getMessage());
        }

        // Advance the recurring cursor only if we fully drained; otherwise leave it so
        // the scheduled poller keeps retrying the older, un-fetched leads. Targeted
        // update (not a full-entity save) so we don't clobber a concurrent token/status
        // write to this row.
        if (!result.truncated()) {
            connectorRepository.updatePollCursor(connector.getId(), pollStart, result.newestLeadId());
        }

        log.info("Manual poll for connector {} (last {} min): fetched {} lead(s), truncated={}",
                connectorId, sinceMinutes, result.fetched(), result.truncated());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("connector_id", connectorId);
        body.put("fetched", result.fetched());
        body.put("since_minutes", sinceMinutes);
        body.put("truncated", result.truncated());
        body.put("message", result.truncated()
                ? "Pulled the most recent " + result.fetched() + " lead(s); the selected window "
                        + "holds more than a single sync returns. Contact support for a deeper backfill."
                : "Pulled " + result.fetched() + " lead(s) from Meta. New leads were ingested; "
                        + "any already delivered were deduped.");
        return ResponseEntity.ok(body);
    }

    // ── One-time backfill: platform_form_name on legacy connectors ───────────

    /**
     * Calls Meta Graph API for every active Meta connector whose
     * {@code platform_form_name} is null/blank and persists the returned name.
     * Idempotent — running it again only touches rows that are still missing.
     * Token decryption + Graph API calls happen synchronously; admins
     * typically have a handful of connectors so this is fine.
     *
     * Returns a summary so the admin sees what changed without tailing logs.
     */
    @PostMapping("/connectors/backfill-form-names")
    @Transactional
    public ResponseEntity<Map<String, Object>> backfillFormNames() {
        List<FormWebhookConnector> connectors = connectorRepository
                .findMissingPlatformFormName("META_LEAD_ADS");

        int updated = 0;
        int skipped = 0;
        List<String> skippedReasons = new ArrayList<>();

        for (FormWebhookConnector c : connectors) {
            String formId = c.getPlatformFormId();
            String tokenEnc = c.getOauthAccessTokenEnc();
            if (formId == null || tokenEnc == null) {
                skipped++;
                skippedReasons.add(c.getId() + " (missing form_id or token)");
                continue;
            }
            String pageToken;
            try {
                pageToken = tokenEncryptionService.decrypt(tokenEnc);
            } catch (Exception e) {
                skipped++;
                skippedReasons.add(c.getId() + " (decrypt failed: " + e.getMessage() + ")");
                continue;
            }
            String name = metaStrategy.fetchFormName(formId, pageToken);
            if (name == null) {
                skipped++;
                skippedReasons.add(c.getId() + " (Meta API returned no name)");
                continue;
            }
            c.setPlatformFormName(name);
            connectorRepository.save(c);
            updated++;
            log.info("Backfilled platform_form_name for connector {} → {}", c.getId(), name);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("scanned", connectors.size());
        result.put("updated", updated);
        result.put("skipped", skipped);
        result.put("skipped_reasons", skippedReasons);
        log.info("Form-name backfill complete: scanned={}, updated={}, skipped={}",
                connectors.size(), updated, skipped);
        return ResponseEntity.ok(result);
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /**
     * Map a stored page entry to the safe DTO, deriving the Full-control warning.
     * A page without the MANAGE task can be selected but won't deliver leads —
     * Meta rejects the webhook subscribe with #200 — so we flag it up front.
     */
    private MetaPageDTO toPageDTO(Map<String, String> p) {
        String tasksCsv = p.getOrDefault("tasks", "");
        List<String> tasks = tasksCsv.isBlank()
                ? List.of()
                : Arrays.asList(tasksCsv.split(","));
        boolean hasManage = Boolean.parseBoolean(p.getOrDefault("has_manage", "false"))
                || tasks.contains("MANAGE");
        String warning = hasManage ? null
                : "You have Leads access to this Page but not Full control, which Facebook "
                + "requires to auto-sync leads. Ask a Page admin to grant your account Full "
                + "control, then reconnect.";
        return MetaPageDTO.builder()
                .id(p.get("id"))
                .name(p.get("name"))
                .tasks(tasks)
                .hasManageTask(hasManage)
                .canReceiveLeads(hasManage)
                .warning(warning)
                .build();
    }

    /**
     * Decrypts the pages JSON blob and returns the raw list (includes token_enc entries).
     * Only used internally — never returned to the frontend.
     */
    private List<Map<String, String>> decryptAndListPages(OAuthConnectState state) {
        try {
            String pagesJson = tokenEncryptionService.decrypt(state.getPagesJsonEnc());
            return objectMapper.readValue(pagesJson,
                    new TypeReference<List<Map<String, String>>>() {});
        } catch (Exception e) {
            throw new VacademyException("Failed to read pages from session: " + e.getMessage());
        }
    }

    /**
     * Resolves and decrypts the page access token for a given page ID.
     * Token stays server-side — this result must never be returned to the client.
     */
    private String resolvePageToken(OAuthConnectState state, String pageId) {
        List<Map<String, String>> pages = decryptAndListPages(state);
        for (Map<String, String> page : pages) {
            if (pageId.equals(page.get("id"))) {
                String tokenEnc = page.get("token_enc");
                if (tokenEnc == null) throw new VacademyException(
                        "No token stored for page " + pageId);
                return tokenEncryptionService.decrypt(tokenEnc);
            }
        }
        throw new VacademyException("Page " + pageId + " not found in session");
    }

    private String resolvePageName(OAuthConnectState state, String pageId) {
        try {
            return decryptAndListPages(state).stream()
                    .filter(p -> pageId.equals(p.get("id")))
                    .map(p -> p.get("name"))
                    .findFirst().orElse(null);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Build a redirect response to the admin frontend.
     * @param base        resolved frontend base URL (client's own origin when
     *                    allowlisted, else the configured default)
     * @param queryString appended as ?queryString (e.g. "session_key=uuid" or "error=denied")
     */
    private ResponseEntity<Void> redirectToFrontend(String base, String queryString) {
        if (base == null || base.isBlank()) {
            log.warn("meta.oauth.frontend.callback.url not set; cannot redirect browser");
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).build();
        }
        // Use & if base already contains ?, otherwise use ?
        String separator = base.contains("?") ? "&" : "?";
        String url = base + separator + queryString;
        return ResponseEntity.status(HttpStatus.FOUND)
                .header(HttpHeaders.LOCATION, url)
                .build();
    }
}
