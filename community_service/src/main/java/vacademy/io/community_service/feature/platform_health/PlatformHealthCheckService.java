package vacademy.io.community_service.feature.platform_health;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.client.ResponseErrorHandler;
import org.springframework.web.client.RestTemplate;
import vacademy.io.common.external.VendorCallLog;

import java.net.InetAddress;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * External uptime monitor for per-client deployments.
 *
 * <p>community_service runs on the shared Hetzner cluster; each client (Vet
 * Education, etc.) runs on its own separate infrastructure. This polls each
 * client's <i>public</i> API host from the outside and pages a WhatsApp group when
 * a deployment goes down or recovers. Because it is off-cluster it is a genuine
 * black-box check: it exercises DNS, the load balancer, ingress and the pod, which
 * is exactly the path a real user takes.</p>
 *
 * <p>Built after the 2026-08-12 Vet Education outage, where a duplicate Flyway
 * migration (two files at V444) crash-looped every admin-core-service pod for
 * roughly three hours. Nothing was watching that deployment, so the outage was
 * only discovered by a person noticing the CRM was broken.</p>
 *
 * <p>Modelled on {@code BbbHealthCheckService} — same Meta Graph API call, same
 * already-approved template, same comma-separated phone list — so it needs no new
 * WhatsApp template approval. It differs in three deliberate ways, each because
 * this monitor runs continuously across the public internet rather than on a fixed
 * daily in-cluster schedule:</p>
 *
 * <ul>
 *   <li><b>Consecutive-failure threshold.</b> A single failed probe does not page.
 *       Crossing the internet means transient DNS hiccups, TLS resets and LB
 *       reloads are normal; paging on the first blip trains people to ignore the
 *       channel. A deployment must fail {@code failure-threshold} checks in a row
 *       before it is declared DOWN.</li>
 *   <li><b>Alert on transition, not on every run.</b> At a 5-minute cadence,
 *       always-messaging would be 288 pages a day per client. It pages when state
 *       flips, then re-pages on a throttle while still broken so a long outage
 *       keeps nagging.</li>
 *   <li><b>Multi-tenant.</b> Each client deployment is an independent target with
 *       its own state, so adding the next client is a config line, not a code
 *       change. The page names the client, because "admin-core-service is DOWN" is
 *       useless when several deployments run the same service names.</li>
 * </ul>
 *
 * <p>State is in-memory and per-replica. If community_service is ever scaled past
 * one replica, each pod will track transitions independently and page separately —
 * move {@code TargetState} to Redis or gate the scheduler behind a leader election
 * before scaling.</p>
 */
@Service
@Slf4j
public class PlatformHealthCheckService {

    private static final String META_API = "https://graph.facebook.com/v21.0";

    /**
     * Reuses the BBB template so no new Meta approval is required. Body takes five
     * positional params: status, hostname, ip, details, timestamp. It is a UTILITY
     * template, which matters — MARKETING templates get throttled by Meta's
     * "healthy ecosystem engagement" rule when repeatedly sent to the same number,
     * and a paging channel that silently stops delivering is worse than no channel.
     */
    private static final String TEMPLATE_NAME = "vacademy_server_health_check_utility";

    private static final DateTimeFormatter IST_FORMATTER = DateTimeFormatter.ofPattern("dd MMM yyyy hh:mm a z");

    private final RestTemplate restTemplate;

    /**
     * Semicolon-separated client deployments to watch, each as
     * {@code name|baseUrl|service,service,...}
     *
     * <pre>
     * veted|https://api.letstalkvet.com|admin-core-service,auth-service,notification-service,media-service
     * </pre>
     *
     * Empty disables the monitor entirely, so non-production environments stay inert.
     */
    @Value("${platform.healthcheck.targets:}")
    private String targetsRaw;

    @Value("${platform.healthcheck.notify-phones:}")
    private String notifyPhones;

    /** Consecutive failed probes before a target is declared DOWN. */
    @Value("${platform.healthcheck.failure-threshold:2}")
    private int failureThreshold;

    /** Minutes before re-paging about an outage that is still ongoing. */
    @Value("${platform.healthcheck.realert-minutes:30}")
    private long realertMinutes;

    /** Page on every run regardless of transitions. Debug aid only. */
    @Value("${platform.healthcheck.always-notify:false}")
    private boolean alwaysNotify;

    @Value("${WHATSAPP_ACCESS_TOKEN_VIDYAYATAN:}")
    private String waAccessToken;

    @Value("${WHATSAPP_PHONE_NUMBER_ID_VIDYAYATAN:}")
    private String waPhoneNumberId;

    private final Map<String, TargetState> state = new ConcurrentHashMap<>();

    /** Per-deployment tracking, kept out of the probe logic. */
    private static class TargetState {
        /** "UP" / "DOWN", or null until the first verdict is reached. */
        volatile String status;
        /** Consecutive failing probes not yet promoted to a DOWN verdict. */
        volatile int consecutiveFailures;
        volatile Instant lastAlertAt;
        volatile Instant downSince;
    }

    public PlatformHealthCheckService(RestTemplateBuilder builder) {
        // A health probe must never inherit an unbounded timeout. If a remote service
        // hangs rather than refusing the connection, an infinite read would stall the
        // scheduler thread and the monitor would silently stop running — failing in
        // precisely the scenario it exists to catch.
        this.restTemplate = builder
                .setConnectTimeout(Duration.ofSeconds(5))
                .setReadTimeout(Duration.ofSeconds(10))
                // A non-2xx IS the answer for a health probe, not an error condition.
                // RestTemplate's DefaultResponseErrorHandler throws on 4xx/5xx, which
                // meant probe()'s non-2xx branch was unreachable dead code and every
                // failure fell into the catch block instead. The alert still fired, but
                // `details` carried the raw exception text — for a 503 that is nginx's
                // error HTML ("503 Service Unavailable: \"<html><head><title>...") pasted
                // into a WhatsApp message. Suppressing the throw lets the status code be
                // read normally so the page says a clean "HTTP 503".
                //
                // NOTE: this handler also applies to the Meta send below, which therefore
                // checks its response status explicitly rather than relying on a throw.
                .errorHandler(new ResponseErrorHandler() {
                    @Override
                    public boolean hasError(ClientHttpResponse response) {
                        return false;
                    }

                    @Override
                    public void handleError(ClientHttpResponse response) {
                        // no-op: the caller inspects the status code
                    }
                })
                .build();
    }

    // -----------------------------------------------------------------------
    // Scheduled probe
    // -----------------------------------------------------------------------

    @Scheduled(cron = "${platform.healthcheck.cron:0 */5 * * * *}")
    public void scheduledHealthCheck() {
        if (targetsRaw == null || targetsRaw.isBlank()) {
            return;
        }
        try {
            runAll(true);
        } catch (Exception e) {
            log.error("[PlatformHealth] Scheduled run failed: {}", e.getMessage(), e);
        }
    }

    // -----------------------------------------------------------------------
    // Orchestration
    // -----------------------------------------------------------------------

    /** Checks every configured deployment. */
    public Map<String, Object> runAll(boolean notify) {
        List<Map<String, Object>> all = new ArrayList<>();
        for (Target t : parseTargets()) {
            try {
                all.add(runTarget(t, notify));
            } catch (Exception e) {
                // One unreachable deployment must not prevent the others being checked.
                log.error("[PlatformHealth] Target {} failed: {}", t.name, e.getMessage());
                all.add(Map.of("target", t.name, "error", String.valueOf(e.getMessage())));
            }
        }
        return Map.of("checked", all.size(), "targets", all);
    }

    /** Checks one deployment by name, e.g. for a manual trigger. */
    public Map<String, Object> runTargetByName(String name, boolean notify) {
        for (Target t : parseTargets()) {
            if (t.name.equalsIgnoreCase(name)) {
                return runTarget(t, notify);
            }
        }
        return Map.of("error", "Unknown target: " + name);
    }

    private Map<String, Object> runTarget(Target target, boolean notify) {
        String timestamp = ZonedDateTime.now(ZoneId.of("Asia/Kolkata")).format(IST_FORMATTER);
        String host = hostOf(target.baseUrl);

        List<Map<String, Object>> results = new ArrayList<>();
        List<String> unhealthy = new ArrayList<>();

        for (String service : target.services) {
            Map<String, Object> r = probe(target.baseUrl, service);
            results.add(r);
            if (!"UP".equals(r.get("status"))) {
                unhealthy.add(service);
            }
        }

        boolean probeFailed = !unhealthy.isEmpty();
        TargetState st = state.computeIfAbsent(target.name, k -> new TargetState());

        // Promote a run of failures to a DOWN verdict only once the threshold is met,
        // so a single cross-internet blip cannot page anyone.
        //
        // IMPORTANT: this only *computes* a verdict. Nothing is written back to `st`
        // unless notify == true (see the commit block below). A manual, non-notifying
        // check must never advance the state machine — if it did, hitting the
        // unauthenticated POST /check (which defaults to notify=false) while a
        // service was down would move st.status to DOWN with no page sent, and the
        // next scheduled run would then see no transition and stay silent. The
        // outage would never be reported at all.
        int projectedFailures = probeFailed ? st.consecutiveFailures + 1 : 0;
        String verdict;
        if (probeFailed) {
            verdict = projectedFailures >= failureThreshold ? "DOWN" : "SUSPECT";
        } else {
            verdict = "UP";
        }

        int total = results.size();
        int healthy = total - unhealthy.size();

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("target", target.name);
        summary.put("baseUrl", target.baseUrl);
        summary.put("host", host);
        summary.put("timestamp", timestamp);
        summary.put("status", verdict);
        summary.put("healthy", healthy);
        summary.put("total", total);
        summary.put("unhealthy", unhealthy);
        summary.put("consecutiveFailures", projectedFailures);
        summary.put("results", results);

        // Read-only path: report what we saw, change nothing. Manual checks are a
        // diagnostic, not an input to the alerting state machine.
        if (!notify) {
            summary.put("notified", false);
            summary.put("stateCommitted", false);
            return summary;
        }

        summary.put("notified", maybeNotify(target, st, verdict, host, healthy, total, results, timestamp));

        // Commit state only on the authoritative (notifying) path.
        st.consecutiveFailures = projectedFailures;

        // SUSPECT is deliberately not written to st.status: it is an in-flight guess,
        // not a settled verdict. Recording it would make the next run read as a
        // transition and page before the threshold is actually met.
        if (!"SUSPECT".equals(verdict)) {
            if ("DOWN".equals(verdict) && !"DOWN".equals(st.status)) {
                st.downSince = Instant.now();
            }
            st.status = verdict;
        }
        summary.put("stateCommitted", true);
        return summary;
    }

    // -----------------------------------------------------------------------
    // Probe
    // -----------------------------------------------------------------------

    private Map<String, Object> probe(String baseUrl, String service) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("service", service);

        String url = trimTrailingSlash(baseUrl) + "/" + service + "/actuator/health";
        r.put("url", url);

        long startedAt = System.currentTimeMillis();
        try {
            ResponseEntity<String> response = restTemplate.getForEntity(url, String.class);
            long ms = System.currentTimeMillis() - startedAt;
            r.put("responseTimeMs", ms);
            r.put("httpStatus", response.getStatusCode().value());

            String body = response.getBody() == null ? "" : response.getBody();

            if (response.getStatusCode().is2xxSuccessful() && body.contains("\"status\":\"UP\"")) {
                r.put("status", "UP");
                r.put("details", "OK in " + ms + "ms");
            } else if (response.getStatusCode().is2xxSuccessful()) {
                // Actuator can answer 200 while reporting DOWN/OUT_OF_SERVICE depending on
                // configuration, so the status code alone is not sufficient evidence.
                r.put("status", "DEGRADED");
                r.put("details", "HTTP 200 but body not UP: " + truncate(body, 80));
            } else {
                r.put("status", "DOWN");
                r.put("details", "HTTP " + response.getStatusCode().value());
            }
        } catch (Exception e) {
            r.put("responseTimeMs", System.currentTimeMillis() - startedAt);
            r.put("status", "DOWN");
            r.put("details", truncate(e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName(), 120));
            log.warn("[PlatformHealth] {} {} DOWN: {}", baseUrl, service, r.get("details"));
        }
        return r;
    }

    // -----------------------------------------------------------------------
    // Notification decision
    // -----------------------------------------------------------------------

    private boolean maybeNotify(Target target, TargetState st, String verdict, String host,
            int healthy, int total, List<Map<String, Object>> results, String timestamp) {

        // Not yet a settled verdict — stay quiet until the threshold decides.
        if ("SUSPECT".equals(verdict) && !alwaysNotify) {
            return false;
        }

        boolean changed = st.status == null
                ? "DOWN".equals(verdict) // first verdict: page only if it is bad news
                : !st.status.equals(verdict);

        // Falls back to downSince when lastAlertAt is null. Without that fallback a
        // DOWN page that failed to send (Meta 5xx, expired token, network) would
        // leave lastAlertAt null forever: `changed` is false on every subsequent run
        // because the state already reads DOWN, so nothing would ever re-fire and
        // the outage would go permanently unreported. Retrying is the whole point of
        // a re-alert interval, and it matters most precisely when the first send failed.
        Instant since = st.lastAlertAt != null ? st.lastAlertAt : st.downSince;
        boolean stillDownAndDue = "DOWN".equals(verdict)
                && since != null
                && Duration.between(since, Instant.now()).toMinutes() >= realertMinutes;

        if (!alwaysNotify && !changed && !stillDownAndDue) {
            return false;
        }

        String headline;
        if ("UP".equals(verdict)) {
            String downFor = st.downSince == null
                    ? ""
                    : " after " + Duration.between(st.downSince, Instant.now()).toMinutes() + "m";
            headline = target.name.toUpperCase() + " RECOVERED" + downFor + " (" + healthy + "/" + total + " up)";
        } else {
            headline = target.name.toUpperCase() + " DOWN (" + healthy + "/" + total + " up)";
        }

        StringBuilder details = new StringBuilder();
        for (Map<String, Object> r : results) {
            if (details.length() > 0) {
                details.append(" | ");
            }
            details.append(r.get("service")).append(": ").append(r.get("status"));
            if (!"UP".equals(r.get("status"))) {
                details.append(" (").append(r.get("details")).append(")");
            }
        }

        try {
            sendWhatsApp(headline, host, resolve(host), truncate(details.toString(), 900), timestamp);
            st.lastAlertAt = Instant.now();
            return true;
        } catch (Exception e) {
            log.error("[PlatformHealth] WhatsApp page failed for {}: {}", target.name, e.getMessage());
            return false;
        }
    }

    // -----------------------------------------------------------------------
    // WhatsApp
    // -----------------------------------------------------------------------

    private void sendWhatsApp(String status, String hostname, String ip, String details, String timestamp) {
        if (waAccessToken == null || waAccessToken.isBlank()
                || waPhoneNumberId == null || waPhoneNumberId.isBlank()
                || notifyPhones == null || notifyPhones.isBlank()) {
            // WARN, not INFO: reaching here means we decided an alert was warranted
            // and then could not deliver it. Since the phone list is intentionally
            // empty by default (set via the VETED_PLATFORM_NOTIFY_PHONES
            // secret), a misconfigured deploy leaves a monitor that probes happily
            // and pages nobody — the worst possible state, because it looks healthy.
            log.warn("[PlatformHealth] WhatsApp skipped — token/phoneNumberId/phone-list not configured. "
                    + "An alert was suppressed. Set VETED_PLATFORM_NOTIFY_PHONES.");
            return;
        }

        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", "Bearer " + waAccessToken);
        headers.setContentType(MediaType.APPLICATION_JSON);

        for (String phone : notifyPhones.split(",")) {
            phone = phone.trim();
            if (phone.isEmpty()) {
                continue;
            }

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
                    escapeJson(ip),
                    escapeJson(details),
                    escapeJson(timestamp));

            try {
                String url = META_API + "/" + waPhoneNumberId + "/messages";
                ResponseEntity<String> response = restTemplate.exchange(
                        url, HttpMethod.POST, new HttpEntity<>(payload, headers), String.class);
                // MUST check explicitly. The no-op error handler configured in the
                // constructor means Meta returning 400 (bad template params, message too
                // long, number not on WhatsApp) no longer throws — without this check a
                // rejected page would be logged as "WhatsApp sent", which is the single
                // most dangerous line this class could produce: it would report a
                // healthy alerting channel that silently delivers nothing.
                if (response.getStatusCode().is2xxSuccessful()) {
                    log.info("[PlatformHealth] WhatsApp sent to {}: {}", phone, truncate(response.getBody(), 120));
                } else {
                    VendorCallLog.failed(url, "send whatsapp alert", payload, response.getStatusCode().value(),
                            response.getBody());
                    log.error("[PlatformHealth] WhatsApp to {} REJECTED by Meta: HTTP {} {}",
                            phone, response.getStatusCode().value(), truncate(response.getBody(), 300));
                }
            } catch (Exception e) {
                VendorCallLog.failed(META_API, "send whatsapp alert", payload, e);
                // One bad number must not stop the rest of the list being paged.
                log.error("[PlatformHealth] WhatsApp to {} failed: {}", phone, e.getMessage());
            }
        }
    }

    // -----------------------------------------------------------------------
    // Config parsing + helpers
    // -----------------------------------------------------------------------

    private static class Target {
        final String name;
        final String baseUrl;
        final List<String> services;

        Target(String name, String baseUrl, List<String> services) {
            this.name = name;
            this.baseUrl = baseUrl;
            this.services = services;
        }
    }

    private List<Target> parseTargets() {
        List<Target> out = new ArrayList<>();
        if (targetsRaw == null || targetsRaw.isBlank()) {
            return out;
        }
        for (String entry : targetsRaw.split(";")) {
            entry = entry.trim();
            if (entry.isEmpty()) {
                continue;
            }
            String[] parts = entry.split("\\|");
            if (parts.length < 3) {
                log.warn("[PlatformHealth] Ignoring malformed target (want name|baseUrl|services): {}", entry);
                continue;
            }
            List<String> services = new ArrayList<>();
            for (String s : parts[2].split(",")) {
                s = s.trim();
                if (!s.isEmpty()) {
                    services.add(s);
                }
            }
            if (services.isEmpty()) {
                log.warn("[PlatformHealth] Ignoring target with no services: {}", entry);
                continue;
            }
            out.add(new Target(parts[0].trim(), trimTrailingSlash(parts[1].trim()), services));
        }
        return out;
    }

    /** Cached view for dashboards. Does not re-probe. */
    public Map<String, Object> lastKnownStatus() {
        Map<String, Object> out = new LinkedHashMap<>();
        for (Target t : parseTargets()) {
            TargetState st = state.get(t.name);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("baseUrl", t.baseUrl);
            m.put("services", t.services);
            m.put("status", st == null || st.status == null ? "UNKNOWN" : st.status);
            m.put("consecutiveFailures", st == null ? 0 : st.consecutiveFailures);
            m.put("lastAlertAt", st == null || st.lastAlertAt == null ? null : st.lastAlertAt.toString());
            m.put("downSince", st == null || st.downSince == null ? null : st.downSince.toString());
            out.put(t.name, m);
        }
        return out;
    }

    private static String hostOf(String url) {
        if (url == null || url.isBlank()) {
            return "";
        }
        String h = url.replaceFirst("^https?://", "");
        int slash = h.indexOf('/');
        return slash > -1 ? h.substring(0, slash) : h;
    }

    private static String resolve(String host) {
        try {
            return InetAddress.getByName(host).getHostAddress();
        } catch (Exception e) {
            return "DNS resolve failed";
        }
    }

    private static String trimTrailingSlash(String s) {
        return s != null && s.endsWith("/") ? s.substring(0, s.length() - 1) : s;
    }

    private static String truncate(String s, int max) {
        if (s == null) {
            return "";
        }
        return s.length() <= max ? s : s.substring(0, max);
    }

    private static String escapeJson(String s) {
        if (s == null) {
            return "";
        }
        // Newlines and tabs are stripped rather than escaped: Meta rejects template
        // parameters containing them outright, so a raw stack trace landing in
        // `details` would fail the entire send.
        return s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", " ")
                .replace("\r", " ")
                .replace("\t", " ");
    }
}
