package vacademy.io.community_service.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;


@Configuration
public class CorsConfig implements WebMvcConfigurer {

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/**")
                // Allow ANY origin so per-institute white-label custom domains (e.g.
                // admin.elevateeducation.in) work, not just the platform's own domains —
                // those domains are arbitrary, so a static allow-list can never cover them.
                // allowedOriginPatterns("*") + allowCredentials echoes the request origin
                // back (the spec forbids "*" + credentials), matching admin_core/auth which
                // already use allowedOrigins("*").
                .allowedOriginPatterns("*")
                .allowedMethods("*")
                .allowCredentials(true) // Allow credentials with pattern matching
                .allowedHeaders("*") // Allow any headers (these are REQUEST headers)
                // RESPONSE headers are a separate list and Spring does NOT
                // wildcard it. Without this, the browser hides Server-Timing
                // from JS on cross-origin calls — silently, with no error.
                .exposedHeaders("Server-Timing");
    }

    // In one of your @Configuration classes
    @Bean
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }
}