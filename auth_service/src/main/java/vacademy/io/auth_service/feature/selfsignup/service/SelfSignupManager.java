package vacademy.io.auth_service.feature.selfsignup.service;

import io.jsonwebtoken.Claims;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.auth_service.feature.auth.dto.JwtResponseDto;
import vacademy.io.auth_service.feature.auth.dto.RegisterRequest;
import vacademy.io.auth_service.feature.auth.manager.AuthManager;
import vacademy.io.common.notification.dto.EmailOTPRequest;
import vacademy.io.auth_service.feature.notification.service.NotificationService;
import vacademy.io.auth_service.feature.selfsignup.dto.SelfSignupConfigResponse;
import vacademy.io.auth_service.feature.selfsignup.dto.SelfSignupOtpRequest;
import vacademy.io.auth_service.feature.selfsignup.dto.SelfSignupRequest;
import vacademy.io.auth_service.feature.selfsignup.dto.SelfSignupVerifyResponse;
import vacademy.io.auth_service.feature.util.UsernameGenerator;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.core.internal_api_wrapper.ProductConfigClient;
import vacademy.io.common.institute.dto.InstituteInfoDTO;
import vacademy.io.common.product.ProductConfigDTO;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * A visitor creates their own workspace and starts a trial: email proven by an OTP or by Google,
 * then the same institute and root admin that a signup or demo provisioning creates.
 *
 * <p>The trial is not written to {@code institute_trial}: that table stops login when it lapses,
 * and these users must still reach their reports and upgrade. Its end date lives in
 * {@code institutes.demo_expires_at}, which the AI credit gate in ai_service reads.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SelfSignupManager {

    private static final String LEAD_TAG_TRIAL = "FREE_TRIAL";
    /** The assessment module: everything Evalezy runs on. */
    private static final String ASSESS_MODULE_ID = "1";
    private static final int MIN_PASSWORD_LENGTH = 8;
    private static final Pattern EMAIL = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]{2,}$");
    private static final Pattern USERNAME = Pattern.compile("^[A-Za-z0-9._-]{4,40}$");
    private static final int MIN_PHONE_DIGITS = 10;
    private static final int MAX_PHONE_DIGITS = 15;
    private static final Set<String> INSTITUTE_TYPES =
            Set.of("school", "coaching", "college", "university", "company", "other");

    private final NotificationService notificationService;
    private final UserRepository userRepository;
    private final AuthManager authManager;
    private final SelfSignupTokenService tokenService;
    private final SelfSignupAlertClient alertClient;
    private final SelfSignupRateLimiter rateLimiter;
    private final ProductConfigClient productConfigClient;

    public String requestOtp(SelfSignupOtpRequest request, String ip) {
        ProductConfigDTO product = requireProduct(request.getProduct());
        String email = requireEmail(request.getEmail());
        rateLimiter.checkOtp(email, ip);
        assertEmailIsFree(email);
        notificationService.sendOtp(EmailOTPRequest.builder()
                .to(email)
                .service("auth-service")
                .subject("Your " + product.getDisplayName() + " verification code")
                .name("there")
                .product(product.getProductKey())
                .build(), "");
        return "OTP sent to " + email;
    }

    public SelfSignupVerifyResponse verifyOtp(SelfSignupOtpRequest request) {
        requireProduct(request.getProduct());
        String email = requireEmail(request.getEmail());
        if (!StringUtils.hasText(request.getOtp())) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Enter the code from your email");
        }
        rateLimiter.checkVerify(email);
        Boolean valid = notificationService.verifyOTP(
                EmailOTPRequest.builder().to(email).otp(request.getOtp().trim()).build());
        if (!Boolean.TRUE.equals(valid)) {
            throw new VacademyException(HttpStatus.UNAUTHORIZED, "That code is wrong or has expired");
        }
        assertEmailIsFree(email);
        return SelfSignupVerifyResponse.builder()
                .signupToken(tokenService.issue(email, SelfSignupTokenService.METHOD_EMAIL_OTP, null, null, null))
                .email(email)
                .expiresAt(System.currentTimeMillis() + tokenService.ttlMillis())
                .build();
    }

    /** What the sign-up screen shows. Public, so nothing about the sender is in it. */
    public SelfSignupConfigResponse config(String product) {
        ProductConfigDTO config = requireProduct(product);
        return SelfSignupConfigResponse.builder()
                .product(config.getProductKey())
                .displayName(config.getDisplayName())
                .trialDays(config.getTrialDays())
                .logoUrl(config.getLogoUrl())
                .appPath(config.getAppPath())
                .build();
    }

    public JwtResponseDto signup(SelfSignupRequest request, String ip) {
        ProductConfigDTO product = requireProduct(request.getProduct());
        Claims proof = tokenService.verify(request.getSignupToken());
        String email = proof.get("email", String.class);
        String method = proof.get("method", String.class);
        boolean google = SelfSignupTokenService.METHOD_GOOGLE.equals(method);

        String fullName = StringUtils.hasText(request.getFullName())
                ? request.getFullName().trim() : proof.get("name", String.class);
        if (!StringUtils.hasText(fullName)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Your name is required");
        }
        String phone = requirePhone(request.getPhone());
        String instituteName = StringUtils.hasText(request.getInstituteName())
                ? request.getInstituteName().trim() : fullName;
        String type = request.getInstituteType() == null
                ? "" : request.getInstituteType().trim().toLowerCase(Locale.ROOT);
        if (!INSTITUTE_TYPES.contains(type)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Pick what kind of institute this is");
        }
        if (request.getTeachers() != null && request.getTeachers() < 1) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Number of teachers must be at least 1");
        }

        String username;
        String password;
        if (google) {
            username = UsernameGenerator.generateUsername(fullName);
            password = UsernameGenerator.generatePassword(16);
        } else {
            username = requireUsername(request.getUsername());
            password = requirePassword(request.getPassword());
        }

        // Before anything is created: both of these would otherwise leave an orphaned institute.
        assertEmailIsFree(email);
        if (userRepository.findByUsername(username).isPresent()) {
            throw new VacademyException(HttpStatus.CONFLICT, "That username is taken. Pick another.");
        }
        rateLimiter.checkSignup(ip);

        Timestamp trialEnds = Timestamp.from(
                Instant.now().plus(product.getTrialDays(), ChronoUnit.DAYS));

        InstituteInfoDTO institute = new InstituteInfoDTO();
        institute.setInstituteName(instituteName);
        institute.setEmail(email);
        institute.setPhone(phone);
        institute.setType(type);
        institute.setCity(emptyToNull(request.getCity()));
        institute.setState(emptyToNull(request.getState()));
        institute.setStaffStrength(request.getTeachers());
        institute.setModuleRequestIds(List.of(ASSESS_MODULE_ID));
        institute.setProduct(product.getProductKey());
        institute.setLeadTag(LEAD_TAG_TRIAL);
        institute.setDemoExpiresAt(trialEnds);

        RegisterRequest register = new RegisterRequest();
        register.setFullName(fullName);
        register.setUserName(username);
        register.setEmail(email);
        register.setMobileNumber(phone);
        register.setPassword(password);
        register.setInstitute(institute);
        register.setSubjectId(emptyToNull(proof.get("subject_id", String.class)));
        register.setVendorId(emptyToNull(proof.get("vendor_id", String.class)));

        JwtResponseDto tokens = authManager.registerRootUser(register, product);

        log.info("[self-signup] signup_completed product={} method={} institute={} trial_ends={} plan={} source={} campaign={}",
                product.getProductKey(), method, institute.getId(), trialEnds, request.getPlan(), request.getSource(), request.getCampaign());
        alertClient.signupCompleted(product.getProductKey(), signupEvent(institute.getId(), instituteName, fullName,
                email, phone, google, trialEnds, request.getSource()));
        return tokens;
    }

    private static java.util.Map<String, Object> signupEvent(String instituteId, String instituteName, String fullName,
            String email, String phone, boolean google, Timestamp trialEnds, String source) {
        java.util.Map<String, Object> event = new java.util.HashMap<>();
        event.put("institute_id", instituteId);
        event.put("institute_name", instituteName);
        event.put("full_name", fullName);
        event.put("email", email);
        event.put("phone", phone);
        event.put("method", google ? "Google" : "Email OTP");
        event.put("trial_ends", java.time.format.DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH)
                .format(trialEnds.toInstant().atZone(java.time.ZoneOffset.UTC)));
        event.put("source", source);
        return event;
    }

    private ProductConfigDTO requireProduct(String product) {
        return productConfigClient.get(product).filter(ProductConfigDTO::isSignupOpen)
                .orElseThrow(() -> new VacademyException(HttpStatus.BAD_REQUEST,
                        "Sign-up is not available for this product"));
    }

    private String requireEmail(String email) {
        String value = email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
        if (!EMAIL.matcher(value).matches()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Enter a valid email address");
        }
        return value;
    }

    /** Digits with the country code, the way user phone numbers are stored. */
    private String requirePhone(String phone) {
        String digits = phone == null ? "" : phone.replaceAll("[^0-9]", "");
        if (digits.length() < MIN_PHONE_DIGITS || digits.length() > MAX_PHONE_DIGITS) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Enter a valid phone number");
        }
        return digits;
    }

    private String requireUsername(String username) {
        String value = username == null ? "" : username.trim();
        if (!USERNAME.matcher(value).matches()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "Username needs 4 to 40 letters, numbers, dots, dashes or underscores");
        }
        return value;
    }

    private String requirePassword(String password) {
        if (password == null || password.length() < MIN_PASSWORD_LENGTH) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Password needs at least 8 characters");
        }
        return password;
    }

    private void assertEmailIsFree(String email) {
        if (userRepository.findFirstByEmailOrderByCreatedAtDesc(email).isPresent()) {
            throw new VacademyException(HttpStatus.CONFLICT,
                    "An account already exists for " + email + ". Please log in instead.");
        }
    }

    private static String emptyToNull(String value) {
        return StringUtils.hasText(value) ? value.trim() : null;
    }
}
