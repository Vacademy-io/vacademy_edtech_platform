package vacademy.io.admin_core_service.features.learner_quiz.answerkey;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * This endpoint's response has correct answers removed once grading runs on the server and
 * the switch for its surface is on. See {@link AnswerKeyResponseAdvice}.
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface WithoutAnswerKeys {
    AnswerKeySurface value();
}
