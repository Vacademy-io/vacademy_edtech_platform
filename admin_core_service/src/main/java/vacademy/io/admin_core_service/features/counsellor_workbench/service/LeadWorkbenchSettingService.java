package vacademy.io.admin_core_service.features.counsellor_workbench.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import vacademy.io.admin_core_service.features.institute.setting_history.InstituteSettingWriter;
import vacademy.io.admin_core_service.features.counsellor_target.dto.BulkCounsellorTargetRequest;
import vacademy.io.admin_core_service.features.counsellor_target.dto.CounsellorTargetDTO;
import vacademy.io.admin_core_service.features.counsellor_target.dto.UpsertCounsellorTargetRequest;
import vacademy.io.admin_core_service.features.counsellor_target.enums.TargetMetric;
import vacademy.io.admin_core_service.features.counsellor_target.enums.TargetPeriodType;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.counsellor_rating.dto.RatingDTO;
import vacademy.io.admin_core_service.features.counsellor_rating.entity.CounsellorRating;
import vacademy.io.admin_core_service.features.counsellor_rating.repository.CounsellorRatingRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.math.BigDecimal;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Per-institute counsellor workbench config + per-counsellor rating reads.
 *
 * <h3>Storage split</h3>
 * <ul>
 *   <li><b>Strategy CONFIG</b> (one row per institute, rarely written) lives
 *       inside the existing {@code institute.setting_json} blob under
 *       {@code LEAD_SETTING → data → workbench → rating}. JSON is appropriate
 *       here — one row per institute, naturally colocated with the rest of
 *       the per-institute lead config (SLA, scoring weights, leads_team_id).</li>
 *   <li><b>Per-counsellor SCORES</b> (one row per (institute, counsellor),
 *       written by the nightly recompute + admin manual_override edits)
 *       live in the {@code counsellor_rating} table (V327). Atomic per-row
 *       upserts replace what was previously a read-mutate-write of the
 *       institute-wide blob — that pattern raced on concurrent recomputes
 *       and lost manual_override edits.</li>
 * </ul>
 *
 * <h3>JSON shape under LEAD_SETTING.data (config only — scores moved out in V327)</h3>
 * A legacy {@code leads_team_id} key may still sit under {@code workbench} in
 * existing institutes' JSON — it configured the old "counselling team" model
 * and is deliberately ignored now: counsellors are role-defined (COUNSELLOR)
 * and scope comes from the org hierarchy (see {@code CounsellorScopeService}).
 * <pre>
 * {
 *   "workbench": {
 *     "rating": {
 *       "strategy_type": "STATIC" | "STRATEGY_BASED",
 *       "starting_rating": 0,
 *       "window_days": 90,
 *       "success_status_keys": ["CONVERTED"],
 *       "w_conversion": 0.6,
 *       "w_velocity": 0.4,
 *       "ideal_velocity_hours": 24,
 *       "worst_velocity_hours": 720,
 *       "min_sample_size": 5
 *     }
 *   }
 * }
 * </pre>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LeadWorkbenchSettingService {

    private static final String LEAD_SETTING_KEY = "LEAD_SETTING";

    private final InstituteRepository instituteRepository;
    private final ObjectMapper objectMapper;
    private final InstituteSettingWriter instituteSettingWriter;
    private final CounsellorRatingRepository counsellorRatingRepository;

    // ────────────────────────────────────────────────────────────────
    // Read
    // ────────────────────────────────────────────────────────────────

    public WorkbenchConfig get(String instituteId) {
        Institute institute = getInstitute(instituteId);
        JsonNode workbench = locateWorkbenchNode(institute.getSetting());
        WorkbenchConfig cfg = WorkbenchConfig.withDefaults(instituteId);
        if (workbench == null || workbench.isMissingNode() || workbench.isNull()) {
            return cfg;
        }
        JsonNode rating = workbench.path("rating");
        if (rating.isObject()) {
            if (rating.hasNonNull("strategy_type"))
                cfg.setStrategyType(rating.get("strategy_type").asText());
            if (rating.hasNonNull("starting_rating"))
                cfg.setStartingRating(BigDecimal.valueOf(rating.get("starting_rating").asDouble()));
            if (rating.hasNonNull("window_days"))
                cfg.setWindowDays(rating.get("window_days").asInt());
            if (rating.has("success_status_keys") && rating.get("success_status_keys").isArray()) {
                List<String> keys = new ArrayList<>();
                rating.get("success_status_keys").forEach(n -> keys.add(n.asText()));
                cfg.setSuccessStatusKeys(keys);
            }
            if (rating.hasNonNull("w_conversion"))
                cfg.setWConversion(BigDecimal.valueOf(rating.get("w_conversion").asDouble()));
            if (rating.hasNonNull("w_velocity"))
                cfg.setWVelocity(BigDecimal.valueOf(rating.get("w_velocity").asDouble()));
            if (rating.hasNonNull("ideal_velocity_hours"))
                cfg.setIdealVelocityHours(rating.get("ideal_velocity_hours").asInt());
            if (rating.hasNonNull("worst_velocity_hours"))
                cfg.setWorstVelocityHours(rating.get("worst_velocity_hours").asInt());
            if (rating.hasNonNull("min_sample_size"))
                cfg.setMinSampleSize(rating.get("min_sample_size").asInt());
        }
        return cfg;
    }

    // ────────────────────────────────────────────────────────────────
    // Write
    // ────────────────────────────────────────────────────────────────

    @Transactional
    public WorkbenchConfig upsertRatingStrategy(WorkbenchConfig req) {
        if (req.getInstituteId() == null) {
            throw new VacademyException("institute_id is required");
        }
        Institute institute = getInstitute(req.getInstituteId());
        ObjectNode root = mutableRoot(institute.getSetting());
        ObjectNode workbench = ensureWorkbenchNode(root);
        ObjectNode rating = workbench.has("rating") && workbench.get("rating").isObject()
                ? (ObjectNode) workbench.get("rating")
                : workbench.putObject("rating");

        if (req.getStrategyType() != null) rating.put("strategy_type", req.getStrategyType());
        if (req.getStartingRating() != null) rating.put("starting_rating", req.getStartingRating());
        if (req.getWindowDays() != null) rating.put("window_days", req.getWindowDays());
        if (req.getSuccessStatusKeys() != null) {
            var arr = rating.putArray("success_status_keys");
            req.getSuccessStatusKeys().forEach(arr::add);
        }
        if (req.getWConversion() != null) rating.put("w_conversion", req.getWConversion());
        if (req.getWVelocity() != null) rating.put("w_velocity", req.getWVelocity());
        if (req.getIdealVelocityHours() != null) rating.put("ideal_velocity_hours", req.getIdealVelocityHours());
        if (req.getWorstVelocityHours() != null) rating.put("worst_velocity_hours", req.getWorstVelocityHours());
        if (req.getMinSampleSize() != null) rating.put("min_sample_size", req.getMinSampleSize());

        persist(institute, root);
        return get(req.getInstituteId());
    }

    // ────────────────────────────────────────────────────────────────
    // Per-counsellor targets — stored under workbench.targets in the
    // institute setting blob. Targets are admin-set CONFIG (the "completed"
    // numbers are computed live, never stored), so JSON is the right home —
    // same rationale as the rating config. Written only by
    // occasional admin edits, so no concurrent-writer race (unlike rating
    // SCORES, which a nightly job writes → V327 moved those to a table).
    //
    // Shape:
    //   workbench.targets = {
    //     "<counsellorUserId>": [
    //       { "id": "ct_..", "metric": "CONVERSIONS", "period_type": "MONTH", "target_value": 50 },
    //       { "id": "ct_..", "metric": "CONVERSIONS", "period_type": "CUSTOM",
    //         "target_value": 25, "period_start": "2026-07-01", "period_end": "2026-07-15" }
    //     ]
    //   }
    // ────────────────────────────────────────────────────────────────

    /** All configured targets for a set of counsellors, keyed by user id. */
    public Map<String, List<CounsellorTargetDTO>> getTargetsBatch(String instituteId,
                                                                  Collection<String> counsellorUserIds) {
        Map<String, List<CounsellorTargetDTO>> out = new LinkedHashMap<>();
        if (counsellorUserIds == null || counsellorUserIds.isEmpty()) return out;
        JsonNode workbench = locateWorkbenchNode(getInstitute(instituteId).getSetting());
        JsonNode targets = workbench == null ? null : workbench.path("targets");
        for (String uid : counsellorUserIds) out.put(uid, readTargetArray(targets, uid));
        return out;
    }

    /** One counsellor's configured targets (settings dialog / drawer). */
    public List<CounsellorTargetDTO> getTargets(String instituteId, String counsellorUserId) {
        JsonNode workbench = locateWorkbenchNode(getInstitute(instituteId).getSetting());
        JsonNode targets = workbench == null ? null : workbench.path("targets");
        return readTargetArray(targets, counsellorUserId);
    }

    /** Set/replace one counsellor's target for a (metric, period) slot. */
    @Transactional
    public CounsellorTargetDTO upsertTarget(UpsertCounsellorTargetRequest req) {
        validateTarget(req.getMetric(), req.getPeriodType(), req.getTargetValue(),
                req.getPeriodStart(), req.getPeriodEnd());
        Institute institute = getInstitute(req.getInstituteId());
        ObjectNode root = mutableRoot(institute.getSetting());
        ObjectNode targetsNode = ensureTargetsNode(ensureWorkbenchNode(root));
        CounsellorTargetDTO saved = applyUpsert(targetsNode, req.getCounsellorUserId(),
                req.getMetric(), req.getPeriodType(), req.getTargetValue(),
                req.getPeriodStart(), req.getPeriodEnd());
        persist(institute, root);
        return saved;
    }

    /** Apply the same target to many counsellors in one blob write. */
    @Transactional
    public void bulkUpsertTargets(BulkCounsellorTargetRequest req) {
        validateTarget(req.getMetric(), req.getPeriodType(), req.getTargetValue(),
                req.getPeriodStart(), req.getPeriodEnd());
        if (req.getCounsellorUserIds() == null || req.getCounsellorUserIds().isEmpty()) return;
        Institute institute = getInstitute(req.getInstituteId());
        ObjectNode root = mutableRoot(institute.getSetting());
        ObjectNode targetsNode = ensureTargetsNode(ensureWorkbenchNode(root));
        for (String uid : req.getCounsellorUserIds()) {
            if (uid == null || uid.isBlank()) continue;
            applyUpsert(targetsNode, uid, req.getMetric(), req.getPeriodType(),
                    req.getTargetValue(), req.getPeriodStart(), req.getPeriodEnd());
        }
        persist(institute, root);
    }

    /** Remove one target by id from a counsellor's list. */
    @Transactional
    public void deleteTarget(String instituteId, String counsellorUserId, String targetId) {
        Institute institute = getInstitute(instituteId);
        ObjectNode root = mutableRoot(institute.getSetting());
        ObjectNode targetsNode = ensureTargetsNode(ensureWorkbenchNode(root));
        JsonNode arr = targetsNode.path(counsellorUserId);
        if (!arr.isArray()) return;
        ArrayNode kept = objectMapper.createArrayNode();
        for (JsonNode n : arr) {
            if (!targetId.equals(n.path("id").asText(null))) kept.add(n);
        }
        targetsNode.set(counsellorUserId, kept);
        persist(institute, root);
    }

    private ObjectNode ensureTargetsNode(ObjectNode workbench) {
        return workbench.has("targets") && workbench.get("targets").isObject()
                ? (ObjectNode) workbench.get("targets")
                : workbench.putObject("targets");
    }

    private List<CounsellorTargetDTO> readTargetArray(JsonNode targets, String uid) {
        List<CounsellorTargetDTO> list = new ArrayList<>();
        if (targets == null || !targets.isObject()) return list;
        JsonNode arr = targets.path(uid);
        if (!arr.isArray()) return list;
        for (JsonNode n : arr) {
            list.add(CounsellorTargetDTO.builder()
                    .id(n.path("id").asText(null))
                    .counsellorUserId(uid)
                    .metric(n.path("metric").asText(null))
                    .periodType(n.path("period_type").asText(null))
                    .targetValue(n.hasNonNull("target_value") ? n.get("target_value").asInt() : null)
                    .periodStart(n.hasNonNull("period_start") ? n.get("period_start").asText() : null)
                    .periodEnd(n.hasNonNull("period_end") ? n.get("period_end").asText() : null)
                    .build());
        }
        return list;
    }

    /** Upsert one target into a counsellor's array; recurring dedupes on
     *  (metric, period), CUSTOM on (metric, start, end). Returns the saved DTO. */
    private CounsellorTargetDTO applyUpsert(ObjectNode targetsNode, String uid,
                                            String metric, String periodType, Integer value,
                                            String start, String end) {
        ArrayNode arr = targetsNode.has(uid) && targetsNode.get(uid).isArray()
                ? (ArrayNode) targetsNode.get(uid)
                : targetsNode.putArray(uid);
        boolean custom = TargetPeriodType.CUSTOM.name().equals(periodType);
        ObjectNode match = null;
        for (JsonNode n : arr) {
            if (!metric.equals(n.path("metric").asText(null))) continue;
            if (!periodType.equals(n.path("period_type").asText(null))) continue;
            if (custom) {
                if (start.equals(n.path("period_start").asText(null))
                        && end.equals(n.path("period_end").asText(null))) {
                    match = (ObjectNode) n;
                    break;
                }
            } else {
                match = (ObjectNode) n;
                break;
            }
        }
        if (match == null) {
            match = arr.addObject();
            match.put("id", "ct_" + UUID.randomUUID().toString().replace("-", ""));
            match.put("metric", metric);
            match.put("period_type", periodType);
            if (custom) {
                match.put("period_start", start);
                match.put("period_end", end);
            }
        }
        match.put("target_value", value);
        return CounsellorTargetDTO.builder()
                .id(match.get("id").asText())
                .counsellorUserId(uid)
                .metric(metric)
                .periodType(periodType)
                .targetValue(value)
                .periodStart(custom ? start : null)
                .periodEnd(custom ? end : null)
                .build();
    }

    private void validateTarget(String metric, String periodType, Integer value,
                                String start, String end) {
        if (!TargetMetric.isValid(metric)) throw new VacademyException("Invalid target metric: " + metric);
        if (!TargetPeriodType.isValid(periodType)) throw new VacademyException("Invalid target period: " + periodType);
        if (value == null || value < 0) throw new VacademyException("target_value must be >= 0");
        if (TargetPeriodType.CUSTOM.name().equals(periodType)
                && (start == null || start.isBlank() || end == null || end.isBlank())) {
            throw new VacademyException("CUSTOM target requires period_start and period_end");
        }
    }

    // ────────────────────────────────────────────────────────────────
    // Per-counsellor ratings — backed by the `counsellor_rating` table
    // since V327. Strategy config still lives in the JSON blob above; only
    // per-counsellor SCORES were moved out. See class javadoc + the V327
    // migration for the rationale.
    // ────────────────────────────────────────────────────────────────

    /**
     * One counsellor's cached rating, or empty when unrated. Used by the
     * single-rating endpoint + by the leaderboard fallback when computing
     * default zeros.
     */
    public Optional<RatingDTO> getCounsellorRating(String instituteId, String counsellorUserId) {
        return counsellorRatingRepository
                .findByInstituteIdAndCounsellorUserId(instituteId, counsellorUserId)
                .map(this::entityToDTO);
    }

    /**
     * All cached ratings for an institute, keyed by counsellor user_id.
     * Used by the leaderboard + batch reads. The map is empty when no
     * ratings have been written yet (fresh institute).
     */
    public Map<String, RatingDTO> getAllCounsellorRatings(String instituteId) {
        return counsellorRatingRepository.findByInstituteId(instituteId).stream()
                .collect(Collectors.toMap(
                        CounsellorRating::getCounsellorUserId,
                        this::entityToDTO,
                        (a, b) -> a));
    }

    /**
     * Read several counsellor ratings at once. Returns only existing
     * entries; callers that want default-zero fallbacks should layer that
     * on top. One indexed SQL query per call (replaces the old
     * read-whole-blob-then-filter pattern).
     */
    public Map<String, RatingDTO> getCounsellorRatingsBatch(String instituteId,
                                                            Collection<String> counsellorUserIds) {
        if (counsellorUserIds == null || counsellorUserIds.isEmpty()) return Collections.emptyMap();
        return counsellorRatingRepository
                .findByInstituteIdAndCounsellorUserIdIn(instituteId, counsellorUserIds).stream()
                .collect(Collectors.toMap(
                        CounsellorRating::getCounsellorUserId,
                        this::entityToDTO,
                        (a, b) -> a));
    }

    /**
     * Write/replace one counsellor's cached rating. Per-row upsert — atomic
     * regardless of how many counsellors are being recomputed concurrently.
     * Caller is responsible for filling the snapshot (strategy_type, score,
     * components, last_computed_at, manual_override).
     */
    @Transactional
    public RatingDTO upsertCounsellorRating(String instituteId, String counsellorUserId, RatingDTO dto) {
        if (dto == null) throw new VacademyException("rating payload is required");

        CounsellorRating row = counsellorRatingRepository
                .findByInstituteIdAndCounsellorUserId(instituteId, counsellorUserId)
                .orElseGet(() -> CounsellorRating.builder()
                        .instituteId(instituteId)
                        .counsellorUserId(counsellorUserId)
                        .build());

        // Strategy type is the only NOT NULL business field; if the caller
        // forgot to set it (older callers seeded from getCounsellorRating
        // for a never-rated counsellor), fall back to the current row's
        // value, or STRATEGY_BASED as a last resort.
        String strategyType = dto.getStrategyType() != null
                ? dto.getStrategyType()
                : (row.getStrategyType() != null ? row.getStrategyType() : "STRATEGY_BASED");

        row.setStrategyType(strategyType);
        row.setScore(dto.getScore());
        row.setConversionRatioScore(dto.getConversionRatioScore());
        row.setVelocityScore(dto.getVelocityScore());
        row.setSampleSize(dto.getSampleSize());
        row.setManualOverride(dto.getManualOverride());
        row.setLastComputedAt(dto.getLastComputedAt());

        CounsellorRating saved = counsellorRatingRepository.save(row);

        // Round-trip what we persisted so the caller sees the canonical
        // values (including ids) without a second SELECT.
        return entityToDTO(saved);
    }

    private RatingDTO entityToDTO(CounsellorRating r) {
        return RatingDTO.builder()
                .instituteId(r.getInstituteId())
                .counsellorUserId(r.getCounsellorUserId())
                .strategyType(r.getStrategyType())
                .score(r.getScore())
                .conversionRatioScore(r.getConversionRatioScore())
                .velocityScore(r.getVelocityScore())
                .sampleSize(r.getSampleSize())
                .manualOverride(r.getManualOverride())
                .lastComputedAt(r.getLastComputedAt())
                .build();
    }

    // ────────────────────────────────────────────────────────────────
    // JSON helpers — same conventions as WhatsAppSettingService.
    // ────────────────────────────────────────────────────────────────

    private Institute getInstitute(String instituteId) {
        return instituteRepository.findById(instituteId)
                .orElseThrow(() -> new VacademyException("Institute not found: " + instituteId));
    }

    private ObjectNode mutableRoot(String settingJson) {
        if (settingJson == null || settingJson.isBlank()) return objectMapper.createObjectNode();
        try {
            JsonNode n = objectMapper.readTree(settingJson);
            return n.isObject() ? (ObjectNode) n : objectMapper.createObjectNode();
        } catch (JsonProcessingException e) {
            log.warn("Corrupted setting JSON, starting fresh: {}", e.getMessage());
            return objectMapper.createObjectNode();
        }
    }

    private ObjectNode ensureWorkbenchNode(ObjectNode root) {
        // Match the existing layout: settings live under root.setting.<KEY>.data
        ObjectNode settingsMap = root.has("setting") && root.get("setting").isObject()
                ? (ObjectNode) root.get("setting") : root.putObject("setting");
        ObjectNode leadSetting = settingsMap.has(LEAD_SETTING_KEY) && settingsMap.get(LEAD_SETTING_KEY).isObject()
                ? (ObjectNode) settingsMap.get(LEAD_SETTING_KEY)
                : settingsMap.putObject(LEAD_SETTING_KEY);
        ObjectNode data = leadSetting.has("data") && leadSetting.get("data").isObject()
                ? (ObjectNode) leadSetting.get("data") : leadSetting.putObject("data");
        return data.has("workbench") && data.get("workbench").isObject()
                ? (ObjectNode) data.get("workbench") : data.putObject("workbench");
    }

    private JsonNode locateWorkbenchNode(String settingJson) {
        if (settingJson == null || settingJson.isBlank()) return null;
        try {
            JsonNode root = objectMapper.readTree(settingJson);
            JsonNode settingsMap = root.has("setting") ? root.get("setting") : root;
            return settingsMap.path(LEAD_SETTING_KEY).path("data").path("workbench");
        } catch (JsonProcessingException e) {
            log.warn("Bad institute setting JSON: {}", e.getMessage());
            return null;
        }
    }

    private void persist(Institute institute, ObjectNode root) {
        try {
            instituteSettingWriter.save(institute, objectMapper.writeValueAsString(root));
        } catch (JsonProcessingException e) {
            throw new VacademyException("Could not save institute settings: " + e.getMessage());
        }
    }
}
