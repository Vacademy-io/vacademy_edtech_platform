package vacademy.io.notification_service.features.email_billing;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.notification_service.features.announcements.security.AnnouncementAccessGuard;

import java.util.List;
import java.util.Map;

/**
 * Email usage and credits for the admin dashboard: this month's free allowance and credits, a cost
 * estimate before a send, and the emails held back for lack of credits (resend or discard).
 * Staff of the institute only.
 */
@RestController
@RequestMapping("/notification-service/v1/email-billing")
@RequiredArgsConstructor
public class EmailBillingController {

    private final EmailBillingService service;
    private final AnnouncementAccessGuard accessGuard;

    @GetMapping("/usage")
    public ResponseEntity<EmailBillingService.UsageSummary> usage(@AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @RequestParam String instituteId,
            @RequestParam(required = false) String month) {
        accessGuard.requireStaff(user, clientId, instituteId);
        return ResponseEntity.ok(service.usage(instituteId, month));
    }

    /**
     * What sending to {@code recipients} people would cost. {@code billingClass} defaults to
     * BILLABLE; {@code copies} is CC/BCC per email; {@code attachmentBytes} per email.
     */
    @GetMapping("/estimate")
    public ResponseEntity<EmailBillingGate.Estimate> estimate(@AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @RequestParam String instituteId,
            @RequestParam int recipients,
            @RequestParam(required = false) String billingClass,
            @RequestParam(defaultValue = "0") int copies,
            @RequestParam(defaultValue = "0") long attachmentBytes) {
        accessGuard.requireStaff(user, clientId, instituteId);
        if (recipients < 0 || copies < 0 || copies > 100) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_ESTIMATE");
        }
        return ResponseEntity.ok(service.estimate(instituteId, billingClass, recipients, copies, attachmentBytes));
    }

    @GetMapping("/blocked")
    public ResponseEntity<Map<String, Object>> blocked(@AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @RequestParam String instituteId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        accessGuard.requireStaff(user, clientId, instituteId);
        return ResponseEntity.ok(service.blocked(instituteId, page, size));
    }

    @PostMapping("/blocked/resend")
    public ResponseEntity<EmailBillingService.ResendResult> resend(@AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @RequestParam String instituteId,
            @RequestBody(required = false) List<String> ids) {
        accessGuard.requireStaff(user, clientId, instituteId);
        return ResponseEntity.ok(service.resend(instituteId, ids));
    }

    @PostMapping("/blocked/discard")
    public ResponseEntity<Map<String, Integer>> discard(@AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @RequestParam String instituteId,
            @RequestBody List<String> ids) {
        accessGuard.requireStaff(user, clientId, instituteId);
        return ResponseEntity.ok(Map.of("discarded", service.discard(instituteId, ids)));
    }
}
