package vacademy.io.admin_core_service.features.ai_plans_billing.gateway;

import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.ai_plans_billing.AiPlansBillingException;

/** A Razorpay API call on the platform account failed; {@link #getRazorpayCode()} is Razorpay's error.code. */
public class RazorpayGatewayException extends AiPlansBillingException {

    private final int httpStatus;
    private final String razorpayCode;

    public RazorpayGatewayException(int httpStatus, String razorpayCode, String message) {
        super(HttpStatus.BAD_GATEWAY, GATEWAY_ERROR, message);
        this.httpStatus = httpStatus;
        this.razorpayCode = razorpayCode;
    }

    public int getHttpStatus() {
        return httpStatus;
    }

    public String getRazorpayCode() {
        return razorpayCode;
    }
}
