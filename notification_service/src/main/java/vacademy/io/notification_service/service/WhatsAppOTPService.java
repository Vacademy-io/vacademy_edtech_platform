package vacademy.io.notification_service.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.logging.SentryLogger;
import vacademy.io.notification_service.dto.WhatsAppOTPRequest;
import vacademy.io.notification_service.dto.WhatsAppOTPResponse;
import vacademy.io.notification_service.features.email_otp.entity.EmailOtp;
import vacademy.io.notification_service.features.email_otp.repository.OtpRepository;
import vacademy.io.notification_service.institute.InstituteInternalService;
import vacademy.io.notification_service.institute.InstituteInfoDTO;
import vacademy.io.notification_service.constants.NotificationConstants;

import java.util.Optional;
import java.util.concurrent.ThreadLocalRandom;

// vendor-call-log: sends through Meta/WATI WhatsAppServiceProviders, which record failures
@Service
@Slf4j
public class WhatsAppOTPService {

    @Autowired
    private OtpRepository otpRepository;

    @Autowired
    private InstituteInternalService instituteInternalService;

    @Autowired
    private WhatsAppProviderFactory whatsAppProviderFactory;

    @Autowired
    private RestTemplate restTemplate;

    @Value("${meta.whatsapp.api.base.url:https://graph.facebook.com/v22.0}")
    private String metaApiBaseUrl;

    // Platform-default WhatsApp credentials, used for system flows that have no
    // institute scope yet (e.g. Vimotion onboarding before signup).
    @Value("${whatsapp.access-token.vidyayatan:}")
    private String platformAccessToken;

    @Value("${whatsapp.phone-number-id.vidyayatan:}")
    private String platformPhoneNumberId;

    @Value("${whatsapp.platform-default.template-name:otp_ll}")
    private String platformTemplateName;

    @Value("${whatsapp.platform-default.language-code:en}")
    private String platformLanguageCode;

    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * Send WhatsApp OTP to the given phone number.
     * Uses the Factory to resolve provider and credentials automatically.
     */
    public WhatsAppOTPResponse sendWhatsAppOtp(WhatsAppOTPRequest request) {
        try {
            log.info("Sending WhatsApp OTP to phone: {}, institute: {}",
                    maskPhoneNumber(request.getPhoneNumber()), request.getInstituteId());

            // Generate 6-digit OTP
            String otp = generateOTP(6);

            // Store OTP in database
            EmailOtp emailOtp = EmailOtp.builder()
                    .phoneNumber(request.getPhoneNumber())
                    .otp(otp)
                    .service(NotificationConstants.OTP_SERVICE_WHATSAPP_AUTH)
                    .type(NotificationConstants.OTP_TYPE_WHATSAPP)
                    .build();
            otpRepository.save(emailOtp);
            log.info("OTP stored in database for phone: {}", maskPhoneNumber(request.getPhoneNumber()));

            // Fetch Institute Settings
            InstituteInfoDTO institute = instituteInternalService.getInstituteByInstituteId(request.getInstituteId());
            String jsonString = institute.getSetting();
            JsonNode root = objectMapper.readTree(jsonString);

            // Use Factory to resolve provider AND credentials together
            // This eliminates instanceof checks and credential guessing
            WhatsAppProviderContext context = whatsAppProviderFactory.resolve(root);

            log.info("Using WhatsApp provider: {} for institute: {}",
                    context.getProviderType(), request.getInstituteId());

            // Call provider with normalized credentials
            return context.getProvider().sendOtp(request, otp, context.getCredentials());

        } catch (Exception e) {
            log.error("Exception while sending WhatsApp OTP: {}", e.getMessage(), e);
            SentryLogger.SentryEventBuilder.error(e)
                    .withMessage("Failed to send WhatsApp OTP")
                    .withTag("notification.type", "WHATSAPP_OTP")
                    .withTag("phone.number", maskPhoneNumber(request.getPhoneNumber()))
                    .withTag("institute.id", request.getInstituteId())
                    .send();
            throw new VacademyException("Failed to send WhatsApp OTP: " + e.getMessage());
        }
    }

    /**
     * Send a WhatsApp OTP using the platform-default Meta credentials, with no
     * institute scope. Intended for pre-signup flows (e.g. Vimotion onboarding).
     * Reuses MetaWhatsAppServiceProvider so retries/template handling stay consistent.
     */
    public WhatsAppOTPResponse sendPlatformDefaultOtp(String phoneNumber) {
        if (phoneNumber == null || phoneNumber.isBlank()) {
            throw new VacademyException("Phone number is required");
        }
        if (platformAccessToken == null || platformAccessToken.isBlank()
                || platformPhoneNumberId == null || platformPhoneNumberId.isBlank()) {
            throw new VacademyException(
                    "Platform-default WhatsApp credentials are not configured");
        }
        if (platformTemplateName == null || platformTemplateName.isBlank()) {
            throw new VacademyException(
                    "Platform-default WhatsApp template name is not configured");
        }

        String otp = generateOTP(6);

        EmailOtp emailOtp = EmailOtp.builder()
                .phoneNumber(phoneNumber)
                .otp(otp)
                .service(NotificationConstants.OTP_SERVICE_WHATSAPP_AUTH)
                .type(NotificationConstants.OTP_TYPE_WHATSAPP)
                .build();
        otpRepository.save(emailOtp);

        ObjectNode credentials = objectMapper.createObjectNode()
                .put("accessToken", platformAccessToken)
                .put("phoneNumberId", platformPhoneNumberId);

        WhatsAppOTPRequest request = WhatsAppOTPRequest.builder()
                .phoneNumber(phoneNumber)
                .templateName(platformTemplateName)
                .languageCode(platformLanguageCode)
                .build();

        MetaWhatsAppServiceProvider provider = new MetaWhatsAppServiceProvider(
                objectMapper, restTemplate, metaApiBaseUrl);
        return provider.sendOtp(request, otp, credentials);
    }

    /**
     * Verify WhatsApp OTP
     */
    public Boolean verifyWhatsAppOtp(String phoneNumber, String otp) {
        try {
            log.info("Verifying WhatsApp OTP for phone: {}", maskPhoneNumber(phoneNumber));

            Optional<EmailOtp> otpOptional = otpRepository.findTopByPhoneNumberAndTypeOrderByCreatedAtDesc(phoneNumber,
                    NotificationConstants.OTP_TYPE_WHATSAPP);

            if (otpOptional.isEmpty()) {
                log.warn("No OTP found for phone: {}", maskPhoneNumber(phoneNumber));
                return false;
            }

            EmailOtp emailOtp = otpOptional.get();

            // Check expiration (10 minutes = 600000 ms)
            long now = System.currentTimeMillis();
            long createdAt = emailOtp.getCreatedAt().getTime();
            long differenceMs = now - createdAt;
            long differenceMinutes = differenceMs / (60 * 1000);

            log.info("OTP verification - Phone: {}, Age: {}min, Threshold: 10min",
                    maskPhoneNumber(phoneNumber), differenceMinutes);

            if (differenceMs > 10 * 60 * 1000) {
                log.warn("OTP expired for phone: {}, Age: {}min", maskPhoneNumber(phoneNumber), differenceMinutes);
                throw new VacademyException("OTP has expired. Please request a new one.");
            }

            // Validate OTP
            if (emailOtp.getOtp().equals(otp)) {
                log.info("OTP verified successfully for phone: {}", maskPhoneNumber(phoneNumber));
                emailOtp.setIsVerified("true");
                otpRepository.save(emailOtp);
                return true;
            }

            log.warn("OTP mismatch for phone: {}", maskPhoneNumber(phoneNumber));
            return false;

        } catch (VacademyException e) {
            throw e;
        } catch (Exception e) {
            log.error("Exception while verifying WhatsApp OTP: {}", e.getMessage(), e);
            throw new VacademyException("Failed to verify WhatsApp OTP: " + e.getMessage());
        }
    }

    /**
     * Generate random OTP
     */
    private String generateOTP(int length) {
        ThreadLocalRandom random = ThreadLocalRandom.current();
        StringBuilder otp = new StringBuilder();
        for (int i = 0; i < length; i++) {
            otp.append(random.nextInt(10));
        }
        return otp.toString();
    }

    /**
     * Mask phone number for logging (security)
     */
    private String maskPhoneNumber(String phoneNumber) {
        if (phoneNumber == null || phoneNumber.length() < 6) {
            return "****";
        }
        return phoneNumber.substring(0, 3) + "****" + phoneNumber.substring(phoneNumber.length() - 3);
    }
}
