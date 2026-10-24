package vacademy.io.assessment_service.features.assessment.notification;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.notification.service.NotificationService;
import vacademy.io.assessment_service.features.open_evaluation.policy.ApiCandidatePolicy;
import vacademy.io.common.notification.dto.AttachmentNotificationDTO;
import vacademy.io.common.notification.dto.AttachmentUsersDTO;
import vacademy.io.common.logging.SentryLogger;

import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;

@Service
public class AssessmentReportNotificationService {

    @Autowired
    private NotificationService notificationService;

    public void sendAssessmentReportsToLearners(Map<StudentAttempt, byte[]> participantPdfReport, String assessmentId, String instituteId) {
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
