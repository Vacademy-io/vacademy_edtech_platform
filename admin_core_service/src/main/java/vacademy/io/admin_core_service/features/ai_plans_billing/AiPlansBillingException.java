package vacademy.io.admin_core_service.features.ai_plans_billing;

import org.springframework.http.HttpStatus;
import vacademy.io.common.exceptions.VacademyException;

/**
 * A refusal or failure of the AI-plan billing facade with a machine-readable {@link #getCode()}
 * (STOREFRONT_OFF, PAYMENTS_DISABLED, BUYER_STATE_REQUIRED, RETURN_URL_NOT_ALLOWED, ...).
 *
 * <p>Extends {@link VacademyException} so anything that already handles that type still works;
 * the facade's own advice renders {@code {error_code, message}} with {@link #getStatus()}.
 */
public class AiPlansBillingException extends VacademyException {

    public static final String STOREFRONT_OFF = "STOREFRONT_OFF";
    public static final String PAYMENTS_DISABLED = "PAYMENTS_DISABLED";
    public static final String INVOICE_SERIES_V2_REQUIRED = "INVOICE_SERIES_V2_REQUIRED";
    public static final String BUYER_STATE_REQUIRED = "BUYER_STATE_REQUIRED";
    public static final String RETURN_URL_NOT_ALLOWED = "RETURN_URL_NOT_ALLOWED";
    public static final String NOT_FOUND = "NOT_FOUND";
    public static final String NO_SUBSCRIPTION = "NO_SUBSCRIPTION";
    public static final String AUTOPAY_UNAVAILABLE = "AUTOPAY_UNAVAILABLE";
    public static final String GATEWAY_ERROR = "GATEWAY_ERROR";
    public static final String UPSTREAM_ERROR = "UPSTREAM_ERROR";
    public static final String INVALID_REQUEST = "INVALID_REQUEST";
    public static final String AMOUNT_MISMATCH = "AMOUNT_MISMATCH";
    public static final String CONFLICT = "CONFLICT";

    private final String code;

    public AiPlansBillingException(HttpStatus status, String code, String message) {
        super(status, message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }

    public static AiPlansBillingException storefrontOff() {
        return new AiPlansBillingException(HttpStatus.NOT_FOUND, STOREFRONT_OFF, "The AI plan storefront is not available");
    }

    public static AiPlansBillingException notFound(String what) {
        return new AiPlansBillingException(HttpStatus.NOT_FOUND, NOT_FOUND, what + " not found");
    }

    public static AiPlansBillingException invalid(String message) {
        return new AiPlansBillingException(HttpStatus.BAD_REQUEST, INVALID_REQUEST, message);
    }
}
