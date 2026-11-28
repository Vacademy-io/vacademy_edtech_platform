package vacademy.io.assessment_service.features.assessment.service.marking_strategy;

import java.math.BigDecimal;
import java.util.List;

/**
 * Whether a learner's numeric answer matches a NUMERIC question's answer key.
 *
 * <p>A question may carry an optional absolute tolerance next to its answers
 * ({@code data.tolerance} in the auto evaluation JSON): accounting papers accept an
 * answer within a rounding margin, e.g. ±1. Without a tolerance (absent, 0, negative or
 * not a finite number) the rule is the exact match it has always been.
 *
 * <p>The distance is measured on the decimal values as written, not on doubles, so a
 * margin that is exactly the tolerance counts: 1.1 against 0.1 with ±1 is correct, where
 * {@code 1.1 - 0.1} in double arithmetic is 1.0000000000000002.
 */
public final class NumericAnswerMatcher {

    private NumericAnswerMatcher() {
    }

    /**
     * @param validAnswers the key; null throws exactly as the old {@code validAnswers.contains}
     *                     did, so a caller that treated that as "no marks" still does
     */
    public static boolean matches(List<Double> validAnswers, Double attempted, Double tolerance) {
        Double margin = normaliseTolerance(tolerance);
        if (margin == null) {
            // Exactly the pre-tolerance rule.
            return validAnswers.contains(attempted);
        }
        if (attempted == null || !Double.isFinite(attempted)) {
            return false;
        }
        BigDecimal given = BigDecimal.valueOf(attempted);
        BigDecimal allowed = BigDecimal.valueOf(margin);
        for (Double answer : validAnswers) {
            if (answer == null || !Double.isFinite(answer)) {
                continue;
            }
            if (BigDecimal.valueOf(answer).subtract(given).abs().compareTo(allowed) <= 0) {
                return true;
            }
        }
        return false;
    }

    /** The tolerance worth storing or applying: a finite number above 0, else null. */
    public static Double normaliseTolerance(Double tolerance) {
        if (tolerance == null || !Double.isFinite(tolerance) || tolerance <= 0) {
            return null;
        }
        return tolerance;
    }
}
