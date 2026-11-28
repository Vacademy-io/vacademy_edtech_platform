package vacademy.io.admin_core_service.features.learner_invitation.notification;

import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.notification.dto.NotificationDTO;
import vacademy.io.admin_core_service.features.notification.dto.NotificationToUserDTO;
import vacademy.io.admin_core_service.features.notification_service.enums.CommunicationType;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.student_analysis.service.aggregation.ThemeColorResolver;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.notification.dto.GenericEmailRequest;

import java.util.HashMap;
import java.util.List;
import java.util.concurrent.CompletableFuture;

@Service
public class LearnerInvitationNotification {

    private static final String NEUTRAL_THEME_COLOR = "#333333";

    private final NotificationService notificationService;

    public LearnerInvitationNotification(NotificationService notificationService) {
        this.notificationService = notificationService;
    }

    /**
     * The shared learner portal (default.learner.portal.url). Institutes without a portal of their
     * own have their learners sign in there, so their links fall back to it rather than vanish.
     */
    @org.springframework.beans.factory.annotation.Value("${default.learner.portal.url:}")
    private String defaultLearnerPortalUrl;

    private String defaultPortalOrNull() {
        if (defaultLearnerPortalUrl == null || defaultLearnerPortalUrl.isBlank()) {
            return null;
        }
        String base = defaultLearnerPortalUrl.trim();
        while (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        return base;
    }

    /**
     * The institute's own learner-portal origin ({@code https://host}, no trailing slash), else
     * the shared learner portal its learners sign in to; null (no button) only when neither is set.
     */
    private String portalUrlOf(Institute institute) {
        if (institute == null || !StringUtils.hasText(institute.getLearnerPortalBaseUrl())) {
            return defaultPortalOrNull();
        }
        String base = institute.getLearnerPortalBaseUrl().trim();
        if (!base.startsWith("http://") && !base.startsWith("https://")) {
            base = "https://" + base;
        }
        while (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        return base;
    }

    /** The institute's theme colour as hex, neutral #333333 when it has none we can read. */
    private static String themeColorOf(Institute institute) {
        String color = institute == null ? null : ThemeColorResolver.resolve(institute.getInstituteThemeCode());
        return color != null ? color : NEUTRAL_THEME_COLOR;
    }

    public void sendLearnerInvitationNotification(List<String> emails, Institute institute, String invitationCode) {
        String instituteName = institute.getInstituteName();
        String instituteId = institute.getId();
        String portalUrl = portalUrlOf(institute);
        String themeColor = themeColorOf(institute);
        CompletableFuture.runAsync(() -> {
            try {
                NotificationDTO notificationDTO = new NotificationDTO();
                notificationDTO.setNotificationType(CommunicationType.EMAIL.name());
                notificationDTO.setSubject("Invitation to join " + instituteName);
                notificationDTO.setSource("LEARNER_INVITATION");
                notificationDTO.setSourceId(invitationCode);
                notificationDTO.setBody(LearnerInvitationEmailBody.getLearnerInvitationEmailBody(instituteName, instituteId, invitationCode, portalUrl, themeColor));

                List<NotificationToUserDTO> users = emails.stream().map(email -> {
                    NotificationToUserDTO notificationToUserDTO = new NotificationToUserDTO();
                    notificationToUserDTO.setUserId(email);
                    notificationToUserDTO.setChannelId(email);
                    notificationToUserDTO.setPlaceholders(new HashMap<>());
                    return notificationToUserDTO;
                }).toList();

                notificationDTO.setUsers(users);
                notificationService.sendEmailViaUnified(notificationDTO,instituteId);
            } catch (Exception e) {
                System.err.println("Error sending invitation emails: " + e.getMessage());
            }
        });
    }

    @Async
    public void sendLearnerInvitationResponseNotification(String email, Institute institute, String responseId) {
        String instituteName = institute.getInstituteName();
        String instituteId = institute.getId();
        String portalUrl = portalUrlOf(institute);
        String themeColor = themeColorOf(institute);
        CompletableFuture.runAsync(() -> {
            try {
                GenericEmailRequest genericEmailRequest = new GenericEmailRequest();
                genericEmailRequest.setSubject("Response recorded for " + instituteName);
                genericEmailRequest.setTo(email);
                genericEmailRequest.setBody(LearnerInvitationEmailBody.getLearnerStatusUpdateEmailBody(instituteName, portalUrl, themeColor));
                notificationService.sendGenericHtmlMailViaUnified(genericEmailRequest, instituteId);
            } catch (Exception e) {
                System.err.println("Error sending invitation response email: " + e.getMessage());
            }
        });
    }

    public void sendStatusUpdateNotification(List<String> emails, Institute institute) {
        String instituteName = institute.getInstituteName();
        String instituteId = institute.getId();
        String portalUrl = portalUrlOf(institute);
        String themeColor = themeColorOf(institute);
        CompletableFuture.runAsync(() -> {
            try {
                NotificationDTO notificationDTO = new NotificationDTO();
                notificationDTO.setNotificationType(CommunicationType.EMAIL.name());
                notificationDTO.setSubject("Status updated for your request to " + instituteName);
                notificationDTO.setSource("LEARNER_INVITATION");
                notificationDTO.setSourceId(instituteId);
                notificationDTO.setBody(LearnerInvitationEmailBody.getLearnerStatusUpdateByInstituteEmailBody(instituteName, portalUrl, themeColor));

                List<NotificationToUserDTO> users = emails.stream().map(email -> {
                    NotificationToUserDTO notificationToUserDTO = new NotificationToUserDTO();
                    notificationToUserDTO.setUserId(email);
                    notificationToUserDTO.setChannelId(email);
                    notificationToUserDTO.setPlaceholders(new HashMap<>());
                    return notificationToUserDTO;
                }).toList();

                notificationDTO.setUsers(users);
                notificationService.sendEmailViaUnified(notificationDTO,instituteId);
            } catch (Exception e) {
                System.err.println("Error sending invitation emails: " + e.getMessage());
            }
        });
    }
}
