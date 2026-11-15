package vacademy.io.admin_core_service.features.commerce.order.checkout;

import org.springframework.http.HttpStatus;

import java.util.Map;

/**
 * A checkout refusal with a public code. The public controller turns it into the Catalogue
 * API error envelope; {@code details} may carry the new price of a cart that changed.
 */
public class CheckoutException extends RuntimeException {

    public static final String INVALID_REQUEST = "invalid_request";
    /** Same client_request_id, another body. */
    public static final String IDEMPOTENCY_KEY_REUSED = "idempotency_key_reused";
    /** The total the shopper saw is not the total now; {@code details.price} is the new one. */
    public static final String PRICE_CHANGED = "price_changed";
    /** A line cannot be bought as asked; {@code details.price} names it. */
    public static final String CART_CHANGED = "cart_changed";
    public static final String OUT_OF_STOCK = "out_of_stock";
    public static final String COUPON_NOT_AVAILABLE = "coupon_not_available";
    public static final String TOO_MANY_OPEN_ORDERS = "too_many_open_orders";
    public static final String PAYMENT_METHOD_NOT_AVAILABLE = "payment_method_not_available";
    public static final String NOT_PRICEABLE = "cart_not_priceable";
    public static final String NOT_CONFIGURED = "checkout_not_configured";
    public static final String ORDER_NOT_FOUND = "not_found";
    public static final String ORDER_NOT_PAYABLE = "order_not_payable";
    public static final String TOKEN_INVALID = "token_invalid";
    public static final String BUYER_UNAVAILABLE = "buyer_unavailable";
    /** A first order of a phone needs an e-mail address; {@code details.param} names the field. */
    public static final String EMAIL_REQUIRED = "email_required";
    public static final String BOT_CHECK_FAILED = "bot_check_failed";
    public static final String RATE_LIMITED = "rate_limited";
    public static final String PAYMENT_NOT_CONFIRMED = "payment_not_confirmed";
    /**
     * The shop (or cash on delivery) needs a phone proved by OTP; {@code details.reason} is
     * {@code mode} or {@code cod} and {@code details.param} names the field.
     */
    public static final String PHONE_VERIFICATION_REQUIRED = "phone_verification_required";
    /** A shopper session that is not (or no longer) valid. */
    public static final String SESSION_INVALID = "session_invalid";

    private final HttpStatus status;
    private final String code;
    private final transient Map<String, Object> details;

    public CheckoutException(HttpStatus status, String code, String message) {
        this(status, code, message, null);
    }

    public CheckoutException(HttpStatus status, String code, String message, Map<String, Object> details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }

    public HttpStatus getStatus() {
        return status;
    }

    public String getCode() {
        return code;
    }

    public Map<String, Object> getDetails() {
        return details;
    }

    public static CheckoutException invalid(String message) {
        return new CheckoutException(HttpStatus.BAD_REQUEST, INVALID_REQUEST, message);
    }
}
