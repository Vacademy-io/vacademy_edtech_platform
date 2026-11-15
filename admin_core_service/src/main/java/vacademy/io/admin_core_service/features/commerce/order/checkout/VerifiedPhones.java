package vacademy.io.admin_core_service.features.commerce.order.checkout;

/**
 * Reads the short-lived "verified phone" token a shopper gets after an OTP. It is not a login.
 * The Spring implementation ({@link CommerceVerifiedPhoneAdapter}) asks {@code CommerceOtpService}.
 */
public interface VerifiedPhones {

    /** The purposes of {@code CommerceOtpPurpose} this package reads tokens for. */
    String PURPOSE_TRACK_ORDER = "TRACK_ORDER";
    String PURPOSE_CHECKOUT = "CHECKOUT";

    /**
     * The phone a token proves, when the token was issued for this institute and this purpose,
     * in the spelling of
     * {@link vacademy.io.admin_core_service.features.commerce.customer.CommercePhones#normalise}.
     * Null when the token is missing, forged, expired, of another institute or of another
     * purpose.
     */
    String phoneOf(String instituteId, String token, String purpose);
}
