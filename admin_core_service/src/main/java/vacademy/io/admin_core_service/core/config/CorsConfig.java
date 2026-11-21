package vacademy.io.admin_core_service.core.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;


@Configuration
public class CorsConfig implements WebMvcConfigurer {

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        // Marketing OAuth initiate sets an HttpOnly nonce cookie that binds the consent to this
        // browser, so the dashboard calls it with credentials. A credentialed request needs the
        // exact origin echoed back plus Allow-Credentials (never "*"). Registered before "/**":
        // the first matching mapping wins. The endpoint still requires the JWT header, so
        // credentials add nothing an attacker's page could use.
        registry.addMapping("/admin-core-service/v1/marketing/oauth/initiate")
                .allowedOriginPatterns("*")
                .allowedMethods("POST", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(true);
        registry.addMapping("/**")
                .allowedOrigins("*") // Allow requests from any origin
                .allowedMethods("*") // Allow any HTTP method (GET, POST, etc.)
                .allowedHeaders("*") // Allow any headers (these are REQUEST headers)
                // RESPONSE headers are a separate list and Spring does NOT
                // wildcard it. Without this, the browser hides Server-Timing
                // from JS on cross-origin calls — silently, with no error.
                // Retry-After: the shop reads it on a 429 of the public commerce routes.
                // Content-Disposition: the admin's report downloads take the server's file name.
                .exposedHeaders("Server-Timing", "Retry-After", "Content-Disposition");
    }
}