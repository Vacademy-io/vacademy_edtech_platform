package vacademy.io.assessment_service.features.submission_review.model;

import java.util.Locale;
import java.util.Set;

/** Which question types the answer key marks and which a person (or the AI) marks. */
public final class QuestionKinds {
    public static final Set<String> OBJECTIVE = Set.of("MCQS", "MCQM", "TRUE_FALSE", "NUMERIC", "ONE_WORD", "CODING");
    public static final String LONG_ANSWER = "LONG_ANSWER";
    public static final String CBE_RESPONSE = "CBE_RESPONSE";

    private QuestionKinds() {
    }

    public static boolean isObjective(String type) {
        return type != null && OBJECTIVE.contains(type.toUpperCase(Locale.ROOT));
    }

    public static boolean isLongAnswer(String type) {
        return LONG_ANSWER.equalsIgnoreCase(type);
    }

    public static boolean isCbe(String type) {
        return CBE_RESPONSE.equalsIgnoreCase(type);
    }
}
