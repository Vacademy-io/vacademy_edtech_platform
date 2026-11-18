package vacademy.io.assessment_service.features.assessment.service.marking_strategy;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Live follow-up B6 (2026-11-19): a long answer whose question has no model answer threw a
 * caught NullPointerException (logged at ERROR) on every save / submit. It is now left for a
 * person to mark (0, PENDING), quietly. Keyword matching of questions WITH a model answer is
 * unchanged (owner decision pending).
 */
class LongAnswerQuestionTypeBasedStrategyTest {

    private static final String MARKING = "{\"type\":\"LONG_ANSWER\",\"data\":{\"totalMark\":5,\"negativeMark\":0}}";
    private static final String RESPONSE = "{\"questionId\":\"q1\",\"responseData\":{\"type\":\"LONG_ANSWER\","
            + "\"answer\":\"A business keeps accounts to know its profit\"}}";

    private ListAppender<ILoggingEvent> logs;
    private Logger logger;

    @BeforeEach
    void captureLogs() {
        logger = (Logger) LoggerFactory.getLogger(LongAnswerQuestionTypeBasedStrategy.class);
        logs = new ListAppender<>();
        logs.start();
        logger.addAppender(logs);
    }

    @AfterEach
    void releaseLogs() {
        logger.detachAppender(logs);
    }

    private static LongAnswerQuestionTypeBasedStrategy strategy() {
        LongAnswerQuestionTypeBasedStrategy s = new LongAnswerQuestionTypeBasedStrategy();
        s.setAnswerStatus("CORRECT"); // a stale status from the previous question must not leak
        return s;
    }

    @Test
    void question_without_a_model_answer_needs_marking_and_logs_nothing() {
        for (String key : new String[] {
                "{\"type\":\"LONG_ANSWER\"}",                                          // no data (the prod case)
                "{\"type\":\"LONG_ANSWER\",\"data\":{}}",                              // no answer
                "{\"type\":\"LONG_ANSWER\",\"data\":{\"answer\":{\"content\":null}}}", // no content
                "{\"type\":\"LONG_ANSWER\",\"data\":{\"answer\":{\"content\":\"  \"}}}",
                null, ""}) {
            LongAnswerQuestionTypeBasedStrategy s = strategy();
            assertThat(s.calculateMarks(MARKING, key, RESPONSE)).as(String.valueOf(key)).isEqualTo(0.0);
            assertThat(s.getAnswerStatus()).as(String.valueOf(key)).isEqualTo("PENDING");
        }
        assertThat(logs.list).noneMatch(e -> e.getLevel().isGreaterOrEqual(Level.WARN));
    }

    @Test
    void blank_or_missing_response_needs_marking_and_logs_nothing() {
        String key = "{\"type\":\"LONG_ANSWER\",\"data\":{\"answer\":{\"content\":\"profit\"}}}";
        LongAnswerQuestionTypeBasedStrategy s = strategy();
        assertThat(s.calculateMarks(MARKING, key, null)).isEqualTo(0.0);
        assertThat(s.getAnswerStatus()).isEqualTo("PENDING");
        s = strategy();
        assertThat(s.calculateMarks(MARKING, key, "{\"responseData\":{\"answer\":\"\"}}")).isEqualTo(0.0);
        assertThat(s.getAnswerStatus()).isEqualTo("PENDING");
        assertThat(logs.list).noneMatch(e -> e.getLevel().isGreaterOrEqual(Level.WARN));
    }

    @Test
    void keyword_match_with_a_model_answer_is_unchanged() {
        String key = "{\"type\":\"LONG_ANSWER\",\"data\":{\"answer\":{\"content\":"
                + "\"A business keeps accounts to know its profit\"}}}";
        LongAnswerQuestionTypeBasedStrategy s = strategy();
        assertThat(s.calculateMarks(MARKING, key, RESPONSE)).isEqualTo(5.0);
        assertThat(s.getAnswerStatus()).isEqualTo("CORRECT");

        s = strategy();
        String other = "{\"responseData\":{\"answer\":\"Something else entirely\"}}";
        assertThat(s.calculateMarks(MARKING, key, other) + 0.0).isEqualTo(0.0); // -0.0 with no negative mark
        assertThat(s.getAnswerStatus()).isEqualTo("INCORRECT");
    }

    @Test
    void unreadable_json_is_left_for_a_person_with_a_warning_not_an_error() {
        LongAnswerQuestionTypeBasedStrategy s = strategy();
        assertThat(s.calculateMarks(MARKING, "{not json", RESPONSE)).isEqualTo(0.0);
        assertThat(s.getAnswerStatus()).isEqualTo("PENDING");
        assertThat(logs.list).noneMatch(e -> e.getLevel() == Level.ERROR);
    }
}
