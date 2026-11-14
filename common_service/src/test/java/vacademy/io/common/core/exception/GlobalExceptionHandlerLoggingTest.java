package vacademy.io.common.core.exception;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.testsupport.ServletFakes;

/** ERROR logs become Sentry issues, so a VacademyException reaches one only when it is a real failure. */
class GlobalExceptionHandlerLoggingTest {

    private final Logger logger = (Logger) LoggerFactory.getLogger(GlobalExceptionHandler.class);
    private final ListAppender<ILoggingEvent> logs = new ListAppender<>();
    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    @BeforeEach
    void capture() {
        logs.start();
        logger.addAppender(logs);
    }

    @AfterEach
    void release() {
        logger.detachAppender(logs);
    }

    private void assertLoggedOnceAt(Level level) {
        assertEquals(1, logs.list.size());
        assertEquals(level, logs.list.get(0).getLevel());
    }

    private ResponseEntity<?> handle(VacademyException ex) {
        return handler.handleExceptionForOthers(new ServletFakes.FakeRequest("GET", "/x").proxy(), ex);
    }

    @Test
    void aClientErrorIsNotLoggedAsAnError() {
        ResponseEntity<?> response = handle(new VacademyException(HttpStatus.FORBIDDEN, "Result has not been released yet"));

        assertEquals(HttpStatus.FORBIDDEN, response.getStatusCode());
        assertLoggedOnceAt(Level.INFO);
        String message = logs.list.get(0).getFormattedMessage();
        assertTrue(message.contains("403") && message.contains("Result has not been released yet"), message);
    }

    @Test
    void aServerErrorIsStillLoggedAsAnError() {
        ResponseEntity<?> response = handle(new VacademyException(HttpStatus.INTERNAL_SERVER_ERROR, "boom"));

        assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, response.getStatusCode());
        assertLoggedOnceAt(Level.ERROR);
    }

    @Test
    void theDefaultStatusStaysAnError() {
        // Most throw sites pass no status: 510 reaches clients and Sentry exactly as before.
        ResponseEntity<?> response = handle(new VacademyException("boom"));

        assertEquals(HttpStatus.NOT_EXTENDED, response.getStatusCode());
        assertLoggedOnceAt(Level.ERROR);
    }
}
