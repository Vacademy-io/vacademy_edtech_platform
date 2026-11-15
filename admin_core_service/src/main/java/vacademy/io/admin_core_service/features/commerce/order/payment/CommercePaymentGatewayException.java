package vacademy.io.admin_core_service.features.commerce.order.payment;

/**
 * No gateway order could be created. Nothing was charged; the commerce order is unchanged and
 * the call may be repeated. The message never carries a credential.
 */
public class CommercePaymentGatewayException extends RuntimeException {

    public static final String NOT_CONFIGURED = "GATEWAY_NOT_CONFIGURED";
    public static final String CURRENCY_NOT_SUPPORTED = "CURRENCY_NOT_SUPPORTED";
    public static final String INVALID_REQUEST = "GATEWAY_REQUEST_INVALID";
    public static final String UNAVAILABLE = "GATEWAY_UNAVAILABLE";

    private final String code;

    public CommercePaymentGatewayException(String code, String message) {
        super(message);
        this.code = code;
    }

    public CommercePaymentGatewayException(String code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }

    public String getCode() {
        return code;
    }

    /** True when trying again later can work; false when the set-up or the request is wrong. */
    public boolean isRetryable() {
        return UNAVAILABLE.equals(code);
    }
}
