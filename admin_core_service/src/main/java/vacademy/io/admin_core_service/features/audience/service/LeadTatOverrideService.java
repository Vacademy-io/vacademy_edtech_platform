package vacademy.io.admin_core_service.features.audience.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.timeline.enums.LeadJourneyActionType;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Admin-only manual override of one lead's TAT deadline. The override is stored on
 * {@code audience_response.tat_due_override_at} and wins over the computed (working-hours
 * aware) deadline everywhere — list badge, SLA filter, reports and the SLA scheduler.
 * Clearing it (null) returns the lead to the automatic deadline.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class LeadTatOverrideService {

    private final AudienceResponseRepository audienceResponseRepository;
    private final AudienceRepository audienceRepository;
    private final AudienceRoleAccessService audienceRoleAccessService;
    private final TimelineEventService timelineEventService;

    /**
     * @param dueAtIso ISO-8601 instant (e.g. "2026-10-07T04:30:00Z"), or null/blank to clear.
     */
    @Transactional
    public void setOverride(String instituteId, String responseId, String dueAtIso, CustomUserDetails user) {
        if (user == null || !audienceRoleAccessService.resolvedCallerRoles(user, instituteId).contains("ADMIN")) {
            throw new VacademyException(HttpStatus.FORBIDDEN, "Only admins can change a lead's TAT deadline.");
        }

        AudienceResponse lead = audienceResponseRepository.findById(responseId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Lead not found: " + responseId));
        String leadInstitute = audienceRepository.findById(lead.getAudienceId())
                .map(Audience::getInstituteId).orElse(null);
        if (leadInstitute == null || !leadInstitute.equals(instituteId)) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "Lead not found: " + responseId);
        }

        Timestamp dueAt = parse(dueAtIso);
        if (dueAt != null && lead.getSubmittedAt() != null && !dueAt.after(lead.getSubmittedAt())) {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "The TAT deadline must be after the lead came in.");
        }

        Timestamp previous = lead.getTatDueOverrideAt();
        audienceResponseRepository.setTatDueOverride(responseId, dueAt, user.getUserId());

        // Journey trail (JOURNEY category, not a response event — it doesn't stop the TAT clock).
        try {
            Map<String, Object> meta = new LinkedHashMap<>();
            meta.put("previous_override_at", previous != null ? previous.toInstant().toString() : "");
            meta.put("new_override_at", dueAt != null ? dueAt.toInstant().toString() : "");
            timelineEventService.logJourneyEvent(
                    "AUDIENCE_RESPONSE", responseId,
                    LeadJourneyActionType.TAT_DEADLINE_CHANGED,
                    "ADMIN", user.getUserId(), user.getUsername(),
                    dueAt != null ? "TAT deadline set manually" : "TAT deadline reset to automatic",
                    null,
                    meta,
                    lead.getUserId() != null ? lead.getUserId() : lead.getStudentUserId());
        } catch (Exception e) {
            log.warn("[LeadTat] journey log failed for lead {}: {}", responseId, e.getMessage());
        }
    }

    private static Timestamp parse(String iso) {
        if (iso == null || iso.isBlank()) return null;
        try {
            return Timestamp.from(Instant.parse(iso.trim()));
        } catch (DateTimeParseException e) {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "Invalid due_at '" + iso + "' — send an ISO-8601 instant, e.g. 2026-10-07T04:30:00Z.");
        }
    }
}
