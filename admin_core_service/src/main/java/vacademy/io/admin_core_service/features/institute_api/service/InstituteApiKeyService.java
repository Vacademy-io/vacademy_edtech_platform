package vacademy.io.admin_core_service.features.institute_api.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.institute_api.dto.ApiKeyVerifyResponse;
import vacademy.io.admin_core_service.features.institute_api.dto.IssueApiKeyRequest;
import vacademy.io.admin_core_service.features.institute_api.entity.InstituteApiAccess;
import vacademy.io.admin_core_service.features.institute_api.entity.InstituteApiKey;
import vacademy.io.admin_core_service.features.institute_api.repository.InstituteApiAccessRepository;
import vacademy.io.admin_core_service.features.institute_api.repository.InstituteApiKeyRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Clock;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Issues, lists, revokes and verifies partner API keys for the AI Evaluation public API
 * (spec 6.1-6.4, T1.2/T1.3).
 *
 * <ul>
 *   <li>Key {@code vak_eval_<48 hex>} from SecureRandom (192 bits); the plaintext is
 *       returned once by {@link #issue} and never stored. Only its SHA-256 hex is kept.</li>
 *   <li>Verify is by hash only ({@code key_hash} is UNIQUE).</li>
 *   <li>Issue is refused unless {@code institute_api_access(evaluation).enabled}; at most
 *       {@value #MAX_ACTIVE_KEYS_PER_INSTITUTE} usable keys per institute.</li>
 *   <li>{@code last_used_at} is written at most once a minute per key per pod, decided
 *       from memory (verify runs on every cache refresh of every assessment pod).</li>
 * </ul>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class InstituteApiKeyService {

    public static final String PRODUCT_EVALUATION = "evaluation";
    /**
     * Keys an institute's own server uses to mint learner login codes (auth_service
     * {@code POST /auth-service/open/v1/login-codes}). Self-serve: an institute admin may issue
     * one without platform staff enabling anything, so no {@code institute_api_access} row is
     * needed and verify reports access as enabled.
     */
    public static final String PRODUCT_LOGIN_LINKS = "login_links";
    public static final String SCOPE_LOGIN_LINKS_CREATE = "login_links:create";
    /**
     * Keys a client's server uses for the public AI calling API (Telleo API v1,
     * {@code /admin-core-service/open/ai-calling/v1}). Self-serve like login links: an
     * institute admin issues them in Settings, no institute_api_access row is needed, and
     * the calls they place are billed to the institute's AI credits like any other call.
     */
    public static final String PRODUCT_AI_CALLING = "ai_calling";
    public static final String SCOPE_CALLS_READ = "calls:read";
    public static final String SCOPE_CALLS_WRITE = "calls:write";
    public static final String SCOPE_WEBHOOKS_MANAGE = "webhooks:manage";
    /**
     * The default scopes of an ai_calling key (what a key gets when none are named, and
     * what a legacy vak_live_ key is treated as having).
     */
    public static final List<String> AI_CALLING_SCOPES =
            List.of(SCOPE_CALLS_READ, SCOPE_CALLS_WRITE, SCOPE_WEBHOOKS_MANAGE);
    /**
     * Human (counsellor) click-to-call, Telleo API v1.2: read lists the institute's staff
     * (names, emails) and human calls; write rings a staff member's phone. Never part of
     * the default set: a key placing AI calls must not gain the power to ring staff or list
     * them, so an admin grants these explicitly when creating a key.
     */
    public static final String SCOPE_HUMAN_CALLS_READ = "human_calls:read";
    public static final String SCOPE_HUMAN_CALLS_WRITE = "human_calls:write";
    /**
     * Telleo API v1.3 management scopes, never in the default set either. counsellors:manage
     * adds counsellors to the institute (creating a dashboard login and mailing it), edits and
     * deactivates them; agents:manage creates, edits, switches and deletes AI agents and moves
     * the institute's default agent and inbound numbers between them. Reading agents stays on
     * calls:read; reading counsellors is also allowed with human_calls:read.
     */
    public static final String SCOPE_COUNSELLORS_MANAGE = "counsellors:manage";
    public static final String SCOPE_AGENTS_MANAGE = "agents:manage";
    /** Every scope an ai_calling key may be issued with. */
    public static final List<String> AI_CALLING_ALLOWED_SCOPES = List.of(SCOPE_CALLS_READ, SCOPE_CALLS_WRITE,
            SCOPE_WEBHOOKS_MANAGE, SCOPE_HUMAN_CALLS_READ, SCOPE_HUMAN_CALLS_WRITE,
            SCOPE_COUNSELLORS_MANAGE, SCOPE_AGENTS_MANAGE);
    /**
     * Publishable keys ({@code vak_pub_…}) for the public Catalogue API
     * ({@code /admin-core-service/open/catalog/v1}): safe in browser code, so they only read the
     * institute's published catalogue and submit enquiries. Self-serve like ai_calling. Browser
     * calls are further locked to the institute's verified websites (CatalogApiAuth).
     */
    public static final String PRODUCT_CATALOG = "catalog";
    public static final String SCOPE_CATALOG_READ = "catalog:read";
    public static final String SCOPE_LEADS_WRITE = "leads:write";
    public static final List<String> CATALOG_SCOPES = List.of(SCOPE_CATALOG_READ, SCOPE_LEADS_WRITE);
    public static final Set<String> PRODUCTS =
            Set.of(PRODUCT_EVALUATION, PRODUCT_LOGIN_LINKS, PRODUCT_AI_CALLING, PRODUCT_CATALOG);
    public static final int MAX_ACTIVE_KEYS_PER_INSTITUTE = 50;
    public static final int MAX_NAME_LENGTH = 120;
    static final long LAST_USED_WRITE_INTERVAL_MS = 60_000L;

    public static final String SCOPE_READ = "evaluation:read";
    public static final String SCOPE_WRITE = "evaluation:write";
    /** Spec 6.2. Phase-2 scopes are accepted so a key can be prepared ahead of the feature. */
    public static final Set<String> ALLOWED_SCOPES = Set.of(
            SCOPE_READ, SCOPE_WRITE, "evaluation:review", "evaluation:finalize",
            "webhooks:manage", "evaluation:review_links");
    public static final List<String> DEFAULT_SCOPES = List.of(SCOPE_READ, SCOPE_WRITE);

    private final InstituteApiKeyRepository keyRepository;
    private final InstituteApiAccessRepository accessRepository;
    private final InstituteApiAuditWriter auditWriter;

    /** keyId -> epoch millis of the last last_used_at write from this pod. */
    private final Map<String, Long> lastUsedWrites = new ConcurrentHashMap<>();

    private Clock clock = Clock.systemUTC();

    void setClock(Clock clock) {
        this.clock = clock;
    }

    // ── Issue ────────────────────────────────────────────────────────────────

    /**
     * Issues a key for the institute. The returned {@link IssuedKey#plaintext()} is the
     * only time the key is ever visible.
     *
     * @param createdVia {@link InstituteApiKey#VIA_DASHBOARD} or {@link InstituteApiKey#VIA_SUPER_ADMIN}
     */
    @Transactional
    public IssuedKey issue(String instituteId, IssueApiKeyRequest request, CustomUserDetails actor, String createdVia) {
        requireInstituteId(instituteId);
        if (actor == null || isBlank(actor.getUserId())) {
            throw new VacademyException(HttpStatus.UNAUTHORIZED, "User authentication required");
        }
        IssueApiKeyRequest body = request == null ? new IssueApiKeyRequest() : request;
        String product = normalizeProduct(body.getProduct());
        boolean loginLinks = PRODUCT_LOGIN_LINKS.equals(product);
        boolean aiCalling = PRODUCT_AI_CALLING.equals(product);
        boolean catalog = PRODUCT_CATALOG.equals(product);
        boolean selfServe = loginLinks || aiCalling || catalog;
        String name = normalizeName(body.getName());
        List<String> scopes = loginLinks ? List.of(SCOPE_LOGIN_LINKS_CREATE)
                : aiCalling ? normalizeAiCallingScopes(body.getScopes())
                : catalog ? normalizeProductScopes(body.getScopes(), CATALOG_SCOPES)
                : normalizeScopes(body.getScopes());
        Instant now = clock.instant();
        Instant expiresAt = parseExpiry(body.getExpiresAt(), now);
        Integer dailyCopyCap = selfServe ? null : body.getDailyCopyCap();
        if (dailyCopyCap != null && dailyCopyCap < 1) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "daily_copy_cap must be at least 1 (or omitted).");
        }

        if (!selfServe) {
            // Row lock on the access row: serialises concurrent issues for this institute
            // (so the cap below holds) and reads the current enabled flag.
            InstituteApiAccess access = accessRepository.findForUpdate(instituteId, PRODUCT_EVALUATION).orElse(null);
            if (access == null || !access.isEnabled()) {
                throw new VacademyException(HttpStatus.FORBIDDEN,
                        "The Evaluation API is not enabled for this institute. Contact Vacademy to enable it.");
            }
        }
        if (keyRepository.countUsable(instituteId, now) >= MAX_ACTIVE_KEYS_PER_INSTITUTE) {
            throw new VacademyException(HttpStatus.CONFLICT,
                    "Too many active API keys for this institute (max " + MAX_ACTIVE_KEYS_PER_INSTITUTE
                            + "). Revoke some first.");
        }

        String plaintext = loginLinks ? ApiKeySecrets.newLoginLinksKey()
                : aiCalling ? ApiKeySecrets.newAiCallingKey()
                : catalog ? ApiKeySecrets.newCatalogKey()
                : ApiKeySecrets.newEvaluationKey();
        InstituteApiKey key = InstituteApiKey.builder()
                .id(UUID.randomUUID().toString())
                .instituteId(instituteId)
                .name(name)
                .keyPrefix(ApiKeySecrets.displayPrefix(plaintext))
                .keyHash(ApiKeySecrets.sha256Hex(plaintext))
                .products(new String[]{product})
                .scopes(scopes.toArray(new String[0]))
                .dailyCopyCap(dailyCopyCap)
                .status(InstituteApiKey.STATUS_ACTIVE)
                .expiresAt(expiresAt)
                .createdBy(actor.getUserId())
                .createdVia(createdVia)
                .createdAt(now)
                .build();
        keyRepository.save(key);

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("key_prefix", key.getKeyPrefix());
        payload.put("name", name);
        payload.put("product", product);
        payload.put("scopes", scopes);
        payload.put("expires_at", expiresAt == null ? null : expiresAt.toString());
        payload.put("daily_copy_cap", dailyCopyCap);
        payload.put("created_via", createdVia);
        auditWriter.record(instituteId, actor, InstituteApiAuditWriter.ENTITY_API_KEY, key.getId(), "ISSUE",
                "Issued API key " + key.getKeyPrefix() + "… (" + name + ")", payload, null);
        log.info("institute-api-key: issued id={} prefix={} institute={} via={} by={}",
                key.getId(), key.getKeyPrefix(), instituteId, createdVia, actor.getUserId());
        return new IssuedKey(key, plaintext);
    }

    // ── List ─────────────────────────────────────────────────────────────────

    /** Every key of the institute, newest first. Rows carry the hash; never return them raw. */
    @Transactional(readOnly = true)
    public List<InstituteApiKey> list(String instituteId) {
        return list(instituteId, null);
    }

    /** The institute's keys for one product (null or blank = every product), newest first. */
    @Transactional(readOnly = true)
    public List<InstituteApiKey> list(String instituteId, String product) {
        requireInstituteId(instituteId);
        List<InstituteApiKey> all = keyRepository.findByInstituteIdOrderByCreatedAtDesc(instituteId);
        if (isBlank(product)) {
            return all;
        }
        String wanted = normalizeProduct(product);
        return all.stream().filter(k -> asList(k.getProducts()).contains(wanted)).toList();
    }

    // ── Revoke ───────────────────────────────────────────────────────────────

    @Transactional
    public RevokeOutcome revoke(String instituteId, String keyId, CustomUserDetails actor) {
        requireInstituteId(instituteId);
        if (isBlank(keyId)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Key id is required.");
        }
        Optional<InstituteApiKey> existing = keyRepository.findByIdAndInstituteId(keyId, instituteId);
        if (existing.isEmpty()) {
            return RevokeOutcome.NOT_FOUND;
        }
        if (!existing.get().isActive()) {
            return RevokeOutcome.ALREADY_REVOKED;
        }
        int n = keyRepository.revoke(keyId, instituteId, clock.instant(), actorId(actor));
        if (n == 0) {
            return RevokeOutcome.ALREADY_REVOKED;
        }
        lastUsedWrites.remove(keyId);
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("key_prefix", existing.get().getKeyPrefix());
        payload.put("name", existing.get().getName());
        auditWriter.record(instituteId, actor, InstituteApiAuditWriter.ENTITY_API_KEY, keyId, "REVOKE",
                "Revoked API key " + existing.get().getKeyPrefix() + "… (" + existing.get().getName() + ")",
                payload, null);
        log.info("institute-api-key: revoked id={} institute={} by={}", keyId, instituteId, actorId(actor));
        return RevokeOutcome.REVOKED;
    }

    /** Kill-switch: revokes every ACTIVE key of the institute. Returns how many were revoked. */
    @Transactional
    public int revokeAll(String instituteId, CustomUserDetails actor, String reason) {
        requireInstituteId(instituteId);
        List<String> ids = keyRepository.findActiveIds(instituteId);
        if (ids.isEmpty()) {
            return 0;
        }
        int n = keyRepository.revokeAllActive(instituteId, clock.instant(), actorId(actor));
        ids.forEach(lastUsedWrites::remove);
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("revoked_count", n);
        payload.put("key_ids", ids);
        payload.put("reason", reason);
        auditWriter.record(instituteId, actor, InstituteApiAuditWriter.ENTITY_API_KEY, null, "REVOKE_ALL",
                "Revoked all " + n + " active API keys" + (isBlank(reason) ? "" : " (" + reason.trim() + ")"),
                payload, null);
        log.warn("institute-api-key: revoke-all institute={} count={} by={}", instituteId, n, actorId(actor));
        return n;
    }

    // ── Verify (internal) ────────────────────────────────────────────────────

    /**
     * Resolves a key hash (contract C2). Empty when the hash is unknown, the key is
     * revoked, or it has expired: the caller answers 404 for all three alike.
     * Throws 400 when {@code keyHash} is not 64 hex characters.
     */
    public Optional<ApiKeyVerifyResponse> verify(String keyHash, String clientIp) {
        String hash = ApiKeySecrets.normalizeHash(keyHash);
        if (hash == null) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "key_hash must be 64 hex characters.");
        }
        Optional<InstituteApiKey> found = keyRepository.findByKeyHash(hash);
        Instant now = clock.instant();
        if (found.isEmpty() || !found.get().isUsableAt(now)) {
            return Optional.empty();
        }
        InstituteApiKey key = found.get();
        stampLastUsed(key.getId(), now, clientIp);
        if (asList(key.getProducts()).contains(PRODUCT_LOGIN_LINKS)
                || asList(key.getProducts()).contains(PRODUCT_AI_CALLING)
                || asList(key.getProducts()).contains(PRODUCT_CATALOG)) {
            // Self-serve product: no institute_api_access row; a usable key is all it takes.
            return Optional.of(toVerifyResponse(key, null, true));
        }
        InstituteApiAccess access = accessRepository
                .findByInstituteIdAndProduct(key.getInstituteId(), PRODUCT_EVALUATION)
                .orElse(null);
        return Optional.of(toVerifyResponse(key, access));
    }

    static ApiKeyVerifyResponse toVerifyResponse(InstituteApiKey key, InstituteApiAccess accessOrNull) {
        return toVerifyResponse(key, accessOrNull, accessOrNull != null && accessOrNull.isEnabled());
    }

    static ApiKeyVerifyResponse toVerifyResponse(InstituteApiKey key, InstituteApiAccess accessOrNull,
            boolean accessEnabled) {
        InstituteApiAccess access = accessOrNull != null
                ? accessOrNull
                : InstituteApiAccess.defaults(key.getInstituteId(), PRODUCT_EVALUATION);
        return new ApiKeyVerifyResponse(
                key.getId(),
                key.getInstituteId(),
                key.getName(),
                asList(key.getProducts()),
                asList(key.getScopes()),
                key.getStatus(),
                key.getExpiresAt() == null ? null : key.getExpiresAt().toString(),
                key.getDailyCopyCap(),
                access.getSegment(),
                access.getRateTier(),
                access.getDailyCopyQuota(),
                access.getDailyIdentifyPages(),
                access.getDailyRubricGenerations(),
                access.getCopyLaneCap(),
                access.getTypedLaneCap(),
                access.getCreditLimit(),
                access.isFireWorkflowEvents(),
                accessEnabled);
    }

    /** Best effort: a failed stamp never fails the verify. */
    private void stampLastUsed(String keyId, Instant now, String clientIp) {
        if (!claimLastUsedWrite(keyId, now.toEpochMilli())) {
            return;
        }
        try {
            String ip = isBlank(clientIp) ? null : truncate(clientIp.trim(), 64);
            if (ip == null) {
                keyRepository.touchLastUsed(keyId, now);
            } else {
                keyRepository.touchLastUsedWithIp(keyId, now, ip);
            }
        } catch (Exception e) {
            log.debug("institute-api-key: last-used stamp failed for {}: {}", keyId, e.getMessage());
        }
    }

    /** True at most once per {@link #LAST_USED_WRITE_INTERVAL_MS} per key (this pod). */
    boolean claimLastUsedWrite(String keyId, long nowMillis) {
        boolean[] claimed = {false};
        lastUsedWrites.compute(keyId, (id, previous) -> {
            if (previous == null || nowMillis - previous >= LAST_USED_WRITE_INTERVAL_MS) {
                claimed[0] = true;
                return nowMillis;
            }
            return previous;
        });
        return claimed[0];
    }

    // ── Validation helpers ───────────────────────────────────────────────────

    /**
     * Blank = the default AI calling scopes ({@link #AI_CALLING_SCOPES}, no human-call
     * scopes). Anything outside {@link #AI_CALLING_ALLOWED_SCOPES} is a 400.
     */
    static List<String> normalizeAiCallingScopes(List<String> raw) {
        if (raw == null || raw.isEmpty()) return AI_CALLING_SCOPES;
        return normalizeProductScopes(raw, AI_CALLING_ALLOWED_SCOPES);
    }

    /** Blank = every scope of the product. Anything outside {@code allowed} is a 400. */
    static List<String> normalizeProductScopes(List<String> raw, List<String> allowed) {
        if (raw == null || raw.isEmpty()) {
            return allowed;
        }
        List<String> out = new java.util.ArrayList<>();
        for (String s : raw) {
            String scope = s == null ? "" : s.trim().toLowerCase(Locale.ROOT);
            if (!allowed.contains(scope)) {
                throw new VacademyException(HttpStatus.BAD_REQUEST,
                        "Unknown scope: " + s + ". Allowed: " + allowed);
            }
            if (!out.contains(scope)) out.add(scope);
        }
        return out;
    }

    static String normalizeName(String raw) {
        if (isBlank(raw)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "name is required.");
        }
        String name = raw.trim();
        if (name.length() > MAX_NAME_LENGTH) {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "name must be at most " + MAX_NAME_LENGTH + " characters.");
        }
        return name;
    }

    /** Blank = evaluation, so callers written before login_links existed keep issuing evaluation keys. */
    static String normalizeProduct(String raw) {
        if (isBlank(raw)) {
            return PRODUCT_EVALUATION;
        }
        String product = raw.trim().toLowerCase(Locale.ROOT);
        if (!PRODUCTS.contains(product)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Unknown product: " + raw + ". Allowed: " + PRODUCTS);
        }
        return product;
    }

    static List<String> normalizeScopes(List<String> raw) {
        if (raw == null || raw.isEmpty()) {
            return DEFAULT_SCOPES;
        }
        Set<String> out = new LinkedHashSet<>();
        for (String s : raw) {
            String scope = s == null ? "" : s.trim().toLowerCase(Locale.ROOT);
            if (!ALLOWED_SCOPES.contains(scope)) {
                throw new VacademyException(HttpStatus.BAD_REQUEST, "Unknown scope: " + s);
            }
            out.add(scope);
        }
        return new ArrayList<>(out);
    }

    static Instant parseExpiry(String raw, Instant now) {
        if (isBlank(raw)) {
            return null;
        }
        Instant expiresAt;
        try {
            expiresAt = Instant.parse(raw.trim());
        } catch (DateTimeParseException e) {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "expires_at must be an ISO-8601 instant, e.g. 2027-03-31T00:00:00Z.");
        }
        if (!expiresAt.isAfter(now)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "expires_at must be in the future.");
        }
        return expiresAt;
    }

    private static void requireInstituteId(String instituteId) {
        if (isBlank(instituteId)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "instituteId is required.");
        }
    }

    private static String actorId(CustomUserDetails actor) {
        return actor == null ? null : actor.getUserId();
    }

    static List<String> asList(String[] values) {
        return values == null ? List.of() : Arrays.asList(values);
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    private static String truncate(String s, int n) {
        return s.length() <= n ? s : s.substring(0, n);
    }

    /** Plaintext + stored row, returned together exactly once at issue. */
    public record IssuedKey(InstituteApiKey key, String plaintext) {
    }

    public enum RevokeOutcome {
        REVOKED, ALREADY_REVOKED, NOT_FOUND
    }
}
