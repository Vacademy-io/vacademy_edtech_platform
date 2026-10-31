package vacademy.io.notification_service.features.email_sending_controls.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.notification_service.features.email_sending_controls.dto.EmailSendingStatusDTO;
import vacademy.io.notification_service.features.email_sending_controls.dto.UnsubscribeRequest;
import vacademy.io.notification_service.features.email_sending_controls.entity.EmailUnsubscribe;
import vacademy.io.notification_service.features.email_sending_controls.repository.EmailUnsubscribeRepository;
import vacademy.io.notification_service.features.email_sending_controls.service.EmailUnsubscribeService;
import vacademy.io.notification_service.service.EmailService;

import java.util.Map;

/** Admin view of sending controls: quota status per sender, and the institute's unsubscribe list. */
@RestController
@RequestMapping("/notification-service/v1/email-sending")
@RequiredArgsConstructor
public class EmailSendingControlsController {

    private final EmailService emailService;
    private final EmailUnsubscribeService unsubscribes;
    private final EmailUnsubscribeRepository unsubscribeRepository;

    @GetMapping("/status/{instituteId}")
    public ResponseEntity<EmailSendingStatusDTO> status(@PathVariable String instituteId,
                                                        @RequestParam(defaultValue = "PROMOTIONAL_EMAIL") String emailType) {
        return ResponseEntity.ok(emailService.sendingStatus(instituteId, emailType));
    }

    /**
     * Cancel everything still queued for a sender. Returns the number of emails called off;
     * already-sent mail is unaffected.
     */
    @DeleteMapping("/queued/{instituteId}")
    public ResponseEntity<Map<String, Object>> cancelQueued(@PathVariable String instituteId,
                                                            @RequestParam(defaultValue = "PROMOTIONAL_EMAIL") String emailType,
                                                            @RequestParam(required = false) String reason) {
        int cancelled = emailService.cancelQueued(instituteId, emailType, reason);
        return ResponseEntity.ok(Map.of("cancelled", cancelled, "emailType", emailType));
    }

    @GetMapping("/unsubscribes/{instituteId}")
    public ResponseEntity<Page<EmailUnsubscribe>> list(@PathVariable String instituteId,
                                                       @RequestParam(defaultValue = "0") int page,
                                                       @RequestParam(defaultValue = "50") int size) {
        return ResponseEntity.ok(unsubscribeRepository.findByInstituteIdAndIsActiveTrueOrderByCreatedAtDesc(instituteId, PageRequest.of(page, Math.min(size, 200))));
    }

    @PostMapping("/unsubscribes/{instituteId}")
    public ResponseEntity<EmailUnsubscribe> add(@PathVariable String instituteId, @RequestBody UnsubscribeRequest req) {
        if (req.getEmail() == null || req.getEmail().isBlank()) return ResponseEntity.badRequest().build();
        return ResponseEntity.ok(unsubscribes.unsubscribe(req.getEmail(), instituteId, "MANUAL", req.getReason()));
    }

    @DeleteMapping("/unsubscribes/{instituteId}")
    public ResponseEntity<Map<String, Boolean>> remove(@PathVariable String instituteId, @RequestParam String email) {
        return ResponseEntity.ok(Map.of("resubscribed", unsubscribes.resubscribe(email, instituteId)));
    }
}
