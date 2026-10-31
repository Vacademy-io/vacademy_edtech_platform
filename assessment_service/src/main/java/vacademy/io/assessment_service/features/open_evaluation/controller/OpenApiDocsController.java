package vacademy.io.assessment_service.features.open_evaluation.controller;

import io.swagger.v3.oas.annotations.Hidden;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import vacademy.io.assessment_service.features.open_evaluation.OpenApiPaths;
import vacademy.io.assessment_service.features.open_evaluation.config.OpenApiDocsConfig;

/**
 * {@code GET /open/evaluation/v1/openapi.json} (public, no key; spec 6.5, T1.33): forwards to
 * springdoc's document of the {@value OpenApiDocsConfig#GROUP} group, which holds the partner
 * API only. The forward target sits under {@code springdoc.api-docs.path}, already public.
 */
@Hidden
@Controller
public class OpenApiDocsController {

    private final String apiDocsPath;

    public OpenApiDocsController(@Value("${springdoc.api-docs.path:/v3/api-docs}") String apiDocsPath) {
        this.apiDocsPath = apiDocsPath.replaceAll("/+$", "");
    }

    @GetMapping(OpenApiPaths.OPENAPI_JSON)
    public String openApiJson() {
        return "forward:" + target();
    }

    String target() {
        return apiDocsPath + "/" + OpenApiDocsConfig.GROUP;
    }
}
