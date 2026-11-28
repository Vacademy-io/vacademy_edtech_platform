package vacademy.io.admin_core_service.features.live_activity.core;

import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.live_activity.dto.LiveActivityEvent;
import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityAction;
import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityActorType;
import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityCategory;

import java.util.HashMap;
import java.util.Map;

/**
 * Turns a lead journey milestone into a feed event.
 *
 * <p><b>Called from {@code AudienceService.logLeadSubmitted}, which is the single choke
 * point every intake path funnels through</b> -- submitLead, submitLeadV2,
 * submitCatalogueLead, submitLeadWithEnquiry, the Meta / Google / Microsoft / Zoho /
 * generic form webhooks, and walk-in registration.
 *
 * <p><b>It deliberately does NOT hook {@code TimelineEventService.logJourneyEvent}, which
 * was the first attempt and silently recorded nothing.</b> That method runs
 * {@code REQUIRES_NEW}, so it executes in a transaction of its own -- and the
 * {@code audience_response} row it would need to read is still uncommitted in the caller's
 * transaction at that moment. Every lookup came back empty and every lead was dropped,
 * with no error anywhere. Taking the saved entity as an argument removes the read entirely.
 */
@Component
@RequiredArgsConstructor
public class LiveActivityLeadRecorder {

    private static final Logger log = LoggerFactory.getLogger(LiveActivityLeadRecorder.class);

    private final LiveActivityRecorder recorder;
    private final AudienceRepository audienceRepository;

    /**
     * Record a newly submitted lead.
     *
     * <p>Takes the persisted entity rather than an id: the caller has it in hand, and at
     * this point in the transaction nobody else can read it yet.
     */
    public void recordLeadSubmitted(AudienceResponse response) {
        if (response == null) {
            return;
        }
        try {
            String instituteId = resolveInstituteId(response);
            if (instituteId == null) {
                // Without a tenant the row cannot be scoped to anyone's feed, and writing it
                // unscoped would leak a lead across institutes.
                log.debug("Skipping lead live activity for {} -- institute could not be resolved",
                        response.getId());
                return;
            }

            Map<String, Object> payload = new HashMap<>();
            if (response.getSourceType() != null) {
                payload.put("sourceType", response.getSourceType());
            }
            if (response.getAudienceId() != null) {
                payload.put("audienceId", response.getAudienceId());
            }

            recorder.recordAfterCommit(LiveActivityEvent.builder()
                    .instituteId(instituteId)
                    .occurredAtEpochMillis(System.currentTimeMillis())
                    .category(LiveActivityCategory.LEAD_FORM)
                    .action(LiveActivityAction.LEAD_SUBMITTED)
                    .actorType(LiveActivityActorType.PROSPECT)
                    .dedupeKey(LiveActivityDedupeKeys.forLead(response.getId()))
                    .subjectId(response.getUserId())
                    .subjectName(response.getParentName())
                    .subjectEmail(response.getParentEmail())
                    .subjectMobile(response.getParentMobile())
                    .entityId(response.getId())
                    .payload(payload)
                    .build());
        } catch (Exception e) {
            log.warn("Failed to record live activity for lead {}: {}",
                    response.getId(), e.getMessage());
        }
    }

    private String resolveInstituteId(AudienceResponse response) {
        if (response.getAudienceId() == null) {
            return null;
        }
        return audienceRepository.findById(response.getAudienceId())
                .map(audience -> audience.getInstituteId())
                .orElse(null);
    }
}
