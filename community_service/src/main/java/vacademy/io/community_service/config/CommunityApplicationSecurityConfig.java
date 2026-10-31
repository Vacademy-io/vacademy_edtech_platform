package vacademy.io.community_service.config;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.AuthenticationProvider;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.config.annotation.authentication.configuration.AuthenticationConfiguration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.password.NoOpPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.util.matcher.AntPathRequestMatcher;
import org.springframework.web.cors.CorsConfigurationSource;
import vacademy.io.common.auth.filter.InternalAuthFilter;
import vacademy.io.common.auth.filter.JwtAuthFilter;
import vacademy.io.common.auth.config.JsonAuthEntryPoint;

@Configuration
@EnableMethodSecurity
public class CommunityApplicationSecurityConfig {

    private static final String[] INTERNAL_PATHS = {
            // Service-to-service only (HMAC via InternalAuthFilter) — never exposed to browsers.
            // admin_core_service's institute-facing app-status endpoint reads through this.
            "/community-service/internal/**" };

    private static final String[] ALLOWED_PATHS = { "/community-service/engage/learner/**",
            "/community-service/engage/**", "/community-service/subject/**", "/community-service/chapter/**",
            "/community-service/actuator/**", "/community-service/swagger-ui.html",
            "/community-service/presentation/**", "/community-service/v1/report/alert/**",
            "/community-service/v3/api-docs/**", "/community-service/swagger-ui/**",
            "/community-service/webjars/swagger-ui/**", "/community-service/api-docs/**",
            // Diagnostics endpoints - open for health dashboard
            "/community-service/diagnostics/**",
            // Public status-page incidents - open for health dashboard
            "/community-service/public/v1/status/**",
            // Public onboarding form (intake + demo handoff) - open for the onboarding pages
            "/community-service/public/v1/onboarding/**",
            // Public plan builder (rate card + quote) - open for the pricing page
            "/community-service/public/v1/pricing/**",
            // BBB server health check & management
            "/community-service/bbb/**",
            // External uptime monitor for per-client deployments (Vet Education etc.).
            //
            // ONLY the read-only status view is open — it returns the cached result of
            // the last scheduled run and neither probes nor mutates anything, so an
            // external uptime checker or health dashboard can poll it freely.
            //
            // Deliberately NOT a /** wildcard: the POST /platform-health/check
            // endpoints fall through to anyRequest().authenticated() below. Those
            // trigger live probes and can send WhatsApp pages, so leaving them open
            // would expose an unauthenticated button that messages three people.
            "/community-service/platform-health/status" };

    @Autowired
    JwtAuthFilter jwtAuthFilter;

    // Replaces the default bodyless 403 (re-dispatched to a secured /error and
    // returned empty) with a JSON body naming the actual reason.
    @Autowired
    private JsonAuthEntryPoint jsonAuthEntryPoint;
    @Autowired
    UserDetailsService userDetailsService;

    @Autowired
    InternalAuthFilter internalAuthFilter;

    @Autowired
    private CorsConfigurationSource corsConfigurationSource;

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                .csrf(csrf -> csrf.disable())
                .cors(cors -> cors.configurationSource(corsConfigurationSource))
                .authorizeHttpRequests(authz -> {
                    // Use AntPathRequestMatcher for Ant-style pattern matching (compatible with
                    // Spring 6)
                    for (String path : ALLOWED_PATHS) {
                        authz.requestMatchers(AntPathRequestMatcher.antMatcher(path)).permitAll();
                    }
                    for (String path : INTERNAL_PATHS) {
                        authz.requestMatchers(AntPathRequestMatcher.antMatcher(path)).authenticated();
                    }
                    authz.anyRequest().authenticated();
                })
                .sessionManagement(session -> session
                        .sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authenticationProvider(authenticationProvider())
                .addFilterBefore(internalAuthFilter, UsernamePasswordAuthenticationFilter.class)
                .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class)
                .exceptionHandling(ex -> ex
                        .authenticationEntryPoint(jsonAuthEntryPoint)
                        .accessDeniedHandler(jsonAuthEntryPoint));
        return http.build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return NoOpPasswordEncoder.getInstance();
    }

    @Bean
    public AuthenticationProvider authenticationProvider() {
        DaoAuthenticationProvider authenticationProvider = new DaoAuthenticationProvider();
        authenticationProvider.setUserDetailsService(userDetailsService);
        authenticationProvider.setPasswordEncoder(passwordEncoder());
        return authenticationProvider;
    }

    @Bean
    public AuthenticationManager authenticationManager(AuthenticationConfiguration config) throws Exception {
        return config.getAuthenticationManager();
    }
}
