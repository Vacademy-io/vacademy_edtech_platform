package vacademy.io.assessment_service.features.assessment.notification;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportPdfService;
import vacademy.io.assessment_service.features.notification.service.NotificationService;
import vacademy.io.assessment_service.features.open_evaluation.policy.ApiCandidatePolicy;
import vacademy.io.common.notification.dto.AttachmentNotificationDTO;
import vacademy.io.common.notification.dto.AttachmentUsersDTO;
import vacademy.io.common.logging.SentryLogger;

import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Slf4j
@Service
public class AssessmentReportNotificationService {

    @Autowired
    private NotificationService notificationService;

    // Optional so a bare instance (unit tests) still sends the built-in email.
    @Autowired(required = false)
    private ResultNotificationService resultNotificationService;

    @Autowired(required = false)
    private AiReportPdfService aiReportPdfService;

    /**
     * The result email of a release (manual-evaluation tests: the checked copy attached). Uses the
     * institute's ASSESSMENT_RESULT_RELEASED email (assessment binding, else institute) with the
     * same per-learner values as auto-evaluated tests. Not the DEFAULT one: its text describes the
     * AI report, not a checked copy, so without a binding the built-in email goes out.
     */
    public void sendAssessmentReportsToLearners(Map<StudentAttempt, byte[]> participantPdfReport, String assessmentId, String instituteId) {
        if (resultNotificationService != null) {
            sendWithResultTemplate(participantPdfReport, assessmentId, instituteId);
            return;
        }
        sendAssessmentReportsToLearners(participantPdfReport, assessmentId, instituteId, "Assessment Report",
                AssessmentNotificationEmailBody.getAssessmentReportBody());
    }

    private void sendWithResultTemplate(Map<StudentAttempt, byte[]> participantPdfReport, String assessmentId,
                                        String instituteId) {
        // Resolve once, first: only the institute's own template can use the full report values,
        // so the per-learner report load is skipped when the built-in email goes out.
        ResultNotificationService.Templates resolved = null;
        try {
            resolved = resultNotificationService.resolve(instituteId, assessmentId);
        } catch (Exception e) {
            log.warn("Result template lookup failed for assessment {}; sending the built-in email: {}",
                    assessmentId, e.getMessage());
        }
        String level = resolved == null ? null : resolved.emailLevel();
        boolean bound = "ASSESSMENT".equals(level) || "INSTITUTE".equals(level);

        List<ResultNotificationService.Item> items = new ArrayList<>();
        for (Map.Entry<StudentAttempt, byte[]> entry : participantPdfReport.entrySet()) {
            StudentAttempt attempt = entry.getKey();
            // Same skip as below: no API candidates, no blank addresses (and no values loaded for them).
            if (attempt == null || !ApiCandidatePolicy.mayMessage(attempt.getRegistration()) || entry.getValue() == null) {
                continue;
            }
            Map<String, String> variables = bound && aiReportPdfService != null
                    ? aiReportPdfService.variables(attempt.getRegistration().getUserId(), assessmentId, attempt.getId(),
                    instituteId, null, null, null)
                    : Map.of();
            items.add(new ResultNotificationService.Item(attempt, entry.getValue(), withAssessmentName(variables, attempt)));
        }
        if (items.isEmpty()) {
            return;
        }
        try {
            resultNotificationService.sendEmails(items, assessmentId, instituteId,
                    bound ? resolved : new ResultNotificationService.Templates(null, null));
        } catch (Exception e) {
            SentryLogger.SentryEventBuilder.error(e)
                    .withMessage("Failed to send assessment report notification")
                    .withTag("notification.type", "EMAIL")
                    .withTag("email.type", "ASSESSMENT_REPORT")
                    .withTag("assessment.id", assessmentId != null ? assessmentId : "unknown")
                    .withTag("user.count", String.valueOf(items.size()))
                    .withTag("operation", "sendAssessmentReportEmail")
                    .send();
            throw e;
        }
    }

    /** The subject and attachment name need {{assessment_name}} even when no report values were loaded. */
    private static Map<String, String> withAssessmentName(Map<String, String> variables, StudentAttempt attempt) {
        if (variables != null && StringUtils.hasText(variables.get("assessment_name"))) {
            return variables;
        }
        Map<String, String> out = new HashMap<>(variables == null ? Map.of() : variables);
        try {
            var assessment = attempt.getRegistration().getAssessment();
            if (assessment != null && StringUtils.hasText(assessment.getName())) {
                out.put("assessment_name", assessment.getName());
            }
        } catch (Exception ignore) {
            // name stays blank; the built-in subject still reads sensibly
        }
        return out;
    }

    /** The same email with another subject and body (the "your result was updated" message). */
    public void sendAssessmentReportsToLearners(Map<StudentAttempt, byte[]> participantPdfReport, String assessmentId,
                                                String instituteId, String subject, String body) {
        List<AttachmentUsersDTO> usersList = new ArrayList<>();

        for (Map.Entry<StudentAttempt, byte[]> entry : participantPdfReport.entrySet()) {
            StudentAttempt studentAttempt = entry.getKey();
            byte[] reportData = entry.getValue();
            // API candidates (partner API) have no login and no email, and a blank address
            // reaches nobody: skip both rather than hand the mailer an empty channel.
            if (studentAttempt == null || !ApiCandidatePolicy.mayMessage(studentAttempt.getRegistration())) {
                continue;
            }

            AttachmentUsersDTO user = new AttachmentUsersDTO();
            user.setChannelId(studentAttempt.getRegistration().getUserEmail());
            user.setUserId(studentAttempt.getRegistration().getUserId());
            user.setPlaceholders(Map.of("learner_name", studentAttempt.getRegistration().getParticipantName()));
            // Convert byte[] to Base64 String and set on attachment
            String encodedAttachment = Base64.getEncoder().encodeToString(reportData);
            AttachmentUsersDTO.AttachmentDTO attachment = new AttachmentUsersDTO.AttachmentDTO();
            attachment.setAttachmentName("report.pdf");
            attachment.setAttachment(encodedAttachment);
            user.setAttachments(List.of(attachment));

            usersList.add(user);
        }

        if (usersList.isEmpty()) {
            return;
        }
        AttachmentNotificationDTO attachmentNotificationDTO = getAttachmentNotificationDTO(usersList, assessmentId);
        attachmentNotificationDTO.setSubject(subject);
        attachmentNotificationDTO.setBody(body);
        sendNotification(attachmentNotificationDTO, instituteId);
    }

    private AttachmentNotificationDTO getAttachmentNotificationDTO(List<AttachmentUsersDTO> usersList,
            String assessmentId) {
        AttachmentNotificationDTO attachmentNotificationDTO = AttachmentNotificationDTO.builder().build();
        attachmentNotificationDTO.setBody(AssessmentNotificationEmailBody.getAssessmentReportBody());
        attachmentNotificationDTO.setSubject("Assessment Report");
        attachmentNotificationDTO.setSource("ASSESSMENT_REPORT");
        attachmentNotificationDTO.setSourceId(assessmentId);
        attachmentNotificationDTO.setNotificationType("EMAIL");
        attachmentNotificationDTO.setUsers(usersList);
        return attachmentNotificationDTO;
    }

    private void sendNotification(AttachmentNotificationDTO notificationDTO, String instituteId) {
        try {
            notificationService.sendAttachmentEmailToUsers(notificationDTO, instituteId);
        } catch (Exception e) {
            SentryLogger.SentryEventBuilder.error(e)
                    .withMessage("Failed to send assessment report notification")
                    .withTag("notification.type", "EMAIL")
                    .withTag("email.type", "ASSESSMENT_REPORT")
                    .withTag("assessment.id",
                            notificationDTO.getSourceId() != null ? notificationDTO.getSourceId() : "unknown")
                    .withTag("user.count",
                            String.valueOf(notificationDTO.getUsers() != null ? notificationDTO.getUsers().size() : 0))
                    .withTag("operation", "sendAssessmentReportEmail")
                    .send();
            throw e;
        }
    }

    /**
     * Send multi-channel notifications (Push + System Alert) to learners after report release.
     * Email with PDF is handled by the existing sendAssessmentReportsToLearners method.
     */
    public void sendMultiChannelReportNotification(Map<StudentAttempt, byte[]> participantPdfReport,
                                                     String assessmentId, String assessmentName, String instituteId) {
        // 1. Send email with PDF (existing flow) — catch so it doesn't block other channels
        try {
            sendAssessmentReportsToLearners(participantPdfReport, assessmentId, instituteId);
        } catch (Exception e) {
            SentryLogger.SentryEventBuilder.error(e)
                    .withMessage("Failed to send email report, continuing with other channels")
                    .withTag("notification.type", "EMAIL")
                    .withTag("assessment.id", assessmentId)
                    .send();
        }

        // 2. Collect user IDs for push and system alert
        List<String> userIds = participantPdfReport.keySet().stream()
                .filter(attempt -> !ApiCandidatePolicy.isApi(attempt))
                .map(attempt -> attempt.getRegistration().getUserId())
                .filter(userId -> userId != null && !userId.isEmpty())
                .toList();

        if (userIds.isEmpty()) return;

        String pushTitle = "Assessment Report Ready";
        String pushBody = "Your report for \"" + assessmentName + "\" is now available. Tap to view.";

        // 3. Send push notification (FCM)
        try {
            Map<String, String> pushData = Map.of(
                    "type", "ASSESSMENT_REPORT",
                    "assessment_id", assessmentId,
                    "action", "VIEW_REPORT",
                    "path", "/assessment/reports"
            );
            notificationService.sendPushNotificationToUsers(instituteId, userIds, pushTitle, pushBody, pushData);
        } catch (Exception e) {
            SentryLogger.SentryEventBuilder.error(e)
                    .withMessage("Failed to send push notification for assessment report")
                    .withTag("notification.type", "PUSH")
                    .withTag("assessment.id", assessmentId)
                    .send();
        }

        // 4. Send system alert (SSE/in-app)
        try {
            notificationService.sendSystemAlertToUsers(instituteId, userIds, pushTitle, pushBody);
        } catch (Exception e) {
            SentryLogger.SentryEventBuilder.error(e)
                    .withMessage("Failed to send system alert for assessment report")
                    .withTag("notification.type", "SYSTEM_ALERT")
                    .withTag("assessment.id", assessmentId)
                    .send();
        }
    }
}
