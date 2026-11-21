package vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing;

import org.springframework.http.HttpStatus;
import vacademy.io.common.exceptions.VacademyException;

/**
 * Partner API traffic only: the credit service could not answer (401/403/5xx,
 * timeout), so the copy is refused rather than graded on an unknown balance
 * (spec 10.6.3: 503 {@code engine_unavailable}, {@code Retry-After: 30}). The
 * dashboard never sees this; it fails open.
 */
public class CreditCheckUnavailableException extends VacademyException {

        public static final String CODE = "engine_unavailable";
        public static final int RETRY_AFTER_SECONDS = 30;

        public CreditCheckUnavailableException(String detail) {
                super(HttpStatus.SERVICE_UNAVAILABLE,
                                "The credit service could not be reached to price this check; retry in "
                                                + RETRY_AFTER_SECONDS + " seconds."
                                                + (detail == null || detail.isBlank() ? "" : " (" + detail + ")"));
        }

        public String getCode() {
                return CODE;
        }

        public int getRetryAfterSeconds() {
                return RETRY_AFTER_SECONDS;
        }
}
