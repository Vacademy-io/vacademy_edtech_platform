package vacademy.io.notification_service.config;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.AuthenticationProvider;
import org.springframework.security.config.annotation.authentication.configuration.AuthenticationConfiguration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.util.matcher.AntPathRequestMatcher;
import org.springframework.web.cors.CorsConfigurationSource;
import vacademy.io.common.auth.filter.HmacAuthFilter;
import vacademy.io.common.auth.filter.JwtAuthFilter;
import vacademy.io.common.auth.config.JsonAuthEntryPoint;
import vacademy.io.common.auth.provider.ServiceAuthProvider;

@EnableWebSecurity
@Configuration
public class WebSecurityConfig {

    private static final String[] ALLOWED_PATHS = {
            // Existing notification service paths
            "/notification-service/push-notifications/**",
            "/notification-service/v1/webhook/**",
            "/notification-service/v1/combot/**",
            "/notification-service/v1/tracking/**",
            "/notification-service/whatsapp/v1/send-template-whatsapp",
            "/notification-service/whatsapp/v1/send-template-whatsapp/multiple",
            "/auth/**",
            "/notification-service/actuator/**",
            "/actuator/**",
            "/notification-service/internal/**",
            "/notification-service/v1/send-email-to-users-public",
            "/internal/**",
            "/notification-service/v1/admin-app/**",
            "/verify/id",
            "/notification-service/diagnostic/**",
            // Swagger and documentation
            "/notification-service/swagger-ui.html",
            "/notification-service/api-docs/**",
            "/swagger-ui.html",
            "/notification-service/swagger-ui/index.html",
            "/notification-service/v3/api-docs/**",
            "/notification-service/swagger-ui/**",
            "/notification-service/webjars/swagger-ui/**",
            "/notification-service/v1/**",

            // Announcement system APIs - OPEN for internal service communication
            "/notification-service/v1/announcements/**",
            "/notification-service/v1/user-messages/**",
            "/notification-service/v1/message-replies/**",
            "/notification-service/v1/institute-settings/**",
            // SSE streaming endpoints
            "/notification-service/v1/sse/**",
            "/notification-service/public/**",
            "/notification-service/health/**",
            "/notification-service/webhook/v1/wati/**",
            // Meta (WhatsApp Cloud API) webhook — Meta calls these UNAUTHENTICATED
            // (GET verification handshake + POST events), so they must be public or
            // Meta's webhook verification fails with 403.
            "/notification-service/webhook/v1/meta",
            "/notification-service/webhook/v1/meta/**"
    };

    /**
     * Paths that must carry a valid JWT. These are matched BEFORE ALLOWED_PATHS,
     * so they win over the broad "/notification-service/v1/**" permitAll entry.
     */
    private static final String[] SECURED_PATHS = {
            "/notification-service/v1/send-email",
            // Sending controls: per-institute quota status and the opt-out list (email addresses)
            // plus add/remove — admin data, must not sit under the broad v1 permitAll.
            "/notification-service/v1/email-sending/**",
            // Email inbox: every email the institute sent/received (attachments included) and
            // reply-as-the-institute. The controller further requires institute staff.
            "/notification-service/v1/email-inbox/**"
    };

    @Autowired
    private JwtAuthFilter jwtAuthFilter; // Inject JwtAuthFilter dependency

    // Replaces the default bodyless 403 (re-dispatched to a secured /error and
    // returned empty) with a JSON body naming the actual reason.
    @Autowired
    private JsonAuthEntryPoint jsonAuthEntryPoint;
    @Autowired
    private HmacAuthFilter hmacAuthFilter;
    @Autowired
    private CorsConfigurationSource corsConfigurationSource;

    // Bean to configure security filters and authorization rules
    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                .csrf(csrf -> csrf.disable())
                .cors(cors -> cors.configurationSource(corsConfigurationSource))
                .authorizeHttpRequests(authz -> {
                    // Chat endpoints require a valid authenticated principal. This MUST be registered
                    // before the broad "/notification-service/v1/**" permitAll below, which would
                    // otherwise swallow them. Scoped to /v1/chat/** only — no other endpoint is affected.
                    authz.requestMatchers(AntPathRequestMatcher.antMatcher("/notification-service/v1/chat/**")).authenticated();

                    // Generic mailer. Left open it is an unauthenticated relay that will send an
                    // arbitrary subject/body to any address. Registered here, ahead of the broad
                    // "/notification-service/v1/**" permitAll below, so it actually takes effect.
                    // Service-to-service callers should use /notification-service/internal/** ;
                    // the OTP endpoints stay public because they are pre-login flows.
                    for (String path : SECURED_PATHS) {
                        authz.requestMatchers(AntPathRequestMatcher.antMatcher(path)).authenticated();
                    }

                    // Institute announcement settings: writes and the all-institutes listing need a JWT (the
                    // controller further requires an admin of the target institute). The per-institute GET stays
                    // public — learners read chat/community flags from it — and never includes the Firebase key.
                    authz.requestMatchers(AntPathRequestMatcher.antMatcher(HttpMethod.POST, "/notification-service/v1/institute-settings")).authenticated();
                    authz.requestMatchers(AntPathRequestMatcher.antMatcher(HttpMethod.DELETE, "/notification-service/v1/institute-settings/**")).authenticated();
                    authz.requestMatchers(AntPathRequestMatcher.antMatcher("/notification-service/v1/institute-settings/all")).authenticated();

                    // Use AntPathRequestMatcher for Ant-style pattern matching (compatible with
                    // Spring 6)
                    for (String path : ALLOWED_PATHS) {
                        authz.requestMatchers(AntPathRequestMatcher.antMatcher(path)).permitAll();
                    }
                    authz.anyRequest().authenticated();
                })
                .sessionManagement(session -> session
                        .sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authenticationProvider(authenticationProvider())
                .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class)
                .exceptionHandling(ex -> ex
                        .authenticationEntryPoint(jsonAuthEntryPoint)
                        .accessDeniedHandler(jsonAuthEntryPoint));

        return http.build();
    }

    // Bean for password encoder using BCrypt algorithm
    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    // Bean for authentication provider using user details service and password
    // encoder
    @Bean
    public AuthenticationProvider authenticationProvider() {
        return new ServiceAuthProvider();
    }

    // Bean to get AuthenticationManager from AuthenticationConfiguration
    @Bean
    public AuthenticationManager authenticationManager(AuthenticationConfiguration config) throws Exception {
        return config.getAuthenticationManager();
    }
}
