package vacademy.io.notification_service.features.email_otp.service;

import vacademy.io.common.core.internal_api_wrapper.ProductConfigClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.OriginInstituteResolver;
import vacademy.io.notification_service.features.email_otp.entity.EmailOtp;
import vacademy.io.notification_service.features.email_otp.repository.OtpRepository;
import vacademy.io.notification_service.service.EmailService;

import java.security.SecureRandom;
import java.util.Optional;

@Service
public class OTPService {

    private static final Logger log = LoggerFactory.getLogger(OTPService.class);

    @Autowired
    OtpRepository otpRepository;

    @Autowired
    EmailService emailService;

    @Autowired
    OriginInstituteResolver originInstituteResolver;

    @Autowired
    ProductConfigClient productConfigClient;

    /**
     * At most this many OTP emails to one address in {@link #OTP_WINDOW_MINUTES}. The public
     * send-email-otp endpoint needs no login, so without it anyone could flood an inbox through
     * our SES. Generous for a real user resending a code.
     */
    static final int MAX_OTP_EMAILS_PER_WINDOW = 5;
    static final int OTP_WINDOW_MINUTES = 10;

    /** Wrong entries allowed per code; after this the code no longer verifies. */
    public static final int MAX_WRONG_ATTEMPTS = 5;

    private static final SecureRandom RANDOM = new SecureRandom();

    public static String generateOTP(int length) {
        StringBuilder otp = new StringBuilder();
        for (int i = 0; i < length; i++) {
            otp.append(RANDOM.nextInt(10));
        }
        return otp.toString();
    }

    /**
     * Checks an entered code against a stored, unexpired OTP. Each check first takes one
     * attempt (atomically, so parallel checks cannot exceed the limit); a correct code gives
     * the attempt back and marks the OTP verified. Once {@link #MAX_WRONG_ATTEMPTS} wrong
     * entries are used up, the OTP stops verifying and a new one has to be requested.
     */
    public static boolean checkCode(OtpRepository otpRepository, EmailOtp storedOtp, String enteredCode) {
        if (otpRepository.takeVerifyAttempt(storedOtp.getId(), MAX_WRONG_ATTEMPTS) == 0) {
            log.warn("OTP {} has no attempts left", storedOtp.getId());
            return false;
        }
        if (storedOtp.getOtp() != null && storedOtp.getOtp().equals(enteredCode)) {
            otpRepository.markVerified(storedOtp.getId());
            return true;
        }
        return false;
    }

    public Boolean sendEmailOtp(String to, String subject, String service, String name, String instituteId) {
        return sendEmailOtp(to, subject, service, name, instituteId, null);
    }

    public Boolean sendEmailOtp(String to, String subject, String service, String name, String instituteId,
            String product) {
        // Signup and resend flows call /v1/send-email-otp straight from the browser and several
        // omitted the instituteId query param, which silently downgraded a white-labelled portal's
        // OTP to the platform sender and Vacademy branding. Recover it from the request host when
        // the caller gave us nothing. No-ops for the internal (server-to-server) controller, which
        // has no Origin and whose caller already resolved the institute.
        if (!StringUtils.hasText(instituteId)) {
            instituteId = originInstituteResolver.resolveInstituteId();
        }
        if (to != null && otpRepository.countRecentForEmail(to.trim(), OTP_WINDOW_MINUTES) >= MAX_OTP_EMAILS_PER_WINDOW) {
            log.warn("OTP email to {} not sent: {} already sent in the last {} minutes", to,
                    MAX_OTP_EMAILS_PER_WINDOW, OTP_WINDOW_MINUTES);
            return false;
        }
        EmailOtp otp = createNewOTP(to, service);
        try {
            OtpBrand brand = productConfigClient.get(product).map(OtpBrand::of).orElse(null);
            emailService.sendEmailOtp(to, subject, service, name, otp.getOtp(), instituteId, brand);
        } catch (Exception e) {
            return false;
        }
        return true;
    }

    public Boolean verifyEmailOtp(String otp, String email) {
        Optional<EmailOtp> otpOptional = otpRepository.findTopByEmailOrderByCreatedAtDesc(email);

        if (otpOptional.isPresent()) {
            EmailOtp emailOtp = otpOptional.get();

            // Check expiration (10 minutes = 600000 ms)
            long now = System.currentTimeMillis();
            long createdAt = emailOtp.getCreatedAt().getTime();
            long differenceMs = now - createdAt;
            long differenceMinutes = differenceMs / (60 * 1000);

            log.info(
                    "EMAIL OTP VERIFICATION - Email: {}, Now: {} ({}), CreatedAt: {} ({}), Difference: {}ms ({}min), JVM Timezone: {}",
                    email,
                    now,
                    new java.util.Date(now),
                    createdAt,
                    emailOtp.getCreatedAt(),
                    differenceMs,
                    differenceMinutes,
                    java.util.TimeZone.getDefault().getID());

            if (differenceMs > 10 * 60 * 1000) {
                log.warn("EMAIL OTP EXPIRED - Email: {}, Age: {}min, Threshold: 10min", email, differenceMinutes);
                throw new VacademyException("OTP has expired. Please request a new one.");
            }

            // Validate OTP
            if (checkCode(otpRepository, emailOtp, otp)) {
                log.info("EMAIL OTP VERIFIED SUCCESSFULLY - Email: {}", email);
                return true;
            } else {
                log.warn("EMAIL OTP MISMATCH - Email: {}", email);
            }
        } else {
            log.warn("EMAIL OTP NOT FOUND - Email: {}", email);
        }

        return false;
    }

    EmailOtp createNewOTP(String email, String service) {
        EmailOtp otp = EmailOtp.builder()
                .email(email)
                .service(service)
                .otp(generateOTP(6))
                .build();
        return otpRepository.save(otp);
    }

}
