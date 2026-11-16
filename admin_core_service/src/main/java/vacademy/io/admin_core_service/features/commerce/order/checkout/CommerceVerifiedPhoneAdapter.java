package vacademy.io.admin_core_service.features.commerce.order.checkout;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.commerce.customer.CommercePhones;
import vacademy.io.admin_core_service.features.commerce.otp.CommerceOtpPurpose;
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

    /**
     * Reads the token, checks institute, purpose (CHECKOUT or COD) and phone, then spends it
     * ({@link CommerceOtpService#consumeToken}: one conditional UPDATE of the challenge row, in
     * the caller's transaction). Of two calls with one token only one gets true.
     */
    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public boolean spendForCod(String instituteId, String token, String phone) {
        if (instituteId == null || phone == null || token == null || token.isBlank() || token.length() > 2048) {
            return false;
        }
        String trimmed = token.trim();
        try {
            CommerceOtpService.VerifiedPhone read = otpService.readToken(trimmed);
            if (!instituteId.equals(read.instituteId())
                    || (read.purpose() != CommerceOtpPurpose.CHECKOUT && read.purpose() != CommerceOtpPurpose.COD)
                    || !phone.equals(CommercePhones.normalise(read.phone()))) {
                return false;
            }
            otpService.consumeToken(trimmed);
            return true;
        } catch (RuntimeException e) {
            log.debug("Verified-phone token not spent: {}", e.getMessage());
            return false;
        }
    }
}
