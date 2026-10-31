package vacademy.io.assessment_service.core.filter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import vacademy.io.assessment_service.core.config.AssessmentInternalUserDetailsService;
import vacademy.io.common.auth.apikey.ApiKeyAuthentication;
import vacademy.io.common.auth.entity.UserActivity;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.UserActivityRepository;
import vacademy.io.common.auth.filter.JwtAuthFilter;
import vacademy.io.common.auth.service.JwtService;
import vacademy.io.common.auth.service.UserActivityTrackingService;
import vacademy.io.common.core.utils.TextSanitizer;
import vacademy.io.common.exceptions.ExpiredTokenException;
import vacademy.io.common.exceptions.InvalidTokenException;

import java.io.IOException;

@Component
@Slf4j
public class AssessmentJwtAuthFilter extends OncePerRequestFilter {

    private static final String[] AUTH_BY_ASSESS_DB_URLS = { "/assessment-service/assessment/learner/status/update",
            "/assessment-service/assessment/learner/status/submit",
            "/assessment-service/assessment/learner/status/restart" };
    @Autowired
    UserDetailsService userDetailsService;
    @Autowired
    AssessmentInternalUserDetailsService assessmentInternalUserDetailsService;
    @Autowired
    private UserActivityRepository userActivityRepository;
    @Autowired
    private JwtService jwtService; // Inject JwtService dependency

    @Autowired(required = false)
    private UserActivityTrackingService userActivityTrackingService;

    @Value("${spring.application.name:assessment-service}")
    private String serviceName;

    private static boolean startWithAssessAuth(String request) {
        for (String path : AUTH_BY_ASSESS_DB_URLS) {
            if (request.startsWith(path)) {
                return true;
            }
        }
        return false;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        // Retrieve Authorization header from the request

        final String authHeader = request.getHeader("Authorization");
        final String instituteId = request.getHeader("clientId");

        // If header is missing or doesn't start with "Bearer ", skip filter
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            filterChain.doFilter(request, response);
            return;
        }

        // Already authenticated by an institute API key (partner API, ApiKeyAuthFilter runs
        // first): a stray Authorization header must neither replace that identity nor turn
        // an unparseable token into an error on a key-authenticated call.
        if (SecurityContextHolder.getContext().getAuthentication() instanceof ApiKeyAuthentication) {
            filterChain.doFilter(request, response);
            return;
        }

        try {
            // Extract JWT token from the header (remove "Bearer ")
            final String jwt = authHeader.substring(7);

            // Generate session token from JWT for activity tracking
            String sessionToken = generateSessionIdFromJwt(jwt);

            // Set request attributes for UserDetailsService to use
            request.setAttribute("serviceName", serviceName);
            request.setAttribute("sessionToken", sessionToken);

            // Extract user email from the JWT using JwtService.
            //
            // Sanitize before it becomes a lookup key — see the same handling in
            // common_service's JwtAuthFilter. An email pasted with an invisible
            // character (ZWSP, BOM, NBSP) is stored verbatim at signup, minted into
            // the token subject, and then matches no user, which surfaces as a
            // bodyless 403 on every authenticated endpoint.
            final String rawUsername = jwtService.extractUsername(jwt);
            final String username = TextSanitizer.cleanIdentifier(rawUsername);
            if (TextSanitizer.hasInvisibleChars(rawUsername)) {
                log.warn("JWT subject carried invisible characters and was normalised (institute={})", instituteId);
            }
            final String usernameWithInstituteId = instituteId + "@" + username;

            // Get current authentication object from SecurityContextHolder
            Authentication authentication = SecurityContextHolder.getContext().getAuthentication();

            // If user email is present and no authentication exists
            if (usernameWithInstituteId != null && authentication == null) {

                boolean isTokenExpired = jwtService.isTokenExpired(jwt);
                if (isTokenExpired)
                    throw new ExpiredTokenException("Expired Token");

                // Track authentication attempt
                long startTime = System.currentTimeMillis();

                String requestUri = request.getRequestURI();

                CustomUserDetails userDetails = null;

                try {
                    if (startWithAssessAuth(requestUri)) {
                        userDetails = (CustomUserDetails) (assessmentInternalUserDetailsService
                                .loadUserByUsername(usernameWithInstituteId));
                    } else {
                        // Load user details using user email
                        userDetails = (CustomUserDetails) userDetailsService
                                .loadUserByUsername(usernameWithInstituteId);
                    }
                } catch (Exception lookupFailure) {
                    // Token is ours and unexpired but resolves to no user. Record the
                    // reason so it reaches the response body instead of surfacing as an
                    // empty 403, then let permitAll endpoints serve the request as before.
                    log.warn("User resolution failed for subject '{}' (institute={}): {}",
                            username, instituteId, lookupFailure.getMessage());
                    request.setAttribute(JwtAuthFilter.AUTH_FAILURE_REASON,
                            "Token subject could not be matched to a user in this institute. Please log in again.");
                    // Rethrow rather than calling the chain here: the catch-all below
                    // falls through to the single doFilter at the end of this method.
                    // Calling it from inside the try would run the chain twice whenever
                    // a downstream handler throws.
                    throw new IllegalStateException("user resolution failed", lookupFailure);
                }
                // Pass User ID with request
                request.setAttribute("user", userDetails);

                // Validate the JWT token using user details and JwtService
                if (jwtService.isTokenValid(jwt, userDetails)) {
                    // Create an authentication token with user details and authorities

                    // todo use loadUserByUsername from assessmentInternalUserDetailsService

                    UsernamePasswordAuthenticationToken authToken = new UsernamePasswordAuthenticationToken(userDetails,
                            null, // As JWT based, no password needed
                            userDetails.getAuthorities());

                    // Set request details on the token
                    authToken.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));

                    // Set the authentication object in SecurityContextHolder
                    SecurityContextHolder.getContext().setAuthentication(authToken);

                    // Session-limit enforcement intentionally lives only in auth_service
                    // (the JwtAuthFilter in common_service), which owns the institute_settings
                    // and user_session tables. Those tables don't exist in the assessment_service
                    // DB, so running the check here only produced 42P01 errors and could never enforce.

                    // Track successful JWT authentication activity
                    if (userActivityTrackingService != null) {
                        try {
                            long responseTime = System.currentTimeMillis() - startTime;
                            String ipAddress = getClientIpAddress(request);
                            String userAgent = request.getHeader("User-Agent");
                            String endpoint = request.getRequestURI();

                            userActivityTrackingService.logUserActivity(
                                    userDetails.getUserId(),
                                    instituteId,
                                    serviceName,
                                    endpoint,
                                    "JWT_AUTHENTICATION",
                                    sessionToken,
                                    ipAddress,
                                    userAgent,
                                    200,
                                    responseTime);

                            // Create or update session
                            userActivityTrackingService.createOrUpdateSession(
                                    userDetails.getUserId(),
                                    instituteId,
                                    sessionToken,
                                    ipAddress,
                                    userAgent);

                        } catch (Exception e) {
                            log.debug("Error tracking JWT authentication activity: {}", e.getMessage());
                        }
                    }
                }
            }

            // Proceed with the filter chain (other filters and request handling)
            filterChain.doFilter(request, response);
        } catch (Exception exception) {
            // Log any errors during JWT processing
            log.error(exception.getMessage());
            throw new InvalidTokenException("Invalid Token");
        }
    }

    void addUserActivity(String userId, String origin, String route, String clientIp) {
        try {
            UserActivity userActivity = new UserActivity();
            userActivity.setUserId(userId);
            userActivity.setOrigin(origin);
            userActivity.setRoute(route);
            userActivity.setClientIp(clientIp);
            userActivityRepository.save(userActivity);
        } catch (Exception e) {
            log.error(e.getMessage());
        }
    }

    /**
     * Generate a consistent session ID from JWT token
     */
    private String generateSessionIdFromJwt(String jwt) {
        // Generate a consistent session ID from the JWT token
        // Use the first part of the token to ensure consistency across requests
        return "jwt_session_" + Integer.toHexString(jwt.hashCode());
    }

    /**
     * Extract client IP address from request
     */
    private String getClientIpAddress(HttpServletRequest request) {
        String xForwardedForHeader = request.getHeader("X-Forwarded-For");
        if (xForwardedForHeader != null && !xForwardedForHeader.isEmpty()) {
            return xForwardedForHeader.split(",")[0].trim();
        }

        String xRealIpHeader = request.getHeader("X-Real-IP");
        if (xRealIpHeader != null && !xRealIpHeader.isEmpty()) {
            return xRealIpHeader;
        }

        return request.getRemoteAddr();
    }

}
