package vacademy.io.assessment_service.features.open_evaluation.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Paths;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import io.swagger.v3.oas.models.servers.Server;
import org.springdoc.core.models.GroupedOpenApi;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import vacademy.io.assessment_service.features.open_evaluation.OpenApiPaths;

import java.util.List;
import java.util.Map;

/**
 * Springdoc groups (T1.33 skeleton): {@value #GROUP} documents only the partner API, served
 * publicly at {@code GET /open/evaluation/v1/openapi.json} (see {@code OpenApiDocsController});
 * {@value #SERVICE_GROUP} keeps everything else in the internal swagger UI as before.
 *
 * <p>The partner document is rewritten for partners: paths relative to the public base
 * ({@code https://api.evalezy.com/v1}), the {@code X-API-Key} header as the only security
 * scheme, and no {@code /openapi.json} entry.
 *
 * <p>The partner group exists only while {@code assessment.open-api.enabled=true}: the
 * springdoc path it would be served on ({@code /assessment-service/api-docs/evaluation-v1})
 * is permitAll, and the gate filter only hides {@code /open/evaluation/v1/**}. The ungrouped
 * {@code /assessment-service/api-docs} is unaffected by these beans (springdoc 2.2.0 keeps
 * its {@code OpenApiWebMvcResource}; group customizers apply to their group only).
 */
@Configuration
public class OpenApiDocsConfig {

    public static final String GROUP = "evaluation-v1";
    public static final String SERVICE_GROUP = "assessment-service";
    public static final String PUBLIC_SERVER = "https://api.evalezy.com/v1";
    public static final String DIRECT_SERVER = "https://backend-stage.vacademy.io" + OpenApiPaths.BASE;
    static final String SECURITY_SCHEME = "ApiKey";

    @Bean
    @ConditionalOnProperty(name = "assessment.open-api.enabled", havingValue = "true")
    public GroupedOpenApi evaluationApiGroup() {
        return GroupedOpenApi.builder()
                .group(GROUP)
                .displayName("AI Evaluation API v1")
                .pathsToMatch(OpenApiPaths.ANT_PATTERN)
                .pathsToExclude(OpenApiPaths.OPENAPI_JSON)
                .addOpenApiCustomizer(OpenApiDocsConfig::forPartners)
                .build();
    }

    /** Everything else, so the internal swagger UI still lists the whole service. */
    @Bean
    public GroupedOpenApi assessmentServiceGroup() {
        return GroupedOpenApi.builder()
                .group(SERVICE_GROUP)
                .pathsToMatch("/**")
                .pathsToExclude(OpenApiPaths.ANT_PATTERN)
                .build();
    }

    static void forPartners(OpenAPI openApi) {
        openApi.info(new Info()
                .title("Evalezy AI Evaluation API")
                .version("v1")
                .description("Create exams, register candidates, submit answer sheets or typed answers and read AI "
                        + "marks. Server-to-server only: never ship an API key inside a mobile or browser app. "
                        + "Hindi answers and language papers are not supported yet."));
        openApi.servers(List.of(new Server().url(PUBLIC_SERVER).description("Public host"),
                new Server().url(DIRECT_SERVER).description("Same API on the platform host")));
        openApi.schemaRequirement(SECURITY_SCHEME, new SecurityScheme()
                .type(SecurityScheme.Type.APIKEY)
                .in(SecurityScheme.In.HEADER)
                .name("X-API-Key"));
        openApi.security(List.of(new SecurityRequirement().addList(SECURITY_SCHEME)));
        if (openApi.getPaths() != null) {
            Paths relative = new Paths();
            for (Map.Entry<String, io.swagger.v3.oas.models.PathItem> e : openApi.getPaths().entrySet()) {
                String path = e.getKey();
                if (path.startsWith(OpenApiPaths.BASE)) {
                    path = path.substring(OpenApiPaths.BASE.length());
                    if (path.isEmpty()) {
                        path = "/";
                    }
                }
                relative.addPathItem(path, e.getValue());
            }
            openApi.setPaths(relative);
        }
    }
}
