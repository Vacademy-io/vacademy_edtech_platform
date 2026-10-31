package vacademy.io.admin_core_service.features.ai_plans_billing.client;

import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.ai_plans_billing.AiPlansBillingException;

/**
 * ai_service answered an internal plans call with a non-2xx status, or could not be reached.
 *
 * <p>{@link #isRetryable()} is true for 5xx, 429 and transport failures: the webhook must then
 * fail (Razorpay retries) and the job must try again next run. A 4xx is a business refusal
 * (charge not found, amount mismatch, already subscribed) and is never retried blindly;
 * {@link #getCode()} carries ai_service's error code when it sent one, else {@code UPSTREAM_ERROR}.
 */
public class AiPlansUpstreamException extends AiPlansBillingException {

    private final int upstreamStatus;
    private final boolean retryable;

    public AiPlansUpstreamException(int upstreamStatus, String code, String message, boolean retryable) {
        super(mapStatus(upstreamStatus, retryable), code, message);
        this.upstreamStatus = upstreamStatus;
        this.retryable = retryable;
    }

    public int getUpstreamStatus() {
        return upstreamStatus;
    }

    public boolean isRetryable() {
        return retryable;
    }

    private static HttpStatus mapStatus(int upstream, boolean retryable) {
        if (retryable) {
            return HttpStatus.BAD_GATEWAY;
        }
        HttpStatus s = HttpStatus.resolve(upstream);
        return s != null && s.is4xxClientError() ? s : HttpStatus.BAD_GATEWAY;
    }
}
