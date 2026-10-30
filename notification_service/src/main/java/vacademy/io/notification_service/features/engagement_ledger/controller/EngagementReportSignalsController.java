package vacademy.io.notification_service.features.engagement_ledger.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.notification_service.features.engagement_ledger.dto.ReportSignalsRequest;
import vacademy.io.notification_service.features.engagement_ledger.dto.ReportSignalsResponse;
import vacademy.io.notification_service.features.engagement_ledger.service.EngagementReportSignalsService;

/**
 * Internal (service-to-service) reads for the engagement daily report in admin_core. Same base path
 * and the same permitAll internal posture as EngagementLedgerInternalController (see the security
 * note there); kept in its own class so the two can change independently.
 */
@RestController
@RequestMapping("/notification-service/internal/v1/engagement")
@RequiredArgsConstructor
@Slf4j
public class EngagementReportSignalsController {

    private final EngagementReportSignalsService engagementReportSignalsService;

    /**
     * Delivery, reply and pricing signals per engine action. Body {instituteId, actionIds (≤ 2000),
     * replyWindowHours (default 72, clamped 1..168)} → {inboundEmailEnabled, actions: {actionId → …}}.
     * Times are epoch millis. 400 when instituteId or actionIds is missing or there are too many ids.
     */
    @PostMapping("/report-signals")
    public ResponseEntity<ReportSignalsResponse> reportSignals(@RequestBody ReportSignalsRequest request) {
        try {
            return ResponseEntity.ok(engagementReportSignalsService.reportSignals(request));
        } catch (IllegalArgumentException e) {
            log.warn("report-signals rejected: {}", e.getMessage());
            return ResponseEntity.badRequest().build();
        }
    }
}
