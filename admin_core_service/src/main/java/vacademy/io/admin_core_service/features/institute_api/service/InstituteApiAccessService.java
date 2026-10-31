package vacademy.io.admin_core_service.features.institute_api.service;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute_api.entity.InstituteApiAccess;
import vacademy.io.admin_core_service.features.institute_api.entity.InstituteApiKey;
import vacademy.io.admin_core_service.features.institute_api.repository.InstituteApiAccessRepository;
import vacademy.io.admin_core_service.features.institute_api.repository.InstituteApiKeyRepository;
import vacademy.io.admin_core_service.features.institute_api.repository.InstituteApiUsageRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * Platform-staff management of partner-API access per institute (spec 6.1, 6.3, 10.7
 * admin_core table, T1.4). Callers (the super-admin controller) must already have
 * passed {@code SuperAdminAuthUtil.requireSuperAdmin}.
 *
 * <p>Segment presets: choosing a segment sets {@code daily_copy_quota} to the preset
 * (school 3,000, university 6,000, UPSC 10,000; no segment 2,000) unless the same
 * request sets the quota explicitly. Presets apply only when the segment changes (or the
 * row is new), so a hand-tuned quota survives unrelated edits.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class InstituteApiAccessService {

    public static final Set<String> PRODUCTS = Set.of(InstituteApiKeyService.PRODUCT_EVALUATION);
    public static final Set<String> SEGMENTS = Set.of("school", "university", "upsc");
    public static final Set<String> RATE_TIERS = Set.of("standard", "high", "custom");
    public static final int MAX_BULK_INSTITUTES = 500;
    static final int USAGE_WINDOW_DAYS = 30;

    private final InstituteApiAccessRepository accessRepository;
    private final InstituteApiKeyRepository keyRepository;
    private final InstituteApiUsageRepository usageRepository;
    private final InstituteRepository instituteRepository;
    private final InstituteApiAuditWriter auditWriter;

    private Clock clock = Clock.systemUTC();

    void setClock(Clock clock) {
        this.clock = clock;
    }

    public static int presetCopyQuota(String segment) {
        if (segment == null) {
            return InstituteApiAccess.DEFAULT_DAILY_COPY_QUOTA;
        }
        return switch (segment) {
            case "school" -> 3000;
            case "university" -> 6000;
            case "upsc" -> 10000;
            default -> InstituteApiAccess.DEFAULT_DAILY_COPY_QUOTA;
        };
    }

    // ── Read ─────────────────────────────────────────────────────────────────

    /**
     * GET /super-admin/v1/institutes/{id}/api-access. Products with no row are shown with
     * the table defaults (enabled=false), so the UI always has something to edit.
     *
     * <p>Deliberately not one transaction: the ledger query is best effort, and a failure
     * inside a shared transaction would mark it rollback-only and fail the whole read.
     */
    public Map<String, Object> overview(String instituteId) {
        requireInstitute(instituteId);
        Map<String, InstituteApiAccess> byProduct = new LinkedHashMap<>();
        for (InstituteApiAccess row : accessRepository.findByInstituteIdOrderByProductAsc(instituteId)) {
            byProduct.put(row.getProduct(), row);
        }
        for (String product : PRODUCTS) {
            byProduct.putIfAbsent(product, InstituteApiAccess.defaults(instituteId, product));
        }
        List<Map<String, Object>> products = byProduct.values().stream().map(InstituteApiAccessService::toView).toList();
        List<Map<String, Object>> keys = keyRepository.findByInstituteIdOrderByCreatedAtDesc(instituteId).stream()
                .map(InstituteApiAccessService::keyView)
                .toList();

        Map<String, Object> usage = new LinkedHashMap<>();
        // copies / typed / identify_pages live in assessment_service api_quota_usage. No internal
        // endpoint for them exists yet, so they are null (unknown), never 0.
        usage.put("copies", null);
        usage.put("typed", null);
        usage.put("identify_pages", null);
        usage.put("credits", apiCredits(instituteId));

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("products", products);
        out.put("keys", keys);
        out.put("usage_30d", usage);
        out.put("webhook_endpoints", List.of()); // Phase 2 (webhooks)
        out.put("last_error", null);
        return out;
    }

    private BigDecimal apiCredits(String instituteId) {
        try {
            Instant from = clock.instant().minus(Duration.ofDays(USAGE_WINDOW_DAYS));
            return usageRepository.sumApiKeyCreditsSince(instituteId, Timestamp.from(from));
        } catch (Exception e) {
            // The overview must still render when the ledger query fails.
            log.warn("institute-api: credit usage query failed for {}: {}", instituteId, e.getMessage());
            return null;
        }
    }

    // ── Update ───────────────────────────────────────────────────────────────

    /**
     * PUT /super-admin/v1/institutes/{id}/api-access/{product}. Partial update: a field
     * missing from {@code body} keeps its value; an explicit JSON null clears a nullable
     * field (segment, lane caps, notes). {@code reason} is required.
     */
    @Transactional
    public InstituteApiAccess update(String instituteId, String product, JsonNode body, CustomUserDetails actor) {
        requireInstitute(instituteId);
        String productKey = normalizeProduct(product);
        if (body == null || !body.isObject()) {
            throw badRequest("Request body must be a JSON object.");
        }
        String reason = requireReason(text(body, "reason"));

        InstituteApiAccess existing = accessRepository.findForUpdate(instituteId, productKey).orElse(null);
        boolean isNew = existing == null;
        InstituteApiAccess row = isNew ? InstituteApiAccess.defaults(instituteId, productKey) : existing;
        Map<String, Object> before = isNew ? null : toView(row);

        applyPatch(row, body, isNew);
        row.setUpdatedBy(actor.getUserId());
        row.setUpdatedAt(clock.instant());
        InstituteApiAccess saved = accessRepository.save(row);

        Map<String, Object> payload = toView(saved);
        payload.put("reason", reason);
        auditWriter.record(instituteId, actor, InstituteApiAuditWriter.ENTITY_API_ACCESS,
                instituteId + ":" + productKey, isNew ? "CREATE" : "UPDATE",
                describe(saved, reason), payload, before);
        log.info("institute-api: access {} institute={} product={} enabled={} by={}",
                isNew ? "created" : "updated", instituteId, productKey, saved.isEnabled(), actor.getUserId());
        return saved;
    }

    /**
     * Applies the present fields of {@code body} to {@code row}. Validates every value
     * before writing any, so a 400 leaves the row untouched.
     */
    static void applyPatch(InstituteApiAccess row, JsonNode body, boolean isNew) {
        Boolean enabled = has(body, "enabled") ? bool(body, "enabled") : null;
        boolean segmentPresent = has(body, "segment");
        String segment = segmentPresent ? normalizeSegment(text(body, "segment")) : null;
        String rateTier = has(body, "rate_tier") ? normalizeRateTier(text(body, "rate_tier")) : null;
        Integer copyQuota = has(body, "daily_copy_quota") ? nonNegativeInt(body, "daily_copy_quota") : null;
        Integer identifyPages = has(body, "daily_identify_pages") ? nonNegativeInt(body, "daily_identify_pages") : null;
        Integer rubricGenerations = has(body, "daily_rubric_generations")
                ? nonNegativeInt(body, "daily_rubric_generations") : null;
        boolean copyCapPresent = has(body, "copy_lane_cap");
        Integer copyLaneCap = copyCapPresent ? positiveIntOrNull(body, "copy_lane_cap") : null;
        boolean typedCapPresent = has(body, "typed_lane_cap");
        Integer typedLaneCap = typedCapPresent ? positiveIntOrNull(body, "typed_lane_cap") : null;
        BigDecimal creditLimit = has(body, "credit_limit") ? nonNegativeDecimal(body, "credit_limit") : null;
        Boolean fireWorkflowEvents = has(body, "fire_workflow_events") ? bool(body, "fire_workflow_events") : null;
        boolean notesPresent = has(body, "notes");
        String notes = notesPresent ? text(body, "notes") : null;

        if (enabled != null) row.setEnabled(enabled);
        if (segmentPresent) {
            boolean changed = isNew || !Objects.equals(row.getSegment(), segment);
            row.setSegment(segment);
            if (changed && copyQuota == null) {
                row.setDailyCopyQuota(presetCopyQuota(segment));
            }
        }
        if (rateTier != null) row.setRateTier(rateTier);
        if (copyQuota != null) row.setDailyCopyQuota(copyQuota);
        if (identifyPages != null) row.setDailyIdentifyPages(identifyPages);
        if (rubricGenerations != null) row.setDailyRubricGenerations(rubricGenerations);
        if (copyCapPresent) row.setCopyLaneCap(copyLaneCap);
        if (typedCapPresent) row.setTypedLaneCap(typedLaneCap);
        if (creditLimit != null) row.setCreditLimit(creditLimit);
        if (fireWorkflowEvents != null) row.setFireWorkflowEvents(fireWorkflowEvents);
        if (notesPresent) row.setNotes(notes == null || notes.isBlank() ? null : notes.trim());
    }

    // ── Bulk enable ──────────────────────────────────────────────────────────

    /**
     * POST /super-admin/v1/api-access/bulk-enable. Enables the product for every listed
     * institute that exists; unknown ids are reported, not created. A non-null segment is
     * applied (with its preset quota when it changes); a null segment keeps each existing
     * row's segment. One audit row per institute.
     */
    @Transactional
    public Map<String, Object> bulkEnable(List<String> instituteIds, String product, String segment,
                                          String reason, CustomUserDetails actor) {
        String productKey = normalizeProduct(product);
        String normalizedSegment = normalizeSegment(segment);
        String why = requireReason(reason);
        if (instituteIds == null || instituteIds.isEmpty()) {
            throw badRequest("institute_ids is required.");
        }
        Set<String> ids = new LinkedHashSet<>();
        for (String id : instituteIds) {
            if (id != null && !id.isBlank()) {
                ids.add(id.trim());
            }
        }
        if (ids.isEmpty()) {
            throw badRequest("institute_ids is required.");
        }
        if (ids.size() > MAX_BULK_INSTITUTES) {
            throw badRequest("At most " + MAX_BULK_INSTITUTES + " institutes per call.");
        }

        Set<String> known = new HashSet<>();
        for (Institute institute : instituteRepository.findAllById(ids)) {
            known.add(institute.getId());
        }
        List<String> enabled = new ArrayList<>();
        List<String> notFound = new ArrayList<>();
        Instant now = clock.instant();
        for (String instituteId : ids) {
            if (!known.contains(instituteId)) {
                notFound.add(instituteId);
                continue;
            }
            InstituteApiAccess existing = accessRepository.findForUpdate(instituteId, productKey).orElse(null);
            boolean isNew = existing == null;
            InstituteApiAccess row = isNew ? InstituteApiAccess.defaults(instituteId, productKey) : existing;
            Map<String, Object> before = isNew ? null : toView(row);
            boolean segmentChanged = normalizedSegment != null
                    && (isNew || !Objects.equals(row.getSegment(), normalizedSegment));
            row.setEnabled(true);
            if (segmentChanged) {
                row.setSegment(normalizedSegment);
                row.setDailyCopyQuota(presetCopyQuota(normalizedSegment));
            }
            row.setUpdatedBy(actor.getUserId());
            row.setUpdatedAt(now);
            InstituteApiAccess saved = accessRepository.save(row);
            Map<String, Object> payload = toView(saved);
            payload.put("reason", why);
            payload.put("bulk", true);
            auditWriter.record(instituteId, actor, InstituteApiAuditWriter.ENTITY_API_ACCESS,
                    instituteId + ":" + productKey, "BULK_ENABLE", describe(saved, why), payload, before);
            enabled.add(instituteId);
        }
        log.info("institute-api: bulk-enable product={} enabled={} not_found={} by={}",
                productKey, enabled.size(), notFound.size(), actor.getUserId());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("product", productKey);
        out.put("enabled", enabled);
        out.put("not_found", notFound);
        out.put("count", enabled.size());
        return out;
    }

    // ── Views ────────────────────────────────────────────────────────────────

    public static Map<String, Object> toView(InstituteApiAccess a) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("product", a.getProduct());
        m.put("enabled", a.isEnabled());
        m.put("segment", a.getSegment());
        m.put("rate_tier", a.getRateTier());
        m.put("daily_copy_quota", a.getDailyCopyQuota());
        m.put("daily_identify_pages", a.getDailyIdentifyPages());
        m.put("daily_rubric_generations", a.getDailyRubricGenerations());
        m.put("copy_lane_cap", a.getCopyLaneCap());
        m.put("typed_lane_cap", a.getTypedLaneCap());
        m.put("credit_limit", a.getCreditLimit());
        m.put("fire_workflow_events", a.isFireWorkflowEvents());
        m.put("notes", a.getNotes());
        m.put("updated_by", a.getUpdatedBy());
        m.put("updated_at", a.getUpdatedAt() == null ? null : a.getUpdatedAt().toString());
        return m;
    }

    /** Key metadata for listings: never the hash, never the plaintext. */
    public static Map<String, Object> keyView(InstituteApiKey k) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", k.getId());
        m.put("name", k.getName());
        m.put("prefix", k.getKeyPrefix());
        m.put("key_prefix", k.getKeyPrefix());
        m.put("products", InstituteApiKeyService.asList(k.getProducts()));
        m.put("scopes", InstituteApiKeyService.asList(k.getScopes()));
        m.put("daily_copy_cap", k.getDailyCopyCap());
        m.put("status", k.getStatus());
        m.put("expires_at", iso(k.getExpiresAt()));
        m.put("created_by", k.getCreatedBy());
        m.put("created_via", k.getCreatedVia());
        m.put("created_at", iso(k.getCreatedAt()));
        m.put("last_used_at", iso(k.getLastUsedAt()));
        m.put("revoked_at", iso(k.getRevokedAt()));
        return m;
    }

    private static String iso(Instant t) {
        return t == null ? null : t.toString();
    }

    private static String describe(InstituteApiAccess a, String reason) {
        return "Evaluation API access " + (a.isEnabled() ? "enabled" : "disabled")
                + " (segment " + (a.getSegment() == null ? "none" : a.getSegment())
                + ", " + a.getDailyCopyQuota() + " copies/day): " + reason;
    }

    // ── Validation helpers ───────────────────────────────────────────────────

    private void requireInstitute(String instituteId) {
        if (instituteId == null || instituteId.isBlank()) {
            throw badRequest("Institute id is required.");
        }
        if (!instituteRepository.existsById(instituteId)) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "Institute not found: " + instituteId);
        }
    }

    static String normalizeProduct(String product) {
        String p = product == null ? "" : product.trim().toLowerCase(Locale.ROOT);
        if (!PRODUCTS.contains(p)) {
            throw badRequest("Unknown product: " + product + ". Allowed: " + PRODUCTS);
        }
        return p;
    }

    static String normalizeSegment(String segment) {
        if (segment == null || segment.isBlank()) {
            return null;
        }
        String s = segment.trim().toLowerCase(Locale.ROOT);
        if (!SEGMENTS.contains(s)) {
            throw badRequest("Unknown segment: " + segment + ". Allowed: " + SEGMENTS);
        }
        return s;
    }

    static String normalizeRateTier(String tier) {
        String t = tier == null ? "" : tier.trim().toLowerCase(Locale.ROOT);
        if (!RATE_TIERS.contains(t)) {
            throw badRequest("Unknown rate_tier: " + tier + ". Allowed: " + RATE_TIERS);
        }
        return t;
    }

    static String requireReason(String reason) {
        if (reason == null || reason.isBlank()) {
            throw badRequest("reason is required.");
        }
        return reason.trim();
    }

    private static boolean has(JsonNode body, String field) {
        return body.has(field);
    }

    private static String text(JsonNode body, String field) {
        JsonNode n = body.get(field);
        if (n == null || n.isNull()) {
            return null;
        }
        if (!n.isTextual()) {
            throw badRequest(field + " must be a string.");
        }
        return n.asText();
    }

    private static Boolean bool(JsonNode body, String field) {
        JsonNode n = body.get(field);
        if (n == null || n.isNull() || !n.isBoolean()) {
            throw badRequest(field + " must be true or false.");
        }
        return n.booleanValue();
    }

    private static Integer nonNegativeInt(JsonNode body, String field) {
        JsonNode n = body.get(field);
        if (n == null || n.isNull() || !n.canConvertToInt() || !n.isIntegralNumber() || n.intValue() < 0) {
            throw badRequest(field + " must be a whole number >= 0.");
        }
        return n.intValue();
    }

    private static Integer positiveIntOrNull(JsonNode body, String field) {
        JsonNode n = body.get(field);
        if (n == null || n.isNull()) {
            return null;
        }
        if (!n.isIntegralNumber() || !n.canConvertToInt() || n.intValue() < 1) {
            throw badRequest(field + " must be a whole number >= 1, or null for the platform default.");
        }
        return n.intValue();
    }

    private static BigDecimal nonNegativeDecimal(JsonNode body, String field) {
        JsonNode n = body.get(field);
        if (n == null || n.isNull() || !n.isNumber() || n.decimalValue().signum() < 0) {
            throw badRequest(field + " must be a number >= 0.");
        }
        BigDecimal v = n.decimalValue().stripTrailingZeros();
        if (v.scale() < 0) {
            v = v.setScale(0);
        }
        if (v.scale() > 2 || v.precision() - v.scale() > 10) {
            throw badRequest(field + " must have at most 10 integer digits and 2 decimals.");
        }
        return v;
    }

    private static VacademyException badRequest(String message) {
        return new VacademyException(HttpStatus.BAD_REQUEST, message);
    }
}
