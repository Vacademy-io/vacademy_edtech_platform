package vacademy.io.admin_core_service.features.capabilities.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.capabilities.catalog.CapabilityCatalog;
import vacademy.io.admin_core_service.features.capabilities.catalog.CapabilityCatalogRegistry;
import vacademy.io.admin_core_service.features.capabilities.entity.InstituteModuleEntitlement;
import vacademy.io.admin_core_service.features.capabilities.entity.InstituteModuleEntitlementId;
import vacademy.io.admin_core_service.features.capabilities.entity.InstituteModuleEntitlementLog;
import vacademy.io.admin_core_service.features.capabilities.entity.InstituteModulePolicy;
import vacademy.io.admin_core_service.features.capabilities.repository.InstituteModuleEntitlementLogRepository;
import vacademy.io.admin_core_service.features.capabilities.repository.InstituteModuleEntitlementRepository;
import vacademy.io.admin_core_service.features.capabilities.repository.InstituteModulePolicyRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Platform-staff management of institute modules (spec §5, §12.3). Callers (the super-admin
 * controllers) must already have passed {@code SuperAdminAuthUtil.requireSuperAdmin}.
 *
 * <p>Every write takes a reason and writes one {@link InstituteModuleEntitlementLog} row per
 * changed key in the same transaction, then evicts the resolver cache for the institute.
 */
@Slf4j
// Explicit name: features.institute.service.InstituteModuleService (sub_modules) already
// owns the default bean name "instituteModuleService"; the clash stopped admin-core booting.
@Service("instituteEntitlementModuleService")
public class InstituteModuleService {

    public static final int MAX_HISTORY_PAGE_SIZE = 100;
    public static final int MAX_OVERVIEW_INSTITUTES = 500;
    static final int MAX_NOTE_LENGTH = 2000;

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final CapabilityCatalogRegistry registry;
    private final CapabilityResolver resolver;
    private final InstituteModulePolicyRepository policyRepository;
    private final InstituteModuleEntitlementRepository entitlementRepository;
    private final InstituteModuleEntitlementLogRepository logRepository;
    private final InstituteRepository instituteRepository;
    private Clock clock = Clock.systemUTC();

    public InstituteModuleService(CapabilityCatalogRegistry registry,
                                  CapabilityResolver resolver,
                                  InstituteModulePolicyRepository policyRepository,
                                  InstituteModuleEntitlementRepository entitlementRepository,
                                  InstituteModuleEntitlementLogRepository logRepository,
                                  InstituteRepository instituteRepository) {
        this.registry = registry;
        this.resolver = resolver;
        this.policyRepository = policyRepository;
        this.entitlementRepository = entitlementRepository;
        this.logRepository = logRepository;
        this.instituteRepository = instituteRepository;
    }

    void setClock(Clock clock) {
        this.clock = clock;
    }

    // ── Read ─────────────────────────────────────────────────────────────────

    /** GET /institutes/{id}/modules. */
    @Transactional(readOnly = true)
    public Map<String, Object> view(String instituteId) {
        requireInstitute(instituteId);
        return toView(resolver.load(instituteId));
    }

    Map<String, Object> toView(CapabilityResolver.Snapshot snapshot) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("institute_id", snapshot.instituteId());
        out.put("mode", snapshot.mode());
        out.put("mode_updated_by", snapshot.modeUpdatedBy());
        out.put("mode_updated_at", iso(snapshot.modeUpdatedAt()));
        out.put("catalog_version", registry.version());
        List<Map<String, Object>> rows = new ArrayList<>();
        for (InstituteModuleEntitlement e : snapshot.rows()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("key", e.getKey());
            row.put("enabled", e.isEnabled());
            row.put("expires_at", iso(e.getExpiresAt()));
            row.put("note", e.getNote());
            row.put("updated_by", e.getUpdatedBy());
            row.put("updated_at", iso(e.getUpdatedAt()));
            rows.add(row);
        }
        out.put("entitlements", rows);
        Map<String, Object> resolved = new LinkedHashMap<>();
        resolved.put("modules", snapshot.resolved().modules());
        resolved.put("features", snapshot.resolved().features());
        out.put("resolved", resolved);
        return out;
    }

    /** GET /institutes/{id}/modules/history. */
    @Transactional(readOnly = true)
    public Map<String, Object> history(String instituteId, int page, int size) {
        int safePage = Math.max(0, page);
        int safeSize = Math.max(1, Math.min(MAX_HISTORY_PAGE_SIZE, size));
        Page<InstituteModuleEntitlementLog> rows = logRepository.findByInstituteIdOrderByCreatedAtDesc(
                instituteId, PageRequest.of(safePage, safeSize));
        List<Map<String, Object>> content = new ArrayList<>();
        for (InstituteModuleEntitlementLog log : rows.getContent()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", log.getId());
            row.put("key", log.getKey());
            boolean mode = InstituteModuleEntitlementLog.MODE_KEY.equals(log.getKey());
            row.put("old_value", mode ? modeValue(log.getOldEnabled())
                    : entitlementValue(log.getOldEnabled(), log.getOldExpiresAt(), log.getOldNote()));
            row.put("new_value", mode ? modeValue(log.getNewEnabled())
                    : entitlementValue(log.getNewEnabled(), log.getNewExpiresAt(), log.getNewNote()));
            row.put("reason", log.getReason());
            row.put("actor_user_id", log.getActor());
            row.put("created_at", iso(log.getCreatedAt()));
            content.add(row);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("content", content);
        out.put("total_elements", rows.getTotalElements());
        out.put("total_pages", rows.getTotalPages());
        out.put("number", rows.getNumber());
        out.put("size", rows.getSize());
        return out;
    }

    /** GET /modules/overview?institute_ids=a,b,c → {id: {mode, enabled_modules}}. */
    @Transactional(readOnly = true)
    public Map<String, Object> overview(Collection<String> instituteIds) {
        Set<String> ids = new LinkedHashSet<>();
        if (instituteIds != null) {
            for (String id : instituteIds) {
                if (id != null && !id.isBlank()) {
                    ids.add(id.trim());
                }
            }
        }
        if (ids.isEmpty()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "institute_ids is required.");
        }
        if (ids.size() > MAX_OVERVIEW_INSTITUTES) {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "At most " + MAX_OVERVIEW_INSTITUTES + " institutes per request.");
        }
        Map<String, String> modes = new HashMap<>();
        policyRepository.findByInstituteIdIn(ids).forEach(p -> modes.put(p.getInstituteId(), p.getMode()));
        Map<String, List<InstituteModuleEntitlement>> rowsById = new HashMap<>();
        entitlementRepository.findByInstituteIdIn(ids)
                .forEach(e -> rowsById.computeIfAbsent(e.getInstituteId(), k -> new ArrayList<>()).add(e));
        Instant now = Instant.now(clock);
        Map<String, Object> out = new LinkedHashMap<>();
        for (String id : ids) {
            CapabilityResolver.Resolved resolved =
                    CapabilityResolver.resolve(registry.catalog(), rowsById.getOrDefault(id, List.of()), now);
            List<String> enabled = new ArrayList<>();
            resolved.modules().forEach((k, on) -> {
                if (Boolean.TRUE.equals(on)) {
                    enabled.add(k);
                }
            });
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("mode", modes.getOrDefault(id, InstituteModulePolicy.MODE_LEGACY));
            entry.put("enabled_modules", enabled);
            out.put(id, entry);
        }
        return out;
    }

    // ── Write ────────────────────────────────────────────────────────────────

    /** One validated change from a PUT body. {@code expiresAtSet}/{@code noteSet}: field was sent. */
    record Change(String key, boolean enabled, boolean expiresAtSet, Instant expiresAt,
                  boolean noteSet, String note) {
    }

    /**
     * PUT /institutes/{id}/modules, body {@code {mode?, changes:[{key, enabled, expires_at?, note?}],
     * reason}}. An absent {@code expires_at}/{@code note} keeps the stored value; an explicit null
     * clears it. 400 on blank reason, unknown key, duplicate key, disabling a core module, bad
     * mode or timestamp.
     */
    @Transactional
    public Map<String, Object> update(String instituteId, JsonNode body, String actorUserId) {
        if (body == null || !body.isObject()) {
            throw badRequest("Request body is required.");
        }
        String reason = requireReason(body.get("reason"));
        String mode = parseMode(body.get("mode"));
        List<Change> changes = parseChanges(body.get("changes"));
        if (mode == null && changes.isEmpty()) {
            throw badRequest("Nothing to change: send mode and/or changes.");
        }
        requireInstitute(instituteId);
        Instant now = Instant.now(clock);
        if (mode != null) {
            applyMode(instituteId, mode, reason, actorUserId, now);
        }
        for (Change change : changes) {
            applyChange(instituteId, change, reason, actorUserId, now);
        }
        resolver.evict(instituteId);
        return toView(resolver.load(instituteId));
    }

    /**
     * Preset apply for one institute (§12.3): listed modules enabled, every other non-core
     * module disabled; feature rows, expiries, notes and mode untouched. A non-core module with
     * no row is already off, so no row is created to disable it.
     */
    @Transactional
    public void applyModuleSet(String instituteId, Collection<String> enabledModules, String reason,
                               String actorUserId) {
        if (reason == null || reason.isBlank()) {
            throw badRequest("reason is required.");
        }
        requireInstitute(instituteId);
        Set<String> wanted = new LinkedHashSet<>(enabledModules);
        Instant now = Instant.now(clock);
        for (CapabilityCatalog.Module module : registry.modules()) {
            if (module.core()) {
                continue;
            }
            boolean target = wanted.contains(module.key());
            Optional<InstituteModuleEntitlement> existing = entitlementRepository.findById(
                    new InstituteModuleEntitlementId(instituteId, module.key()));
            if (existing.isEmpty() && !target) {
                continue;
            }
            applyChange(instituteId, new Change(module.key(), target, false, null, false, null),
                    reason.trim(), actorUserId, now);
        }
        resolver.evict(instituteId);
    }

    private void applyMode(String instituteId, String mode, String reason, String actor, Instant now) {
        Optional<InstituteModulePolicy> existing = policyRepository.findById(instituteId);
        String oldMode = existing.map(InstituteModulePolicy::getMode).orElse(InstituteModulePolicy.MODE_LEGACY);
        if (oldMode.equals(mode)) {
            return;
        }
        InstituteModulePolicy policy = existing.orElseGet(() -> InstituteModulePolicy.builder()
                .instituteId(instituteId).build());
        policy.setMode(mode);
        policy.setUpdatedBy(actor);
        policy.setUpdatedAt(now);
        policyRepository.save(policy);
        logRepository.save(InstituteModuleEntitlementLog.builder()
                .id(UUID.randomUUID().toString())
                .instituteId(instituteId)
                .key(InstituteModuleEntitlementLog.MODE_KEY)
                .oldEnabled(InstituteModulePolicy.MODE_MANAGED.equals(oldMode))
                .newEnabled(InstituteModulePolicy.MODE_MANAGED.equals(mode))
                .reason(reason)
                .actor(actor)
                .createdAt(now)
                .build());
    }

    private void applyChange(String instituteId, Change change, String reason, String actor, Instant now) {
        Optional<InstituteModuleEntitlement> existing = entitlementRepository.findById(
                new InstituteModuleEntitlementId(instituteId, change.key()));
        Boolean oldEnabled = existing.map(InstituteModuleEntitlement::isEnabled).orElse(null);
        Instant oldExpires = existing.map(InstituteModuleEntitlement::getExpiresAt).orElse(null);
        String oldNote = existing.map(InstituteModuleEntitlement::getNote).orElse(null);

        Instant newExpires = change.expiresAtSet() ? change.expiresAt() : oldExpires;
        String newNote = change.noteSet() ? change.note() : oldNote;
        boolean unchanged = existing.isPresent() && oldEnabled == change.enabled()
                && Objects.equals(oldExpires, newExpires) && Objects.equals(oldNote, newNote);
        if (unchanged) {
            return;
        }
        InstituteModuleEntitlement row = existing.orElseGet(() -> InstituteModuleEntitlement.builder()
                .instituteId(instituteId).key(change.key()).build());
        row.setEnabled(change.enabled());
        row.setExpiresAt(newExpires);
        row.setNote(newNote);
        row.setUpdatedBy(actor);
        row.setUpdatedAt(now);
        entitlementRepository.save(row);
        logRepository.save(InstituteModuleEntitlementLog.builder()
                .id(UUID.randomUUID().toString())
                .instituteId(instituteId)
                .key(change.key())
                .oldEnabled(oldEnabled)
                .newEnabled(change.enabled())
                .oldExpiresAt(oldExpires)
                .newExpiresAt(newExpires)
                .oldNote(oldNote)
                .newNote(newNote)
                .reason(reason)
                .actor(actor)
                .createdAt(now)
                .build());
    }

    // ── Parsing ──────────────────────────────────────────────────────────────

    static String requireReason(JsonNode node) {
        if (node == null || !node.isTextual() || node.asText().isBlank()) {
            throw badRequest("reason is required.");
        }
        return node.asText().trim();
    }

    private static String parseMode(JsonNode node) {
        if (node == null || node.isNull()) {
            return null;
        }
        String mode = node.isTextual() ? node.asText().trim().toUpperCase(Locale.ROOT) : "";
        if (!mode.equals(InstituteModulePolicy.MODE_LEGACY) && !mode.equals(InstituteModulePolicy.MODE_MANAGED)) {
            throw badRequest("mode must be LEGACY or MANAGED.");
        }
        return mode;
    }

    List<Change> parseChanges(JsonNode node) {
        List<Change> out = new ArrayList<>();
        if (node == null || node.isNull()) {
            return out;
        }
        if (!node.isArray()) {
            throw badRequest("changes must be an array.");
        }
        Set<String> seen = new LinkedHashSet<>();
        for (JsonNode c : node) {
            if (!c.isObject()) {
                throw badRequest("Each change must be an object.");
            }
            JsonNode keyNode = c.get("key");
            String key = keyNode != null && keyNode.isTextual() ? keyNode.asText().trim() : null;
            if (key == null || key.isEmpty()) {
                throw badRequest("Each change needs a key.");
            }
            if (!registry.isKnownKey(key)) {
                throw badRequest("Unknown module or feature key: " + key);
            }
            if (!seen.add(key)) {
                throw badRequest("Duplicate key in changes: " + key);
            }
            JsonNode enabledNode = c.get("enabled");
            if (enabledNode == null || !enabledNode.isBoolean()) {
                throw badRequest("enabled (boolean) is required for " + key);
            }
            boolean enabled = enabledNode.asBoolean();
            if (!enabled && registry.isCoreModule(key)) {
                throw badRequest("Core module '" + key + "' cannot be disabled.");
            }
            boolean expiresSet = c.has("expires_at");
            Instant expires = expiresSet ? parseInstant(c.get("expires_at"), key) : null;
            boolean noteSet = c.has("note");
            String note = null;
            if (noteSet && !c.get("note").isNull()) {
                if (!c.get("note").isTextual()) {
                    throw badRequest("note must be a string for " + key);
                }
                note = c.get("note").asText();
                if (note.length() > MAX_NOTE_LENGTH) {
                    throw badRequest("note is longer than " + MAX_NOTE_LENGTH + " characters for " + key);
                }
                if (note.isBlank()) {
                    note = null;
                }
            }
            out.add(new Change(key, enabled, expiresSet, expires, noteSet, note));
        }
        return out;
    }

    private static Instant parseInstant(JsonNode node, String key) {
        if (node == null || node.isNull()) {
            return null;
        }
        if (!node.isTextual()) {
            throw badRequest("expires_at must be an ISO-8601 timestamp for " + key);
        }
        String text = node.asText().trim();
        try {
            return Instant.parse(text);
        } catch (DateTimeParseException e) {
            try {
                return OffsetDateTime.parse(text).toInstant();
            } catch (DateTimeParseException e2) {
                throw badRequest("expires_at must be an ISO-8601 timestamp for " + key);
            }
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private void requireInstitute(String instituteId) {
        if (instituteId == null || instituteId.isBlank() || !instituteRepository.existsById(instituteId)) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "Institute not found.");
        }
    }

    private static String entitlementValue(Boolean enabled, Instant expiresAt, String note) {
        if (enabled == null) {
            return null;
        }
        ObjectNode node = MAPPER.createObjectNode();
        node.put("enabled", enabled);
        node.put("expires_at", iso(expiresAt));
        node.put("note", note);
        return node.toString();
    }

    private static String modeValue(Boolean managed) {
        if (managed == null) {
            return null;
        }
        ObjectNode node = MAPPER.createObjectNode();
        node.put("mode", managed ? InstituteModulePolicy.MODE_MANAGED : InstituteModulePolicy.MODE_LEGACY);
        return node.toString();
    }

    static String iso(Instant instant) {
        return instant == null ? null : instant.toString();
    }

    static VacademyException badRequest(String message) {
        return new VacademyException(HttpStatus.BAD_REQUEST, message);
    }
}
