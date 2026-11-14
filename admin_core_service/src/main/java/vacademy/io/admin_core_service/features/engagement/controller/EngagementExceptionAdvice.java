package vacademy.io.admin_core_service.features.engagement.controller;

import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import vacademy.io.admin_core_service.features.engagement.service.EngagementRejectedException;

import java.util.Date;

/**
 * Error body for engagement refusals: the global {@code ErrorInfo} plus a {@code reasonCode}.
 *
 * <p>Scoped to the engagement controller package, and it handles ONLY
 * {@link EngagementRejectedException}, so no other controller's errors and no other
 * exception change shape. The status and the first four fields are built exactly as
 * {@code GlobalExceptionHandler.handleExceptionForOthers} builds them for a
 * VacademyException (510, {@code responseCode = String.valueOf(status)}), so a deployed
 * client that reads {@code ex} sees the same body it always did.
 *
 * <p>Ordered first: the global advice also has a VacademyException handler, and Spring
 * asks advices in order, so without this the global one would answer and drop the code.
 */
@RestControllerAdvice(basePackageClasses = EngagementLearnerController.class)
@Order(Ordered.HIGHEST_PRECEDENCE)
@Slf4j
public class EngagementExceptionAdvice {

    /** {@code ErrorInfo}'s fields in the same order and types, then {@code reasonCode}. */
    public record EngagementErrorInfo(String url, String ex, String responseCode, Date date,
                                      String reasonCode) {}

    @ExceptionHandler(EngagementRejectedException.class)
    public ResponseEntity<EngagementErrorInfo> handleRejected(HttpServletRequest req,
                                                              EngagementRejectedException ex) {
        // A refusal is the rule doing its job, not a server fault: warn, no stack trace.
        log.warn("[engagement] rejected ({}): {}", ex.getReasonCode(), ex.getMessage());
        return ResponseEntity.status(ex.getStatus()).body(new EngagementErrorInfo(
                req.getRequestURL().toString(),
                ex.getLocalizedMessage(),
                String.valueOf(ex.getStatus()),
                new Date(),
                ex.getReasonCode()));
    }
}
