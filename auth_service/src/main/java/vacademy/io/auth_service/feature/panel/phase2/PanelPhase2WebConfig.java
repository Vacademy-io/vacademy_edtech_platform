package vacademy.io.auth_service.feature.panel.phase2;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import vacademy.io.auth_service.feature.panel.filter.PanelBearerGuard;

/**
 * The phase 2 platform-staff panel endpoints are for a person's own browser, like the Bearer panel
 * endpoints, so the same guard turns away an access token minted for a panel session there too.
 */
@Configuration
public class PanelPhase2WebConfig implements WebMvcConfigurer {

    public static final String SUPER_ADMIN_PATHS = "/auth-service/super-admin/v1/panel/**";

    private final PanelBearerGuard guard;

    public PanelPhase2WebConfig(PanelBearerGuard guard) {
        this.guard = guard;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(guard).addPathPatterns(SUPER_ADMIN_PATHS);
    }
}
