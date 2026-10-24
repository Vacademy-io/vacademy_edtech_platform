package vacademy.io.admin_core_service.features.course_settings.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.annotation.CachePut;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.course_settings.dto.LmsConnectionHealthDTO;
import vacademy.io.admin_core_service.features.course_settings.dto.LmsConnectionTestRequest;
import vacademy.io.admin_core_service.features.course_settings.dto.LmsConnectionTestResultDTO;
import vacademy.io.admin_core_service.features.course_settings.dto.LmsProviderDTO;
import vacademy.io.admin_core_service.features.course_settings.dto.LmsProviderFieldDTO;
import vacademy.io.admin_core_service.features.course_settings.dto.PackageTriggerDTO;
import vacademy.io.admin_core_service.features.institute.dto.settings.GenericSettingRequest;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.learner.enums.LmsSourcesEnum;
import vacademy.io.admin_core_service.features.packages.repository.PackageRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.workflow.entity.Workflow;
import vacademy.io.admin_core_service.features.workflow.entity.WorkflowTrigger;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowRepository;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowTriggerRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/**
 * Institute LMS connections (a library of saved external LMSes), the provider catalog the
 * settings UI renders, a live connection test, and applying a chosen connection to a course.
 *
 * <p>Storage ({@code LMS_SETTING.data.data}, double-data envelope):
 * <pre>{ defaultConnectionId, activeLms, connections: [ {id, type, name, ...fields} ], ...mirror }</pre>
 * {@code activeLms} + the default connection's flat fields are mirrored at the top level so
 * legacy readers (LearnerPortalAccessService.determineActiveLms) keep working. Connection
 * {@code type} is LEARNDASH or MOODLE — they are SEPARATE connections (Moodle is its own type,
 * not nested inside LearnDash). Vacademy is the implicit built-in when there are no connections.</p>
 *
 * <p>Per course, {@link #applyConnectionToPackage} writes the key the enrolment workflow already
 * reads — Moodle → {@code MOODLE_SETTING.data.data = { moodleBaseUrl, moodleToken, moodleCourseId }}
 * (shared portal + per-course id), LearnDash → {@code LMS_SETTING} — and optionally attaches an
 * existing workflow to the course's package sessions.</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LmsSettingService {

    private static final String LMS_SETTING_KEY = "LMS_SETTING";
    private static final String MOODLE_SETTING_KEY = "MOODLE_SETTING";
    private static final String ENROLL_EVENT = "LEARNER_BATCH_ENROLLMENT";
    private static final String PACKAGE_SESSION_TYPE = "PACKAGE_SESSION";

    /** Concurrent LMS probes per health sweep. Bounded so a long connection list can't
     *  open an unbounded number of sockets from one dashboard load. */
    private static final int HEALTH_MAX_PARALLEL_CHECKS = 4;
    /** Hard ceiling on a whole sweep. Each probe already allows 10s; this stops a slow LMS
     *  from holding the dashboard request open indefinitely. */
    private static final long HEALTH_SWEEP_TIMEOUT_SECONDS = 25;

    private static final List<String> LEARNDASH_KEYS = List.of(
            "apiUrl", "ldLmsApiUrl", "apiKey", "apiSecret", "fullAccessGroupId", "sendcredentialsCrmSecret");
    private static final List<String> MOODLE_KEYS = List.of("moodleBaseUrl", "moodleToken");

    private final InstituteSettingService instituteSettingService;
    private final PackageSettingService packageSettingService;
    private final PackageRepository packageRepository;
    private final PackageSessionRepository packageSessionRepository;
    private final WorkflowRepository workflowRepository;
    private final WorkflowTriggerRepository workflowTriggerRepository;
    private final ObjectMapper objectMapper;

    // ─────────────────────────────────────────────────────────────────────────
    // Providers + connections + existing-config discovery
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * The institute's LMS connections plus where they were resolved from.
     *
     * <p>Extracted so the settings page ({@link #getProviders}) and the dashboard health check
     * ({@link #getConnectionHealth}) resolve connections through exactly the same path. If they
     * each had their own copy, the health widget could report on a different set of connections
     * than the one the admin is looking at in Settings.</p>
     */
    private record ResolvedConnections(ArrayNode connections, String activeLms,
                                       String defaultConnectionId, String configSource,
                                       JsonNode inner) {
    }

    /**
     * Everything the LMS settings UI needs: the provider catalog (types + field schema), the
     * institute's saved connections, the default connection, and back-compat fields. Never blank:
     * if the institute hasn't set anything but a course already has LMS config, that is surfaced.
     */
    public Map<String, Object> getProviders(String instituteId) {
        // Selectable LMS = the full provider catalog (Vacademy + LearnDash + Moodle + Custom),
        // not just LmsSourcesEnum — the integration is provider-agnostic (any LMS via Custom).
        List<String> available = buildProviderCatalog().stream().map(LmsProviderDTO::getId).toList();
        ResolvedConnections resolved = resolveInstituteConnections(instituteId);

        Object instituteLmsConfig = null;
        if (resolved.inner() != null && resolved.inner().isObject()) {
            instituteLmsConfig = objectMapper.convertValue(resolved.inner(), Object.class);
        }

        Map<String, Object> response = new HashMap<>();
        response.put("availableLms", available);
        response.put("activeLms", resolved.activeLms());
        response.put("instituteLmsConfig", instituteLmsConfig);
        response.put("providers", buildProviderCatalog());
        response.put("connections", objectMapper.convertValue(resolved.connections(), List.class));
        response.put("defaultConnectionId", resolved.defaultConnectionId());
        response.put("configSource", resolved.configSource());
        return response;
    }

    /** @see ResolvedConnections */
    private ResolvedConnections resolveInstituteConnections(String instituteId) {
        String activeLms = LmsSourcesEnum.VACADEMY.name();
        String configSource = "NONE";
        String defaultConnectionId = null;

        JsonNode inner = null;
        try {
            inner = readInstituteSettingInner(instituteId, LMS_SETTING_KEY);
        } catch (Exception e) {
            log.warn("Could not read institute LMS settings for {}: {}", instituteId, e.getMessage());
        }

        ArrayNode connections;
        boolean instituteHasNewConnections = inner != null
                && inner.path("connections").isArray() && inner.get("connections").size() > 0;

        if (instituteHasNewConnections) {
            // The institute has a curated connection list — but it is a SNAPSHOT, not the whole
            // truth. It was seeded from discovery (ids like disc-ld-… / legacy-…) plus whatever
            // an admin added by hand, and nothing re-syncs it. A course wired to a NEW LMS after
            // that snapshot was taken has a live, enrolling connection that never enters the list.
            //
            // Real case: Vet Education's list held 7 connections while its courses referenced 6
            // distinct endpoints, and "Practice Membership - Apiam" (learning.apiam.com.au) was
            // in the courses but not the list — so it was invisible on the LMS settings page and
            // to the dashboard health widget, despite actively enrolling learners.
            //
            // So union the two rather than letting the snapshot short-circuit discovery. Curated
            // entries are inserted FIRST, so an admin's own id/name wins the dedup and only
            // genuinely new endpoints are appended. This is strictly additive — connKey dedups on
            // type + normalised URL + auth key, so nothing already listed is removed or renamed.
            //
            // It also matches what the rest of this class already does: findConnection() has
            // always fallen through to discoverConnectionsFromCourses(), so a discovered
            // connection could already be APPLIED to a course — it just could not be SEEN.
            ArrayNode curated = (ArrayNode) inner.get("connections");
            java.util.LinkedHashMap<String, ObjectNode> byKey = new java.util.LinkedHashMap<>();
            for (JsonNode c : curated) {
                if (c.isObject()) {
                    byKey.put(connKey(c), (ObjectNode) c);
                }
            }
            for (ObjectNode c : discoverConnectionsFromCourses(instituteId)) {
                byKey.putIfAbsent(connKey(c), c);
            }
            connections = objectMapper.createArrayNode();
            byKey.values().forEach(connections::add);

            configSource = "INSTITUTE";
            // Read the active/default off the CURATED list, not the union: which connection is
            // the institute's default is the admin's decision, and appending a discovered one
            // must not be able to change it.
            activeLms = inner.path("activeLms").asText(curated.get(0).path("type").asText(activeLms));
            defaultConnectionId = inner.hasNonNull("defaultConnectionId")
                    ? inner.get("defaultConnectionId").asText()
                    : curated.get(0).path("id").asText(null);
        } else {
            // No curated list yet: discover EVERY distinct connection — from a legacy institute
            // config AND from each course's settings — deduped by (type, base URL, auth username).
            connections = objectMapper.createArrayNode();
            java.util.LinkedHashMap<String, ObjectNode> byKey = new java.util.LinkedHashMap<>();
            boolean instituteHadLegacy = inner != null
                    && (inner.hasNonNull("activeLms") || hasAnyConnectionField(inner));
            if (instituteHadLegacy) {
                for (JsonNode c : resolveConnections(inner)) {
                    byKey.put(connKey(c), (ObjectNode) c);
                }
            }
            for (ObjectNode c : discoverConnectionsFromCourses(instituteId)) {
                byKey.putIfAbsent(connKey(c), c);
            }
            byKey.values().forEach(connections::add);
            configSource = instituteHadLegacy ? "INSTITUTE" : (connections.size() > 0 ? "COURSE" : "NONE");
            if (connections.size() > 0) {
                activeLms = connections.get(0).path("type").asText(activeLms);
                defaultConnectionId = connections.get(0).path("id").asText(null);
            }
        }

        return new ResolvedConnections(connections, activeLms, defaultConnectionId, configSource, inner);
    }

    /**
     * Normalise stored config to a connections array. New shape already has {@code connections[]};
     * a legacy single-active config is wrapped into one synthesized connection so it still shows.
     */
    private ArrayNode resolveConnections(JsonNode inner) {
        if (inner.has("connections") && inner.get("connections").isArray()) {
            return (ArrayNode) inner.get("connections");
        }
        ArrayNode arr = objectMapper.createArrayNode();
        String activeLms = inner.path("activeLms").asText("");
        boolean hasMoodle = !inner.path("moodleBaseUrl").asText("").isBlank()
                || !inner.path("moodleToken").asText("").isBlank();
        boolean hasLd = LEARNDASH_KEYS.stream().anyMatch(k -> !inner.path(k).asText("").isBlank())
                || "LEARNDASH".equalsIgnoreCase(activeLms);
        if (hasLd) {
            ObjectNode c = objectMapper.createObjectNode();
            c.put("id", "legacy-learndash");
            c.put("type", "LEARNDASH");
            c.put("name", "LearnDash");
            LEARNDASH_KEYS.forEach(k -> {
                if (inner.hasNonNull(k)) c.put(k, inner.get(k).asText());
            });
            arr.add(c);
        }
        if (hasMoodle) {
            ObjectNode c = objectMapper.createObjectNode();
            c.put("id", "legacy-moodle");
            c.put("type", "MOODLE");
            c.put("name", "Moodle");
            MOODLE_KEYS.forEach(k -> {
                if (inner.hasNonNull(k)) c.put(k, inner.get(k).asText());
            });
            arr.add(c);
        }
        return arr;
    }

    /** The connection types the UI can add + the built-in, with friendly copy + field schema. */
    private List<LmsProviderDTO> buildProviderCatalog() {
        LmsProviderDTO vacademy = LmsProviderDTO.builder()
                .id(LmsSourcesEnum.VACADEMY.name())
                .displayName("Vacademy (built-in)")
                .tagline("Use the learning experience that ships with this platform.")
                .description("Your learners study right here — no external system to connect.")
                .enables(List.of("Courses & content hosted in this platform", "Nothing to set up"))
                .requiresConnection(false)
                .fields(List.of())
                .build();

        LmsProviderDTO learndash = LmsProviderDTO.builder()
                .id("LEARNDASH")
                .displayName("LearnDash (WordPress)")
                .tagline("Connect a LearnDash site running on WordPress.")
                .description("On enrolment, the CRM creates the learner's account on your LearnDash site "
                        + "and enrols them in the mapped course.")
                .enables(List.of("Auto-create accounts on your WordPress/LearnDash site",
                        "Auto-enrol into the mapped course", "Send login details"))
                .docsUrl("https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/#application-passwords")
                .requiresConnection(true)
                .fields(List.of(
                        field("apiUrl", "WordPress REST API URL", "url", true,
                                "https://yoursite.com/wp-json/wp/v2",
                                "Your WordPress REST API base — usually your site address + /wp-json/wp/v2."),
                        field("ldLmsApiUrl", "LearnDash API URL", "url", true,
                                "https://yoursite.com/wp-json/ldlms/v2",
                                "The LearnDash API base — usually your site address + /wp-json/ldlms/v2."),
                        field("apiKey", "WordPress username or email", "text", true,
                                "admin@yoursite.com",
                                "The WordPress account the CRM connects as (needs LearnDash admin access)."),
                        field("apiSecret", "Application password", "secret", true,
                                "xxxx xxxx xxxx xxxx",
                                "WordPress → Users → Profile → Application Passwords. Generate one and paste it here."),
                        field("fullAccessGroupId", "Full-access group ID", "text", false,
                                "69853", "Optional. The LearnDash group that grants access to all courses."),
                        field("sendcredentialsCrmSecret", "Credential-sync secret", "secret", false,
                                "shared secret", "Optional. Secures credential-sync requests with your site.")))
                .build();

        LmsProviderDTO moodle = LmsProviderDTO.builder()
                .id("MOODLE")
                .displayName("Moodle")
                .tagline("Connect your Moodle site.")
                .description("On enrolment, the CRM creates the learner in Moodle and enrols them into the "
                        + "course you map. The site + token are shared; you set the Moodle course id per course.")
                .enables(List.of("Auto-create learners in Moodle", "Auto-enrol into the mapped Moodle course"))
                .docsUrl("https://docs.moodle.org/en/Using_web_services")
                .requiresConnection(true)
                .fields(List.of(
                        field("moodleBaseUrl", "Moodle site URL", "url", true,
                                "https://moodle.yoursite.com",
                                "The web address you use to log in to Moodle."),
                        field("moodleToken", "Web service token", "secret", true,
                                "Moodle web service token",
                                "Moodle → Site administration → Server → Web services → Manage tokens. "
                                        + "Create one for an admin user with the REST protocol enabled.")))
                .build();

        // No preset fields — you define the connection entirely with your own key–value pairs,
        // so any LMS the platform doesn't know about can still be connected.
        LmsProviderDTO custom = LmsProviderDTO.builder()
                .id("CUSTOM")
                .displayName("Other / Custom LMS")
                .tagline("Connect any other LMS with your own fields.")
                .description("Add exactly the connection details your LMS or workflow needs as key–value pairs.")
                .enables(List.of("Bring any LMS", "Define only the fields your workflow reads"))
                .requiresConnection(true)
                .fields(List.of())
                .build();

        return List.of(vacademy, learndash, moodle, custom);
    }

    private LmsProviderFieldDTO field(String key, String label, String type, boolean required,
                                      String placeholder, String help) {
        return LmsProviderFieldDTO.builder()
                .key(key).label(label).type(type).required(required).placeholder(placeholder).help(help).build();
    }

    private boolean hasAnyConnectionField(JsonNode lms) {
        if (lms == null || !lms.isObject()) return false;
        for (String k : LEARNDASH_KEYS) {
            if (!lms.path(k).asText("").isBlank()) return true;
        }
        for (String k : MOODLE_KEYS) {
            if (!lms.path(k).asText("").isBlank()) return true;
        }
        return false;
    }

    /**
     * Discover every distinct LMS connection the admin configured across the institute's courses:
     * LearnDash from each course's LMS_SETTING and Moodle from each MOODLE_SETTING. Deduped by
     * (type, base URL, auth username) so e.g. three different LearnDash sites/logins show as three
     * connections and one Moodle site as one. The per-course courseId is dropped — it belongs to
     * the course, not the shared connection.
     */
    private List<ObjectNode> discoverConnectionsFromCourses(String instituteId) {
        java.util.LinkedHashMap<String, ObjectNode> byKey = new java.util.LinkedHashMap<>();
        List<String> settings;
        try {
            settings = packageRepository.findCourseSettingsWithLmsByInstitute(instituteId);
        } catch (Exception e) {
            log.warn("Could not scan course LMS settings for institute {}: {}", instituteId, e.getMessage());
            return new ArrayList<>();
        }
        for (String raw : settings) {
            if (raw == null || raw.isBlank()) continue;
            JsonNode setting;
            try {
                setting = objectMapper.readTree(raw).path("setting");
            } catch (Exception e) {
                continue;
            }
            JsonNode ld = innerData(setting.path(LMS_SETTING_KEY));
            if (ld != null && ld.path("connections").isArray()) {
                for (JsonNode c : ld.get("connections")) {
                    if (c.isObject()) byKey.putIfAbsent(connKey(c), (ObjectNode) c.deepCopy());
                }
            }
            if (ld != null && !ld.path("apiUrl").asText("").isBlank()) {
                ObjectNode c = learndashConnection(ld);
                byKey.putIfAbsent(connKey(c), c);
            }
            JsonNode mo = innerData(setting.path(MOODLE_SETTING_KEY));
            if (mo != null && !mo.path("moodleBaseUrl").asText("").isBlank()) {
                ObjectNode c = moodleConnection(mo);
                byKey.putIfAbsent(connKey(c), c);
            }
        }
        return new ArrayList<>(byKey.values());
    }

    /** Unwrap a course setting entry ({key,name,data}) to its inner data (handles double-data). */
    private JsonNode innerData(JsonNode entry) {
        if (entry == null || entry.isMissingNode() || entry.isNull()) return null;
        JsonNode d = entry.path("data");
        if (d.isMissingNode() || d.isNull()) return null;
        JsonNode dd = d.path("data");
        if (dd.isObject()) return dd;
        return d.isObject() ? d : null;
    }

    private ObjectNode learndashConnection(JsonNode src) {
        ObjectNode c = objectMapper.createObjectNode();
        String apiUrl = src.path("apiUrl").asText("");
        String user = src.path("apiKey").asText("");
        c.put("id", "disc-ld-" + slug(normUrl(apiUrl) + "-" + user));
        c.put("type", "LEARNDASH");
        String host = hostOf(apiUrl);
        c.put("name", user.isBlank() ? "LearnDash · " + host : "LearnDash · " + host + " (" + user + ")");
        LEARNDASH_KEYS.forEach(k -> {
            if (src.hasNonNull(k)) c.put(k, src.get(k).asText());
        });
        return c;
    }

    private ObjectNode moodleConnection(JsonNode src) {
        ObjectNode c = objectMapper.createObjectNode();
        String base = src.path("moodleBaseUrl").asText("");
        c.put("id", "disc-moodle-" + slug(normUrl(base)));
        c.put("type", "MOODLE");
        c.put("name", "Moodle · " + hostOf(base));
        MOODLE_KEYS.forEach(k -> {
            if (src.hasNonNull(k)) c.put(k, src.get(k).asText());
        });
        return c;
    }

    /** Dedup key (per user): type + base URL + auth username — LearnDash apiKey, Moodle token. */
    private String connKey(JsonNode c) {
        String type = c.path("type").asText("").toUpperCase();
        if ("MOODLE".equals(type)) {
            return "MOODLE|" + normUrl(c.path("moodleBaseUrl").asText("")) + "|"
                    + c.path("moodleToken").asText("").trim();
        }
        if ("LEARNDASH".equals(type)) {
            return "LEARNDASH|" + normUrl(c.path("apiUrl").asText("")) + "|"
                    + c.path("apiKey").asText("").trim();
        }
        // Custom / unknown type — dedup by its own id/name so it isn't collapsed with others.
        return type + "|" + c.path("name").asText("") + "|" + c.path("id").asText("");
    }

    private static String normUrl(String s) {
        if (s == null) return "";
        String v = s.trim().toLowerCase();
        return v.endsWith("/") ? v.substring(0, v.length() - 1) : v;
    }

    private static String hostOf(String url) {
        try {
            String h = URI.create(url.trim()).getHost();
            return h != null && !h.isBlank() ? h : url;
        } catch (Exception e) {
            return url;
        }
    }

    private static String slug(String s) {
        String v = s.toLowerCase().replaceAll("[^a-z0-9]+", "-").replaceAll("(^-+|-+$)", "");
        return v.isBlank() ? "x" : v;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Live connection test (before saving)
    // ─────────────────────────────────────────────────────────────────────────

    /** Live-tests a connection from form values. Never throws — returns a friendly ok/fail message. */
    /**
     * Live health of every saved LMS connection — backs the dashboard's connection-health widget.
     *
     * <p>Runs the same {@link #testConnection} the settings form uses, but against the STORED
     * credentials instead of form values, so nothing secret has to travel to the browser and back.
     * Only the connection's host is returned.</p>
     *
     * <p>Checks run concurrently: each test allows up to 10s, so a serial sweep of an institute
     * with several connections could outlast the request. Concurrency is capped so a large
     * connection list can't open an unbounded number of sockets, and the whole sweep is bounded
     * by {@link #HEALTH_SWEEP_TIMEOUT_SECONDS} — anything still running by then is reported as a
     * timeout rather than holding the response open.</p>
     *
     * <p><b>Cached for 1 minute, per institute.</b> The widget polls every 60s, so without a cache
     * every open dashboard would independently probe the customer's WordPress/Moodle site every
     * minute — five admins with the tab open means five times the outbound traffic to a third
     * party we don't own. The TTL matches the poll interval, so the result is never older than the
     * widget's own "checked N ago" claims.</p>
     *
     * <p>The stale-after-a-fix problem a cache would otherwise introduce is handled by
     * {@link #refreshConnectionHealth}: the widget's manual refresh button bypasses the cache, so
     * an admin who has just fixed a connection gets a live answer immediately.</p>
     */
    @Cacheable(value = "lmsConnectionHealth", key = "#instituteId")
    public LmsConnectionHealthDTO getConnectionHealth(String instituteId) {
        return runConnectionHealthSweep(instituteId);
    }

    /**
     * A live sweep that ignores (and replaces) the cached result — what the widget's refresh
     * button calls. Without this, an admin who just fixed a broken connection would keep seeing
     * the failure for up to a minute and reasonably conclude the fix hadn't worked.
     */
    @CachePut(value = "lmsConnectionHealth", key = "#instituteId")
    public LmsConnectionHealthDTO refreshConnectionHealth(String instituteId) {
        return runConnectionHealthSweep(instituteId);
    }

    private LmsConnectionHealthDTO runConnectionHealthSweep(String instituteId) {
        ResolvedConnections resolved = resolveInstituteConnections(instituteId);
        ArrayNode connections = resolved.connections();

        List<JsonNode> nodes = new ArrayList<>();
        connections.forEach(nodes::add);

        List<LmsConnectionHealthDTO.ConnectionHealth> results = new ArrayList<>();
        if (!nodes.isEmpty()) {
            int parallelism = Math.min(nodes.size(), HEALTH_MAX_PARALLEL_CHECKS);
            ExecutorService pool = Executors.newFixedThreadPool(parallelism);
            try {
                List<Callable<LmsConnectionHealthDTO.ConnectionHealth>> tasks = nodes.stream()
                        .map(node -> (Callable<LmsConnectionHealthDTO.ConnectionHealth>) () ->
                                checkOneConnection(node, resolved.defaultConnectionId()))
                        .toList();
                List<Future<LmsConnectionHealthDTO.ConnectionHealth>> futures =
                        pool.invokeAll(tasks, HEALTH_SWEEP_TIMEOUT_SECONDS, TimeUnit.SECONDS);
                for (int i = 0; i < futures.size(); i++) {
                    JsonNode node = nodes.get(i);
                    try {
                        results.add(futures.get(i).get());
                    } catch (Exception e) {
                        // Cancelled by the sweep timeout, or the check itself blew up. Either way
                        // the admin needs to see the connection listed, not silently dropped.
                        results.add(unreachable(node, resolved.defaultConnectionId(),
                                "The check didn't finish in time — the LMS may be slow or unreachable.",
                                e.getClass().getSimpleName()));
                    }
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                log.warn("LMS health sweep interrupted for institute {}", instituteId);
            } finally {
                pool.shutdownNow();
            }
        }

        int healthy = (int) results.stream().filter(r -> "HEALTHY".equals(r.getStatus())).count();
        int unhealthy = (int) results.stream().filter(r -> "UNHEALTHY".equals(r.getStatus())).count();
        int notApplicable = results.size() - healthy - unhealthy;

        return LmsConnectionHealthDTO.builder()
                .checkedAt(Instant.now())
                .configSource(resolved.configSource())
                .total(results.size())
                .healthy(healthy)
                .unhealthy(unhealthy)
                .notApplicable(notApplicable)
                .connections(results)
                .build();
    }

    /** One connection's live check. Never throws — a thrown check would drop the row entirely. */
    private LmsConnectionHealthDTO.ConnectionHealth checkOneConnection(JsonNode conn, String defaultConnectionId) {
        String type = conn.path("type").asText("").toUpperCase();
        String id = conn.path("id").asText(null);
        String name = firstNonBlank(conn.path("name").asText(""), type, "LMS connection");
        boolean isDefault = id != null && id.equals(defaultConnectionId);

        // Only LearnDash and Moodle have a real probe. Vacademy is built-in and a custom LMS has
        // no known endpoint — reporting either as "unhealthy" would cry wolf every dashboard load.
        boolean testable = "LEARNDASH".equals(type) || "MOODLE".equals(type);
        String target = hostOf("MOODLE".equals(type)
                ? conn.path("moodleBaseUrl").asText("")
                : conn.path("apiUrl").asText(""));

        if (!testable) {
            LmsConnectionTestResultDTO r = testConnection(
                    LmsConnectionTestRequest.builder().activeLms(type).fields(Map.of()).build());
            return LmsConnectionHealthDTO.ConnectionHealth.builder()
                    .id(id).name(name).type(type).isDefault(isDefault)
                    .status("NOT_APPLICABLE")
                    .message(r.getMessage())
                    .target(target)
                    .build();
        }

        Map<String, String> fields = new HashMap<>();
        conn.fields().forEachRemaining(e -> {
            if (e.getValue() != null && e.getValue().isTextual()) {
                fields.put(e.getKey(), e.getValue().asText());
            }
        });

        long startedAt = System.currentTimeMillis();
        try {
            LmsConnectionTestResultDTO r = testConnection(
                    LmsConnectionTestRequest.builder().activeLms(type).fields(fields).build());
            return LmsConnectionHealthDTO.ConnectionHealth.builder()
                    .id(id).name(name).type(type).isDefault(isDefault)
                    .status(r.isOk() ? "HEALTHY" : "UNHEALTHY")
                    .message(r.getMessage())
                    .detail(r.getDetail())
                    .target(target)
                    .latencyMs(System.currentTimeMillis() - startedAt)
                    .build();
        } catch (Exception e) {
            log.warn("LMS health check threw for connection {} ({}): {}", id, type, e.getMessage());
            return unreachable(conn, defaultConnectionId,
                    "Couldn't complete the check for this connection.", e.getMessage());
        }
    }

    private LmsConnectionHealthDTO.ConnectionHealth unreachable(JsonNode conn, String defaultConnectionId,
                                                               String message, String detail) {
        String type = conn.path("type").asText("").toUpperCase();
        String id = conn.path("id").asText(null);
        return LmsConnectionHealthDTO.ConnectionHealth.builder()
                .id(id)
                .name(firstNonBlank(conn.path("name").asText(""), type, "LMS connection"))
                .type(type)
                .isDefault(id != null && id.equals(defaultConnectionId))
                .status("UNHEALTHY")
                .message(message)
                .detail(detail)
                .target(hostOf("MOODLE".equals(type)
                        ? conn.path("moodleBaseUrl").asText("")
                        : conn.path("apiUrl").asText("")))
                .build();
    }

    private static String firstNonBlank(String... values) {
        for (String v : values) {
            if (v != null && !v.isBlank()) return v;
        }
        return "";
    }

    public LmsConnectionTestResultDTO testConnection(LmsConnectionTestRequest request) {
        String provider = request != null && request.getActiveLms() != null
                ? request.getActiveLms().toUpperCase() : LmsSourcesEnum.VACADEMY.name();
        Map<String, String> f = request != null && request.getFields() != null ? request.getFields() : Map.of();

        if (LmsSourcesEnum.VACADEMY.name().equals(provider)) {
            return ok(provider, "Vacademy is the built-in LMS — it's always connected, nothing to set up.", null);
        }
        if ("LEARNDASH".equals(provider)) return testLearndash(f);
        if ("MOODLE".equals(provider)) return testMoodle(f);
        // Any other / custom LMS — we can't auto-test it, but that's not a failure. Let the admin
        // save it and verify the enrolment in their own LMS.
        return ok(provider, "No automated connection test for this LMS — save it and verify the "
                + "enrolment in your LMS.", null);
    }

    private LmsConnectionTestResultDTO testLearndash(Map<String, String> f) {
        String apiUrl = trim(f.get("apiUrl"));
        String user = trim(f.get("apiKey"));
        String secret = trim(f.get("apiSecret"));
        if (apiUrl.isBlank() || user.isBlank() || secret.isBlank()) {
            return fail("LEARNDASH", "Enter your WordPress API URL, username and application password first.", null);
        }
        if (!isHttpUrl(apiUrl)) {
            return fail("LEARNDASH", "Your WordPress REST API URL should start with http:// or https://.", null);
        }
        String url = stripTrailingSlash(apiUrl) + "/users/me?context=edit";
        try {
            String basic = Base64.getEncoder()
                    .encodeToString((user + ":" + secret).getBytes(StandardCharsets.UTF_8));
            HttpResponse<String> resp = httpGet(url, "Basic " + basic);
            int sc = resp.statusCode();
            if (sc >= 200 && sc < 300) {
                String name = textField(resp.body(), "name");
                return ok("LEARNDASH", name != null && !name.isBlank()
                        ? "Connected to your WordPress site as \"" + name + "\"."
                        : "Connected to your WordPress site.", null);
            }
            if (sc == 401 || sc == 403) {
                return fail("LEARNDASH", "WordPress rejected the username or application password. "
                        + "Re-generate an Application Password under Users → Profile.", "HTTP " + sc);
            }
            if (sc == 404) {
                return fail("LEARNDASH", "That WordPress REST API URL wasn't found. It usually ends in "
                        + "/wp-json/wp/v2.", "HTTP 404");
            }
            return fail("LEARNDASH", "Your WordPress site returned an unexpected response (HTTP " + sc + ").",
                    truncate(resp.body()));
        } catch (Exception e) {
            return fail("LEARNDASH", "Couldn't reach your WordPress site. Check the address is correct and "
                    + "reachable from the internet.", e.getMessage());
        }
    }

    private LmsConnectionTestResultDTO testMoodle(Map<String, String> f) {
        String baseUrl = trim(f.get("moodleBaseUrl"));
        String token = trim(f.get("moodleToken"));
        if (baseUrl.isBlank() || token.isBlank()) {
            return fail("MOODLE", "Enter your Moodle site URL and web service token first.", null);
        }
        if (!isHttpUrl(baseUrl)) {
            return fail("MOODLE", "Your Moodle site URL should start with http:// or https://.", null);
        }
        String url = stripTrailingSlash(baseUrl)
                + "/webservice/rest/server.php?wstoken=" + enc(token)
                + "&wsfunction=core_webservice_get_site_info&moodlewsrestformat=json";
        try {
            HttpResponse<String> resp = httpGet(url, null);
            JsonNode node = objectMapper.readTree(resp.body());
            if (node.hasNonNull("sitename")) {
                return ok("MOODLE", "Connected to \"" + node.get("sitename").asText() + "\".", null);
            }
            String errorcode = node.path("errorcode").asText("");
            String message = node.path("message").asText("");
            if ("invalidtoken".equals(errorcode)) {
                return fail("MOODLE", "Your web service token was rejected. Re-copy it from Moodle "
                        + "(Site administration → Server → Web services → Manage tokens).", message);
            }
            if (!errorcode.isBlank() || !message.isBlank()) {
                return fail("MOODLE", message.isBlank()
                        ? "Moodle rejected the request. Check web services and the REST protocol are enabled."
                        : message, errorcode);
            }
            return fail("MOODLE", "Unexpected response from Moodle. Double-check the site URL and token.",
                    truncate(resp.body()));
        } catch (Exception e) {
            return fail("MOODLE", "Couldn't reach your Moodle site. Check the address is correct and reachable.",
                    e.getMessage());
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Apply a connection (+ optional workflow) to a course
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Sets a course up with one of the institute's LMS connections: writes the per-course key the
     * enrolment workflow reads (Moodle → MOODLE_SETTING with the shared portal + this moodleCourseId;
     * LearnDash → LMS_SETTING), and optionally attaches an existing workflow to the course's package
     * sessions so enrolment fires it.
     */
    @Transactional
    public Map<String, Object> applyConnectionToPackage(String instituteId, String packageId,
                                                        String connectionId, String courseId,
                                                        List<String> workflowIds, Map<String, String> extraFields) {
        JsonNode conn = findConnection(instituteId, connectionId);
        if (conn == null) {
            throw new VacademyException("LMS connection not found: " + connectionId);
        }
        String type = conn.path("type").asText("").toUpperCase();

        // Copy EVERY field the connection carries (its preset fields AND any custom key–value
        // pairs the admin added) — nothing is hardcoded to a fixed provider schema.
        ObjectNode data = objectMapper.createObjectNode();
        copyConnectionFields(data, conn);
        // Generic per-course id usable by ANY LMS workflow (provider-agnostic). Provider-specific
        // aliases below keep the built-in Moodle/LearnDash flows working.
        String trimmedCourseId = courseId != null ? courseId.trim() : "";
        if (!trimmedCourseId.isBlank()) {
            data.put("courseId", trimmedCourseId);
        }

        if ("MOODLE".equals(type)) {
            if (!trimmedCourseId.isBlank()) {
                data.put("moodleCourseId", trimmedCourseId);
            }
            applyExtraFields(data, extraFields);
            savePackageKey(packageId, MOODLE_SETTING_KEY, "Moodle Integration Settings", data);
            // A course syncs with ONE LMS — drop any leftover LearnDash config so the workflow
            // doesn't read a stale WordPress connection.
            packageSettingService.removeSetting(packageId, LMS_SETTING_KEY);
        } else {
            // LearnDash / Custom / any external connection → LMS_SETTING.
            data.put("activeLms", type.isBlank() ? "LEARNDASH" : type);
            if (!trimmedCourseId.isBlank()) {
                data.put("ldCourseId", trimmedCourseId);
            }
            applyExtraFields(data, extraFields);
            savePackageKey(packageId, LMS_SETTING_KEY, "LMS Setting", data);
            // A course syncs with ONE LMS — drop any leftover Moodle config.
            packageSettingService.removeSetting(packageId, MOODLE_SETTING_KEY);
        }

        int created = 0;
        int removed = 0;
        // workflowIds is the authoritative multi-select set: attach the ones listed, detach the
        // rest. null = leave triggers untouched (caller didn't manage workflows this time).
        if (workflowIds != null) {
            int[] counts = syncEnrollmentWorkflows(instituteId, packageId, workflowIds);
            created = counts[0];
            removed = counts[1];
        }

        Map<String, Object> result = new HashMap<>();
        result.put("applied", true);
        result.put("connectionType", type);
        result.put("workflowTriggersCreated", created);
        result.put("workflowTriggersRemoved", removed);
        return result;
    }

    /**
     * ALL enrolment workflows attached to this course — found via active LEARNER_BATCH_ENROLLMENT
     * triggers whose {@code event_id} is one of the package's package sessions, distinct by workflow.
     * Returns {@code { attachedWorkflows: [ {id, name} ] }} so the course LMS card can pre-select them.
     */
    public Map<String, Object> getAttachedEnrollmentWorkflow(String packageId) {
        List<Map<String, String>> attached = new ArrayList<>();
        List<String> psIds = packageSessionIds(packageId);
        if (!psIds.isEmpty()) {
            List<WorkflowTrigger> triggers =
                    workflowTriggerRepository.findActiveByEventIdInAndTriggerEventName(psIds, ENROLL_EVENT);
            java.util.LinkedHashMap<String, String> distinct = new java.util.LinkedHashMap<>();
            for (WorkflowTrigger t : triggers) {
                if (t.getWorkflow() != null && t.getWorkflow().getId() != null) {
                    distinct.putIfAbsent(t.getWorkflow().getId(), t.getWorkflow().getName());
                }
            }
            distinct.forEach((id, name) -> {
                Map<String, String> m = new HashMap<>();
                m.put("id", id);
                m.put("name", name);
                attached.add(m);
            });
        }
        Map<String, Object> res = new HashMap<>();
        res.put("attachedWorkflows", attached);
        return res;
    }

    /**
     * ALL workflow triggers attached to a course, across ANY trigger event — found via active
     * triggers whose {@code event_id} is one of the package's sessions, distinct by (event, workflow).
     */
    public List<PackageTriggerDTO> getPackageWorkflowTriggers(String packageId) {
        List<PackageTriggerDTO> out = new ArrayList<>();
        List<String> psIds = packageSessionIds(packageId);
        if (psIds.isEmpty()) return out;

        java.util.LinkedHashSet<String> seen = new java.util.LinkedHashSet<>();
        for (WorkflowTrigger t : workflowTriggerRepository.findActiveByEventIdIn(psIds)) {
            if (t.getWorkflow() == null || t.getWorkflow().getId() == null) continue;
            String key = t.getTriggerEventName() + "|" + t.getWorkflow().getId();
            if (!seen.add(key)) continue;
            out.add(PackageTriggerDTO.builder()
                    .triggerEventName(t.getTriggerEventName())
                    .workflowId(t.getWorkflow().getId())
                    .workflowName(t.getWorkflow().getName())
                    .build());
        }
        return out;
    }

    /**
     * Make the course's attached workflow triggers exactly match {@code desired} (authoritative,
     * any trigger event): create workflow_trigger rows (one per package session) for each
     * (event, workflow) pair, and delete triggers on those sessions whose (event, workflow) pair
     * isn't in the desired set. Returns {@code { created, removed }}.
     */
    @Transactional
    public Map<String, Object> savePackageWorkflowTriggers(String instituteId, String packageId,
                                                           List<PackageTriggerDTO> desired) {
        Map<String, Object> res = new HashMap<>();
        res.put("created", 0);
        res.put("removed", 0);

        List<String> psIds = packageSessionIds(packageId);
        if (psIds.isEmpty()) return res;

        java.util.LinkedHashSet<String> target = new java.util.LinkedHashSet<>();
        List<PackageTriggerDTO> valid = new ArrayList<>();
        if (desired != null) {
            for (PackageTriggerDTO d : desired) {
                if (d == null || d.getTriggerEventName() == null || d.getTriggerEventName().isBlank()
                        || d.getWorkflowId() == null || d.getWorkflowId().isBlank()) {
                    continue;
                }
                if (target.add(d.getTriggerEventName().trim() + "|" + d.getWorkflowId().trim())) {
                    valid.add(d);
                }
            }
        }

        List<WorkflowTrigger> existing = workflowTriggerRepository.findActiveByEventIdIn(psIds);
        List<WorkflowTrigger> toRemove = new ArrayList<>();
        for (WorkflowTrigger t : existing) {
            String wfId = t.getWorkflow() != null ? t.getWorkflow().getId() : null;
            if (wfId != null && !target.contains(t.getTriggerEventName() + "|" + wfId)) {
                toRemove.add(t);
            }
        }

        int created = 0;
        for (PackageTriggerDTO d : valid) {
            String ev = d.getTriggerEventName().trim();
            Workflow wf = workflowRepository.findById(d.getWorkflowId().trim()).orElse(null);
            if (wf == null) continue;
            for (String psId : psIds) {
                if (workflowTriggerRepository
                        .existsByWorkflow_IdAndEventIdAndTriggerEventName(wf.getId(), psId, ev)) {
                    continue;
                }
                workflowTriggerRepository.save(WorkflowTrigger.builder()
                        .triggerEventName(ev)
                        .instituteId(instituteId)
                        .status("ACTIVE")
                        .workflow(wf)
                        .eventId(psId)
                        .eventAppliedType(PACKAGE_SESSION_TYPE)
                        .description("Course workflow trigger (" + ev + ") for " + packageId)
                        .build());
                created++;
            }
        }
        if (!toRemove.isEmpty()) {
            workflowTriggerRepository.deleteAll(toRemove);
        }
        res.put("created", created);
        res.put("removed", toRemove.size());
        return res;
    }

    /**
     * Make the course's attached enrolment workflows exactly match {@code workflowIds} (authoritative
     * multi-select): create LEARNER_BATCH_ENROLLMENT triggers (one per package session) for any
     * newly-selected workflow, and delete triggers for workflows no longer selected. Idempotent.
     * Returns {@code [created, removed]} trigger-row counts.
     */
    private int[] syncEnrollmentWorkflows(String instituteId, String packageId, List<String> workflowIds) {
        java.util.LinkedHashSet<String> target = new java.util.LinkedHashSet<>();
        for (String w : workflowIds) {
            if (w != null && !w.isBlank()) target.add(w.trim());
        }

        List<String> psIds = packageSessionIds(packageId);
        if (psIds.isEmpty()) {
            return new int[]{0, 0};
        }

        List<WorkflowTrigger> existing =
                workflowTriggerRepository.findActiveByEventIdInAndTriggerEventName(psIds, ENROLL_EVENT);
        List<WorkflowTrigger> toRemove = new ArrayList<>();
        for (WorkflowTrigger t : existing) {
            String wfId = t.getWorkflow() != null ? t.getWorkflow().getId() : null;
            if (wfId != null && !target.contains(wfId)) {
                toRemove.add(t); // previously attached, now unselected → detach
            }
        }

        int created = 0;
        for (String wfId : target) {
            Workflow wf = workflowRepository.findById(wfId).orElse(null);
            if (wf == null) continue;
            for (String psId : psIds) {
                if (workflowTriggerRepository
                        .existsByWorkflow_IdAndEventIdAndTriggerEventName(wfId, psId, ENROLL_EVENT)) {
                    continue;
                }
                workflowTriggerRepository.save(WorkflowTrigger.builder()
                        .triggerEventName(ENROLL_EVENT)
                        .instituteId(instituteId)
                        .status("ACTIVE")
                        .workflow(wf)
                        .eventId(psId)
                        .eventAppliedType(PACKAGE_SESSION_TYPE)
                        .description("LMS enrolment sync for course " + packageId)
                        .build());
                created++;
            }
        }

        if (!toRemove.isEmpty()) {
            workflowTriggerRepository.deleteAll(toRemove);
        }
        return new int[]{created, toRemove.size()};
    }

    /**
     * Real (enrollable) package sessions of a course — EXCLUDING the "Invited" session
     * (status = INVITED), which tracks invited-but-not-enrolled learners and shouldn't get
     * enrolment/workflow triggers. Used by both the attach and read paths so the Invited
     * session is never managed here.
     */
    private List<String> packageSessionIds(String packageId) {
        List<String> psIds = new ArrayList<>();
        for (PackageSession ps : packageSessionRepository.findAllByPackageIds(List.of(packageId))) {
            if (ps.getId() != null && !"INVITED".equalsIgnoreCase(ps.getStatus())) {
                psIds.add(ps.getId());
            }
        }
        return psIds;
    }

    /** Copy all of a connection's fields (preset + custom) into the per-course data, except id/type/name. */
    private void copyConnectionFields(ObjectNode data, JsonNode conn) {
        conn.fields().forEachRemaining(e -> {
            String k = e.getKey();
            if (!"id".equals(k) && !"type".equals(k) && !"name".equals(k)) {
                data.set(k, e.getValue());
            }
        });
    }

    /** Merge admin-supplied extra key–value pairs into the per-course setting data (blank keys skipped). */
    private void applyExtraFields(ObjectNode data, Map<String, String> extraFields) {
        if (extraFields == null) return;
        extraFields.forEach((k, v) -> {
            if (k != null && !k.trim().isBlank()) {
                data.put(k.trim(), v == null ? "" : v);
            }
        });
    }

    /**
     * Resolve a connection by id the SAME way {@link #getProviders} exposes them, so any connection
     * the UI shows can be applied: curated institute {@code connections[]}, the legacy single-config
     * synth, AND connections discovered from courses (e.g. a {@code disc-moodle-…} the admin hasn't
     * saved into the institute library yet).
     */
    private JsonNode findConnection(String instituteId, String connectionId) {
        if (connectionId == null) return null;
        JsonNode inner = readInstituteSettingInner(instituteId, LMS_SETTING_KEY);
        if (inner != null && inner.path("connections").isArray()) {
            for (JsonNode c : inner.get("connections")) {
                if (c.isObject() && connectionId.equals(c.path("id").asText(null))) return c;
            }
        }
        if (inner != null) {
            for (JsonNode c : resolveConnections(inner)) {
                if (connectionId.equals(c.path("id").asText(null))) return c;
            }
        }
        for (ObjectNode c : discoverConnectionsFromCourses(instituteId)) {
            if (connectionId.equals(c.path("id").asText(null))) return c;
        }
        return null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Institute → package mirror (legacy "apply institute LMS" — unchanged)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Copies the institute's (default) LMS config into this package's LMS keys. Kept for the
     * existing "apply institute LMS to course" affordance; the connection-aware path above is
     * preferred for new courses.
     */
    public void applyInstituteLmsToPackage(String instituteId, String packageId) {
        JsonNode lms = readInstituteSettingInner(instituteId, LMS_SETTING_KEY);
        if (lms == null || !lms.isObject()) {
            throw new VacademyException("No institute LMS settings configured to apply");
        }
        savePackageKey(packageId, LMS_SETTING_KEY, "LMS Setting", (ObjectNode) lms.deepCopy());

        String moodleToken = lms.path("moodleToken").asText("");
        String moodleBaseUrl = lms.path("moodleBaseUrl").asText("");
        if (!moodleToken.isBlank() || !moodleBaseUrl.isBlank()) {
            ObjectNode moodleData = objectMapper.createObjectNode();
            if (!moodleToken.isBlank()) moodleData.put("moodleToken", moodleToken);
            if (!moodleBaseUrl.isBlank()) moodleData.put("moodleBaseUrl", moodleBaseUrl);
            String existingCourseId = existingPackageMoodleField(packageId, "moodleCourseId");
            if (existingCourseId != null) moodleData.put("moodleCourseId", existingCourseId);
            savePackageKey(packageId, MOODLE_SETTING_KEY, "Moodle Integration Settings", moodleData);
        }
    }

    private JsonNode readInstituteSettingInner(String instituteId, String settingKey) {
        Object settingData = instituteSettingService.getSettingByInstituteIdAndKey(instituteId, settingKey);
        if (settingData == null) return null;
        JsonNode node = objectMapper.convertValue(settingData, JsonNode.class);
        return node.has("data") && node.get("data").isObject() ? node.get("data") : node;
    }

    private String existingPackageMoodleField(String packageId, String field) {
        try {
            Object data = packageSettingService.getSettingData(packageId, MOODLE_SETTING_KEY);
            if (data == null) return null;
            JsonNode node = objectMapper.convertValue(data, JsonNode.class);
            JsonNode in = node.has("data") && node.get("data").isObject() ? node.get("data") : node;
            return in.hasNonNull(field) ? in.get(field).asText() : null;
        } catch (Exception e) {
            return null;
        }
    }

    private void savePackageKey(String packageId, String key, String name, ObjectNode fields) {
        ObjectNode wrapped = objectMapper.createObjectNode();
        wrapped.set("data", fields);
        GenericSettingRequest request = GenericSettingRequest.builder()
                .settingName(name)
                .settingData(objectMapper.convertValue(wrapped, Object.class))
                .build();
        packageSettingService.saveGenericSetting(packageId, key, request);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Small helpers
    // ─────────────────────────────────────────────────────────────────────────

    private HttpResponse<String> httpGet(String url, String authHeader) throws Exception {
        HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(8))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
        HttpRequest.Builder builder = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .timeout(Duration.ofSeconds(10))
                .header("Accept", "application/json")
                .GET();
        if (authHeader != null) builder.header("Authorization", authHeader);
        return client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    }

    private String textField(String json, String field) {
        try {
            JsonNode node = objectMapper.readTree(json);
            return node.hasNonNull(field) ? node.get(field).asText() : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static String trim(String s) {
        return s == null ? "" : s.trim();
    }

    private static boolean isHttpUrl(String s) {
        String v = s.toLowerCase();
        return v.startsWith("http://") || v.startsWith("https://");
    }

    private static String stripTrailingSlash(String s) {
        return s.endsWith("/") ? s.substring(0, s.length() - 1) : s;
    }

    private static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8);
    }

    private static String truncate(String s) {
        if (s == null) return null;
        return s.length() > 300 ? s.substring(0, 300) + "…" : s;
    }

    private static LmsConnectionTestResultDTO ok(String provider, String message, String detail) {
        return LmsConnectionTestResultDTO.builder().ok(true).provider(provider).message(message).detail(detail).build();
    }

    private static LmsConnectionTestResultDTO fail(String provider, String message, String detail) {
        return LmsConnectionTestResultDTO.builder().ok(false).provider(provider).message(message).detail(detail).build();
    }
}
