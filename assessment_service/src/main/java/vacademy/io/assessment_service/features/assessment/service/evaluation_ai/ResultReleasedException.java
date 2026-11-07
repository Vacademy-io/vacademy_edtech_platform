package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import org.springframework.http.HttpStatus;
import vacademy.io.common.exceptions.VacademyException;

/**
 * An AI check was asked for an attempt whose result is already RELEASED (gate G8,
 * T0.33). The callback refuses to touch a released result, so such a run was billed
 * and then thrown away; it is now refused before anything is queued, on every
 * channel (spec 8.3: 409 {@code submission_finalized}).
 */
public class ResultReleasedException extends VacademyException {

        public static final String CODE = "submission_finalized";

        public ResultReleasedException(String message) {
                super(HttpStatus.CONFLICT, message);
        }

        public String getCode() {
                return CODE;
        }
}
