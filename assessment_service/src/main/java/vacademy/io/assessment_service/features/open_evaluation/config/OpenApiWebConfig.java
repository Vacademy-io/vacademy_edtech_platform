package vacademy.io.assessment_service.features.open_evaluation.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import vacademy.io.assessment_service.features.open_evaluation.OpenApiPaths;
import vacademy.io.assessment_service.features.open_evaluation.ratelimit.OpenApiRateLimitInterceptor;

/** Registers the partner API's rate limiter on the partner paths only. */
@Configuration
public class OpenApiWebConfig implements WebMvcConfigurer {

    private final OpenApiRateLimitInterceptor rateLimitInterceptor;

    public OpenApiWebConfig(OpenApiRateLimitInterceptor rateLimitInterceptor) {
        this.rateLimitInterceptor = rateLimitInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(rateLimitInterceptor)
                .addPathPatterns(OpenApiPaths.ANT_PATTERN)
                .excludePathPatterns(OpenApiPaths.OPENAPI_JSON);
    }
}
