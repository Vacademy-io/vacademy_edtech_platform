package vacademy.io.admin_core_service.features.commerce.notify;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.IThrowableProxy;
import ch.qos.logback.core.read.ListAppender;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Captures every log event of the named loggers (and their children) at every level, for tests
 * that check what a log line may and may not hold. Close it to detach.
 */
public final class LogCapture implements AutoCloseable {

    public static final String COMMERCE = "vacademy.io.admin_core_service.features.commerce";
    public static final String WORKFLOW = "vacademy.io.admin_core_service.features.workflow";

    private final List<Logger> loggers = new ArrayList<>();
    private final List<Level> levels = new ArrayList<>();
    private final ListAppender<ILoggingEvent> appender = new ListAppender<>();

    private LogCapture(String... names) {
        appender.start();
        for (String name : names) {
            Logger logger = (Logger) LoggerFactory.getLogger(name);
            loggers.add(logger);
            levels.add(logger.getLevel());
            logger.setLevel(Level.ALL);
            logger.addAppender(appender);
        }
    }

    public static LogCapture of(String... names) {
        return new LogCapture(names);
    }

    public List<ILoggingEvent> events() {
        return List.copyOf(appender.list);
    }

    /** Every formatted message. */
    public List<String> messages() {
        return appender.list.stream().map(ILoggingEvent::getFormattedMessage).toList();
    }

    /**
     * Everything a log event carries as text: the formatted message, the raw pattern, each
     * argument, and the messages of an attached throwable and its causes.
     */
    public List<String> everything() {
        List<String> out = new ArrayList<>();
        for (ILoggingEvent e : appender.list) {
            out.add(e.getFormattedMessage());
            out.add(e.getMessage());
            if (e.getArgumentArray() != null) {
                Arrays.stream(e.getArgumentArray()).map(String::valueOf).forEach(out::add);
            }
            for (IThrowableProxy t = e.getThrowableProxy(); t != null; t = t.getCause()) {
                out.add(t.getClassName() + ": " + t.getMessage());
            }
        }
        return out;
    }

    @Override
    public void close() {
        for (int i = 0; i < loggers.size(); i++) {
            loggers.get(i).detachAppender(appender);
            loggers.get(i).setLevel(levels.get(i));
        }
        appender.stop();
    }
}
