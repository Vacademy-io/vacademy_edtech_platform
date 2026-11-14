package vacademy.io.admin_core_service.core.config;

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
import org.springframework.security.web.header.writers.DelegatingRequestMatcherHeaderWriter;
import org.springframework.security.web.header.writers.frameoptions.XFrameOptionsHeaderWriter;
import org.springframework.security.web.util.matcher.AntPathRequestMatcher;
import org.springframework.security.web.util.matcher.NegatedRequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.cors.CorsConfigurationSource;
import vacademy.io.common.auth.filter.InternalAuthFilter;
import vacademy.io.common.auth.filter.JwtAuthFilter;
import vacademy.io.common.auth.config.JsonAuthEntryPoint;

@Configuration
@EnableMethodSecurity
public class ApplicationSecurityConfig {

    private static final String[] INTERNAL_PATHS = { "/admin-core-service/internal/**" };

    private static final String[] ALLOWED_PATHS = {
            "/admin-core-service/open/**",
            "/admin-core-service/batch/v1/search",
            "/admin-core-service/public/**",
            "/admin-core-service/public/domain-routing/v1/**",
            "/admin-core-service/live-presenter/v1/**",
            "/admin-core-service/live-learner/v1/**",
            "/admin-core-service/institute/open_learner/v1/**",
            "/admin-core-service/institute/v1/internal/create",
            "/admin-core-service/learner/v1/details/**",
            "/admin-core-service/actuator/**",
            "/admin-core-service/swagger-ui.html",
            "/admin-core-service/v1/report/alert/**",
            "/admin-core-service/v3/api-docs/**",
            "/admin-core-service/swagger-ui/**",
            "/admin-core-service/webjars/swagger-ui/**",
            "/admin-core-service/api-docs/**",
            "/admin-core-service/learner-invitation-response/**",
            "/admin-core-service/live-session/register-guest-user/**",
            "/admin-core-service/live-session/get-earliest-schedule-id/**",
            "/admin-core-service/live-session/get-registration-data/**",
            "/admin-core-service/live-session/check-email-registration/**",
            "/admin-core-service/live-session/register-and-pay/**",
            "/admin-core-service/live-session/payment-info/**",
            "/admin-core-service/live-session/guest/**",
            // Public guest attendance marking (no JWT — called from the public
            // register/live-class + waiting-room pages). NOTE: this is a sibling of
            // /guest/**, so the wildcard above does NOT cover it — keep it explicit.
            "/admin-core-service/live-session/mark-guest-attendance/**",
            "/admin-core-service/course/ai/v1/**",
            "/admin-core-service/payments/webhook/callback/**",
            "/admin-core-service/v1/learner/enroll/**",
            "/admin-core-service/v2/learner/enroll/**",
            "/admin-core-service/workflow/schedule/**",
            "/admin-core-service/payments/user-plan/**/status/**",
            "/admin-core-service/llm-analytics/**",
            "/admin-core-service/v1/llm-analytics/**",
            "/admin-core-service/v1/embedding/api-docs/**",
            // NOTE: Spring's requestMatchers does not resolve path variables like
            // {instituteId},
            // so you must use a pattern with a wildcard instead.
            "/admin-core-service/tag-management/institutes/*/tags/users",
            // User Resolution APIs for notification service - OPEN for internal
            // communication
            "/admin-core-service/v1/faculty/by-package-sessions",
            "/admin-core-service/v1/students/by-package-sessions",
            "/admin-core-service/v1/package-sessions/names",
            "/admin-core-service/v1/faculty/package-sessions",
            "/admin-core-service/v1/package-sessions/search",
            "/admin-core-service/v1/users/by-custom-field-filters",
            "/admin-core-service/v1/users/by-custom-field-filters/**",
            // Centralized recipient resolution API
            "/admin-core-service/v1/recipient-resolution/centralized",
            // Agent SSE stream - EventSource doesn't support auth headers, session is
            // validated internally
            "/admin-core-service/v1/agent/stream/**",
            // Live activity SSE stream - same EventSource constraint. Unlike the
            // per-call telephony stream, an instituteId is guessable, so this one is
            // gated on a short-lived signed token minted by the AUTHENTICATED
            // /stream-token endpoint, which stays off this list. The token also carries
            // the caller's permitted categories, and the bus filters every event
            // against them before writing.
            "/admin-core-service/v1/live-activity/stream",
            "/admin-core-service/api/v1/audience/webhook/**",
            // Ad platform webhook endpoints (Meta hub.challenge GET + POST, Google POST)
            "/admin-core-service/api/v1/webhook/meta",
            "/admin-core-service/api/v1/webhook/google/**",
            // Meta OAuth callback (Meta redirects without Vacademy JWT)
            "/admin-core-service/v1/oauth/meta/callback",
            // YouTube OAuth callback (Google redirects without Vacademy JWT; state token is the CSRF guard)
            "/admin-core-service/youtube/oauth/callback",
            "/admin-core-service/health/**",
            // Network-baseline ping for the "is it us or your connection?" indicator.
            // Must stay unauthenticated: JwtAuthFilter short-circuits without a Bearer
            // token, so an anonymous call does no server work and its round trip is
            // almost pure network. Does no DB access. See PerfPingController.
            "/admin-core-service/v1/perf/ping",
            // Invoice test endpoints (for testing only)
            "/admin-core-service/v1/invoices/test/**",
            // Applicant public APIs for application form
            "/admin-core-service/applicant/v1/enquiry/**",
            "/admin-core-service/v1/applicant/**",
            "/admin-core-service/enrollment-policy/**",
            "/admin-core-service/v1/admission/submit",
            "/admin-core-service/v1/admission/bulk-submit-with-admission",
            // BBB server-to-server callback (no JWT — called by BigBlueButton when meeting ends)
            "/admin-core-service/live-sessions/provider/meeting/bbb-callback",
            "/admin-core-service/live-sessions/provider/meeting/bbb-analytics-callback",
            // BBB activeness plugin report (from the learner's browser inside BBB, no JWT —
            // authenticated by the per-learner HMAC token in the body)
            "/admin-core-service/live-sessions/provider/meeting/bbb-activeness",
            // BBB recording upload (server-to-server from BBB post-publish script, auth via X-BBB-Secret header)
            "/admin-core-service/live-sessions/provider/meeting/recording/init-upload",
            "/admin-core-service/live-sessions/provider/meeting/recording/complete",
            // BBB server pool management (server-to-server from community_service, no JWT)
            "/admin-core-service/bbb/pool/**",
            // BBB custom live-class domains, read by the pool start workflow.
            // No JWT, but NOT unauthenticated: BbbCustomDomainController itself
            // requires the shared X-Internal-Service-Token. Note the path must not
            // contain the word "internal" — InternalAuthFilter substring-matches the
            // URI and would demand clientName + Signature instead.
            "/admin-core-service/bbb/custom-domains",
            // ai_service copy-check callbacks for assignment AI evaluation. No JWT, but
            // AssignmentCopyCheckCallbackController requires X-Internal-Service-Token.
            "/admin-core-service/assignment-ai-evaluation/hook/**",
            // Zoom webhook callback (no JWT — verified by per-account HMAC signature)
            "/admin-core-service/live-sessions/provider/meeting/zoom-callback/**",
            // "Connect with Zoom" OAuth redirect (no JWT — CSRF-protected by the state record)
            "/admin-core-service/live-sessions/provider/zoom/oauth/callback",
            // "Connect Google Workspace" OAuth redirect (no JWT — CSRF-protected by the state record)
            "/admin-core-service/live-sessions/provider/google/oauth/callback",
            // Google Meet Pub/Sub push (Phase 4). Auth: optional shared-secret ?token=
            // (google.events.push-token). Inbound OIDC verification is NOT yet implemented — the
            // handler only triggers an idempotent recording re-sync (no exfiltration); harden before prod.
            "/admin-core-service/live-sessions/provider/meeting/google-meet-callback/**",
            // Telephony provider StatusCallbacks (Exotel, Plivo, etc.) — auth via
            // shared-secret ?token= + provider IP allowlist enforced in the handler.
            "/admin-core-service/v1/telephony/webhook/**",
            // Telephony call-event SSE stream — EventSource doesn't support auth
            // headers; the callLogId UUID acts as the capability token (returned only
            // to the counsellor who placed the call via /telephony/calls/connect).
            "/admin-core-service/v1/telephony/calls/*/events",
            // Inbound (lead -> counsellor) routing + status callbacks. The provider's
            // Connect applet hits /inbound/route synchronously and /inbound/status
            // when the call terminates; both auth via shared-secret ?token= verified
            // by the matching provider handler.
            "/admin-core-service/v1/telephony/inbound/**",
            // Vacademy Voice (Plivo) call-flow applets — Plivo fetches the answer
            // XML for the outbound bridge (and, later, inbound IVR) here. Auth via the
            // unguessable ?corr= call-log UUID + optional shared-secret ?token=.
            "/admin-core-service/v1/telephony/plivo/**"

    };
    @Autowired
    JwtAuthFilter jwtAuthFilter;

    // Replaces the default bodyless 403 (which is re-dispatched to a secured
    // /error and comes back empty) with a JSON body naming the actual reason.
    @Autowired
    private JsonAuthEntryPoint jsonAuthEntryPoint;
    @Autowired
    UserDetailsService userDetailsService;

    @Autowired
    InternalAuthFilter internalAuthFilter;

    @Autowired
    private CorsConfigurationSource corsConfigurationSource;

    /**
     * The public certificate verification document, which the learner portal
     * shows in an iframe on the institute's own domain. Every other response
     * keeps X-Frame-Options: DENY. The document sets its own CSP, which allows
     * the framing and nothing else (see PublicCertificateVerificationController).
     */
    static final RequestMatcher VERIFICATION_DOCUMENT = request -> {
        String uri = request.getRequestURI();
        return uri != null
                && uri.startsWith("/admin-core-service/open/v1/certificate/verify/")
                && uri.endsWith("/document");
    };

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                .headers(headers -> headers
                        .frameOptions(frame -> frame.disable())
                        .addHeaderWriter(new DelegatingRequestMatcherHeaderWriter(
                                new NegatedRequestMatcher(VERIFICATION_DOCUMENT),
                                new XFrameOptionsHeaderWriter(XFrameOptionsHeaderWriter.XFrameOptionsMode.DENY))))
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
                .anonymous(anonymous -> anonymous.disable())
                .authenticationProvider(authenticationProvider())
                .addFilterBefore(internalAuthFilter, UsernamePasswordAuthenticationFilter.class)
                .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class)
                .exceptionHandling(ex -> ex
                        .authenticationEntryPoint(jsonAuthEntryPoint)
                        .accessDeniedHandler(jsonAuthEntryPoint));
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
