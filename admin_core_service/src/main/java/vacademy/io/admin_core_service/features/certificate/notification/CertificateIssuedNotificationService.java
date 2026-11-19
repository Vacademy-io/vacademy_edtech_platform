package vacademy.io.admin_core_service.features.certificate.notification;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.notification.dto.AttachmentNotificationDTO;
import vacademy.io.common.notification.dto.AttachmentUsersDTO;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.text.SimpleDateFormat;
import java.time.Duration;
import java.util.Base64;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Sends the "your certificate is ready" email when a certificate is issued.
 * Fired from {@code InstituteCertificateManager} after the file id is persisted
 * on the learner mapping. Failures are logged but never propagated — the
 * learner has already received the certificate URL synchronously.
 *
 * <p>Preferred path attaches the PDF directly to the email; if the PDF cannot
 * be fetched (network blip, S3 ACL, etc.) we fall back to a link-only email so
 * the learner is still notified.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CertificateIssuedNotificationService {

    private final NotificationService notificationService;
    private final AuthService authService;

    /**
     * @return true when an email was handed to the notification service. The
     *         issuance path ignores this — a failed email must never block
     *         certificate delivery — but the admin "Resend" action surfaces it,
     *         since silently reporting success for an email that was never sent
     *         is worse than saying nothing.
     */
    public boolean notifyCertificateIssued(Institute institute, String userId, String studentName,
                                        String courseName, String certificateId, String certificateUrl) {
        try {
            String email = resolveEmail(userId);
            if (email == null || email.isBlank()) {
                log.warn("Skipping certificate-issued email for user {}: no email on file", userId);
                return false;
            }

            String resolvedStudentName = (studentName != null && !studentName.isBlank()) ? studentName : "Learner";
            String resolvedCourseName  = courseName != null ? courseName : "";
            String resolvedInstitute   = institute != null ? Objects.toString(institute.getInstituteName(), "") : "";
            // The legacy variable is still called `issueDate` locally so we
            // don't have to ripple-rename through unrelated callers, but the
            // email template token has been renamed to {{DATE_OF_COMPLETION}}.
            String issueDate           = new SimpleDateFormat("dd MMM yyyy").format(new Date());
            String instituteId         = institute != null ? institute.getId() : null;

            String body = CertificateIssuedEmailBody.CERTIFICATE_ISSUED_EMAIL_TEMPLATE
                    .replace("{{STUDENT_NAME}}", resolvedStudentName)
                    .replace("{{COURSE_NAME}}", resolvedCourseName)
                    .replace("{{INSTITUTE_NAME}}", resolvedInstitute)
                    .replace("{{CERTIFICATE_URL}}", certificateUrl != null ? certificateUrl : "")
                    .replace("{{CERTIFICATE_ID}}", certificateId != null ? certificateId : "")
                    .replace("{{DATE_OF_COMPLETION}}", issueDate);

            String subject = "Your certificate for " + resolvedCourseName + " is ready";

            byte[] pdfBytes = certificateUrl != null ? downloadPdfBytes(certificateUrl) : null;

            if (pdfBytes != null && pdfBytes.length > 0) {
                sendWithAttachment(email, subject, body, pdfBytes, certificateId, instituteId);
            } else {
                log.warn("Falling back to link-only certificate email for user {} (PDF download unavailable)", userId);
                notificationService.sendHtmlEmailViaUnified(
                        email,
                        subject,
                        body,
                        instituteId,
                        null, null,
                        "UTILITY_EMAIL");
            }
            return true;
        } catch (Exception e) {
            log.error("Failed to send certificate-issued email for user {}: {}", userId, e.getMessage());
            return false;
        }
    }

    private void sendWithAttachment(String email, String subject, String body, byte[] pdfBytes,
                                    String certificateId, String instituteId) {
        String fileName = "certificate-" + (certificateId != null ? certificateId : "issued") + ".pdf";

        AttachmentUsersDTO.AttachmentDTO attachment = new AttachmentUsersDTO.AttachmentDTO();
        attachment.setAttachmentName(fileName);
        attachment.setAttachment(Base64.getEncoder().encodeToString(pdfBytes));

        AttachmentUsersDTO toUser = new AttachmentUsersDTO();
        toUser.setChannelId(email);
        toUser.setPlaceholders(Map.of("email", email));
        toUser.setAttachments(List.of(attachment));

        AttachmentNotificationDTO notification = AttachmentNotificationDTO.builder()
                .body(body)
                .subject(subject)
                .notificationType("EMAIL")
                .source("CERTIFICATE_ISSUED")
                .sourceId(certificateId)
                .users(List.of(toUser))
                .build();

        notificationService.sendAttachmentEmailViaUnified(List.of(notification), instituteId);
    }

    /**
     * Best-effort GET of the certificate PDF from the public URL stored on the
     * issued certificate row. Returns null on any failure — the caller falls
     * back to a link-only email so the learner still gets notified.
     */
    private byte[] downloadPdfBytes(String url) {
        try {
            HttpClient client = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofSeconds(10))
                    .followRedirects(HttpClient.Redirect.NORMAL)
                    .build();
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofSeconds(30))
                    .GET()
                    .build();
            HttpResponse<byte[]> res = client.send(req, HttpResponse.BodyHandlers.ofByteArray());
            if (res.statusCode() >= 200 && res.statusCode() < 300) {
                return res.body();
            }
            log.warn("Certificate PDF fetch returned status {} for url {}", res.statusCode(), url);
        } catch (Exception e) {
            log.warn("Failed to download certificate PDF from {}: {}", url, e.getMessage());
        }
        return null;
    }

    private String resolveEmail(String userId) {
        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(userId));
            if (users != null && !users.isEmpty()) {
                return users.get(0).getEmail();
            }
        } catch (Exception e) {
            log.warn("Could not resolve email for user {}: {}", userId, e.getMessage());
        }
        return null;
    }
}
