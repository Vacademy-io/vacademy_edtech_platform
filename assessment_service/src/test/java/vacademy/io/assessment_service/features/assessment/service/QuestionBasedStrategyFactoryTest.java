package vacademy.io.assessment_service.features.assessment.service;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.dto.QuestionWiseBasicDetailDto;
import vacademy.io.assessment_service.features.assessment.enums.QuestionResponseEnum;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The factory hands out marking strategies, and grading runs on an @Async pool with many
 * learners in flight at once.
 *
 * It used to hold ONE shared instance per question type in a static map.
 * {@link IQuestionTypeBasedStrategy} keeps `type` and `answerStatus` as mutable instance
 * fields, and {@code calculateMarks} reads {@code getAnswerStatus()} AFTER the marks call
 * returns -- so between those two statements another thread could overwrite the status.
 * The result was learner A's question being persisted with learner B's CORRECT/INCORRECT
 * status in question_wise_marks: silent, non-deterministic, and corrupting to every
 * report and status-based revaluation downstream.
 *
 * The fix hands out a fresh instance per call. These tests pin both halves of that:
 * the arithmetic is unchanged, and concurrent grading no longer crosses answers.
 */
class QuestionBasedStrategyFactoryTest {

    private static final String MCQS_MARKING =
            "{\"type\":\"MCQS\",\"data\":{\"totalMark\":4,\"negativeMark\":1,\"negativeMarkingPercentage\":100}}";

    private static final String MCQS_CORRECT_A =
            "{\"type\":\"MCQS\",\"data\":{\"correctOptionIds\":[\"a\"]}}";

    private static String mcqsResponse(String optionId) {
        return "{\"responseData\":{\"type\":\"MCQS\",\"optionIds\":[\"" + optionId + "\"]}}";
    }

    @Test
    void gradesACorrectAnswer() {
        QuestionWiseBasicDetailDto result =
                QuestionBasedStrategyFactory.calculateMarks(
                        MCQS_MARKING, MCQS_CORRECT_A, mcqsResponse("a"), "MCQS");

        assertThat(result.getMarks()).isEqualTo(4.0);
        assertThat(result.getAnswerStatus()).isEqualTo(QuestionResponseEnum.CORRECT.name());
    }

    @Test
    void gradesAnIncorrectAnswer() {
        QuestionWiseBasicDetailDto result =
                QuestionBasedStrategyFactory.calculateMarks(
                        MCQS_MARKING, MCQS_CORRECT_A, mcqsResponse("b"), "MCQS");

        assertThat(result.getMarks()).isEqualTo(-1.0);
        assertThat(result.getAnswerStatus()).isEqualTo(QuestionResponseEnum.INCORRECT.name());
    }

    @Test
    void eachCallGetsItsOwnStrategyInstance() throws Exception {
        // The structural guarantee behind the concurrency fix: if two lookups returned
        // the same object, one thread's status could overwrite another's.
        assertThat(QuestionBasedStrategyFactory.verifyMarkingJson(MCQS_MARKING, "MCQS"))
                .isNotSameAs(QuestionBasedStrategyFactory.verifyMarkingJson(MCQS_MARKING, "MCQS"));
    }

    @Test
    void concurrentGradingNeverCrossesAnswerStatuses() throws Exception {
        // Half the tasks grade a correct answer, half an incorrect one, interleaved on a
        // pool. Every result must match the answer THAT task submitted.
        final int taskCount = 400;
        ExecutorService pool = Executors.newFixedThreadPool(16);
        try {
            List<Callable<Boolean>> tasks = new ArrayList<>();
            for (int i = 0; i < taskCount; i++) {
                final boolean shouldBeCorrect = (i % 2 == 0);
                tasks.add(() -> {
                    QuestionWiseBasicDetailDto result =
                            QuestionBasedStrategyFactory.calculateMarks(
                                    MCQS_MARKING,
                                    MCQS_CORRECT_A,
                                    mcqsResponse(shouldBeCorrect ? "a" : "b"),
                                    "MCQS");

                    String expectedStatus = shouldBeCorrect
                            ? QuestionResponseEnum.CORRECT.name()
                            : QuestionResponseEnum.INCORRECT.name();
                    double expectedMarks = shouldBeCorrect ? 4.0 : -1.0;

                    return expectedStatus.equals(result.getAnswerStatus())
                            && expectedMarks == result.getMarks();
                });
            }

            List<Future<Boolean>> futures = pool.invokeAll(tasks, 60, TimeUnit.SECONDS);

            int mismatches = 0;
            for (Future<Boolean> future : futures) {
                if (!future.get()) mismatches++;
            }
            assertThat(mismatches)
                    .as("gradings whose marks/status did not match their own submitted answer")
                    .isZero();
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void unknownQuestionType_failsLoudlyRatherThanNullPointer() {
        // getStrategy returned null for an unrecognised type and several call sites
        // dereferenced it straight away.
        try {
            QuestionBasedStrategyFactory.getResponseOptionIds(mcqsResponse("a"), "NOT_A_TYPE");
            assertThat(false).as("expected an IllegalArgumentException").isTrue();
        } catch (IllegalArgumentException expected) {
            assertThat(expected).hasMessageContaining("NOT_A_TYPE");
        } catch (Exception other) {
            assertThat(other).as("expected IllegalArgumentException, got %s", other).isNull();
        }
    }
}
