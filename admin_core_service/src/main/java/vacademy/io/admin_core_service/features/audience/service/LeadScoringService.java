package vacademy.io.admin_core_service.features.audience.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.entity.LeadScore;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadScoreRepository;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldValuesRepository;
import vacademy.io.admin_core_service.features.enquiry.entity.Enquiry;
import vacademy.io.admin_core_service.features.enquiry.repository.EnquiryRepository;
import vacademy.io.admin_core_service.features.timeline.enums.LeadJourneyActionType;
import vacademy.io.admin_core_service.features.timeline.repository.TimelineEventRepository;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;

/**
 * Real-time lead scoring engine.
 * Calculates raw_score (0-100) immediately on every lead event.
 * Percentile ranks are recalculated in batch every 15 minutes.
 *
 * Scoring factors (default weights — per-institute overrides come from
 * LEAD_SETTING.data.scoringWeights via {@link LeadScoringSettingService}):
 * 1. SOURCE_QUALITY (25%): Source type credibility
 * 2. PROFILE_COMPLETENESS (30%): How many key fields are filled
 * 3. RECENCY (25%): Time decay — newer leads score higher
 * 4. ENGAGEMENT (20%): Timeline events count
 */
@Service
public class LeadScoringService {

    private static final Logger logger = LoggerFactory.getLogger(LeadScoringService.class);

    // Default source quality scores
    private static final Map<String, Integer> DEFAULT_SOURCE_SCORES = Map.of(
            "GOOGLE_ADS", 90,
            "FACEBOOK_ADS", 80,
            "LINKEDIN_ADS", 85,
            "INSTAGRAM_ADS", 75,
            "TWITTER_ADS", 70,
            "WEBSITE", 70,
            "WALK_IN", 85,
            "AUDIENCE_CAMPAIGN", 70,
            "MANUAL", 40
    );

    @Autowired
    private LeadScoreRepository leadScoreRepository;

    @Autowired
    private LeadTierService leadTierService;

    @Autowired
    private AudienceResponseRepository audienceResponseRepository;

    @Autowired
    private AudienceRepository audienceRepository;

    @Autowired
    private EnquiryRepository enquiryRepository;

    @Autowired
    private CustomFieldValuesRepository customFieldValuesRepository;

    @Autowired
    private TimelineEventRepository timelineEventRepository;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private UserLeadProfileService userLeadProfileService;

    @Autowired
    private LeadScoringSettingService leadScoringSettingService;

    // @Lazy breaks cycle: LeadScoringService → TimelineEventService → UserLeadProfileService → (lazy) LeadScoringService
    @Autowired
    @Lazy
    private TimelineEventService timelineEventService;

    /**
     * Calculate and persist lead score for an AudienceResponse.
     * Called in real-time on lead creation and lead events.
     *
     * @param audienceResponseId The audience response ID
     * @param audienceId         The audience/campaign ID
     * @param instituteId        The institute ID
     * @param sourceType         The lead source type
     * @param enquiryId          The linked enquiry ID (may be null)
     */
    @Transactional
    public LeadScore calculateAndSaveScore(String audienceResponseId, String audienceId,
                                            String instituteId, String sourceType,
                                            String enquiryId) {
        logger.debug("Calculating lead score for response: {}", audienceResponseId);

        // Skip recalculation if a manual override is active — preserve the admin-set score.
        LeadScore existingForCheck = leadScoreRepository.findByAudienceResponseId(audienceResponseId).orElse(null);
        if (existingForCheck != null && Boolean.TRUE.equals(existingForCheck.getIsManualOverride())) {
            logger.debug("Skipping recalculation — manual score override active for response: {}", audienceResponseId);
            return existingForCheck;
        }

        // Pre-fetch the response so engagement can also count cross-stage events
        // (notes/calls logged from the lead-profile drawer carry student_user_id but
        // not type='AUDIENCE_RESPONSE', so they would otherwise be missed).
        AudienceResponse responseForScoring = audienceResponseRepository.findById(audienceResponseId).orElse(null);
        String userIdForEngagement = null;
        if (responseForScoring != null) {
            userIdForEngagement = responseForScoring.getStudentUserId() != null
                    ? responseForScoring.getStudentUserId()
                    : responseForScoring.getUserId();
        }

        // Per-institute weights + recency decay (LEAD_SETTING.data, cached 5 min)
        LeadScoringSettingService.ScoringConfig cfg = leadScoringSettingService.get(instituteId);

        // Factor 1: Source Quality (0-100)
        int sourceScore = calculateSourceScore(sourceType);

        // Factor 2: Profile Completeness (0-100)
        int completenessScore = calculateCompletenessScore(audienceResponseId, enquiryId);

        // Factor 3: Recency (0-100)
        int recencyScore = calculateRecencyScore(audienceResponseId, cfg.decayDays());

        // Factor 4: Engagement (0-100)
        int engagementScore = calculateEngagementScore(enquiryId, audienceResponseId, userIdForEngagement);

        // Weighted sum (single division avoids rounding errors in the final score)
        int baseScore = (sourceScore * cfg.sourceWeight()
                + completenessScore * cfg.completenessWeight()
                + recencyScore * cfg.recencyWeight()
                + engagementScore * cfg.engagementWeight()) / 100;

        // Clamp to 0-100
        baseScore = Math.max(0, Math.min(100, baseScore));

        // Add the snapshotted initial score (set at lead creation) on top of calculated score, capped at 100.
        // Null means the lead predates this feature → treated as 0.
        Integer initialScore = (responseForScoring != null) ? responseForScoring.getInitialScore() : null;
        int rawScore = (initialScore != null) ? Math.min(100, baseScore + initialScore) : baseScore;

        // Distribute baseScore exactly across factors using largest-remainder so contributions always sum to baseScore.
        int[] scores  = { sourceScore, completenessScore, recencyScore, engagementScore };
        int[] weights = { cfg.sourceWeight(), cfg.completenessWeight(), cfg.recencyWeight(), cfg.engagementWeight() };
        int[] contributions = new int[4];
        double[] remainders = new double[4];
        int floorSum = 0;
        for (int i = 0; i < 4; i++) {
            double exact = scores[i] * weights[i] / 100.0;
            contributions[i] = (int) exact;
            remainders[i] = exact - contributions[i];
            floorSum += contributions[i];
        }
        // Give the leftover points to the factors with the largest remainders
        int leftover = baseScore - floorSum;
        Integer[] order = { 0, 1, 2, 3 };
        Arrays.sort(order, (a, b) -> Double.compare(remainders[b], remainders[a]));
        for (int i = 0; i < leftover; i++) {
            contributions[order[i]]++;
        }

        // Build scoring factors breakdown for UI
        Map<String, Object> factors = new LinkedHashMap<>();
        factors.put("source_quality", Map.of("score", sourceScore, "weight", cfg.sourceWeight(),
                "contribution", contributions[0]));
        factors.put("profile_completeness", Map.of("score", completenessScore, "weight", cfg.completenessWeight(),
                "contribution", contributions[1]));
        factors.put("recency", Map.of("score", recencyScore, "weight", cfg.recencyWeight(),
                "contribution", contributions[2]));
        factors.put("engagement", Map.of("score", engagementScore, "weight", cfg.engagementWeight(),
                "contribution", contributions[3]));
        if (initialScore != null) {
            factors.put("initial_score", Map.of("value", initialScore));
        }

        String factorsJson;
        try {
            factorsJson = objectMapper.writeValueAsString(factors);
        } catch (JsonProcessingException e) {
            factorsJson = null;
            logger.error("Failed to serialize scoring factors", e);
        }

        // Upsert the score
        LeadScore leadScore = leadScoreRepository.findByAudienceResponseId(audienceResponseId)
                .orElse(LeadScore.builder()
                        .audienceResponseId(audienceResponseId)
                        .audienceId(audienceId)
                        .instituteId(instituteId)
                        .build());

        // Capture old score before overwrite — used to decide whether to log SCORE_UPDATED.
        Integer oldRawScore = leadScore.getId() != null ? leadScore.getRawScore() : null;

        leadScore.setRawScore(rawScore);
        leadScore.setScoringFactorsJson(factorsJson);
        leadScore.setLastCalculatedAt(new Timestamp(System.currentTimeMillis()));

        LeadScore saved = leadScoreRepository.save(leadScore);
        String savedTier = leadTierService.deriveTier(saved.getInstituteId(), saved.getRawScore());
        logger.info("Lead score calculated: response={}, score={}, tier={}",
                audienceResponseId, rawScore, savedTier);

        // Log SCORE_UPDATED whenever the score is set or changes (including initial calculation).
        if (!Integer.valueOf(rawScore).equals(oldRawScore)) {
            try {
                String title = oldRawScore == null
                        ? "Lead score calculated"
                        : "Lead score updated";
                String desc = oldRawScore == null
                        ? "Initial score: " + rawScore
                        : "Score changed from " + oldRawScore + " to " + rawScore;
                timelineEventService.logJourneyEvent(
                        "AUDIENCE_RESPONSE", audienceResponseId,
                        LeadJourneyActionType.SCORE_UPDATED,
                        "SYSTEM", null, "System",
                        title, desc,
                        Map.of("old_score", oldRawScore != null ? oldRawScore : 0,
                               "new_score", rawScore,
                               "tier", savedTier != null ? savedTier : ""),
                        responseForScoring != null ? responseForScoring.getStudentUserId() : null
                );
            } catch (Exception e) {
                logger.warn("Failed to log SCORE_UPDATED journey event for response={}: {}", audienceResponseId, e.getMessage());
            }
        }

        // Asynchronously update the user-level lead profile
        try {
            if (responseForScoring != null) {
                String profileUserId = responseForScoring.getUserId() != null
                        ? responseForScoring.getUserId()
                        : responseForScoring.getStudentUserId();
                if (profileUserId != null) {
                    userLeadProfileService.buildOrUpdateProfile(profileUserId, instituteId);
                }
            }
        } catch (Exception e) {
            logger.warn("Failed to update user_lead_profile after score save for response={}", audienceResponseId, e);
        }

        return saved;
    }

    /**
     * Recalculate score for a lead (triggered by events like status change, note added, etc.)
     */
    @Transactional
    public void recalculateScore(String audienceResponseId) {
        AudienceResponse response = audienceResponseRepository.findById(audienceResponseId).orElse(null);
        if (response == null) {
            logger.warn("Cannot recalculate score — AudienceResponse not found: {}", audienceResponseId);
            return;
        }

        // Find the institute via Audience
        String instituteId = null;
        try {
            // Use the existing score's institute
            LeadScore existing = leadScoreRepository.findByAudienceResponseId(audienceResponseId).orElse(null);
            if (existing != null) {
                instituteId = existing.getInstituteId();
            }
        } catch (Exception e) {
            logger.error("Error getting institute for recalculation", e);
        }

        // Never scored yet (an intake path that skipped scoring): take the institute from
        // the lead's list, so a recalculation can create the first score instead of no-oping.
        if (instituteId == null && StringUtils.hasText(response.getAudienceId())) {
            instituteId = audienceRepository.findById(response.getAudienceId())
                    .map(Audience::getInstituteId)
                    .orElse(null);
        }

        if (instituteId == null) {
            logger.warn("Cannot determine institute for response: {}", audienceResponseId);
            return;
        }

        calculateAndSaveScore(
                audienceResponseId,
                response.getAudienceId(),
                instituteId,
                response.getSourceType(),
                response.getEnquiryId()
        );
    }

    /**
     * Batch recalculate percentile ranks every 15 minutes.
     * Percentile is an expensive operation (touches all rows) so it runs as batch.
     */
    @Scheduled(fixedRate = 15 * 60 * 1000) // 15 minutes
    // lockAtLeastFor sits just under the 15-minute rate. Each of the 4 replicas ticks on its
    // own fixedRate timer, so a 30s floor only stopped CONCURRENT runs: the job ran about once
    // per replica per interval (266 runs in 16 h instead of ~64). Same fix as
    // AirtelCcrImportScheduler; cron-scheduled jobs fire together and do not need it.
    @SchedulerLock(name = "LeadScoringService_batchRecalculatePercentiles", lockAtMostFor = "PT14M", lockAtLeastFor = "PT14M")
    @Transactional
    public void batchRecalculatePercentiles() {
        logger.info("Starting batch percentile recalculation...");

        // One set-based UPDATE instead of one per audience. PERCENT_RANK already partitions by
        // audience_id, so each row receives the same rank the per-audience loop computed -- the
        // loop was issuing N round trips to narrow a window function that did not need narrowing.
        //
        // The old loop caught per-audience failures and carried on. A single statement is
        // all-or-nothing inside this transaction: a failure now rolls the whole recalculation
        // back rather than leaving some audiences updated and others stale. That is the safer
        // outcome for a job that runs to completion on a schedule.
        int updated = leadScoreRepository.recalculatePercentilesForAllAudiences();

        logger.info("Batch percentile recalculation complete. Updated {} lead scores.", updated);
    }

    // ─────────────────────────────────────────────────────────
    // Factor Calculation Methods
    // ─────────────────────────────────────────────────────────

    /**
     * Factor 1: Source Quality (0-100)
     * Higher-intent sources score higher.
     */
    private int calculateSourceScore(String sourceType) {
        if (sourceType == null) return 40; // default for unknown
        return DEFAULT_SOURCE_SCORES.getOrDefault(sourceType.toUpperCase(), 50);
    }

    /**
     * Factor 2: Profile Completeness (0-100)
     * Percentage of key fields filled across AudienceResponse + custom fields.
     */
    private int calculateCompletenessScore(String audienceResponseId, String enquiryId) {
        int totalFields = 0;
        int filledFields = 0;

        // Check AudienceResponse fields
        AudienceResponse response = audienceResponseRepository.findById(audienceResponseId).orElse(null);
        if (response != null) {
            totalFields += 4; // parentName, parentEmail, parentMobile, studentUserId
            if (StringUtils.hasText(response.getParentName())) filledFields++;
            if (StringUtils.hasText(response.getParentEmail())) filledFields++;
            if (StringUtils.hasText(response.getParentMobile())) filledFields++;
            if (StringUtils.hasText(response.getStudentUserId())) filledFields++;
        }

        // Check custom field values count
        long customFieldCount = customFieldValuesRepository
                .findBySourceTypeAndSourceId("AUDIENCE_RESPONSE", audienceResponseId)
                .size();
        // Assume a good submission has 3+ custom fields
        totalFields += 3;
        filledFields += Math.min(3, (int) customFieldCount);

        // Check Enquiry fields if available
        if (StringUtils.hasText(enquiryId)) {
            try {
                Enquiry enquiry = enquiryRepository.findById(UUID.fromString(enquiryId)).orElse(null);
                if (enquiry != null) {
                    totalFields += 3; // referenceSource, mode, parentRelationWithChild
                    if (StringUtils.hasText(enquiry.getReferenceSource())) filledFields++;
                    if (StringUtils.hasText(enquiry.getMode())) filledFields++;
                    if (StringUtils.hasText(enquiry.getParentRelationWithChild())) filledFields++;
                }
            } catch (Exception e) {
                // Ignore — enquiry might have non-UUID id format
            }
        }

        if (totalFields == 0) return 50; // default
        return (filledFields * 100) / totalFields;
    }

    /**
     * Factor 3: Recency (0-100)
     * Linear decay over the institute's configured decay window
     * (LEAD_SETTING.data.recencyDecayDays, default 30).
     * Brand new = 100, decayDays+ old = 0.
     */
    private int calculateRecencyScore(String audienceResponseId, int decayDays) {
        AudienceResponse response = audienceResponseRepository.findById(audienceResponseId).orElse(null);
        if (response == null || response.getSubmittedAt() == null) return 50;

        long daysSinceSubmission = ChronoUnit.DAYS.between(
                response.getSubmittedAt().toInstant(),
                Instant.now());

        if (daysSinceSubmission <= 0) return 100;
        if (daysSinceSubmission >= decayDays) return 0;

        return (int) ((decayDays - daysSinceSubmission) * 100L / decayDays);
    }

    /**
     * Factor 4: Engagement (0-100)
     * Counts timeline events from three sources:
     *  - enquiry-tied events (type='ENQUIRY', type_id=enquiryId)
     *  - response-tied events (type='AUDIENCE_RESPONSE', type_id=audienceResponseId)
     *  - cross-stage events tagged on the student (student_user_id=userId) — this is
     *    where notes/calls/meetings logged from the lead-profile drawer land.
     * Curve: 0 events = 0, 1 event = 30, 2 events = 50, 3-4 events = 70, 5+ events = 100.
     */
    private int calculateEngagementScore(String enquiryId, String audienceResponseId, String userId) {
        long eventCount = 0;

        // Count timeline events for the enquiry
        if (StringUtils.hasText(enquiryId)) {
            eventCount = timelineEventRepository.countByTypeAndTypeId("ENQUIRY", enquiryId);
        }

        // Also count timeline events for the audience response
        eventCount += timelineEventRepository.countByTypeAndTypeId("AUDIENCE_RESPONSE", audienceResponseId);

        // Cross-stage events stamped with student_user_id (notes/calls/meetings from
        // the lead-profile drawer). These are tagged with type='STUDENT' or similar
        // and would otherwise be invisible to the count above.
        if (StringUtils.hasText(userId)) {
            eventCount += timelineEventRepository.countByStudentUserId(userId);
        }

        if (eventCount == 0) return 0;
        if (eventCount == 1) return 30;
        if (eventCount == 2) return 50;
        if (eventCount <= 4) return 70;
        return 100; // 5+ events
    }

}
