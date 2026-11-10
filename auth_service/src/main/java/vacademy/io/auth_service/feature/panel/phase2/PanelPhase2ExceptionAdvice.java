package vacademy.io.auth_service.feature.panel.phase2;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import vacademy.io.auth_service.feature.panel.controller.PanelExceptionAdvice;

/**
 * The phase 1 {code, message} error bodies for every controller under feature/panel/phase2/**.
 * PanelExceptionAdvice is limited to its own package, so phase 2 controllers would otherwise fall
 * through to the shared handler. Same handlers, inherited, no new behaviour.
 */
@RestControllerAdvice(basePackages = "vacademy.io.auth_service.feature.panel.phase2")
@Order(Ordered.HIGHEST_PRECEDENCE)
public class PanelPhase2ExceptionAdvice extends PanelExceptionAdvice {
}
