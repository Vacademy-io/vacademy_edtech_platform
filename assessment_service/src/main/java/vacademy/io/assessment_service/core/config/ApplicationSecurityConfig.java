package vacademy.io.assessment_service.core.config;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.AuthenticationProvider;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.authorization.AuthorizationDecision;
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
import org.springframework.web.client.RestTemplate;
import org.springframework.web.cors.CorsConfigurationSource;
import vacademy.io.assessment_service.core.filter.AssessmentJwtAuthFilter;
import vacademy.io.assessment_service.features.open_evaluation.OpenApiPaths;
import vacademy.io.assessment_service.features.open_evaluation.auth.AssessmentApiKeyVerifier;
import vacademy.io.assessment_service.features.open_evaluation.config.OpenApiGateFilter;
import vacademy.io.assessment_service.features.open_evaluation.config.OpenApiProperties;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiAuthEntryPoint;
import vacademy.io.common.auth.apikey.ApiKeyAuthFilter;
import vacademy.io.common.auth.apikey.ApiKeyAuthentication;
import vacademy.io.common.auth.config.JsonAuthEntryPoint;
import vacademy.io.common.auth.filter.InternalAuthFilter;

import java.util.List;
import java.util.Set;

@Configuration
@EnableMethodSecurity
public class ApplicationSecurityConfig {

    private static final String[] INTERNAL_PATHS = { "/assessment-service/internal/**" };

    private static final String[] ALLOWED_PATHS = { "/assessment-service/open-registrations/register/v1/**",

            "/assessment-service/question-paper/upload/docx/v1/**", "/assessment-service/actuator/**",

            "/assessment-service/swagger-ui.html", "/assessment-service/v1/report/alert/**",

            "/assessment-service/v3/api-docs/**", "/assessment-service/swagger-ui/**",

            "/assessment-service/webjars/swagger-ui/**", "/assessment-service/api-docs/**",

            "/assessment-service/open-registrations/v1/assessment-page",

            "/assessment-service/scheduler/test/**", "/assessment-service/health/**",
            // NOTE: /assessment/evaluation-ai/** and /assessment/evaluation-criteria/**
            // were previously permitAll — anyone could trigger paid grading runs on
            // arbitrary attempts, stop other tenants' runs, and read student PII from
            // progress. They now require a valid JWT (fall through to anyRequest()
            // .authenticated()) and enforce institute ownership in
            // EvaluationAccessValidator. The copy-check callback path below stays open
            // because it is authenticated by a shared X-Internal-Service-Token instead.
            // Copy-check callbacks: deliberately NOT under /internal/** because
            // InternalAuthFilter (common_service) intercepts anything whose URI
            // contains "internal" and demands HMAC headers (clientName +
            // Signature). ai_service signs callbacks with a simpler shared
            // X-Internal-Service-Token, so we keep this path out of that filter's
            // reach and rely on CopyCheckCallbackController.verify() for auth.
            "/assessment-service/copy-check/callback/**" };

    // The logged-out "Evaluator AI" free tool (admin dashboard /evaluator-ai) is
    // retired (founder, 2026-10-01). Its public /evaluation-tool/assessment/{create,
    // sections,{id}} endpoints are deleted, so nothing under /evaluation-tool/** is
    // anonymous any more. ai-publish lives under /internal/ (HMAC-only).

    @Autowired
    AssessmentJwtAuthFilter jwtAuthFilter;

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

    // AI Evaluation partner API (docs/AI_EVALUATION_PUBLIC_API.md 6.4-6.5).
    @Autowired
    private AssessmentApiKeyVerifier apiKeyVerifier;

    @Autowired
    private OpenApiProperties openApiProperties;

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        // Partner API filters are built here and added to the chain only. They are NOT
        // beans: Spring Boot registers every Filter bean on the servlet container for all
        // paths, outside the security chain.
        ApiKeyAuthFilter apiKeyAuthFilter = new ApiKeyAuthFilter(apiKeyVerifier, ApiKeyAuthFilter.Settings.builder()
                .pathPrefixes(List.of(OpenApiPaths.OPEN_PREFIX))
                .requiredKeyPathPrefixes(List.of(OpenApiPaths.PREFIX))
                .exemptPaths(Set.of(OpenApiPaths.OPENAPI_JSON))
                .requiredProduct(OpenApiPaths.PRODUCT)
                .build());
        OpenApiGateFilter openApiGateFilter = new OpenApiGateFilter(openApiProperties::isEnabled);
        OpenApiAuthEntryPoint entryPoint = new OpenApiAuthEntryPoint(jsonAuthEntryPoint, jsonAuthEntryPoint);

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
                    // Partner API: the OpenAPI document is public; everything else needs an
                    // API key. Tested by type, never by authority string, so a dashboard JWT
                    // (whatever roles or custom permissions it carries) is refused here.
                    authz.requestMatchers(AntPathRequestMatcher.antMatcher(OpenApiPaths.OPENAPI_JSON)).permitAll();
                    authz.requestMatchers(AntPathRequestMatcher.antMatcher(OpenApiPaths.ANT_PATTERN))
                            .access((authentication, context) -> new AuthorizationDecision(
                                    authentication.get() instanceof ApiKeyAuthentication));
                    authz.anyRequest().authenticated();
                })
                .sessionManagement(session -> session
                        .sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authenticationProvider(authenticationProvider())
                .addFilterBefore(internalAuthFilter, UsernamePasswordAuthenticationFilter.class)
                .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class)
                // Key auth runs before the JWT filter (spec 6.5); the kill switch before both.
                .addFilterBefore(apiKeyAuthFilter, AssessmentJwtAuthFilter.class)
                .addFilterBefore(openApiGateFilter, ApiKeyAuthFilter.class)
                .exceptionHandling(ex -> ex
                        .authenticationEntryPoint(entryPoint)
                        .accessDeniedHandler(entryPoint));
        return http.build();
    }

    @Bean
    public RestTemplate restTemplate() {
        return new RestTemplate();
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
