package vacademy.io.admin_core_service.core.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;


@Configuration
public class CorsConfig implements WebMvcConfigurer {

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/**")
                .allowedOrigins("*") // Allow requests from any origin
                .allowedMethods("*") // Allow any HTTP method (GET, POST, etc.)
                .allowedHeaders("*") // Allow any headers (these are REQUEST headers)
                // RESPONSE headers are a separate list and Spring does NOT
                // wildcard it. Without this, the browser hides Server-Timing
                // from JS on cross-origin calls — silently, with no error.
                // Retry-After: the shop reads it on a 429 of the public commerce routes.
                .exposedHeaders("Server-Timing", "Retry-After");
    }
}