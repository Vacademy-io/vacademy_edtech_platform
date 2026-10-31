package vacademy.io.assessment_service.features.open_evaluation.error;

import org.springframework.http.HttpStatus;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.InsufficientCreditsException;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Map;

/** Partner-API errors built from the engine's own refusals (spec 8.3). */
public final class OpenApiErrors {

    private OpenApiErrors() {
    }

    /** 402 {@code insufficient_credits} with {@code {required, available, balance, credit_limit, committed}}. */
    public static OpenApiException insufficientCredits(InsufficientCreditsException e) {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("required", plain(e.getRequired()));
        details.put("available", plain(e.getAvailable()));
        details.put("balance", plain(e.getBalance()));
        details.put("credit_limit", plain(e.getCreditLimit()));
        details.put("committed", plain(e.getCommitted()));
        return new OpenApiException(HttpStatus.PAYMENT_REQUIRED, ApiErrorCode.INSUFFICIENT_CREDITS,
                "Not enough AI credits for this submission. Top up credits and retry.", details);
    }

    /** 503 {@code engine_unavailable} with {@code Retry-After}. */
    public static OpenApiException engineUnavailable(int retryAfterSeconds) {
        return new OpenApiException(HttpStatus.SERVICE_UNAVAILABLE, ApiErrorCode.ENGINE_UNAVAILABLE,
                "The evaluation engine could not be reached. Retry in " + retryAfterSeconds + " seconds.", null,
                Map.of("Retry-After", String.valueOf(retryAfterSeconds)));
    }

    /** A credit figure as a JSON number (no trailing zeros); 0 when unknown. */
    public static Number plain(BigDecimal value) {
        if (value == null) {
            return 0;
        }
        BigDecimal stripped = value.stripTrailingZeros();
        if (stripped.scale() <= 0) {
            try {
                return stripped.longValueExact();
            } catch (ArithmeticException tooBig) {
                return stripped;
            }
        }
        return stripped;
    }
}
