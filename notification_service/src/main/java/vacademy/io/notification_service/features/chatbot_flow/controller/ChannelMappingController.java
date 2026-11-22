package vacademy.io.notification_service.features.chatbot_flow.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.client.DefaultResponseErrorHandler;
import org.springframework.web.client.RestTemplate;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.notification_service.config.InstituteStaffAccess;
import vacademy.io.notification_service.constants.NotificationConstants;
import vacademy.io.notification_service.features.chatbot_flow.engine.provider.CombotMessageProvider;
import vacademy.io.notification_service.features.chatbot_flow.engine.provider.WatiMessageProvider;
import vacademy.io.notification_service.features.combot.entity.ChannelToInstituteMapping;
import vacademy.io.notification_service.features.combot.repository.ChannelToInstituteMappingRepository;
import vacademy.io.notification_service.institute.InstituteInfoDTO;
import vacademy.io.notification_service.institute.InstituteInternalService;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URI;
import java.util.List;
import java.util.Map;

/**
 * CRUD for channel_to_institute_mapping + webhook registration.
 * Creates the mapping so inbound webhooks route to the correct institute.
 * Optionally auto-registers webhook URL with WATI.
 */
@RestController
@RequestMapping("/notification-service/v1/channel-mapping")
@RequiredArgsConstructor
@Slf4j
public class ChannelMappingController {

    private final ChannelToInstituteMappingRepository mappingRepository;
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;
    private final InstituteInternalService instituteInternalService;
    private final CombotMessageProvider combotMessageProvider;
    private final WatiMessageProvider watiMessageProvider;

    // ==================== CRUD ====================

    @PostMapping
    public ResponseEntity<ChannelToInstituteMapping> createMapping(@RequestBody Map<String, String> body) {
        String channelId = body.get("channelId");
        String channelType = body.get("channelType");
        String displayNumber = body.get("displayChannelNumber");
        String instituteId = body.get("instituteId");

        if (channelId == null || instituteId == null) {
            return ResponseEntity.badRequest().build();
        }

        // Upsert: update if exists, create if not
        ChannelToInstituteMapping mapping = mappingRepository.findById(channelId)
                .orElse(new ChannelToInstituteMapping());

        mapping.setChannelId(channelId);
        mapping.setChannelType(channelType != null ? channelType : "WHATSAPP_COMBOT");
        mapping.setDisplayChannelNumber(displayNumber);
        mapping.setInstituteId(instituteId);
        mapping.setActive(true);

        mapping = mappingRepository.save(mapping);
        log.info("Channel mapping saved: channelId={}, instituteId={}, type={}",
                channelId, instituteId, channelType);
        return ResponseEntity.ok(mapping);
    }

    @GetMapping
    public ResponseEntity<List<ChannelToInstituteMapping>> getMappings(@RequestParam String instituteId) {
        List<ChannelToInstituteMapping> mappings = mappingRepository.findAllByInstituteId(instituteId);
        return ResponseEntity.ok(mappings);
    }

    @DeleteMapping("/{channelId}")
    public ResponseEntity<Void> deleteMapping(@PathVariable String channelId) {
        mappingRepository.deleteById(channelId);
        log.info("Channel mapping deleted: channelId={}", channelId);
        return ResponseEntity.noContent().build();
    }

    // ==================== Webhook Registration ====================

    /**
     * Register webhook URL with WATI automatically.
     * WATI supports programmatic webhook setup via their API.
     */
    @PostMapping("/register-webhook/wati")
    public ResponseEntity<Map<String, Object>> registerWatiWebhook(@RequestBody Map<String, String> body) {
        String watiApiUrl = body.get("watiApiUrl");
        String watiApiKey = body.get("watiApiKey");
        String webhookUrl = body.get("webhookUrl");

        if (watiApiUrl == null || watiApiKey == null || webhookUrl == null) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Missing required fields"));
        }

        try {
            String url = watiApiUrl + "/api/v2/setWebhook";

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set("Authorization", "Bearer " + watiApiKey);

            Map<String, Object> payload = Map.of(
                    "url", webhookUrl,
                    "events", List.of("messages", "message_status", "message_template_status_update")
            );

            HttpEntity<Map<String, Object>> request = new HttpEntity<>(payload, headers);
            ResponseEntity<String> response = restTemplate.postForEntity(url, request, String.class);

            boolean success = response.getStatusCode().is2xxSuccessful();
            log.info("WATI webhook registration: url={}, success={}", webhookUrl, success);

            return ResponseEntity.ok(Map.of(
                    "success", success,
                    "message", success ? "Webhook registered with WATI" : "WATI returned " + response.getStatusCode(),
                    "response", response.getBody() != null ? response.getBody() : ""
            ));

        } catch (Exception e) {
            log.error("Failed to register WATI webhook: {}", e.getMessage());
            return ResponseEntity.ok(Map.of(
                    "success", false,
                    "message", "Failed: " + e.getMessage()
            ));
        }
    }

    /**
     * Register webhook URL with Meta WhatsApp Cloud API.
     * SECURITY: Reads app_secret and credentials from server-side institute settings (NOT from frontend).
     * Frontend only sends { instituteId, webhookUrl, verifyToken }.
     *
     * Step 1: POST /{app-id}/subscriptions (register callback URL using App Access Token)
     * Step 2: POST /{waba-id}/subscribed_apps (subscribe WABA using System User token)
     */
    @PostMapping("/register-webhook/meta")
    public ResponseEntity<Map<String, Object>> registerMetaWebhook(@RequestBody Map<String, String> body) {
        String instituteId = body.get("instituteId");
        String webhookUrl = body.get("webhookUrl");
        String verifyToken = body.getOrDefault("verifyToken", "vacademy_webhook_secret");

        if (instituteId == null || webhookUrl == null) {
            return ResponseEntity.badRequest().body(Map.of("success", false,
                    "message", "Missing required fields: instituteId, webhookUrl"));
        }

        List<String> steps = new java.util.ArrayList<>();

        try {
            // Read Meta credentials from server-side institute settings
            InstituteInfoDTO institute = instituteInternalService.getInstituteByInstituteId(instituteId);
            JsonNode root = objectMapper.readTree(institute.getSetting());

            JsonNode whatsappSetting = root.path("setting")
                    .path(NotificationConstants.WHATSAPP_SETTING)
                    .path(NotificationConstants.DATA)
                    .path(NotificationConstants.UTILITY_WHATSAPP);
            if (whatsappSetting.isMissingNode()) {
                whatsappSetting = root.path(NotificationConstants.WHATSAPP_SETTING)
                        .path(NotificationConstants.DATA)
                        .path(NotificationConstants.UTILITY_WHATSAPP);
            }

            JsonNode meta = whatsappSetting.path("meta");
            String appId = meta.path("app_id").asText(meta.path("appId").asText(
                    whatsappSetting.path("appId").asText(whatsappSetting.path("app_id").asText(""))));
            String appSecret = meta.path("app_secret").asText(meta.path("appSecret").asText(""));
            String accessToken = meta.path("access_token").asText(meta.path("accessToken").asText(
                    whatsappSetting.path("access_token").asText("")));
            String wabaId = meta.path("wabaId").asText(meta.path("waba_id").asText(""));

            if (appId.isBlank() || appSecret.isBlank()) {
                return ResponseEntity.ok(Map.of("success", false,
                        "message", "Meta App ID and App Secret must be configured in provider credentials first"));
            }

            // Step 1: Register webhook URL on the app using App Access Token
            String appAccessToken = appId + "|" + appSecret;
            String subscriptionUrl = "https://graph.facebook.com/v22.0/" + appId + "/subscriptions";

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);

            // Subscribe to inbound messages/statuses AND template lifecycle events so Meta
            // pushes approval/rejection/recategorisation — otherwise a template created via
            // Vacademy stays PENDING locally even after Meta rejects/removes it.
            String formBody = "object=whatsapp_business_account"
                    + "&callback_url=" + java.net.URLEncoder.encode(webhookUrl, java.nio.charset.StandardCharsets.UTF_8)
                    + "&verify_token=" + java.net.URLEncoder.encode(verifyToken, java.nio.charset.StandardCharsets.UTF_8)
                    + "&fields=messages,message_template_status_update,message_template_category_update"
                    + "&access_token=" + java.net.URLEncoder.encode(appAccessToken, java.nio.charset.StandardCharsets.UTF_8);

            HttpEntity<String> request = new HttpEntity<>(formBody, headers);
            ResponseEntity<String> response = restTemplate.postForEntity(subscriptionUrl, request, String.class);

            if (response.getStatusCode().is2xxSuccessful()) {
                steps.add("Webhook URL registered on app");
                log.info("Meta webhook registered: appId={}, url={}", appId, webhookUrl);
            } else {
                log.error("Meta subscription failed: {}", response.getBody());
                return ResponseEntity.ok(Map.of("success", false,
                        "message", "Failed to register webhook: " + response.getBody(),
                        "steps", steps));
            }

            // Step 2: Subscribe WABA to the app (if WABA ID and access token available)
            if (!wabaId.isBlank() && !accessToken.isBlank()) {
                String subscribeUrl = "https://graph.facebook.com/v22.0/" + wabaId + "/subscribed_apps";

                HttpHeaders tokenHeaders = new HttpHeaders();
                tokenHeaders.setContentType(MediaType.APPLICATION_FORM_URLENCODED);

                String subscribeBody = "access_token=" + java.net.URLEncoder.encode(accessToken, java.nio.charset.StandardCharsets.UTF_8);
                HttpEntity<String> subscribeRequest = new HttpEntity<>(subscribeBody, tokenHeaders);
                ResponseEntity<String> subscribeResponse = restTemplate.postForEntity(subscribeUrl, subscribeRequest, String.class);

                if (subscribeResponse.getStatusCode().is2xxSuccessful()) {
                    steps.add("WABA subscribed to app webhook");
                    log.info("Meta WABA subscribed: wabaId={}", wabaId);
                } else {
                    steps.add("WABA subscription failed: " + subscribeResponse.getBody());
                    log.warn("Meta WABA subscription failed: {}", subscribeResponse.getBody());
                }
            } else {
                steps.add("WABA subscription skipped (no WABA ID or access token configured)");
            }

            return ResponseEntity.ok(Map.of(
                    "success", true,
                    "message", "Meta webhook setup complete",
                    "steps", steps
            ));

        } catch (Exception e) {
            log.error("Failed to register Meta webhook: {}", e.getMessage(), e);
            steps.add("Error: " + e.getMessage());
            return ResponseEntity.ok(Map.of(
                    "success", false,
                    "message", "Failed: " + e.getMessage(),
                    "steps", steps
            ));
        }
    }

    /**
     * Verify that our webhook endpoint is reachable (self-test). Institute staff only; the
     * URL must be a public http(s) address, redirects are not followed and the response body
     * is never returned.
     */
    @PostMapping("/verify-webhook")
    public ResponseEntity<Map<String, Object>> verifyWebhook(
            @RequestBody Map<String, String> body,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        InstituteStaffAccess.requireStaff(user, clientId);

        String webhookUrl = body.get("webhookUrl");
        if (webhookUrl == null) {
            return ResponseEntity.badRequest().body(Map.of("success", false));
        }
        if (!isPublicHttpUrl(webhookUrl)) {
            return ResponseEntity.ok(Map.of(
                    "success", false,
                    "message", "Webhook URL must be a public http(s) address"
            ));
        }

        try {
            // Send a GET with verify params to our own endpoint
            String testUrl = webhookUrl + "?hub.mode=subscribe&hub.challenge=test123&hub.verify_token=vacademy_webhook_secret";
            ResponseEntity<String> response = WEBHOOK_CHECK_CLIENT.getForEntity(testUrl, String.class);

            boolean success = response.getStatusCode().is2xxSuccessful()
                    && "test123".equals(response.getBody());

            return ResponseEntity.ok(Map.of(
                    "success", success,
                    "message", success ? "Webhook endpoint verified"
                            : "Verification failed (HTTP " + response.getStatusCode().value() + ")"
            ));

        } catch (Exception e) {
            log.info("Webhook self-test could not reach {}: {}", webhookUrl, e.getClass().getSimpleName());
            return ResponseEntity.ok(Map.of(
                    "success", false,
                    "message", "Endpoint unreachable"
            ));
        }
    }

    /** Self-test client: short timeouts, never follows redirects, 4xx/5xx returned as responses. */
    private static final RestTemplate WEBHOOK_CHECK_CLIENT = buildWebhookCheckClient();

    private static RestTemplate buildWebhookCheckClient() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory() {
            @Override
            protected void prepareConnection(HttpURLConnection connection, String httpMethod) throws IOException {
                super.prepareConnection(connection, httpMethod);
                connection.setInstanceFollowRedirects(false);
            }
        };
        factory.setConnectTimeout(5000);
        factory.setReadTimeout(10000);
        RestTemplate client = new RestTemplate(factory);
        client.setErrorHandler(new DefaultResponseErrorHandler() {
            @Override
            public boolean hasError(ClientHttpResponse response) {
                return false;
            }
        });
        return client;
    }

    /**
     * True for an http(s) URL whose host resolves only to public addresses (no loopback,
     * private, link-local, CGNAT, unique-local or metadata address, no cluster-internal name).
     */
    static boolean isPublicHttpUrl(String url) {
        try {
            URI uri = new URI(url.trim());
            String scheme = uri.getScheme();
            String host = uri.getHost();
            if (scheme == null || host == null || uri.getUserInfo() != null) {
                return false;
            }
            if (!scheme.equalsIgnoreCase("https") && !scheme.equalsIgnoreCase("http")) {
                return false;
            }
            String h = host.toLowerCase();
            if (h.equals("localhost") || h.endsWith(".local") || h.endsWith(".internal")
                    || h.endsWith(".svc") || h.endsWith(".cluster.local") || !h.contains(".")) {
                return false;
            }
            InetAddress[] addresses = InetAddress.getAllByName(host);
            if (addresses.length == 0) {
                return false;
            }
            for (InetAddress address : addresses) {
                if (isNonPublicAddress(address)) {
                    return false;
                }
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static boolean isNonPublicAddress(InetAddress address) {
        if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
                || address.isSiteLocalAddress() || address.isMulticastAddress()) {
            return true;
        }
        byte[] b = address.getAddress();
        if (b.length == 4) {
            int first = b[0] & 0xFF;
            int second = b[1] & 0xFF;
            return first == 0                                  // 0.0.0.0/8
                    || (first == 100 && second >= 64 && second <= 127) // 100.64.0.0/10
                    || (first == 192 && second == 0 && (b[2] & 0xFF) == 0) // 192.0.0.0/24
                    || first >= 240;                           // reserved
        }
        if (b.length == 16) {
            if ((b[0] & 0xFE) == 0xFC) {                       // fc00::/7
                return true;
            }
            boolean v4Mapped = true;
            for (int i = 0; i < 10; i++) {
                if (b[i] != 0) {
                    v4Mapped = false;
                    break;
                }
            }
            if (v4Mapped && (b[10] & 0xFF) == 0xFF && (b[11] & 0xFF) == 0xFF) {
                try {
                    return isNonPublicAddress(InetAddress.getByAddress(new byte[]{b[12], b[13], b[14], b[15]}));
                } catch (Exception e) {
                    return true;
                }
            }
        }
        return false;
    }

    // ==================== Cache Invalidation ====================

    /**
     * Evict provider config cache for an institute.
     * Call this after switching providers or updating credentials.
     */
    @PostMapping("/evict-cache")
    public ResponseEntity<Map<String, Object>> evictCache(@RequestParam String instituteId) {
        combotMessageProvider.evictConfig(instituteId);
        watiMessageProvider.evictConfig(instituteId);
        log.info("Evicted all provider config caches for institute {}", instituteId);
        return ResponseEntity.ok(Map.of("success", true, "message", "Cache evicted for " + instituteId));
    }
}
