package vacademy.io.admin_core_service.features.notification.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.notification.dto.ResendCommunicationRequest;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendResponse;
import vacademy.io.admin_core_service.features.notification.service.CommunicationResendService;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * Resending a message from a learner's communication timeline.
 *
 * <p>The send could be posted straight to notification-service, and originally was. It comes
 * through admin-core instead for one reason: {@code /notification-service/v1/send} is permitAll, so
 * nothing there can say WHO resent a message. Here the admin's JWT is already resolved, and
 * {@code @Auditable} writes the row into admin_activity_log alongside course and learner actions —
 * "who messaged this learner twice" gets an answer on the same page as everything else.
 */
@RestController
@RequestMapping("/admin-core-service/v1/communication")
@RequiredArgsConstructor
@Slf4j
public class CommunicationResendController {

    private final CommunicationResendService communicationResendService;

    /**
     * Replay one message to the learner it already went to.
     *
     * <p>The audit row is conditional on the provider actually accepting the send: a WhatsApp
     * rejection comes back inside a 200 with {@code failed: 1}, and logging that would record a
     * message that never left.
     */
    @PostMapping("/resend")
    @Auditable(
            entityType = "COMMUNICATION",
            action = "RESEND",
            entityIdExpr = "#request?.sourceLogId",
            conditionExpr = "@communicationResendService.wasAccepted(#result?.body)",
            descriptionExpr = "@communicationResendService.describe(#request)")
    public ResponseEntity<UnifiedSendResponse> resend(
            @RequestBody ResendCommunicationRequest request,
            @RequestAttribute("user") CustomUserDetails user) {

        log.info("Resend requested by {} for institute {} ({} to {})",
                user != null ? user.getUserId() : "unknown",
                request.getInstituteId(), request.getChannel(), request.getRecipient());

        return ResponseEntity.ok(communicationResendService.resend(request));
    }
}
