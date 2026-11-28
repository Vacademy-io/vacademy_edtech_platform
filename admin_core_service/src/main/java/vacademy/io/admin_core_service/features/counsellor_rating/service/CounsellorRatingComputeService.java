package vacademy.io.admin_core_service.features.counsellor_rating.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.counsellor_rating.dto.RatingDTO;
import vacademy.io.admin_core_service.features.counsellor_rating.enums.RatingStrategyType;
import vacademy.io.admin_core_service.features.counsellor_workbench.service.LeadWorkbenchSettingService;
import vacademy.io.admin_core_service.features.counsellor_workbench.service.WorkbenchConfig;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Timestamp;
import java.util.List;

/**
 * Computes counsellor rating scores and persists them into the
 * {@code counsellor_rating} table (since V327) via
 * {@link LeadWorkbenchSettingService}. Strategy CONFIG still lives in the
 * {@code institute_setting.LEAD_SETTING.workbench.rating} JSON blob;
 * per-counsellor SCORES were moved out so the nightly recompute can do
 * atomic per-row upserts instead of read-mutate-write of the whole
 * institute blob.
 *
 * <h3>assigned_at is derived, not stored</h3>
 * Earlier designs stored an {@code assigned_at} column on
 * {@code user_lead_profile}; we drop that and resolve "when did this
 * counsellor take over THIS lead" at compute time from
 * {@code timeline_event(action_type = 'COUNSELOR_ASSIGNED')} — the enum
 * NAME (assigns and reassigns share the enum; see
 * {@code LeadJourneyActionType}). timeline_event is already the system of
 * record for assignment changes — having a derived column to keep in sync
 * was an avoidable correctness hazard.
 *
 * <h3>Algorithm — STRATEGY_BASED</h3>
 * For a counsellor c within a rolling window of <em>window_days</em>:
 * <pre>
 *   assigned_at  = MAX(timeline_event.created_at) per lead
 *                  WHERE action_type = 'COUNSELOR_ASSIGNED'
 *                    AND type = 'USER_LEAD_PROFILE'
 *                    AND type_id = user_lead_profile.id
 *
 *   assigned     = COUNT leads where assigned_counselor_id = c
 *                              AND assigned_at >= NOW() - window_days
 *   converted    = same set AND conversion_status IN success_status_keys
 *
 *   if assigned &lt; min_sample_size: score = starting_rating (cold start)
 *   else:
 *     conversion_ratio_score = 100 * converted / assigned
 *
 *     avg_hours = AVG(EXTRACT(EPOCH FROM converted_at - assigned_at)/3600)
 *                 over the converted set
 *     velocity_score = clamp(0, 100,
 *                            100 * (worst_velocity_hours - avg_hours) /
 *                                  (worst_velocity_hours - ideal_velocity_hours))
 *     raw  = w_conversion*conversion_ratio_score + w_velocity*velocity_score
 *     score = clamp(0, 100, starting_rating + raw)
 * </pre>
 *
 * <h3>STATIC</h3>
 * score = manual_override (admin sets via the dedicated endpoint).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CounsellorRatingComputeService {

    /**
     * Reused inline-LATERAL fragment that resolves the latest "assigned to
     * THIS counsellor" timestamp per lead from timeline_event. Joined into
     * each query below so the assigned-at calculation stays in one place.
     */
    private static final String ASSIGNED_AT_LATERAL =
            // action_type stores the enum NAME ('COUNSELOR_ASSIGNED' — assigns
            // and reassigns share the enum). type_id on USER_LEAD_PROFILE events
            // is user_lead_profile.id, NOT the raw user_id — timeline_event has
            // no institute_id column, and a user_id alone can now resolve to a
            // profile per institute, so correlating on user_id would pull in
            // another institute's assignment events for the same person. See
            // timeline_event invariants in docs/crm.
            "LEFT JOIN LATERAL ( " +
            "    SELECT MAX(te.created_at) AS assigned_at " +
            "    FROM timeline_event te " +
            "    WHERE te.type = 'USER_LEAD_PROFILE' " +
            "      AND te.type_id = ulp.id " +
            "      AND te.action_type = 'COUNSELOR_ASSIGNED' " +
            ") ta ON true ";

    private final LeadWorkbenchSettingService settingService;
    private final JdbcTemplate jdbc;

    /**
     * Recompute one counsellor's score under the institute's current strategy
     * and persist the snapshot into the workbench JSON. For STATIC strategies
     * the manual_override (if set) wins; admins change it via the dedicated
     * manual-override endpoint, not by recomputing.
     */
    @Transactional
    public RatingDTO recompute(String instituteId, String counsellorUserId) {
        WorkbenchConfig cfg = settingService.get(instituteId);
        BigDecimal startingRating = cfg.getStartingRating() != null
                ? cfg.getStartingRating() : BigDecimal.ZERO;

        // Seed from the existing JSON entry so manual_override (and any
        // previously-computed components) survive the recompute.
        RatingDTO rating = settingService.getCounsellorRating(instituteId, counsellorUserId)
                .orElseGet(() -> RatingDTO.builder()
                        .counsellorUserId(counsellorUserId)
                        .instituteId(instituteId)
                        .strategyType(cfg.getStrategyType())
                        .score(startingRating)
                        .build());

        if (RatingStrategyType.STATIC.name().equals(cfg.getStrategyType())) {
            rating.setStrategyType(RatingStrategyType.STATIC.name());
            if (rating.getManualOverride() != null) {
                rating.setScore(rating.getManualOverride());
            } else if (rating.getScore() == null) {
                rating.setScore(startingRating);
            }
            rating.setConversionRatioScore(null);
            rating.setVelocityScore(null);
            rating.setSampleSize(null);
            rating.setLastComputedAt(new Timestamp(System.currentTimeMillis()));
            return settingService.upsertCounsellorRating(instituteId, counsellorUserId, rating);
        }

        Inputs in = fetchInputs(instituteId, counsellorUserId, cfg);

        rating.setStrategyType(RatingStrategyType.STRATEGY_BASED.name());
        rating.setSampleSize(in.assigned);
        rating.setLastComputedAt(new Timestamp(System.currentTimeMillis()));

        int minSample = cfg.getMinSampleSize() != null ? cfg.getMinSampleSize() : 5;
        if (in.assigned < minSample) {
            // Cold start: counsellor doesn't have enough leads in window for
            // a credible computed score. Prefer the per-counsellor
            // `manual_override` (set from Settings → Workbench team) over the
            // institute-wide `starting_rating` — admins use the per-row input
            // to seed individual counsellors with a starting handicap that
            // reflects their experience. Once the counsellor crosses
            // min_sample_size, the computed score takes over.
            BigDecimal coldStart = rating.getManualOverride() != null
                    ? rating.getManualOverride()
                    : startingRating;
            rating.setScore(clamp(coldStart));
            rating.setConversionRatioScore(null);
            rating.setVelocityScore(null);
            return settingService.upsertCounsellorRating(instituteId, counsellorUserId, rating);
        }

        BigDecimal conversionRatioScore = BigDecimal.valueOf(in.converted)
                .multiply(BigDecimal.valueOf(100))
                .divide(BigDecimal.valueOf(in.assigned), 2, RoundingMode.HALF_UP);

        int ideal = cfg.getIdealVelocityHours() != null ? cfg.getIdealVelocityHours() : 24;
        int worst = cfg.getWorstVelocityHours() != null ? cfg.getWorstVelocityHours() : 720;
        BigDecimal velocityScore;
        if (in.converted == 0 || in.avgHours == null) {
            velocityScore = BigDecimal.ZERO;
        } else {
            double range = (double) (worst - ideal);
            double raw = range == 0 ? 0 : 100.0 * (worst - in.avgHours) / range;
            velocityScore = clamp(BigDecimal.valueOf(raw).setScale(2, RoundingMode.HALF_UP));
        }

        BigDecimal wc = cfg.getWConversion() != null ? cfg.getWConversion() : new BigDecimal("0.6");
        BigDecimal wv = cfg.getWVelocity() != null ? cfg.getWVelocity() : new BigDecimal("0.4");
        BigDecimal raw = conversionRatioScore.multiply(wc).add(velocityScore.multiply(wv));
        BigDecimal score = clamp(startingRating.add(raw).setScale(2, RoundingMode.HALF_UP));

        rating.setConversionRatioScore(conversionRatioScore);
        rating.setVelocityScore(velocityScore);
        rating.setScore(score);
        return settingService.upsertCounsellorRating(instituteId, counsellorUserId, rating);
    }

    @Transactional
    public int recomputeAll(String instituteId) {
        List<String> counsellorIds = jdbc.queryForList(
                "SELECT DISTINCT assigned_counselor_id FROM user_lead_profile " +
                        "WHERE institute_id = ? AND assigned_counselor_id IS NOT NULL",
                String.class, instituteId);
        int n = 0;
        for (String c : counsellorIds) {
            try {
                recompute(instituteId, c);
                n++;
            } catch (Exception e) {
                log.warn("Rating recompute failed for counsellor={} institute={}: {}",
                        c, instituteId, e.getMessage());
            }
        }
        return n;
    }

    // ────────────────────────────────────────────────────────────────

    private record Inputs(int assigned, int converted, Double avgHours) {}

    private Inputs fetchInputs(String instituteId, String counsellorUserId, WorkbenchConfig cfg) {
        int windowDays = cfg.getWindowDays() != null ? cfg.getWindowDays() : 90;
        List<String> keys = cfg.getSuccessStatusKeys() != null && !cfg.getSuccessStatusKeys().isEmpty()
                ? cfg.getSuccessStatusKeys() : List.of("CONVERTED");

        // ta.assigned_at is the LATERAL-derived assignment timestamp; see
        // ASSIGNED_AT_LATERAL above.
        String windowSql = "ta.assigned_at >= NOW() - (? || ' days')::interval";

        Integer assigned = jdbc.queryForObject(
                "SELECT COUNT(*) FROM user_lead_profile ulp " +
                        ASSIGNED_AT_LATERAL +
                        "WHERE ulp.institute_id = ? AND ulp.merged_into_user_id IS NULL " +
                        "  AND ulp.assigned_counselor_id = ? " +
                        "  AND ta.assigned_at IS NOT NULL " +
                        "  AND " + windowSql,
                Integer.class, instituteId, counsellorUserId, windowDays);

        String inList = String.join("','", keys.stream().map(s -> s.replace("'", "''")).toList());
        Integer converted = jdbc.queryForObject(
                "SELECT COUNT(*) FROM user_lead_profile ulp " +
                        ASSIGNED_AT_LATERAL +
                        "WHERE ulp.institute_id = ? AND ulp.merged_into_user_id IS NULL " +
                        "  AND ulp.assigned_counselor_id = ? " +
                        "  AND ta.assigned_at IS NOT NULL " +
                        "  AND " + windowSql + " " +
                        "  AND ulp.conversion_status IN ('" + inList + "')",
                Integer.class, instituteId, counsellorUserId, windowDays);

        Double avgHours = jdbc.queryForObject(
                "SELECT AVG(EXTRACT(EPOCH FROM (ulp.converted_at - ta.assigned_at)) / 3600) " +
                        "FROM user_lead_profile ulp " +
                        ASSIGNED_AT_LATERAL +
                        "WHERE ulp.institute_id = ? AND ulp.merged_into_user_id IS NULL " +
                        "  AND ulp.assigned_counselor_id = ? " +
                        "  AND ta.assigned_at IS NOT NULL " +
                        "  AND ulp.converted_at IS NOT NULL " +
                        "  AND " + windowSql + " " +
                        "  AND ulp.conversion_status IN ('" + inList + "')",
                Double.class, instituteId, counsellorUserId, windowDays);

        return new Inputs(
                assigned != null ? assigned : 0,
                converted != null ? converted : 0,
                avgHours);
    }

    private static BigDecimal clamp(BigDecimal v) {
        if (v == null) return BigDecimal.ZERO;
        if (v.compareTo(BigDecimal.ZERO) < 0) return BigDecimal.ZERO;
        if (v.compareTo(BigDecimal.valueOf(100)) > 0) return BigDecimal.valueOf(100);
        return v;
    }
}
