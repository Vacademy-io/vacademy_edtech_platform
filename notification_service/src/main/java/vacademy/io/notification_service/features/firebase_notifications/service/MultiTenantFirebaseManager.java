package vacademy.io.notification_service.features.firebase_notifications.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.auth.oauth2.GoogleCredentials;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.notification_service.features.announcements.entity.InstituteAnnouncementSettings;
import vacademy.io.notification_service.features.announcements.repository.InstituteAnnouncementSettingsRepository;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Manages FirebaseApp/FirebaseMessaging instances per institute based on
 * service account JSON stored in institute announcement settings under key path:
 * settings.firebase.serviceAccountJson (string) OR settings.firebase.serviceAccountJsonBase64 (base64 string)
 *
 * <p>Apps are shared per service-account key (project_id + private_key_id), not created per institute:
 * most institutes use the same Vacademy Firebase project, so they share one FirebaseApp.</p>
 *
 * <p>An institute's users can hold tokens from more than one Firebase project — e.g. a white-label
 * Android app on its own project while the web app always registers on the shared "vacademy-app"
 * project. {@link #getOtherMessaging} exposes every other configured project so
 * {@link PushNotificationService} can retry a token that the institute's own project rejects as
 * belonging to a different sender.</p>
 */
@Service
@Slf4j
public class MultiTenantFirebaseManager {

    private static final long KNOWN_APPS_REFRESH_MS = 10 * 60 * 1000L;
    /** After a failed discovery, retry this soon rather than keeping a stale/empty list for 10 minutes. */
    private static final long KNOWN_APPS_RETRY_MS = 30 * 1000L;

    private final InstituteAnnouncementSettingsRepository settingsRepository;
    private final java.util.function.LongSupplier clock;

    @org.springframework.beans.factory.annotation.Autowired
    public MultiTenantFirebaseManager(InstituteAnnouncementSettingsRepository settingsRepository) {
        this(settingsRepository, System::currentTimeMillis);
    }

    /** Visible for tests: a controllable clock for the cache expiry logic. */
    public MultiTenantFirebaseManager(InstituteAnnouncementSettingsRepository settingsRepository, java.util.function.LongSupplier clock) {
        this.settingsRepository = settingsRepository;
        this.clock = clock;
    }
    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * Per-institute app, re-resolved from the settings row when it expires so a rotated, replaced or removed
     * key takes effect on every pod without a restart (apps are shared per key in appByKey, so an unchanged key
     * costs one row read, not a new FirebaseApp). A missing or unusable stored key (bad JSON/base64) counts as
     * "no key" and is re-checked every 60 s, so a newly saved key is picked up fast. A failed DB lookup keeps
     * the last good app and retries in 30 s rather than switching the institute's push off. The map is bounded
     * (expired entries pruned) because callers can pass arbitrary institute ids.
     */
    private record CachedApp(FirebaseApp app, long expiresAt) { }
    private static final long INSTITUTE_APP_TTL_MS = 5 * 60 * 1000L;
    private static final long NO_KEY_TTL_MS = 60 * 1000L;
    private static final long FAILED_LOOKUP_RETRY_MS = 30 * 1000L;
    private static final int INSTITUTE_CACHE_MAX = 10_000;
    private final Map<String, CachedApp> instituteIdToApp = new ConcurrentHashMap<>();
    /** project_id + ":" + private_key_id -> app, so institutes sharing a key share one app. */
    private final Map<String, FirebaseApp> appByKey = new ConcurrentHashMap<>();

    private volatile List<FirebaseApp> knownApps = List.of();
    private volatile long knownAppsLoadedAt = 0L;
    private volatile long knownAppsRefreshMs = KNOWN_APPS_REFRESH_MS;

    public Optional<FirebaseMessaging> getMessagingForInstitute(String instituteId) {
        if (instituteId == null) {
            return Optional.empty();
        }
        try {
            long now = clock.getAsLong();
            CachedApp cached = instituteIdToApp.get(instituteId);
            if (cached == null || now >= cached.expiresAt()) {
                FirebaseApp previous = cached == null ? null : cached.app();
                try {
                    FirebaseApp app = resolveAppForInstitute(instituteId);
                    cached = new CachedApp(app, now + (app != null ? INSTITUTE_APP_TTL_MS : NO_KEY_TTL_MS));
                } catch (Exception e) {
                    log.warn("Firebase lookup failed for institute {} (keeping previous app): {}", instituteId, e.getMessage());
                    cached = new CachedApp(previous, now + FAILED_LOOKUP_RETRY_MS);
                }
                if (instituteIdToApp.size() >= INSTITUTE_CACHE_MAX) {
                    final long cutoff = now;
                    instituteIdToApp.values().removeIf(c -> c.expiresAt() <= cutoff);
                    if (instituteIdToApp.size() >= INSTITUTE_CACHE_MAX) {
                        instituteIdToApp.clear(); // entries are cheap to re-resolve
                    }
                }
                instituteIdToApp.put(instituteId, cached);
            }
            if (cached.app() == null) {
                return Optional.empty();
            }
            return Optional.of(FirebaseMessaging.getInstance(cached.app()));
        } catch (Exception e) {
            log.warn("Failed to get FirebaseMessaging for institute {}: {}", instituteId, e.getMessage());
            return Optional.empty();
        }
    }

    /**
     * Messaging clients for every configured Firebase project other than {@code exclude}'s — the
     * fallback set for a token the primary project rejects as another sender's. Discovered from all
     * institutes' settings, refreshed at most every 10 minutes.
     */
    public List<FirebaseMessaging> getOtherMessaging(FirebaseMessaging exclude) {
        List<FirebaseMessaging> out = new ArrayList<>();
        for (FirebaseApp app : loadKnownApps()) {
            try {
                FirebaseMessaging messaging = FirebaseMessaging.getInstance(app);
                if (messaging != exclude) {
                    out.add(messaging);
                }
            } catch (Exception e) {
                log.warn("Skipping Firebase app {} as a fallback: {}", app.getName(), e.getMessage());
            }
        }
        return out;
    }

    private List<FirebaseApp> loadKnownApps() {
        long now = clock.getAsLong();
        if (now - knownAppsLoadedAt < knownAppsRefreshMs) {
            return knownApps;
        }
        synchronized (this) {
            if (now - knownAppsLoadedAt < knownAppsRefreshMs) {
                return knownApps;
            }
            Map<String, FirebaseApp> distinct = new LinkedHashMap<>();
            try {
                for (InstituteAnnouncementSettings row : settingsRepository.findAll()) {
                    // One malformed row must not switch off fallback for every institute.
                    try {
                        String json = extractServiceAccountJson(row.getSettings());
                        if (json == null) {
                            continue;
                        }
                        FirebaseApp app = appForServiceAccount(json, "institute " + row.getInstituteId());
                        if (app != null) {
                            distinct.putIfAbsent(app.getName(), app);
                        }
                    } catch (Exception rowError) {
                        log.warn("Skipping unusable Firebase config for institute {}: {}",
                                row.getInstituteId(), rowError.getMessage());
                    }
                }
                knownApps = List.copyOf(distinct.values());
                knownAppsRefreshMs = KNOWN_APPS_REFRESH_MS;
            } catch (Exception e) {
                // Keep the previous list, but try again soon.
                log.warn("Failed to load fallback Firebase projects: {}", e.getMessage());
                knownAppsRefreshMs = KNOWN_APPS_RETRY_MS;
            }
            knownAppsLoadedAt = now;
            return knownApps;
        }
    }

    /**
     * The institute's app, or null when it has no usable key stored. Throws on lookup failures (DB errors) so
     * the caller can keep the last good app instead of treating a blip as "no key".
     */
    private FirebaseApp resolveAppForInstitute(String instituteId) {
        Optional<InstituteAnnouncementSettings> settingsOpt = settingsRepository.findByInstituteId(instituteId);
        if (settingsOpt.isEmpty()) {
            log.debug("No announcement settings for institute {}; no Firebase app.", instituteId);
            return null;
        }
        String json = extractServiceAccountJson(settingsOpt.get().getSettings());
        if (json == null) {
            log.debug("No Firebase service account configured for institute {}.", instituteId);
            return null;
        }
        return appForServiceAccount(json, "institute " + instituteId);
    }

    /**
     * settings.firebase.serviceAccountJson, else the base64 variant decoded; null when absent. firebase.enabled
     * is deliberately NOT enforced here: the old admin page saved enabled=false by default, so many rows carry
     * false while their key is meant to be used.
     */
    private String extractServiceAccountJson(Map<String, Object> settings) {
        if (settings == null || !(settings.get("firebase") instanceof Map<?, ?> firebaseCfg)) {
            return null;
        }
        Object jsonRaw = firebaseCfg.get("serviceAccountJson");
        if (jsonRaw instanceof String s && !s.isBlank()) {
            return s;
        }
        Object base64 = firebaseCfg.get("serviceAccountJsonBase64");
        if (base64 instanceof String b64 && !b64.isBlank()) {
            // MIME decoder tolerates line breaks/whitespace that admins paste along with the key.
            String decoded;
            try {
                decoded = new String(java.util.Base64.getMimeDecoder().decode(b64), StandardCharsets.UTF_8);
            } catch (IllegalArgumentException badBase64) {
                // An unusable stored key is "no key", not a lookup failure (which would keep a replaced key).
                log.warn("Stored Firebase serviceAccountJsonBase64 is not valid base64; ignoring it.");
                return null;
            }
            return decoded.isBlank() ? null : decoded;
        }
        return null;
    }

    /** One FirebaseApp per service-account key; null (logged) when the JSON is unusable. */
    private FirebaseApp appForServiceAccount(String json, String source) {
        JsonNode node;
        try {
            node = objectMapper.readTree(json);
        } catch (Exception e) {
            log.warn("Failed to parse Firebase JSON for {}: {}", source, e.getMessage());
            return null;
        }
        if (!node.has("client_email") || !node.has("private_key")) {
            log.warn("Invalid Firebase service account JSON for {}.", source);
            return null;
        }
        String projectId = node.path("project_id").asText("unknown");
        String keyId = node.path("private_key_id").asText(node.path("client_email").asText());
        String cacheKey = projectId + ":" + keyId;
        FirebaseApp existing = appByKey.get(cacheKey);
        if (existing != null) {
            return existing;
        }
        try {
            InputStream jsonStream = new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8));
            FirebaseOptions options = FirebaseOptions.builder()
                .setCredentials(GoogleCredentials.fromStream(jsonStream))
                .build();

            String appName = "fcm-" + projectId + "-" + (keyId.length() > 8 ? keyId.substring(0, 8) : keyId);
            // If an app with same name already exists (race), reuse it
            synchronized (MultiTenantFirebaseManager.class) {
                FirebaseApp app = null;
                for (FirebaseApp candidate : FirebaseApp.getApps()) {
                    if (candidate.getName().equals(appName)) {
                        app = candidate;
                        break;
                    }
                }
                if (app == null) {
                    app = FirebaseApp.initializeApp(options, appName);
                    log.info("Initialized Firebase app {} (first used by {})", appName, source);
                }
                appByKey.put(cacheKey, app);
                return app;
            }
        } catch (Exception e) {
            log.error("Error initializing Firebase for {}", source, e);
            return null;
        }
    }
}
