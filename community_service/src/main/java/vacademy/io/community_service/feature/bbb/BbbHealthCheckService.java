package vacademy.io.community_service.feature.bbb;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.*;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.net.InetAddress;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

/**
 * Manages the BBB server pool lifecycle via scheduled tasks.
 *
 * Flow:
 * 1. scheduledStart() — Reads "how many servers to start" from
 * admin_core_service,
 * then triggers GitHub Actions workflow with server_count.
 * 2. scheduledHealthCheck() — Pings each running server's BBB API.
 * 3. scheduledStop() — Triggers GitHub Actions to stop ALL running servers.
 *
 * Pool config (which servers, their domains, max_meetings) is owned by
 * admin_core_service's bbb_server_pool table.
 */
@Service
@Slf4j
public class BbbHealthCheckService {

    private final RestTemplate restTemplate;

    private static final String META_API = "https://graph.facebook.com/v21.0";
    private static final String TEMPLATE_NAME = "vacademy_server_health_check_utility";
    private static final DateTimeFormatter IST_FORMATTER = DateTimeFormatter.ofPattern("dd MMM yyyy hh:mm a z");

    @Value("${WHATSAPP_ACCESS_TOKEN_VIDYAYATAN:}")
    private String waAccessToken;

    @Value("${WHATSAPP_PHONE_NUMBER_ID_VIDYAYATAN:}")
    private String waPhoneNumberId;

    @Value("${bbb.healthcheck.notify-phones:}")
    private String notifyPhones;

    /** Legacy single-server URL — used as fallback when pool API is unavailable */
    @Value("${bbb.healthcheck.url:https://meet.vacademy.io/bigbluebutton/api}")
    private String bbbApiUrl;

    @Value("${bbb.healthcheck.hostname:meet.vacademy.io}")
    private String bbbHostname;

    @Value("${GH_ACTION_TOKEN:}")
    private String githubToken;

    @Value("${bbb.github.repo:Vacademy-io/vacademy_edtech_platform}")
    private String githubRepo;

    /** admin_core_service base URL for pool queries */
    @Value("${ADMIN_CORE_SERVICE_BASE_URL:http://admin-core-service:8072}")
    private String adminCoreBaseUrl;

    public BbbHealthCheckService() {
        this.restTemplate = new RestTemplate();
    }

    // -----------------------------------------------------------------------
    // Scheduled tasks
    // -----------------------------------------------------------------------

    /**
     * Scheduled start — Mon-Sat at 2:30 pm IST.
     * Reads servers_to_start from admin_core_service, then dispatches the
     * GitHub Actions workflow with server_count parameter.
     */
    @Scheduled(cron = "0 30 14 * * MON-SAT", zone = "Asia/Kolkata")
    public void scheduledStart() {
        log.info("[BBB Pool] Scheduled START triggered");

        int serverCount = getServersToStart();
        log.info("[BBB Pool] Starting {} server(s)", serverCount);

        triggerPoolAction("start", "all", serverCount);
    }

    /**
     * Scheduled health check — Mon-Sat at 2:45 pm IST.
     * Checks all running servers from the pool and sends the WhatsApp health message.
     */
    @Scheduled(cron = "0 45 14 * * MON-SAT", zone = "Asia/Kolkata")
    public void scheduledHealthCheck() {
        log.info("[BBB Pool HealthCheck] Scheduled check triggered");
        runPoolHealthCheck(true);
    }

    /**
     * Scheduled stop — 2:00 AM IST, Mon-SUN (runs on the calendar day after each
     * class day)
     */
    @Scheduled(cron = "0 0 2 * * MON-SUN", zone = "Asia/Kolkata")
    public void scheduledStop() {
        log.info("[BBB Pool] Scheduled STOP triggered");
        triggerPoolAction("stop", "all", 0);
    }

    /**
     * Scheduled start — Sunday at 9:30 AM IST.
     */
    // @Scheduled(cron = "0 30 9 * * SUN", zone = "Asia/Kolkata")
    // public void scheduledStartSunday() {
    //     log.info("[BBB Pool] Scheduled START (Sunday) triggered");

    //     int serverCount = getServersToStart();
    //     log.info("[BBB Pool] Starting {} server(s)", serverCount);

    //     triggerPoolAction("start", "all", serverCount);
    // }

    /**
     * Scheduled health check — Sunday at 9:45 AM IST.
     */
    // @Scheduled(cron = "0 45 9 * * SUN", zone = "Asia/Kolkata")
    // public void scheduledHealthCheckSunday() {
    //     log.info("[BBB Pool HealthCheck] Scheduled check (Sunday) triggered");
    //     runPoolHealthCheck(true);
    // }

    /**
     * Scheduled stop — Sunday at 4:00 PM IST.
     */
    // @Scheduled(cron = "0 0 16 * * SUN", zone = "Asia/Kolkata")
    // public void scheduledStopSunday() {
    //     log.info("[BBB Pool] Scheduled STOP (Sunday) triggered");
    //     triggerPoolAction("stop", "all", 0);
    // }

    // -----------------------------------------------------------------------
    // Pool API client (talks to admin_core_service)
    // -----------------------------------------------------------------------

    /**
     * Get how many servers to start from admin_core_service config.
     */
    private int getServersToStart() {
        try {
            String url = adminCoreBaseUrl + "/admin-core-service/bbb/pool/config/servers-to-start";
            ResponseEntity<Map<String, Object>> response = restTemplate.exchange(
                    url, HttpMethod.GET, null,
                    new ParameterizedTypeReference<>() {
                    });

            if (response.getBody() != null && response.getBody().containsKey("serversToStart")) {
                return ((Number) response.getBody().get("serversToStart")).intValue();
            }
        } catch (Exception e) {
            log.warn("[BBB Pool] Failed to get servers_to_start from admin_core: {}. Defaulting to 1.", e.getMessage());
        }
        return 1; // safe default
    }

    /**
     * Get list of currently running servers from admin_core_service.
     */
    private List<Map<String, Object>> getRunningServers() {
        try {
            String url = adminCoreBaseUrl + "/admin-core-service/bbb/pool/servers/running";
            ResponseEntity<List<Map<String, Object>>> response = restTemplate.exchange(
                    url, HttpMethod.GET, null,
                    new ParameterizedTypeReference<>() {
                    });
            return response.getBody() != null ? response.getBody() : List.of();
        } catch (Exception e) {
            log.warn("[BBB Pool] Failed to get running servers: {}", e.getMessage());
            return List.of();
        }
    }

    /**
     * Update a server's health status in admin_core_service.
     */
    private void updateServerHealth(String slug, String healthStatus) {
        try {
            String url = adminCoreBaseUrl + "/admin-core-service/bbb/pool/" + slug + "/status";
            Map<String, Object> body = Map.of("healthStatus", healthStatus);
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(body, headers), String.class);
            log.info("[BBB Pool] Updated health status for {}: {}", slug, healthStatus);
        } catch (Exception e) {
            log.warn("[BBB Pool] Failed to update health for {}: {}", slug, e.getMessage());
        }
    }

    // -----------------------------------------------------------------------
    // Health check logic
    // -----------------------------------------------------------------------

    public Map<String, Object> runHealthCheck() {
        return runHealthCheck(bbbHostname, bbbApiUrl, true);
    }

    public Map<String, Object> runHealthCheck(String hostname, String apiUrl) {
        return runHealthCheck(hostname, apiUrl, true);
    }

    /**
     * Iterate the running pool and check each server. Updates DB health status.
     * Set notify=false to skip WhatsApp (used by manual UI button).
     */
    public Map<String, Object> runPoolHealthCheck(boolean notify) {
        List<Map<String, Object>> running = getRunningServers();
        if (running.isEmpty()) {
            log.info("[BBB Pool HealthCheck] No pool servers, checking legacy endpoint");
            Map<String, Object> legacy = runHealthCheck(bbbHostname, bbbApiUrl, notify);
            legacy.put("slug", "legacy");
            return Map.of("results", List.of(legacy), "checked", 1, "source", "legacy");
        }
        List<Map<String, Object>> results = new ArrayList<>();
        for (Map<String, Object> server : running) {
            String slug = (String) server.get("slug");
            String domain = (String) server.get("domain");
            String apiUrl = (String) server.get("apiUrl");
            if (apiUrl == null || apiUrl.isBlank()) {
                apiUrl = "https://" + domain + "/bigbluebutton/api";
            }
            log.info("[BBB Pool HealthCheck] Checking server: {} ({})", slug, domain);
            Map<String, Object> r = runHealthCheck(domain, apiUrl, notify);
            r.put("slug", slug);
            try {
                updateServerHealth(slug, (String) r.get("status"));
            } catch (Exception e) {
                log.warn("[BBB Pool HealthCheck] Failed to update health for {}: {}", slug, e.getMessage());
            }
            results.add(r);
        }
        return Map.of("results", results, "checked", results.size(), "source", "pool");
    }

    public Map<String, Object> runHealthCheck(String hostname, String apiUrl, boolean notify) {
        Map<String, Object> result = new LinkedHashMap<>();
        String timestamp = ZonedDateTime.now(ZoneId.of("Asia/Kolkata")).format(IST_FORMATTER);
        result.put("timestamp", timestamp);
        result.put("hostname", hostname);

        String status;
        String serverIp = "N/A";
        String details;

        try {
            // Resolve IP
            try {
                InetAddress addr = InetAddress.getByName(hostname);
                serverIp = addr.getHostAddress();
            } catch (Exception e) {
                serverIp = "DNS resolve failed";
            }
            result.put("ip", serverIp);

            // Check BBB API endpoint
            ResponseEntity<String> response = restTemplate.getForEntity(apiUrl, String.class);
            String body = response.getBody();

            if (response.getStatusCode().is2xxSuccessful() && body != null && body.contains("SUCCESS")) {
                status = "HEALTHY";
                details = "API OK, server responding";
            } else if (response.getStatusCode().is2xxSuccessful()) {
                status = "HEALTHY";
                details = "API reachable (HTTP " + response.getStatusCode().value() + ")";
            } else {
                status = "DEGRADED";
                details = "API returned HTTP " + response.getStatusCode().value();
            }
        } catch (Exception e) {
            status = "DOWN";
            details = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
            if (details.length() > 200)
                details = details.substring(0, 200);
            log.error("[BBB HealthCheck] {} failed: {}", hostname, details);
        }

        result.put("status", status);
        result.put("details", details);

        if (notify) {
            try {
                sendWhatsApp(status, serverIp, details, timestamp, hostname);
            } catch (Exception e) {
                log.error("[BBB HealthCheck] WhatsApp failed: {}", e.getMessage());
                result.put("notificationError", e.getMessage());
            }
        }

        return result;
    }

    // -----------------------------------------------------------------------
    // GitHub Actions dispatch — new pool-aware workflow
    // -----------------------------------------------------------------------

    /**
     * Trigger the BBB Pool Manage workflow.
     */
    public Map<String, Object> triggerPoolAction(String action, String serverSlug, int serverCount) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("action", action);
        result.put("serverSlug", serverSlug);
        result.put("serverCount", serverCount);

        if (githubToken == null || githubToken.isBlank()) {
            log.error("[BBB Pool] GH_ACTION_TOKEN not configured");
            result.put("error", "GH_ACTION_TOKEN not configured");
            return result;
        }

        if (!List.of("start", "stop", "status").contains(action)) {
            result.put("error", "Invalid action. Use: start, stop, status");
            return result;
        }

        try {
            // Use the new bbb-pool-manage.yml workflow
            String url = "https://api.github.com/repos/" + githubRepo
                    + "/actions/workflows/bbb-pool-manage.yml/dispatches";

            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "Bearer " + githubToken);
            headers.set("Accept", "application/vnd.github+json");
            headers.set("X-GitHub-Api-Version", "2022-11-28");
            headers.setContentType(MediaType.APPLICATION_JSON);

            // Include server_slug and server_count in dispatch inputs
            String body = String.format(
                    "{\"ref\":\"main\",\"inputs\":{\"action\":\"%s\",\"server_slug\":\"%s\",\"server_count\":\"%d\"}}",
                    action, serverSlug, serverCount);

            ResponseEntity<String> response = restTemplate.exchange(url, HttpMethod.POST,
                    new HttpEntity<>(body, headers), String.class);

            // A renamed repo answers a dispatch POST with 3xx, which RestTemplate does not
            // treat as an error. Without this check the call is logged as "triggered" while
            // GitHub never creates a run, so a start or stop fails silently.
            if (!response.getStatusCode().is2xxSuccessful()) {
                String msg = "Dispatch not accepted: HTTP " + response.getStatusCode();
                result.put("error", msg);
                log.error("[BBB Pool] {} (url={}, action={})", msg, url, action);
                return result;
            }

            result.put("status", "triggered");
            result.put("message",
                    "Pool workflow dispatched: " + action + " (slug=" + serverSlug + ", count=" + serverCount + ")");
            log.info("[BBB Pool] GitHub Action triggered: action={}, slug={}, count={}", action, serverSlug,
                    serverCount);
        } catch (Exception e) {
            result.put("error", e.getMessage());
            log.error("[BBB Pool] GitHub Action trigger failed: {}", e.getMessage());
        }

        return result;
    }

    /**
     * Legacy method — for backward compatibility with existing callers.
     */
    public Map<String, Object> triggerGitHubAction(String action) {
        return triggerPoolAction(action, "all", 1);
    }

    // -----------------------------------------------------------------------
    // WhatsApp notification
    // -----------------------------------------------------------------------

    private void sendWhatsApp(String status, String serverIp, String details,
            String timestamp, String hostname) {
        if (waAccessToken == null || waAccessToken.isBlank()
                || waPhoneNumberId == null || waPhoneNumberId.isBlank()
                || notifyPhones == null || notifyPhones.isBlank()) {
            log.info("[BBB HealthCheck] WhatsApp skipped — credentials not configured");
            return;
        }

        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", "Bearer " + waAccessToken);
        headers.setContentType(MediaType.APPLICATION_JSON);

        String[] phones = notifyPhones.split(",");

        for (String phone : phones) {
            phone = phone.trim();
            if (phone.isEmpty())
                continue;

            String payload = String.format("""
                    {
                        "messaging_product": "whatsapp",
                        "to": "%s",
                        "type": "template",
                        "template": {
                            "name": "%s",
                            "language": { "code": "en" },
                            "components": [
                                {
                                    "type": "body",
                                    "parameters": [
                                        { "type": "text", "text": "%s" },
                                        { "type": "text", "text": "%s" },
                                        { "type": "text", "text": "%s" },
                                        { "type": "text", "text": "%s" },
                                        { "type": "text", "text": "%s" }
                                    ]
                                }
                            ]
                        }
                    }""",
                    phone, TEMPLATE_NAME,
                    escapeJson(status),
                    escapeJson(hostname),
                    escapeJson(serverIp),
                    escapeJson(details),
                    escapeJson(timestamp));

            try {
                String url = META_API + "/" + waPhoneNumberId + "/messages";
                ResponseEntity<String> response = restTemplate.exchange(
                        url, HttpMethod.POST, new HttpEntity<>(payload, headers), String.class);
                log.info("[BBB HealthCheck] WhatsApp sent to {}: {}", phone, response.getBody());
            } catch (Exception e) {
                log.error("[BBB HealthCheck] WhatsApp to {} failed: {}", phone, e.getMessage());
            }
        }
    }

    private static String escapeJson(String s) {
        if (s == null)
            return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n");
    }
}
