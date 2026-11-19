package vacademy.io.notification_service.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.notification_service.dto.AdminAppLinkRequest;

import java.util.List;

/**
 * Sends the Vacademy Admin mobile-app download link to a phone number over
 * WhatsApp using the platform-default (Vidyayatan) WhatsApp Business account —
 * the same account used for pre-signup OTP — and emails an internal alert
 * recording who (name + email) from which institute requested it.
 */
// vendor-call-log: sends through MetaWhatsAppServiceProvider and EmailService, which record failures
@Service
@Slf4j
public class AdminAppLinkService {

    @Autowired
    private RestTemplate restTemplate;

    @Autowired
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${meta.whatsapp.api.base.url:https://graph.facebook.com/v22.0}")
    private String metaApiBaseUrl;

    // Platform-default (Vidyayatan) WhatsApp credentials, shared with WhatsAppOTPService.
    @Value("${whatsapp.access-token.vidyayatan:}")
    private String platformAccessToken;

    @Value("${whatsapp.phone-number-id.vidyayatan:}")
    private String platformPhoneNumberId;

    @Value("${adminapp.whatsapp.template-name:admin_app_download_link}")
    private String templateName;

    @Value("${adminapp.whatsapp.language-code:en}")
    private String languageCode;

    // Public URL for the template's IMAGE header. Must be set because the
    // approved template declares an image header; a blank value would be rejected
    // by Meta with a header format mismatch.
    @Value("${adminapp.whatsapp.header-image-url:https://vacademy-media-storage-public.s3.ap-south-1.amazonaws.com/ADMIN_PUBLIC_UPLOAD/a65685cc-3af2-45e3-9e80-60a88e0b69cb-wa_app.png}")
    private String headerImageUrl;

    @Value("${adminapp.link.android:https://play.google.com/store/apps/details?id=io.vacademy.admin.app&hl=en_IN}")
    private String androidLink;

    @Value("${adminapp.link.ios:https://apps.apple.com/in/app/vacademy-admin/id6785942499}")
    private String iosLink;

    @Value("${adminapp.notify.email:shreyash@vidyayatan.com}")
    private String notifyEmail;

    /**
     * Send the app link over WhatsApp and fire the internal notification email.
     * The WhatsApp send is the primary action; a failing internal email is
     * logged but never blocks the user's request.
     */
    public void requestAppLink(AdminAppLinkRequest request) {
        if (request == null || !StringUtils.hasText(request.getPhoneNumber())) {
            throw new VacademyException("Phone number is required");
        }
        if (!StringUtils.hasText(request.getPlatform())) {
            throw new VacademyException("Platform (ANDROID / IOS) is required");
        }
        if (!StringUtils.hasText(platformAccessToken) || !StringUtils.hasText(platformPhoneNumberId)) {
            throw new VacademyException("Platform-default WhatsApp credentials are not configured");
        }

        String platform = request.getPlatform().trim().toUpperCase();
        String link;
        String platformLabel;
        if ("IOS".equals(platform) || "APPLE".equals(platform)) {
            link = iosLink;
            platformLabel = "iOS";
        } else if ("ANDROID".equals(platform)) {
            link = androidLink;
            platformLabel = "Android";
        } else {
            throw new VacademyException("Unsupported platform: " + request.getPlatform());
        }

        String name = StringUtils.hasText(request.getRequesterName()) ? request.getRequesterName().trim() : "there";

        MetaWhatsAppServiceProvider provider = new MetaWhatsAppServiceProvider(
                objectMapper, restTemplate, metaApiBaseUrl);
        boolean sent = provider.sendTemplateMessage(
                platformPhoneNumberId, platformAccessToken, request.getPhoneNumber(),
                templateName, languageCode, List.of(name, link), headerImageUrl);

        if (!sent) {
            throw new VacademyException("Failed to send the app link over WhatsApp. Please try again.");
        }

        sendInternalNotification(request, platformLabel);
    }

    private void sendInternalNotification(AdminAppLinkRequest request, String platformLabel) {
        try {
            if (!StringUtils.hasText(notifyEmail)) {
                return;
            }
            String requesterName = StringUtils.hasText(request.getRequesterName())
                    ? request.getRequesterName() : "Unknown";
            String requesterEmail = StringUtils.hasText(request.getRequesterEmail())
                    ? request.getRequesterEmail() : "Unknown";
            String instituteName = StringUtils.hasText(request.getInstituteName())
                    ? request.getInstituteName() : "Unknown";
            String instituteId = StringUtils.hasText(request.getInstituteId())
                    ? request.getInstituteId() : "Unknown";

            String subject = "Admin app link requested — " + instituteName;
            String body = "A user requested the Vacademy Admin mobile app link.\n\n"
                    + "Requested by : " + requesterName + " (" + requesterEmail + ")\n"
                    + "Institute     : " + instituteName + " (" + instituteId + ")\n"
                    + "Platform      : " + platformLabel + "\n"
                    + "Sent to phone : " + request.getPhoneNumber() + "\n";

            emailService.sendEmail(notifyEmail, subject, body, null);
        } catch (Exception e) {
            // Never fail the user's request because the internal alert didn't go out.
            log.warn("Failed to send admin-app-request internal notification email: {}", e.getMessage());
        }
    }
}
