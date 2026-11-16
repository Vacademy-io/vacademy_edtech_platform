package vacademy.io.admin_core_service.features.commerce.order.checkout;

/**
 * Reads the short-lived "verified phone" token a shopper gets after an OTP. It is not a login.
 * The Spring implementation ({@link CommerceVerifiedPhoneAdapter}) asks {@code CommerceOtpService}.
 */
public interface VerifiedPhones {

    /** The purposes of {@code CommerceOtpPurpose} this package reads tokens for. */
    String PURPOSE_TRACK_ORDER = "TRACK_ORDER";
    String PURPOSE_CHECKOUT = "CHECKOUT";
    String PURPOSE_ACCOUNT = "ACCOUNT";
    String PURPOSE_COD = "COD";

    /**
     * The phone a token proves, when the token was issued for this institute and this purpose,
     * in the spelling of
     * {@link vacademy.io.admin_core_service.features.commerce.customer.CommercePhones#normalise}.
     * Null when the token is missing, forged, expired, of another institute or of another
     * purpose.
     */
    String phoneOf(String instituteId, String token, String purpose);

    /**
     * Spends a token of this institute that proves {@code phone} for cash on delivery (purpose
     * {@code CHECKOUT} or {@code COD}), inside the caller's transaction: a rollback leaves it
     * unspent. True when this call spent it; false when the token is missing, forged, expired,
     * of another institute, purpose or phone, or already spent. An implementation that cannot
     * spend tokens answers false, so COD is never placed on a token that was only read.
     */
    default boolean spendForCod(String instituteId, String token, String phone) {
        return false;
    }
}
