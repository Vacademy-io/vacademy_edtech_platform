package vacademy.io.admin_core_service.features.ai_plans_billing.controller;

import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import vacademy.io.admin_core_service.features.ai_plans_billing.AiPlansBillingException;

import java.util.Date;

/**
 * Error body for the AI-plan billing facade and ops endpoints: the global {@code ErrorInfo}
 * fields (url, ex, responseCode, date) plus a machine-readable {@code code} / {@code error_code}
 * (STOREFRONT_OFF, PAYMENTS_DISABLED, BUYER_STATE_REQUIRED, ALREADY_SUBSCRIBED, ...), with the
 * exception's own HTTP status (404 / 409 / 422 / 502) instead of the global 510.
 *
 * <p>Scoped to this controller package and to {@link AiPlansBillingException} only; ordered first
 * because the global advice also handles its VacademyException supertype.
 */
@RestControllerAdvice(basePackageClasses = AiPlansStorefrontController.class)
@Order(Ordered.HIGHEST_PRECEDENCE)
@Slf4j
public class AiPlansBillingExceptionAdvice {

    public record AiPlansErrorInfo(String url, String ex, String responseCode, Date date, String code,
            String error_code) {}

    @ExceptionHandler(AiPlansBillingException.class)
    public ResponseEntity<AiPlansErrorInfo> handle(HttpServletRequest req, AiPlansBillingException ex) {
        int status = ex.getStatus() == null ? 500 : ex.getStatus().value();
        if (status >= 500) {
            log.error("[ai-plans-billing] {} {} -> {} {}: {}", req.getMethod(), req.getRequestURI(), status,
                    ex.getCode(), ex.getMessage());
        } else {
            log.info("[ai-plans-billing] {} {} -> {} {}", req.getMethod(), req.getRequestURI(), status, ex.getCode());
        }
        return ResponseEntity.status(status).body(new AiPlansErrorInfo(req.getRequestURL().toString(),
                ex.getLocalizedMessage(), String.valueOf(status), new Date(), ex.getCode(), ex.getCode()));
    }
}
