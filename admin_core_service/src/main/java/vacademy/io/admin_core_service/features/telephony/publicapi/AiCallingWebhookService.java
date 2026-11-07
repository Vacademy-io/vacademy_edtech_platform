package vacademy.io.admin_core_service.features.telephony.publicapi;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import lombok.extern.slf4j.Slf4j;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.telephony.publicapi.entity.AiCallApiCall;
import vacademy.io.admin_core_service.features.telephony.publicapi.entity.AiCallWebhook;
import vacademy.io.admin_core_service.features.telephony.publicapi.repository.AiCallApiCallRepository;
import vacademy.io.admin_core_service.features.telephony.publicapi.repository.AiCallWebhookRepository;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.URI;
import java.net.http.HttpTimeoutException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;

/**
 * Webhooks for the public AI calling API.
 *
 * <p><b>Events.</b> {@code call.completed} — the call connected (outcome attached when the
 * AI result arrived); {@code call.not_connected} — it ended without a conversation
 * (no_answer, busy, failed, canceled, expired). One event per call, sent when the call
 * becomes final (see {@link AiCallingApiViews#state}).
 *
 * <p><b>Delivery.</b> POST, JSON, signed: {@code Telleo-Signature: t=<unix>,v1=<hex>} where
 * v1 = HMAC-SHA256(secret, t + "." + body). Any 2xx within 10 s is success. Otherwise
 * retried after 1 min, 5 min, 30 min, 2 h and 6 h, then marked failed. At-least-once: a
 * receiver dedupes on {@code Telleo-Event-Id} (stable across retries).
 *
 * <p><b>Outbox.</b> The finaliser and the sender are two scheduled passes over
 * ai_call_api_call; nothing hooks the call pipeline, so a missed signal costs at most one
 * tick. Both passes hold a ShedLock, so one pod runs each; if a lock lapses mid-pass an
 * event can go twice, which the stable event id makes safe.
 *
 * <p><b>Fairness.</b> The finaliser scans least-recently-checked first, and the sender takes
 * at most {@link #PER_INSTITUTE_PER_PASS} events per institute per pass, delivers different
 * institutes in parallel and stops an institute at its first failure in the pass. One
 * client's backlog or broken endpoint therefore never holds up another client's events.
 * Every delivery is bounded in total time: only the status line is read.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AiCallingWebhookService {

    static final List<Duration> RETRY_AFTER = List.of(Duration.ofMinutes(1), Duration.ofMinutes(5),
            Duration.ofMinutes(30), Duration.ofHours(2), Duration.ofHours(6));
    static final Duration TIMEOUT = Duration.ofSeconds(10);
    /** Calls older than this are no longer scanned for finality. */
    static final Duration SCAN_WINDOW = Duration.ofDays(7);
    static final String EVENT_COMPLETED = "call.completed";
    static final String EVENT_NOT_CONNECTED = "call.not_connected";
    static final int PER_INSTITUTE_PER_PASS = 10;
    static final int DELIVERY_THREADS = 8;
    /** A delivery pass gives up waiting well inside its 10-minute lock. */
    static final Duration PASS_DEADLINE = Duration.ofMinutes(4);
    static final Duration IDEMPOTENCY_TTL = Duration.ofHours(24);
    /** Ports a webhook may use. */
    static final Set<Integer> ALLOWED_PORTS = Set.of(443, 8443);
    /** Test events per institute per minute (each is an outbound request on our side). */
    static final int TEST_EVENTS_PER_MINUTE = 5;
    /** Addresses that must never receive a webhook (our own ingress and nodes), from config. */
    private static volatile Set<String> deniedAddresses = Set.of();

    private static final SecureRandom RANDOM = new SecureRandom();

    private final AiCallApiCallRepository callRepository;
    private final AiCallWebhookRepository webhookRepository;
    private final AiCallingApiViews views;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();
    private final ExecutorService deliveryPool = Executors.newFixedThreadPool(DELIVERY_THREADS, r -> {
        Thread t = new Thread(r, "ai-calling-webhook");
        t.setDaemon(true);
        return t;
    });
    private final Map<String, Deque<Long>> testEvents = new ConcurrentHashMap<>();

    @Value("${telephony.ai.api.webhook.denied-addresses:}")
    void setDeniedAddresses(String csv) {
        Set<String> out = new HashSet<>();
        if (csv != null) {
            for (String a : csv.split(",")) {
                if (!a.isBlank()) out.add(a.trim());
            }
        }
        deniedAddresses = Set.copyOf(out);
    }

    @PreDestroy
    void shutdown() {
        deliveryPool.shutdownNow();
    }

    // ── Configuration ────────────────────────────────────────────────────────────

    public Map<String, Object> get(String instituteId) {
        AiCallWebhook w = webhookRepository.findById(instituteId)
                .orElseThrow(() -> AiCallingApiException.notFound("Webhook"));
        return view(w, false);
    }

    /** Create or change the endpoint. A new endpoint gets a new secret, returned once. */
    public Map<String, Object> put(String instituteId, String url, String actor) {
        String clean = validateUrl(url);
        Optional<AiCallWebhook> existing = webhookRepository.findById(instituteId);
        AiCallWebhook w = existing.orElseGet(() -> AiCallWebhook.builder()
                .instituteId(instituteId).secret(newSecret()).createdBy(actor).build());
        w.setUrl(clean);
        w.setEnabled(true);
        w = webhookRepository.save(w);
        return view(w, existing.isEmpty());
    }

    public Map<String, Object> rotateSecret(String instituteId) {
        AiCallWebhook w = webhookRepository.findById(instituteId)
                .orElseThrow(() -> AiCallingApiException.notFound("Webhook"));
        w.setSecret(newSecret());
        w = webhookRepository.save(w);
        return view(w, true);
    }

    public void delete(String instituteId) {
        if (!webhookRepository.existsById(instituteId)) throw AiCallingApiException.notFound("Webhook");
        webhookRepository.deleteById(instituteId);
    }

    /** Send a webhook.test event now and report what the endpoint answered. */
    public Map<String, Object> sendTest(String instituteId) {
        AiCallWebhook w = webhookRepository.findById(instituteId)
                .orElseThrow(() -> AiCallingApiException.notFound("Webhook"));
        throttleTestEvents(instituteId);
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("message", "This is a test event from Telleo.");
        Delivery d = deliver(w, "evt_test_" + hex(8), "webhook.test", data);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("delivered", d.ok());
        out.put("status_code", d.code());
        if (d.error() != null) out.put("error", d.error());
        return out;
    }

    private void throttleTestEvents(String instituteId) {
        long now = System.currentTimeMillis();
        Deque<Long> times = testEvents.computeIfAbsent(instituteId, k -> new ArrayDeque<>());
        synchronized (times) {
            while (!times.isEmpty() && times.peekFirst() < now - 60_000) times.pollFirst();
            if (times.size() >= TEST_EVENTS_PER_MINUTE) {
                long retry = Math.max(1, (times.peekFirst() + 60_000 - now) / 1000);
                throw new AiCallingApiException(HttpStatus.TOO_MANY_REQUESTS, "rate_limited",
                        "At most " + TEST_EVENTS_PER_MINUTE + " test events a minute. Retry after " + retry + " seconds.",
                        null, (int) retry);
            }
            times.addLast(now);
        }
    }

    private Map<String, Object> view(AiCallWebhook w, boolean includeSecret) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("object", "webhook");
        m.put("url", w.getUrl());
        m.put("enabled", w.isEnabled());
        // One endpoint receives both families: AI calls and, since v1.2, human calls.
        m.put("events", List.of(EVENT_COMPLETED, EVENT_NOT_CONNECTED, HumanCallWebhookService.EVENT_COMPLETED,
                HumanCallWebhookService.EVENT_NOT_CONNECTED, HumanCallWebhookService.EVENT_ANALYSIS_READY));
        if (includeSecret) {
            m.put("secret", w.getSecret());
        } else {
            String s = w.getSecret();
            m.put("secret_hint", s == null ? null : s.substring(0, 6) + "…" + s.substring(s.length() - 4));
        }
        m.put("created_at", w.getCreatedAt() == null ? null : w.getCreatedAt().toString());
        m.put("updated_at", w.getUpdatedAt() == null ? null : w.getUpdatedAt().toString());
        return m;
    }

    // ── Outbox ───────────────────────────────────────────────────────────────────

    /** Mark calls final and queue their event. Read-mostly; one targeted write per call checked. */
    @Scheduled(fixedDelayString = "${telephony.ai.api.finalize-delay-ms:15000}", initialDelay = 30000)
    @SchedulerLock(name = "AiCallingApiFinalize", lockAtMostFor = "PT5M", lockAtLeastFor = "PT2S")
    public void finalizePass() {
        try {
            List<AiCallApiCall> open = callRepository.findOpen(Instant.now().minus(SCAN_WINDOW), 300);
            for (AiCallApiCall c : open) {
                if (Thread.currentThread().isInterrupted()) return;
                try {
                    finalizeOne(c);
                } catch (RuntimeException e) {
                    log.warn("ai-calling-api: finalise {} failed: {}", c.getId(), e.getMessage());
                }
            }
            callRepository.clearIdempotencyKeysBefore(Instant.now().minus(IDEMPOTENCY_TTL));
        } catch (RuntimeException e) {
            log.warn("ai-calling-api: finalise pass failed: {}", e.getMessage());
        }
    }

    void finalizeOne(AiCallApiCall c) {
        AiCallingApiViews.State s = views.state(c);
        if (!s.isFinal()) {
            callRepository.markChecked(c.getId());
            return;
        }
        boolean hasHook = webhookRepository.findById(c.getInstituteId()).map(AiCallWebhook::isEnabled).orElse(false);
        Instant now = Instant.now();
        callRepository.finalizeIfOpen(c.getId(), s.status(),
                "completed".equals(s.status()) ? EVENT_COMPLETED : EVENT_NOT_CONNECTED, now,
                hasHook ? AiCallApiCall.WEBHOOK_PENDING : AiCallApiCall.WEBHOOK_NONE, hasHook ? now : null);
    }

    @Scheduled(fixedDelayString = "${telephony.ai.api.webhook-delay-ms:5000}", initialDelay = 40000)
    @SchedulerLock(name = "AiCallingApiWebhooks", lockAtMostFor = "PT10M", lockAtLeastFor = "PT2S")
    public void deliverPass() {
        List<AiCallApiCall> due;
        try {
            due = callRepository.findWebhooksDue(Instant.now(), PER_INSTITUTE_PER_PASS, 200);
        } catch (RuntimeException e) {
            log.warn("ai-calling-api: webhook pass failed: {}", e.getMessage());
            return;
        }
        if (due.isEmpty()) return;
        // One task per institute, in order; institutes run in parallel. An institute stops at
        // its first failed delivery this pass (its endpoint is down; the rest wait their turn).
        Map<String, List<AiCallApiCall>> byInstitute = new LinkedHashMap<>();
        for (AiCallApiCall c : due) byInstitute.computeIfAbsent(c.getInstituteId(), k -> new ArrayList<>()).add(c);
        List<Future<?>> tasks = new ArrayList<>();
        for (List<AiCallApiCall> calls : byInstitute.values()) {
            tasks.add(deliveryPool.submit(() -> {
                for (AiCallApiCall c : calls) {
                    if (Thread.currentThread().isInterrupted()) return;
                    try {
                        if (!deliverOne(c)) return;
                    } catch (RuntimeException e) {
                        log.warn("ai-calling-api: webhook for {} failed: {}", c.getId(), e.getMessage());
                        return;
                    }
                }
            }));
        }
        long deadline = System.nanoTime() + PASS_DEADLINE.toNanos();
        for (Future<?> f : tasks) {
            try {
                f.get(Math.max(1, deadline - System.nanoTime()), TimeUnit.NANOSECONDS);
            } catch (TimeoutException e) {
                f.cancel(true);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                tasks.forEach(t -> t.cancel(true));
                return;
            } catch (ExecutionException e) {
                log.warn("ai-calling-api: webhook task failed: {}", e.getMessage());
            }
        }
    }

    /** Deliver one event and record the result. Returns false when the delivery failed. */
    boolean deliverOne(AiCallApiCall c) {
        Optional<AiCallWebhook> hook = webhookRepository.findById(c.getInstituteId()).filter(AiCallWebhook::isEnabled);
        if (hook.isEmpty()) {
            callRepository.recordDelivery(c.getId(), AiCallApiCall.WEBHOOK_NONE, c.getWebhookAttempts(), null,
                    c.getWebhookLastCode(), c.getWebhookLastError(), null);
            return true;
        }
        Map<String, Object> data = views.call(c, false);
        Delivery d = deliver(hook.get(), eventId(c), c.getFinalEvent(), data);
        if (d.interrupted()) return false;
        int attempt = c.getWebhookAttempts() + 1;
        String error = d.error() == null ? null : d.error().length() > 480 ? d.error().substring(0, 480) : d.error();
        if (d.ok()) {
            callRepository.recordDelivery(c.getId(), AiCallApiCall.WEBHOOK_DELIVERED, attempt, null, d.code(), null,
                    Instant.now());
        } else if (attempt > RETRY_AFTER.size()) {
            callRepository.recordDelivery(c.getId(), AiCallApiCall.WEBHOOK_FAILED, attempt, null, d.code(), error, null);
        } else {
            callRepository.recordDelivery(c.getId(), AiCallApiCall.WEBHOOK_PENDING, attempt,
                    Instant.now().plus(RETRY_AFTER.get(attempt - 1)), d.code(), error, null);
        }
        return d.ok();
    }

    /** Stable per call, so every retry of its event carries the same id. */
    static String eventId(AiCallApiCall c) {
        return "evt_" + c.getId().replaceFirst("^call_", "");
    }

    record Delivery(boolean ok, Integer code, String error, boolean interrupted) {
        Delivery(boolean ok, Integer code, String error) {
            this(ok, code, error, false);
        }
    }

    /**
     * POST one event. Only the status line is read and the body stream is closed at once, so
     * the whole exchange is bounded by the connect timeout plus {@link #TIMEOUT}: an endpoint
     * that sends headers and then drips a body cannot hold a thread. Errors are reported in
     * coarse words (never exception text), so the test route is no probe of other hosts.
     */
    Delivery deliver(AiCallWebhook w, String eventId, String type, Map<String, Object> data) {
        try {
            validateUrl(w.getUrl());
            Map<String, Object> event = new LinkedHashMap<>();
            event.put("id", eventId);
            event.put("object", "event");
            event.put("type", type);
            event.put("created_at", Instant.now().toString());
            event.put("data", data);
            String body = objectMapper.writeValueAsString(event);
            long t = Instant.now().getEpochSecond();
            HttpRequest req = HttpRequest.newBuilder(URI.create(w.getUrl()))
                    .timeout(TIMEOUT)
                    .header("Content-Type", "application/json")
                    .header("User-Agent", "Telleo-Webhooks/1.0")
                    .header("Telleo-Event-Id", eventId)
                    .header("Telleo-Event-Type", type)
                    .header("Telleo-Signature", "t=" + t + ",v1=" + sign(w.getSecret(), t, body))
                    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                    .build();
            HttpResponse<InputStream> resp = http.send(req, HttpResponse.BodyHandlers.ofInputStream());
            int code = resp.statusCode();
            try {
                resp.body().close();
            } catch (IOException ignored) {
                // The status is all we need.
            }
            return new Delivery(code >= 200 && code < 300, code, code >= 200 && code < 300 ? null : "HTTP " + code);
        } catch (AiCallingApiException e) {
            return new Delivery(false, null, e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new Delivery(false, null, "interrupted", true);
        } catch (HttpTimeoutException e) {
            return new Delivery(false, null, "timeout");
        } catch (javax.net.ssl.SSLException e) {
            log.debug("ai-calling-api: webhook TLS failure to {}: {}", w.getInstituteId(), e.getMessage());
            return new Delivery(false, null, "TLS handshake failed");
        } catch (IOException e) {
            log.debug("ai-calling-api: webhook connection failure for {}: {}", w.getInstituteId(), e.getMessage());
            return new Delivery(false, null, "connection failed");
        } catch (Exception e) {
            log.warn("ai-calling-api: webhook delivery error for {}: {}", w.getInstituteId(), e.toString());
            return new Delivery(false, null, "delivery failed");
        }
    }

    /** Hex HMAC-SHA256 of "t.body" — what Telleo-Signature v1 carries. */
    static String sign(String secret, long t, String body) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal((t + "." + body).getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("HMAC-SHA256 unavailable", e);
        }
    }

    /**
     * https only, a public host, and no credentials in the URL. The host is resolved and
     * every address checked, so a name that points at a private, loopback or link-local
     * address (our cluster, the cloud metadata endpoint) is refused — at set time and
     * again at every delivery, since DNS can change.
     */
    static String validateUrl(String raw) {
        if (raw == null || raw.isBlank()) throw AiCallingApiException.invalid("url is required.");
        URI u;
        try {
            u = URI.create(raw.trim());
        } catch (IllegalArgumentException e) {
            throw AiCallingApiException.invalid("url is not a valid URL.");
        }
        if (!"https".equalsIgnoreCase(u.getScheme())) throw AiCallingApiException.invalid("url must use https.");
        if (u.getHost() == null || u.getHost().isBlank()) throw AiCallingApiException.invalid("url has no host.");
        if (u.getUserInfo() != null) throw AiCallingApiException.invalid("url must not contain credentials.");
        if (raw.length() > 2048) throw AiCallingApiException.invalid("url is at most 2048 characters.");
        if (u.getPort() != -1 && !ALLOWED_PORTS.contains(u.getPort())) {
            throw AiCallingApiException.invalid("url must use port 443 (or 8443).");
        }
        try {
            for (InetAddress a : InetAddress.getAllByName(u.getHost())) {
                if (a.isLoopbackAddress() || a.isSiteLocalAddress() || a.isLinkLocalAddress()
                        || a.isAnyLocalAddress() || a.isMulticastAddress() || isUniqueLocalOrCgnat(a)
                        || deniedAddresses.contains(a.getHostAddress())) {
                    throw new AiCallingApiException(HttpStatus.BAD_REQUEST, "invalid_request",
                            "url must point to a public address.");
                }
            }
        } catch (java.net.UnknownHostException e) {
            throw AiCallingApiException.invalid("url host does not resolve.");
        }
        return u.toString();
    }

    private static boolean isUniqueLocalOrCgnat(InetAddress a) {
        byte[] b = a.getAddress();
        if (b.length == 16) return (b[0] & 0xfe) == 0xfc;                       // fc00::/7
        return (b[0] & 0xff) == 100 && (b[1] & 0xc0) == 64;                     // 100.64.0.0/10
    }

    private static String newSecret() {
        return "whsec_" + hex(24);
    }

    private static String hex(int bytes) {
        byte[] b = new byte[bytes];
        RANDOM.nextBytes(b);
        return HexFormat.of().formatHex(b);
    }
}
