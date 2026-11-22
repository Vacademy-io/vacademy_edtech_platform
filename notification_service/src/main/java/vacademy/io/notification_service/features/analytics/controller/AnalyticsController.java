package vacademy.io.notification_service.features.analytics.controller;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.notification_service.config.InstituteStaffAccess;
import vacademy.io.notification_service.features.analytics.dto.*;
import vacademy.io.notification_service.features.analytics.service.DailyParticipationService;
import vacademy.io.notification_service.features.analytics.service.LeadJourneyFunnelService;

import java.sql.Timestamp;

@RestController
@RequestMapping("notification-service/analytics")
@RequiredArgsConstructor
@Slf4j
@Tag(name = "Analytics", description = "Analytics APIs for notification metrics and participation tracking")
public class AnalyticsController {

    private final DailyParticipationService dailyParticipationService;
    private final LeadJourneyFunnelService leadJourneyFunnelService;

    @PostMapping("/daily-participation")
    @Operation(
        summary = "Get Daily Participation Metrics",
        description = "Returns 14-day workflow participation metrics including outgoing/incoming messages, unique users, and response rates for each day and template"
    )
    public ResponseEntity<DailyParticipationResponseDTO> getDailyParticipation(
            @RequestBody DailyParticipationRequestDTO request,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId
    ) {
        InstituteStaffAccess.requireStaff(user, clientId, request.getInstituteId());
        log.info("Received daily participation request: {}", request);

        Timestamp startDate = request.getStartDate() != null
                ? Timestamp.valueOf(request.getStartDate())
                : null;
        Timestamp endDate = request.getEndDate() != null
                ? Timestamp.valueOf(request.getEndDate())
                : null;

        DailyParticipationResponseDTO response = dailyParticipationService.getDailyParticipation(
                request.getInstituteId(),
                startDate,
                endDate
        );

        return ResponseEntity.ok(response);
    }

    @PostMapping("/engagement-leaderboard")
    @Operation(
        summary = "Get Engagement Leaderboard",
        description = "Returns a paginated leaderboard of most active users based on their message activity (outgoing + incoming). Includes user details from custom fields."
    )
    public ResponseEntity<EngagementLeaderboardResponseDTO> getEngagementLeaderboard(
            @RequestBody EngagementLeaderboardRequestDTO request,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId
    ) {
        InstituteStaffAccess.requireStaff(user, clientId, request.getInstituteId());
        log.info("Received engagement leaderboard request: {}", request);

        Timestamp startDate = request.getStartDate() != null 
                ? Timestamp.valueOf(request.getStartDate()) 
                : null;
        Timestamp endDate = request.getEndDate() != null 
                ? Timestamp.valueOf(request.getEndDate()) 
                : null;

        Integer page = request.getPage() != null ? request.getPage() : 1;
        Integer pageSize = request.getPageSize() != null ? request.getPageSize() : 20;

        EngagementLeaderboardResponseDTO response = dailyParticipationService.getEngagementLeaderboard(
                request.getInstituteId(),
                startDate,
                endDate,
                page,
                pageSize,
                request.getCustomFieldName(),
                request.getCustomFieldValue()
        );

        return ResponseEntity.ok(response);
    }

    @PostMapping("/completion-cohort")
    @Operation(
        summary = "Get Completion Cohort",
        description = "Returns a paginated list of users who completed the challenge (received completion template). Includes user details and completion dates."
    )
    public ResponseEntity<CompletionCohortResponseDTO> getCompletionCohort(
            @RequestBody CompletionCohortRequestDTO request,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId
    ) {
        InstituteStaffAccess.requireStaff(user, clientId, request.getInstituteId());
        log.info("Received completion cohort request: {}", request);

        Timestamp startDate = request.getStartDate() != null 
                ? Timestamp.valueOf(request.getStartDate()) 
                : null;
        Timestamp endDate = request.getEndDate() != null 
                ? Timestamp.valueOf(request.getEndDate()) 
                : null;

        Integer page = request.getPage() != null ? request.getPage() : 1;
        Integer pageSize = request.getPageSize() != null ? request.getPageSize() : 50;

        CompletionCohortResponseDTO response = dailyParticipationService.getCompletionCohort(
                request.getInstituteId(),
                request.getCompletionTemplateIdentifiers(),
                startDate,
                endDate,
                page,
                pageSize
        );

        return ResponseEntity.ok(response);
    }

    @PostMapping("/lead-journey-funnel")
    @Operation(
        summary = "Get Lead-Journey Daily-Message Funnel",
        description = "Returns per-day send/recipient/reply metrics plus a per-recipient roster for a multi-day WhatsApp drip identified by a template-name prefix (default 'lead_journey_day_'). Surfaces journeys that are not registered in notification_template_day_map (e.g. Facebook-leads journeys)."
    )
    public ResponseEntity<LeadJourneyFunnelResponseDTO> getLeadJourneyFunnel(
            @RequestBody LeadJourneyFunnelRequestDTO request,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId
    ) {
        InstituteStaffAccess.requireStaff(user, clientId, request.getInstituteId());
        log.info("Received lead-journey funnel request: {}", request);

        Timestamp startDate = request.getStartDate() != null
                ? Timestamp.valueOf(request.getStartDate())
                : null;
        Timestamp endDate = request.getEndDate() != null
                ? Timestamp.valueOf(request.getEndDate())
                : null;

        LeadJourneyFunnelResponseDTO response = leadJourneyFunnelService.getFunnel(
                request.getInstituteId(),
                request.getSenderBusinessChannelId(),
                request.getTemplatePrefix(),
                startDate,
                endDate
        );

        return ResponseEntity.ok(response);
    }

    @GetMapping("/outgoing-templates")
    @Operation(
        summary = "Get Outgoing Templates",
        description = "Returns all outgoing template identifiers grouped by day for the given institute. Used to populate dropdown for completion cohort filtering."
    )
    public ResponseEntity<TemplateIdentifiersResponseDTO> getOutgoingTemplates(
            @RequestParam("institute_id") String instituteId,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId
    ) {
        InstituteStaffAccess.requireStaff(user, clientId, instituteId);
        log.info("Received outgoing templates request for institute: {}", instituteId);

        TemplateIdentifiersResponseDTO response = dailyParticipationService.getOutgoingTemplates(instituteId);

        return ResponseEntity.ok(response);
    }
}
