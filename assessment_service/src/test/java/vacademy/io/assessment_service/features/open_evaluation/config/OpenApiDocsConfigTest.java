package vacademy.io.assessment_service.features.open_evaluation.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.Paths;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import vacademy.io.assessment_service.features.open_evaluation.OpenApiPaths;
import vacademy.io.assessment_service.features.open_evaluation.controller.OpenApiDocsControllerAccess;

import static org.assertj.core.api.Assertions.assertThat;

class OpenApiDocsConfigTest {

    @Test
    void partner_document_is_relative_to_the_public_base_and_uses_the_api_key_header() {
        OpenAPI api = new OpenAPI().paths(new Paths()
                .addPathItem(OpenApiPaths.BASE + "/exams", new PathItem())
                .addPathItem(OpenApiPaths.BASE + "/exams/{examId}", new PathItem()));

        OpenApiDocsConfig.forPartners(api);

        assertThat(api.getPaths()).containsOnlyKeys("/exams", "/exams/{examId}");
        assertThat(api.getServers().get(0).getUrl()).isEqualTo("https://api.evalezy.com/v1");
        assertThat(api.getComponents().getSecuritySchemes().get("ApiKey").getName()).isEqualTo("X-API-Key");
        assertThat(api.getSecurity().get(0)).containsKey("ApiKey");
        assertThat(api.getInfo().getDescription()).contains("Server-to-server only");
    }

    @Test
    void groups_split_the_partner_api_from_the_rest() {
        OpenApiDocsConfig config = new OpenApiDocsConfig();
        assertThat(config.evaluationApiGroup().getPathsToMatch()).containsExactly(OpenApiPaths.ANT_PATTERN);
        assertThat(config.evaluationApiGroup().getPathsToExclude()).containsExactly(OpenApiPaths.OPENAPI_JSON);
        assertThat(config.assessmentServiceGroup().getPathsToExclude()).containsExactly(OpenApiPaths.ANT_PATTERN);
        assertThat(OpenApiDocsControllerAccess.target("/assessment-service/api-docs/"))
                .isEqualTo("forward:/assessment-service/api-docs/evaluation-v1");
    }

    @Test
    void partner_group_is_only_registered_while_the_api_is_switched_on() throws Exception {
        ConditionalOnProperty condition = OpenApiDocsConfig.class.getMethod("evaluationApiGroup")
                .getAnnotation(ConditionalOnProperty.class);
        assertThat(condition).isNotNull();
        assertThat(condition.name()).containsExactly("assessment.open-api.enabled");
        assertThat(condition.havingValue()).isEqualTo("true");
        assertThat(condition.matchIfMissing()).isFalse();
        assertThat(OpenApiDocsConfig.class.getMethod("assessmentServiceGroup")
                .getAnnotation(ConditionalOnProperty.class)).isNull();
    }
}
