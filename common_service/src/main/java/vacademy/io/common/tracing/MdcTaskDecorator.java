package vacademy.io.common.tracing;

import org.slf4j.MDC;
import org.springframework.core.task.TaskDecorator;

import java.util.Map;
import java.util.concurrent.Callable;

/**
 * Copies the submitting thread's MDC (which holds {@link RequestIds#MDC_KEY}) onto the
 * worker thread for the duration of the task, then puts the worker's own MDC back.
 *
 * <p>Deliberately not a bean: every service builds its own executors, and a lone
 * TaskDecorator bean would only reach Spring Boot's default executor. Wire it where it is
 * wanted:
 * <pre>
 * executor.setTaskDecorator(new MdcTaskDecorator());
 * </pre>
 * or wrap a single task with {@link #wrap(Runnable)} / {@link #wrap(Callable)}.
 */
public class MdcTaskDecorator implements TaskDecorator {

    @Override
    public Runnable decorate(Runnable runnable) {
        return wrap(runnable);
    }

    public static Runnable wrap(Runnable task) {
        final Map<String, String> captured = MDC.getCopyOfContextMap();
        return () -> {
            Map<String, String> previous = MDC.getCopyOfContextMap();
            apply(captured);
            try {
                task.run();
            } finally {
                apply(previous);
            }
        };
    }

    public static <T> Callable<T> wrap(Callable<T> task) {
        final Map<String, String> captured = MDC.getCopyOfContextMap();
        return () -> {
            Map<String, String> previous = MDC.getCopyOfContextMap();
            apply(captured);
            try {
                return task.call();
            } finally {
                apply(previous);
            }
        };
    }

    private static void apply(Map<String, String> context) {
        if (context == null || context.isEmpty()) {
            MDC.clear();
        } else {
            MDC.setContextMap(context);
        }
    }
}
