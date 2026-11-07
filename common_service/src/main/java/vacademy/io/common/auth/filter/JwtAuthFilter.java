package vacademy.io.common.auth.filter;

import io.jsonwebtoken.ExpiredJwtException;
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
import vacademy.io.common.exceptions.AccessRevokedException;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.service.JwtService;
import vacademy.io.common.auth.service.UserActivityTrackingService;
import vacademy.io.common.auth.service.UserService;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;
import vacademy.io.common.core.utils.TextSanitizer;
import vacademy.io.common.exceptions.ExpiredTokenException;
import vacademy.io.common.exceptions.VacademyException;

import java.io.IOException;
import java.util.concurrent.ConcurrentHashMap;

@Component
@Slf4j
public class JwtAuthFilter extends OncePerRequestFilter {

    /**
     * Request attribute carrying why authentication did not stick, so the
     * entry point can put a real message in the response body instead of
     * returning a bodyless 403.
     */
    public static final String AUTH_FAILURE_REASON = "vacademy.authFailureReason";

    // ── Session-limit enforcement caches (no external dependency) ──
    private record CacheEntry(boolean value, long expiresAt) {
        boolean isExpired() {
            return System.currentTimeMillis() > expiresAt;
        }
    }

    private static final long INSTITUTE_LIMIT_TTL_MS = 60 * 60 * 1000L; // 1 hour
    private static final long SESSION_ACTIVE_TTL_MS = 10 * 60 * 1000L; // 10 minutes
    private static final ConcurrentHashMap<String, CacheEntry> instituteHasLimitCache = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, CacheEntry> sessionActiveCache = new ConcurrentHashMap<>();

    @Autowired
    UserDetailsService userDetailsService;

    @Autowired
    private JwtService jwtService; // Inject JwtService dependency

    @Autowired(required = false)
    private UserActivityTrackingService userActivityTrackingService;

    @Value("${spring.application.name:unknown-service}")
    private String serviceName;

    @Autowired(required = false)
    private UserService userService;

    @Autowired(required = false)
    private vacademy.io.common.auth.repository.UserSessionRepository userSessionRepository;

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

        // --- JWT authentication (best-effort) ---
        // If the token is ours and valid, SecurityContext is populated.
        // If parsing fails (e.g. external JWT from BBB), we skip auth silently
        // and let Spring Security's permitAll / authenticated rules decide.
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
            // Sanitize it before it becomes a lookup key: an email pasted with an
            // invisible character (ZWSP, BOM, NBSP) is stored verbatim at signup,
            // minted into the token subject, and then matches nothing on lookup —
            // which surfaces as a bodyless 403 on every authenticated endpoint. The
            // DB side is normalised too (User#normalizeIdentifiers), so cleaning
            // here lets already-issued tokens keep working instead of forcing a
            // re-login. See TextSanitizer.
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

                // Load user details using user email.
                //
                // A failure here means the token is ours and unexpired but the subject
                // resolves to no user. Letting it fall into the catch-all below leaves
                // the SecurityContext empty, and Spring Security then answers with an
                // empty 403 that reads like a permissions problem — the single most
                // misleading failure this filter can produce. Record the real reason so
                // it reaches the response body (see JsonAuthEntryPoint) and the logs.
                CustomUserDetails userDetails;
                try {
                    userDetails = (CustomUserDetails) userDetailsService
                            .loadUserByUsername(usernameWithInstituteId);
                } catch (Exception lookupFailure) {
                    log.warn("User resolution failed for subject '{}' (institute={}): {}",
                            username, instituteId, lookupFailure.getMessage());
                    // A switched-off team member gets a distinct reason so the client can end
                    // the session; any other failure (including auth-service being briefly
                    // unreachable) keeps the old reason and must not log people out.
                    request.setAttribute(AUTH_FAILURE_REASON, AccessRevokedException.isCause(lookupFailure)
                            ? AccessRevokedException.CODE
                            : "Token subject could not be matched to a user in this institute. Please log in again.");
                    // Rethrow rather than calling the chain here: the catch-all below
                    // falls through to the single doFilter at the end of this method.
                    // Calling it from inside the try would run the chain twice whenever
                    // a downstream handler throws. permitAll endpoints still serve the
                    // request exactly as they did before — only the reason is recorded.
                    throw new IllegalStateException("user resolution failed", lookupFailure);
                }

                // Pass User ID with request
                request.setAttribute("user", userDetails);

                // The token's signed "user" claim (users.id at mint time). userDetails came from a
                // username lookup; SuperAdminAuthUtil requires the two to agree. Best-effort only.
                try {
                    Object tokenUserId = jwtService.extractClaim(jwt, claims -> claims.get("user"));
                    if (tokenUserId instanceof String) {
                        request.setAttribute(SuperAdminAuthUtil.JWT_USER_ID_ATTRIBUTE, tokenUserId);
                    }
                } catch (Exception ignored) {
                    // No usable claim: the allowlist alone decides.
                }

                // Validate the JWT token using user details and JwtService
                if (jwtService.isTokenValid(jwt, userDetails)) {
                    // Create an authentication token with user details and authorities
                    UsernamePasswordAuthenticationToken authToken = new UsernamePasswordAuthenticationToken(userDetails,
                            null, // As JWT based, no password needed
                            userDetails.getAuthorities());

                    // Set request details on the token
                    authToken.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));

                    // Set the authentication object in SecurityContextHolder
                    SecurityContextHolder.getContext().setAuthentication(authToken);
                    if (userService != null) {
                        userService.updateLastLoginTimeForUser(userDetails.getUserId());
                    }

                    // ── Session-limit enforcement (only in auth_service — it owns the tables) ──
                    if (instituteId != null && userSessionRepository != null
                            && "auth_service".equals(serviceName)) {
                        try {
                            if (isInstituteLimited(instituteId) && !isSessionStillActive(sessionToken)) {
                                SecurityContextHolder.clearContext();
                                response.setStatus(460);
                                response.setContentType("application/json");
                                response.getWriter().write(
                                        "{\"error\":\"SESSION_TERMINATED\",\"message\":\"Your session has been terminated. Please log in again.\"}");
                                return;
                            }
                        } catch (Exception e) {
                            log.debug("Session-limit check failed (allowing request): {}", e.getMessage());
                        }
                    }

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
        } catch (ExpiredJwtException exception) {
            throw new VacademyException("Expired Token");
        } catch (ExpiredTokenException exception) {
            // Expired Vacademy token detected by the explicit isTokenExpired check.
            throw new VacademyException(exception.getMessage());
        } catch (Exception exception) {
            // Unrecognised / external JWT (e.g. BBB HS512 token) — skip auth silently.
            // SecurityContext stays empty; Spring Security rules (permitAll vs
            // authenticated) decide access.
            log.debug("JWT processing skipped (unrecognised token): {}", exception.getMessage());
        }

        // Always proceed with the filter chain — authorization is enforced by Spring
        // Security, not here
        filterChain.doFilter(request, response);
    }

    /**
     * Generate a consistent session ID from JWT token
     */
    private String generateSessionIdFromJwt(String jwt) {
        // Generate a consistent session ID from the JWT token
        // Use the first part of the token to ensure consistency across requests
        return "jwt_session_" + Integer.toHexString(jwt.hashCode());
    }

    // ── Cache helpers for session-limit enforcement ──

    private boolean isInstituteLimited(String instituteId) {
        CacheEntry entry = instituteHasLimitCache.get(instituteId);
        if (entry != null && !entry.isExpired())
            return entry.value();
        try {
            boolean hasLimit = userSessionRepository.countSessionLimitConfigured(instituteId) > 0;
            log.info("Institute {} session limit configured: {}", instituteId, hasLimit);
            instituteHasLimitCache.put(instituteId,
                    new CacheEntry(hasLimit, System.currentTimeMillis() + INSTITUTE_LIMIT_TTL_MS));
            return hasLimit;
        } catch (Exception e) {
            log.warn("Failed to check session limit for institute {}: {}", instituteId, e.getMessage());
            instituteHasLimitCache.put(instituteId,
                    new CacheEntry(false, System.currentTimeMillis() + INSTITUTE_LIMIT_TTL_MS));
            return false;
        }
    }

    private boolean isSessionStillActive(String sessionToken) {
        CacheEntry entry = sessionActiveCache.get(sessionToken);
        if (entry != null && !entry.isExpired())
            return entry.value();
        boolean active = userSessionRepository.countActiveSession(sessionToken) > 0;
        log.info("Session {} active: {}", sessionToken, active);
        sessionActiveCache.put(sessionToken,
                new CacheEntry(active, System.currentTimeMillis() + SESSION_ACTIVE_TTL_MS));
        return active;
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
