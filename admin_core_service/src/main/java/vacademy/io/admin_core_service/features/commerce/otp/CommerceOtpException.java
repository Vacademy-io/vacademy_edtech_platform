package vacademy.io.admin_core_service.features.commerce.otp;

/**
 * A refusal of the OTP wrapper. {@code code} is stable and safe to show; the message never
 * says whether a phone number is known to the shop.
 */
public class CommerceOtpException extends RuntimeException {

    /** The phone, the code or the purpose is not usable. */
    public static final String INVALID_REQUEST = "OTP_INVALID_REQUEST";
    /** Too many codes asked for, or too many tries. {@code retryAfterSeconds} says when to come back. */
    public static final String RATE_LIMITED = "OTP_RATE_LIMITED";
    /** Wrong, used or expired code: one answer for all three. */
    public static final String INVALID_CODE = "OTP_INVALID";
    /** Too many wrong guesses for this code; a new code is needed. */
    public static final String LOCKED = "OTP_LOCKED";
    /** The code could not be sent or checked (no WhatsApp sender, service down). */
    public static final String UNAVAILABLE = "OTP_UNAVAILABLE";
    /** The verified-phone token is forged, expired, spent or for another purpose. */
    public static final String INVALID_TOKEN = "OTP_TOKEN_INVALID";

    private final String code;
    private final Integer retryAfterSeconds;

    public CommerceOtpException(String code, String message) {
        this(code, message, null);
    }

    public CommerceOtpException(String code, String message, Integer retryAfterSeconds) {
        super(message);
        this.code = code;
        this.retryAfterSeconds = retryAfterSeconds;
    }

    public String getCode() {
        return code;
    }

    public Integer getRetryAfterSeconds() {
        return retryAfterSeconds;
    }
}
