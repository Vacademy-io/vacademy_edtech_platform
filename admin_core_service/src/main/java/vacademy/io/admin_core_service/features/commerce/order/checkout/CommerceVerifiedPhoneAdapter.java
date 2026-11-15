package vacademy.io.admin_core_service.features.commerce.order.checkout;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.commerce.customer.CommercePhones;
import vacademy.io.admin_core_service.features.commerce.otp.CommerceOtpService;

/** {@link VerifiedPhones} on top of the OTP package's token check. */
@Slf4j
@Component
@RequiredArgsConstructor
public class CommerceVerifiedPhoneAdapter implements VerifiedPhones {

    private final CommerceOtpService otpService;

    @Override
    public String phoneOf(String instituteId, String token, String purpose) {
        if (instituteId == null || token == null || token.isBlank() || token.length() > 2048) {
            return null;
        }
        try {
            return CommercePhones.normalise(otpService.verifyToken(instituteId, token.trim(), purpose));
        } catch (RuntimeException e) {
            // An invalid token is an everyday event; the reason is not echoed to the caller.
            log.debug("Verified-phone token refused: {}", e.getMessage());
            return null;
        }
    }
}
