package vacademy.io.admin_core_service.features.site_assistant.controller;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiErrorAdvice;

/**
 * The Catalogue API error envelope {"error":{"code","message","request_id","details"?}} for the
 * Site Assistant internal endpoints, so ai_service reads one error shape from the catalogue proxies
 * and the rest. Inherits every handler of {@link CatalogApiErrorAdvice}; scoped to this controller
 * and to the demo guide's lead endpoint ({@link DemoGuideInternalController}).
 */
@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(assignableTypes = {SiteAssistantInternalController.class, DemoGuideInternalController.class})
public class SiteAssistantErrorAdvice extends CatalogApiErrorAdvice {
}
