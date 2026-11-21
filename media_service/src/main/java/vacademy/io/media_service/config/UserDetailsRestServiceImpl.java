package vacademy.io.media_service.config;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Component;
import vacademy.io.common.auth.constants.AuthConstant;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

@Component
@Slf4j
public class UserDetailsRestServiceImpl implements UserDetailsService {

    @Autowired
    InternalClientUtils hmacClientUtils;

    @Value(value = "${auth.server.baseurl}")
    String authServerBaseUrl;
    @Value(value = "${spring.application.name}")
    String clientName;

    @Override
    @Cacheable(value = "userDetails", key = "#username")
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {

        log.debug("Entering in loadUserByUsername Method...");

        // Extract session token from SecurityContext if available
        String sessionToken = extractSessionToken();

        // Build endpoint URL with service name and optional session token
        // Percent-encode every query value. The username is an email, which can
        // legitimately contain '+', '&' and non-ASCII characters — unencoded, those
        // either truncate the query string or get mangled downstream. Paired with
        // makeHmacRequestWithEncodedRoute so nothing encodes them a second time.
        String endpoint = AuthConstant.userServiceRoute
                + "?userName=" + encode(username)
                + "&serviceName=" + encode(clientName)
                + (sessionToken != null ? "&sessionToken=" + encode(sessionToken) : "");

        ResponseEntity<String> response = hmacClientUtils.makeHmacRequestWithEncodedRoute(
                clientName,
                HttpMethod.GET.name(),
                authServerBaseUrl,
                endpoint,
                null);

        ObjectMapper objectMapper = new ObjectMapper();

        try {
            UserServiceDTO customUserDetails = objectMapper.readValue(response.getBody(), UserServiceDTO.class);
            log.info("User Authenticated Successfully..!!!");
            return new CustomUserDetails(customUserDetails);
        } catch (JsonProcessingException e) {
            throw new RuntimeException(e);
        }
    }

    /**
     * Extract session token from current security context
     * This can be enhanced based on your session management strategy
     */
    private String extractSessionToken() {
        try {
            // First, try to get from request attributes (set by JWT filter)
            RequestAttributes requestAttributes = RequestContextHolder.getRequestAttributes();
            if (requestAttributes instanceof ServletRequestAttributes) {
                HttpServletRequest request = ((ServletRequestAttributes) requestAttributes).getRequest();

                // Check if JWT filter set the session token
                String sessionToken = (String) request.getAttribute("sessionToken");
                if (sessionToken != null) {
                    return sessionToken;
                }

                // Fallback: Extract from Authorization header
                String authHeader = request.getHeader("Authorization");
                if (authHeader != null && authHeader.startsWith("Bearer ")) {
                    return generateSessionIdFromToken(authHeader.substring(7));
                }

                // Fallback: HTTP session
                HttpSession session = request.getSession(false);
                if (session != null) {
                    return session.getId();
                }
            }

            return null;
        } catch (Exception e) {
            log.debug("Could not extract session token: {}", e.getMessage());
            return null;
        }
    }

    private String generateSessionIdFromToken(String token) {
        // Generate consistent session ID from JWT token
        return "session_" + Integer.toHexString(token.hashCode());
    }

    private static String encode(String value) {
        return URLEncoder.encode(value == null ? "" : value, StandardCharsets.UTF_8);
    }
}