package vacademy.io.common.tracing;

import io.sentry.Breadcrumb;
import io.sentry.Sentry;
import io.sentry.SentryLevel;
import lombok.extern.slf4j.Slf4j;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;
import vacademy.io.common.exceptions.UserNotFoundException;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.health.service.SlowQueryRegistry;

import java.util.Arrays;
import java.util.concurrent.TimeUnit;

/**
 * Aspect that automatically logs slow database queries from Spring Data JPA
 * repositories.
 * 
 * This intercepts all methods in Repository classes and logs timing
 * information.
 * Slow queries are logged as warnings and sent to Sentry for analysis.
 * 
 * Can be disabled via:
 * - vacademy.tracing.enabled=false (master toggle)
 * - vacademy.tracing.slow-query-logger-enabled=false (individual toggle)
 * 
 * Enable by adding @EnableAspectJAutoProxy to your Spring configuration.
 */
@Aspect
@Component
@Slf4j
public class SlowQueryLogger {

    @Autowired
    private TracingProperties tracingProperties;

    @Autowired
    private SlowQueryRegistry slowQueryRegistry;

    /**
     * Intercept all Repository methods (Spring Data JPA) in vacademy.io packages
     * only
     */
    @Around("execution(* vacademy.io..*..*Repository.*(..))")
    public Object logRepositoryMethods(ProceedingJoinPoint joinPoint) throws Throwable {
        if (!tracingProperties.isSlowQueryLoggerEffectivelyEnabled()) {
            return joinPoint.proceed();
        }
        return logMethodExecution(joinPoint, "repository");
    }

    /**
     * Intercept all methods in Service classes in vacademy.io packages only
     * Excludes Spring framework services to prevent conflicts
     */
    @Around("execution(* vacademy.io..*..*Service.*(..))")
    public Object logServiceMethods(ProceedingJoinPoint joinPoint) throws Throwable {
        if (!tracingProperties.isSlowQueryLoggerEffectivelyEnabled()) {
            return joinPoint.proceed();
        }
        return logMethodExecution(joinPoint, "service");
    }

    /**
     * Intercept all methods in Manager classes in vacademy.io packages only
     * Excludes Spring framework managers (like AuthorizationManager) to prevent
     * conflicts
     */
    @Around("execution(* vacademy.io..*..*Manager.*(..))")
    public Object logManagerMethods(ProceedingJoinPoint joinPoint) throws Throwable {
        if (!tracingProperties.isSlowQueryLoggerEffectivelyEnabled()) {
            return joinPoint.proceed();
        }
        return logMethodExecution(joinPoint, "manager");
    }

    /**
     * Common method execution logging logic
     */
    private Object logMethodExecution(ProceedingJoinPoint joinPoint, String type) throws Throwable {
        MethodSignature signature = (MethodSignature) joinPoint.getSignature();
        String className = signature.getDeclaringType().getSimpleName();
        String methodName = signature.getName();
        String fullMethodName = className + "." + methodName;

        long startTime = System.nanoTime();

        try {
            // Execute the actual method
            Object result = joinPoint.proceed();

            // Calculate duration
            long durationNanos = System.nanoTime() - startTime;
            long durationMs = TimeUnit.NANOSECONDS.toMillis(durationNanos);

            // Log if slow
            logIfSlow(fullMethodName, type, durationMs, joinPoint.getArgs(), null);

            return result;

        } catch (Throwable throwable) {
            // Calculate duration even for errors
            long durationNanos = System.nanoTime() - startTime;
            long durationMs = TimeUnit.NANOSECONDS.toMillis(durationNanos);

            // Log the error with timing
            logIfSlow(fullMethodName, type, durationMs, joinPoint.getArgs(), throwable);

            throw throwable;
        }
    }

    /**
     * Log method execution if it exceeded the slow threshold
     */
    private void logIfSlow(String methodName, String type, long durationMs, Object[] args, Throwable thrown) {
        // A deliberate 4xx is the method doing its job -- rejecting a request the rules forbid --
        // not a failure. Treating it as one made every business rule (chat's CHAT_DISABLED for an
        // institute that never enabled chat, a missing required field, a 404) an ERROR log, and
        // error logs become Sentry issues. Drop it back to the normal path so it is still reported
        // when SLOW, never as an error. RequestTracingFilter already applies this rule to statuses.
        Throwable error = isExpectedClientError(thrown) ? null : thrown;

        if (durationMs < tracingProperties.getSlowQueryThresholdMs() && error == null) {
            return;
        }

        String argsString = formatArgs(args);

        if (error != null) {
            log.error("❌ {} [{}] FAILED after {}ms | Args: {} | Error: {}",
                    type.toUpperCase(), methodName, durationMs, argsString, error.getMessage());
            addSentryBreadcrumb(methodName, type, durationMs, true, error.getMessage());
            slowQueryRegistry.record(methodName, type, durationMs, "error", error.getMessage());

        } else if (durationMs >= tracingProperties.getCriticalQueryThresholdMs()) {
            log.error("🔴 CRITICAL SLOW {} [{}] took {}ms | Args: {}",
                    type.toUpperCase(), methodName, durationMs, argsString);
            addSentryBreadcrumb(methodName, type, durationMs, false, null);
            captureSlowMethodEvent(methodName, type, durationMs, argsString, "critical");
            slowQueryRegistry.record(methodName, type, durationMs, "critical", null);

        } else if (durationMs >= tracingProperties.getSlowQueryThresholdMs()) {
            log.warn("🟡 SLOW {} [{}] took {}ms | Args: {}",
                    type.toUpperCase(), methodName, durationMs, argsString);
            addSentryBreadcrumb(methodName, type, durationMs, false, null);
            captureSlowMethodEvent(methodName, type, durationMs, argsString, "warning");
            slowQueryRegistry.record(methodName, type, durationMs, "warning", null);
        }
    }

    /**
     * Is this throwable a business rejection the endpoint chose to return (a 4xx), rather than
     * something that went wrong? Covers the four ways this codebase declares one: a
     * {@link ResponseStatusException}, a {@link VacademyException} carrying its own status, one of
     * the shared exceptions GlobalExceptionHandler maps to a fixed 4xx, and a custom exception
     * annotated {@code @ResponseStatus}. 5xx keeps its error treatment in every case -- including
     * EnrollmentConflictException, which deliberately keeps VacademyException's 510.
     */
    private boolean isExpectedClientError(Throwable error) {
        if (error == null) {
            return false;
        }
        if (error instanceof ResponseStatusException rse) {
            return rse.getStatusCode().is4xxClientError();
        }
        if (error instanceof VacademyException ve) {
            return ve.getStatus() != null && ve.getStatus().is4xxClientError();
        }
        if (error instanceof UserNotFoundException
                || error instanceof ResourceNotFoundException
                || error instanceof ForbiddenException
                || error instanceof ConflictException
                || error instanceof InvalidRequestException) {
            return true;
        }
        ResponseStatus annotation = AnnotatedElementUtils.findMergedAnnotation(error.getClass(), ResponseStatus.class);
        return annotation != null && annotation.value().is4xxClientError();
    }

    /**
     * Format method arguments for logging (truncated to avoid huge logs)
     */
    private String formatArgs(Object[] args) {
        if (args == null || args.length == 0) {
            return "[]";
        }

        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < args.length; i++) {
            if (i > 0)
                sb.append(", ");
            sb.append(formatArg(args[i]));

            // Limit total length
            if (sb.length() > 200) {
                sb.append("...(truncated)");
                break;
            }
        }
        sb.append("]");
        return sb.toString();
    }

    /**
     * Format a single argument, truncating if necessary
     */
    String formatArg(Object arg) {
        if (arg == null)
            return "null";

        String str;
        if (arg instanceof String && looksLikeSecret((String) arg)) {
            str = "\"***\"";
        } else if (arg instanceof String) {
            str = "\"" + arg + "\"";
        } else if (arg.getClass().isArray()) {
            // Primitive arrays (byte[], int[]...) cannot be cast to Object[] —
            // doing so threw ClassCastException from inside the aspect's error
            // path, REPLACING the intercepted method's real exception. Print a
            // compact descriptor instead of the contents.
            if (arg.getClass().getComponentType().isPrimitive()) {
                str = arg.getClass().getComponentType().getSimpleName()
                        + "[](length=" + java.lang.reflect.Array.getLength(arg) + ")";
            } else {
                str = Arrays.toString((Object[]) arg);
            }
        } else if (arg instanceof java.util.Collection) {
            java.util.Collection<?> col = (java.util.Collection<?>) arg;
            str = "Collection(size=" + col.size() + ")";
        } else if (arg instanceof java.util.Map) {
            // Maps often carry credentials (e.g. a payment gateway's key id + secret). The
            // truncation below keeps the first ~47 characters, and map order is not fixed, so
            // a secret could be printed (and sent to Sentry). Never print map contents.
            str = "Map(size=" + ((java.util.Map<?, ?>) arg).size() + ")";
        } else {
            str = arg.toString();
        }

        // Truncate long values
        if (str.length() > 50) {
            return str.substring(0, 47) + "...";
        }
        return str;
    }

    /** Vendor key / secret shapes that must never reach a log line. */
    static boolean looksLikeSecret(String s) {
        String v = s.trim();
        return v.startsWith("rzp_live_") || v.startsWith("rzp_test_") || v.startsWith("sk-") || v.startsWith("sk_live_")
                || v.startsWith("sk_test_") || v.startsWith("Bearer ");
    }

    /**
     * Add a breadcrumb to Sentry for slow method execution
     */
    private void addSentryBreadcrumb(String methodName, String type, long durationMs, boolean isError,
            String errorMessage) {
        try {
            Breadcrumb breadcrumb = new Breadcrumb();
            breadcrumb.setCategory(type + ".slow");
            breadcrumb.setMessage(methodName + " took " + durationMs + "ms");
            breadcrumb.setData("method", methodName);
            breadcrumb.setData("duration_ms", durationMs);
            breadcrumb.setData("type", type);

            if (isError) {
                breadcrumb.setLevel(SentryLevel.ERROR);
                breadcrumb.setData("error", errorMessage);
            } else if (durationMs >= tracingProperties.getCriticalQueryThresholdMs()) {
                breadcrumb.setLevel(SentryLevel.ERROR);
            } else {
                breadcrumb.setLevel(SentryLevel.WARNING);
            }

            Sentry.addBreadcrumb(breadcrumb);
        } catch (Exception e) {
            // Silently ignore Sentry errors
        }
    }

    /**
     * Capture slow method as a Sentry event for alerting
     */
    private void captureSlowMethodEvent(String methodName, String type, long durationMs, String args, String severity) {
        try {
            Sentry.configureScope(scope -> {
                scope.setTag("slow_" + type, "true");
                scope.setTag("slow_" + type + "_severity", severity);
                scope.setExtra(type + "_duration_ms", String.valueOf(durationMs));
                scope.setExtra(type + "_method", methodName);
                scope.setExtra(type + "_args", args);
            });
        } catch (Exception e) {
            // Silently ignore
        }
    }
}