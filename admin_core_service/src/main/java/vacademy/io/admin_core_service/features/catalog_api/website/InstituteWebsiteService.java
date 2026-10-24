package vacademy.io.admin_core_service.features.catalog_api.website;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.institute_api.service.InstituteApiAuditWriter;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Approved websites of an institute for the public Catalogue API: add, DNS-verify, remove
 * (institute admin) and revoke / restore (platform staff), plus the cached verified-host set the
 * origin lock reads ({@link #verifiedHosts}).
 *
 * <p>Verification is a DNS TXT record {@code _vacademy-verification.<host>} with value
 * {@code vacademy-site-verification=<token>}: owning the DNS of a host proves control of it and
 * of its subdomains. The DoH lookup runs outside any transaction.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class InstituteWebsiteService {

    public static final int MAX_WEBSITES_PER_INSTITUTE = 20;
    public static final String TXT_VALUE_PREFIX = "vacademy-site-verification=";
    static final long VERIFIED_HOSTS_TTL_MS = 60_000L;
    /** A Verify click within this long of the previous check returns the row without a new lookup. */
    static final long MIN_RECHECK_INTERVAL_MS = 5_000L;
    private static final int MAX_REASON_LENGTH = 500;
    private static final SecureRandom RANDOM = new SecureRandom();

    private final InstituteWebsiteRepository repository;
    private final TxtLookup txtLookup;
    private final InstituteApiAuditWriter auditWriter;

    /** instituteId -> verified hosts, per pod; invalidated locally on every change here. */
    private final Map<String, CachedHosts> verifiedHostsCache = new ConcurrentHashMap<>();

    private Clock clock = Clock.systemUTC();

    void setClock(Clock clock) {
        this.clock = clock;
    }

    // ── Origin lock ──────────────────────────────────────────────────────────

    /**
     * Hosts of the institute's VERIFIED websites, cached in memory for 60 s. A revoke on another
     * pod therefore takes up to a minute to bite there.
     */
    public Set<String> verifiedHosts(String instituteId) {
        long now = clock.millis();
        CachedHosts cached = verifiedHostsCache.get(instituteId);
        if (cached != null && cached.expiresAtMillis() > now) {
            return cached.hosts();
        }
        Set<String> hosts = Set.copyOf(repository.findVerifiedHosts(instituteId));
        if (verifiedHostsCache.size() > 10_000) {
            verifiedHostsCache.entrySet().removeIf(e -> e.getValue().expiresAtMillis() <= now);
        }
        verifiedHostsCache.put(instituteId, new CachedHosts(hosts, now + VERIFIED_HOSTS_TTL_MS));
        return hosts;
    }

    // ── Institute admin ──────────────────────────────────────────────────────

    public List<InstituteWebsite> list(String instituteId) {
        requireInstituteId(instituteId);
        return repository.findByInstituteIdOrderByCreatedAtDesc(instituteId);
    }

    /**
     * Adds a website as PENDING with a fresh token. Adding a host the institute already has
     * returns that row unchanged; a host revoked by Vacademy is refused (409).
     */
    public InstituteWebsite add(String instituteId, String rawHost, CustomUserDetails actor) {
        requireInstituteId(instituteId);
        String host;
        try {
            host = WebsiteHosts.normalize(rawHost);
        } catch (IllegalArgumentException e) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, e.getMessage());
        }
        InstituteWebsite existing = repository.findByInstituteIdAndHost(instituteId, host).orElse(null);
        if (existing != null) {
            if (existing.isRevoked()) {
                throw revokedConflict(host);
            }
            return existing;
        }
        if (repository.countByInstituteIdAndStatusNot(instituteId, InstituteWebsite.STATUS_REVOKED)
                >= MAX_WEBSITES_PER_INSTITUTE) {
            throw new VacademyException(HttpStatus.CONFLICT, "An institute can have at most "
                    + MAX_WEBSITES_PER_INSTITUTE + " websites. Remove one first.");
        }
        InstituteWebsite row = InstituteWebsite.builder()
                .id(UUID.randomUUID().toString())
                .instituteId(instituteId)
                .host(host)
                .status(InstituteWebsite.STATUS_PENDING)
                .verificationToken(newToken())
                .createdBy(actorId(actor))
                .createdAt(clock.instant())
                .build();
        try {
            repository.saveAndFlush(row);
        } catch (DataIntegrityViolationException e) {
            // Two concurrent adds of the same host: the unique (institute_id, host) wins.
            InstituteWebsite raced = repository.findByInstituteIdAndHost(instituteId, host)
                    .orElseThrow(() -> new VacademyException(HttpStatus.CONFLICT, "Could not add " + host + ". Retry."));
            if (raced.isRevoked()) {
                throw revokedConflict(host);
            }
            return raced;
        }
        audit(row, actor, "ADD", "Added website " + host, null);
        log.info("institute-website: added id={} host={} institute={} by={}", row.getId(), host, instituteId,
                actorId(actor));
        return row;
    }

    /**
     * Looks the TXT record up now. PENDING → VERIFIED when a TXT value equals
     * {@code vacademy-site-verification=<token>}; otherwise it stays PENDING with
     * {@code last_error} saying what was found. A VERIFIED row is returned as is.
     */
    public InstituteWebsite verify(String instituteId, String websiteId, CustomUserDetails actor) {
        InstituteWebsite row = requireRow(instituteId, websiteId);
        if (row.isRevoked()) {
            throw revokedConflict(row.getHost());
        }
        if (row.isVerified()) {
            return row;
        }
        Instant now = clock.instant();
        if (row.getLastCheckedAt() != null
                && now.toEpochMilli() - row.getLastCheckedAt().toEpochMilli() < MIN_RECHECK_INTERVAL_MS) {
            return row;
        }
        String expected = txtValue(row);
        String recordName = WebsiteHosts.verificationRecordName(row.getHost());
        TxtLookup.Result result = txtLookup.lookupVerificationRecord(row.getHost());

        boolean matched = !result.failed()
                && result.values().stream().anyMatch(v -> v != null && v.trim().equals(expected));
        if (matched) {
            if (repository.markVerified(row.getId(), instituteId, now) == 0) {
                return reread(instituteId, websiteId); // revoked (or removed) while DNS was being read
            }
            row.setStatus(InstituteWebsite.STATUS_VERIFIED);
            row.setVerifiedAt(now);
            row.setLastCheckedAt(now);
            row.setLastError(null);
            invalidate(instituteId);
            audit(row, actor, "VERIFY", "Verified website " + row.getHost(), null);
            log.info("institute-website: verified id={} host={} institute={}", row.getId(), row.getHost(),
                    instituteId);
            return row;
        }
        String error;
        if (result.failed()) {
            error = "Could not check DNS right now (" + result.error() + "). Try again in a minute.";
        } else if (result.values().isEmpty()) {
            error = "No TXT record found at " + recordName + " yet. DNS changes can take up to an hour.";
        } else {
            error = "Found a TXT record at " + recordName + ", but not with the expected value. It must be exactly: "
                    + expected;
        }
        error = truncate(error, 500);
        if (repository.markCheckFailed(row.getId(), instituteId, now, error) == 0) {
            return reread(instituteId, websiteId);
        }
        row.setLastCheckedAt(now);
        row.setLastError(error);
        return row;
    }

    /** Deletes the row. A row revoked by Vacademy cannot be removed (it would let the host be re-added). */
    public void remove(String instituteId, String websiteId, CustomUserDetails actor) {
        InstituteWebsite row = requireRow(instituteId, websiteId);
        if (row.isRevoked()) {
            throw revokedConflict(row.getHost());
        }
        if (repository.deleteUnlessRevoked(row.getId(), instituteId) == 0) {
            // Revoked a moment ago (deleting it would let the host be added again), or already gone.
            reread(instituteId, websiteId);
            return;
        }
        invalidate(instituteId);
        audit(row, actor, "REMOVE", "Removed website " + row.getHost(), snapshot(row));
        log.info("institute-website: removed id={} host={} institute={} by={}", row.getId(), row.getHost(),
                instituteId, actorId(actor));
    }

    // ── Super admin ──────────────────────────────────────────────────────────

    /** Every institute's rows (newest 500) or one institute's. */
    public List<InstituteWebsite> listAll(String instituteIdOrNull) {
        if (instituteIdOrNull == null || instituteIdOrNull.isBlank()) {
            return repository.findTop500ByOrderByCreatedAtDesc();
        }
        return repository.findByInstituteIdOrderByCreatedAtDesc(instituteIdOrNull.trim());
    }

    /** REVOKED: the host stops opening the origin lock and the institute cannot add it again. */
    public InstituteWebsite revoke(String websiteId, String reason, CustomUserDetails actor) {
        InstituteWebsite row = requireRow(websiteId);
        if (reason == null || reason.isBlank()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "reason is required.");
        }
        if (row.isRevoked()) {
            return row;
        }
        Map<String, Object> before = snapshot(row);
        row.setStatus(InstituteWebsite.STATUS_REVOKED);
        row.setRevokedAt(clock.instant());
        row.setRevokedBy(actorId(actor));
        row.setRevokedReason(truncate(reason.trim(), MAX_REASON_LENGTH));
        repository.save(row);
        invalidate(row.getInstituteId());
        audit(row, actor, "REVOKE", "Revoked website " + row.getHost() + " (" + row.getRevokedReason() + ")",
                before);
        log.warn("institute-website: revoked id={} host={} institute={} by={}", row.getId(), row.getHost(),
                row.getInstituteId(), actorId(actor));
        return row;
    }

    /**
     * Undoes a revoke: back to VERIFIED when the row had been verified by DNS before, else
     * PENDING. The revoke fields are cleared; the audit log keeps the history.
     */
    public InstituteWebsite restore(String websiteId, CustomUserDetails actor) {
        InstituteWebsite row = requireRow(websiteId);
        if (!row.isRevoked()) {
            return row;
        }
        Map<String, Object> before = snapshot(row);
        row.setStatus(row.getVerifiedAt() != null ? InstituteWebsite.STATUS_VERIFIED : InstituteWebsite.STATUS_PENDING);
        row.setRevokedAt(null);
        row.setRevokedBy(null);
        row.setRevokedReason(null);
        repository.save(row);
        invalidate(row.getInstituteId());
        audit(row, actor, "RESTORE", "Restored website " + row.getHost() + " to " + row.getStatus(), before);
        log.warn("institute-website: restored id={} host={} institute={} status={} by={}", row.getId(),
                row.getHost(), row.getInstituteId(), row.getStatus(), actorId(actor));
        return row;
    }

    // ── Views ────────────────────────────────────────────────────────────────

    /** The institute admin's view of a row (snake_case, ISO instants). */
    public static Map<String, Object> view(InstituteWebsite w) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", w.getId());
        m.put("host", w.getHost());
        m.put("status", w.getStatus());
        Map<String, Object> dns = new LinkedHashMap<>();
        dns.put("type", "TXT");
        dns.put("name", WebsiteHosts.verificationRecordName(w.getHost()));
        dns.put("value", txtValue(w));
        m.put("dns_record", dns);
        m.put("verified_at", iso(w.getVerifiedAt()));
        m.put("last_checked_at", iso(w.getLastCheckedAt()));
        m.put("last_error", w.getLastError());
        m.put("created_at", iso(w.getCreatedAt()));
        m.put("revoked_reason", w.getRevokedReason());
        return m;
    }

    /** {@link #view} plus who / which institute, for platform staff. */
    public static Map<String, Object> superAdminView(InstituteWebsite w) {
        Map<String, Object> m = view(w);
        m.put("institute_id", w.getInstituteId());
        m.put("created_by", w.getCreatedBy());
        m.put("revoked_at", iso(w.getRevokedAt()));
        m.put("revoked_by", w.getRevokedBy());
        return m;
    }

    static String txtValue(InstituteWebsite w) {
        return TXT_VALUE_PREFIX + w.getVerificationToken();
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private InstituteWebsite requireRow(String instituteId, String websiteId) {
        requireInstituteId(instituteId);
        if (websiteId == null || websiteId.isBlank()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Website id is required.");
        }
        return repository.findByIdAndInstituteId(websiteId, instituteId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Website not found."));
    }

    private InstituteWebsite requireRow(String websiteId) {
        if (websiteId == null || websiteId.isBlank()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Website id is required.");
        }
        return repository.findById(websiteId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Website not found."));
    }

    private InstituteWebsite reread(String instituteId, String websiteId) {
        InstituteWebsite now = requireRow(instituteId, websiteId);
        if (now.isRevoked()) {
            throw revokedConflict(now.getHost());
        }
        return now;
    }

    private void invalidate(String instituteId) {
        verifiedHostsCache.remove(instituteId);
    }

    private void audit(InstituteWebsite row, CustomUserDetails actor, String action, String description,
                       Map<String, Object> before) {
        auditWriter.record(row.getInstituteId(), actor, InstituteApiAuditWriter.ENTITY_WEBSITE, row.getId(), action,
                description, snapshot(row), before);
    }

    /** Never includes the verification token. */
    private static Map<String, Object> snapshot(InstituteWebsite row) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("host", row.getHost());
        m.put("status", row.getStatus());
        m.put("revoked_reason", row.getRevokedReason());
        return m;
    }

    private static VacademyException revokedConflict(String host) {
        return new VacademyException(HttpStatus.CONFLICT,
                host + " was revoked by Vacademy and cannot be added or changed. Contact support.");
    }

    static String newToken() {
        byte[] b = new byte[16];
        RANDOM.nextBytes(b);
        return HexFormat.of().formatHex(b);
    }

    private static void requireInstituteId(String instituteId) {
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "instituteId is required.");
        }
    }

    private static String actorId(CustomUserDetails actor) {
        return actor == null ? null : actor.getUserId();
    }

    private static String iso(Instant t) {
        return t == null ? null : t.toString();
    }

    private static String truncate(String s, int n) {
        return s.length() <= n ? s : s.substring(0, n);
    }

    private record CachedHosts(Set<String> hosts, long expiresAtMillis) {
    }
}
