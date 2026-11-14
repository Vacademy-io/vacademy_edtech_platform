package vacademy.io.media_service.config;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
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

    // AI endpoint matchers removed — all AI features migrated to ai_service.
    private static final String[] ALLOWED_PATHS = { "/media-service/convert-presentations/**",
            "/auth/**", "/media-service/actuator/**",
            "/media-service/convert/doc-to-html", "/media-service/internal/**",
            "/internal/**", "/verify/id", "/media-service/swagger-ui.html", "/media-service/api-docs/**",
            "/swagger-ui.html", "/media-service/swagger-ui/index.html", "/media-service/v3/api-docs/**",
            "/media-service/swagger-ui/**", "/media-service/webjars/swagger-ui/**", "/media-service/public/**",
            "/media-service/health/**", "/media-service/convert/ppt-to-pdf/**",
            "/s/**" }; // Added /s/** for public short URL redirects
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
