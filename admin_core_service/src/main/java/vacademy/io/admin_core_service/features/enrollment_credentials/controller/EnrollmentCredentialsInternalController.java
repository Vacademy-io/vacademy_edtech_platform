package vacademy.io.admin_core_service.features.enrollment_credentials.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.enrollment_credentials.service.EnrollmentCredentialsService;

/**
 * Returns the ready-to-send login-details text for a phone number, for the
 * chatbot flow's HTTP_WEBHOOK node to forward verbatim into a free-text session
 * message.
 *
 * Returns text/plain rather than JSON on purpose: HttpWebhookNodeExecutor stores
 * the response body as an opaque string in a session variable and has no
 * JSON-path extraction, so anything but final text would reach the learner as a
 * raw blob.
 *
 * 204 No Content when the number has no ACTIVE in-scope enrollment. The flow's
 * SEND_MESSAGE node refuses to send a blank body, so an unknown number results
 * in no message rather than a half-filled one — fail closed.
 *
 * Lives under "/admin-core-service/internal/**", which the edge gates on
 * clientName + Signature headers.
 */
@RestController
@RequestMapping("/admin-core-service/internal/enrollment-credentials")
@RequiredArgsConstructor
@Slf4j
public class EnrollmentCredentialsInternalController {

    private final EnrollmentCredentialsService enrollmentCredentialsService;

    @GetMapping(value = "/text", produces = MediaType.TEXT_PLAIN_VALUE)
    public ResponseEntity<String> credentialsText(@RequestParam("phone") String phone) {
        String text = enrollmentCredentialsService.buildCredentialsText(phone);
        if (text == null) {
            return ResponseEntity.noContent().build();
        }
        return ResponseEntity.ok(text);
    }
}
