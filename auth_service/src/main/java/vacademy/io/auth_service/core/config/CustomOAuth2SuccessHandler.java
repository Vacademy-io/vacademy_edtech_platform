package vacademy.io.auth_service.core.config;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationContext;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;
import org.springframework.stereotype.Component;
import vacademy.io.auth_service.feature.auth.dto.JwtResponseDto;
import vacademy.io.auth_service.feature.auth.manager.AdminOAuth2Manager;
import vacademy.io.auth_service.feature.auth.manager.LearnerOAuth2Manager;
import vacademy.io.common.auth.service.OAuth2VendorToUserDetailService;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;

@Component
public class CustomOAuth2SuccessHandler implements AuthenticationSuccessHandler {
    private static final Logger log = LoggerFactory.getLogger(CustomOAuth2SuccessHandler.class);

    @Autowired
    private ApplicationContext applicationContext;

    @Autowired
    private OAuth2VendorToUserDetailService oAuth2VendorToUserDetailService;

    // Removed unused InstitutePolicyService field

    @Value("${teacher.portal.client.url:https://dash.vacademy.io}")
    private String adminPortalClientUrl;

    private static class DecodedState {
        String fromUrl;
        String instituteId;
        String userType; // "learner" | "admin"
        String accountType; // "signup" | "login"
    }

    @Override
    public void onAuthenticationSuccess(HttpServletRequest request,
                                        HttpServletResponse response,
                                        Authentication authentication) throws IOException {
        log.debug("OAuth2 authentication success triggered");

        String encodedState = request.getParameter("state");
        log.debug("Received state parameter: {}", encodedState != null ? "[REDACTED]" : null);

        // Base fallback values
        String fallbackUrl = adminPortalClientUrl;
        log.debug("Using fallback URL: {}", fallbackUrl);

        DecodedState state = decodeState(encodedState, fallbackUrl);
        log.info("Decoded state - fromUrl: '{}', instituteId: '{}'", state.fromUrl, state.instituteId);

        String redirectUrl = state.fromUrl != null ? state.fromUrl : fallbackUrl;
        String instituteId = state.instituteId;

        if (redirectUrl == null) {
            log.error("Redirect URL is null after decoding state. Aborting process.");
            return;
        }

        log.debug("Decoded state - fromUrl: {}, instituteId: {}, userType: {}, accountType: {}",
                  state.fromUrl, state.instituteId, state.userType, state.accountType);
        log.debug("Using redirect URL: {}", redirectUrl);

        // Derive user type and account type with fallback logic
        String derivedUserType = deriveUserType(state.userType, redirectUrl);
        String derivedAccountType = deriveAccountType(state.accountType, redirectUrl);

        log.debug("Derived user type: {}, account type: {}", derivedUserType, derivedAccountType);

        if (!(authentication instanceof OAuth2AuthenticationToken oauthToken)) {
            log.error("Authentication object is not an instance of OAuth2AuthenticationToken. It is: {}",
                    authentication.getClass().getName());
            sendErrorRedirect(response, redirectUrl, "invalid_authentication_type");
            return;
        }

        log.debug("Processing OAuth2 user for provider: {}", oauthToken.getAuthorizedClientRegistrationId());
        processOAuth2User(oauthToken, redirectUrl, response, encodedState, instituteId, derivedUserType, derivedAccountType);
    }

    private DecodedState decodeState(String encodedState, String fallbackUrl) {
        log.debug("Attempting to decode state parameter...");
        DecodedState result = new DecodedState();
        result.fromUrl = fallbackUrl; // Set default fallback URL

        if (encodedState == null || encodedState.trim().isEmpty()) {
            log.warn("State parameter is null or empty. Using fallback URL: {}", fallbackUrl);
            return result;
        }

        try {
            log.debug("Decoding Base64 encoded state: {}", encodedState);
            byte[] decodedBytes;
            
            // Try URL-safe Base64 decoding first, then fall back to standard Base64
            try {
                decodedBytes = Base64.getUrlDecoder().decode(encodedState);
                log.debug("Successfully decoded using URL-safe Base64 decoder");
            } catch (IllegalArgumentException e) {
                log.debug("URL-safe Base64 decoding failed, trying standard Base64 decoder: {}", e.getMessage());
                decodedBytes = Base64.getDecoder().decode(encodedState);
                log.debug("Successfully decoded using standard Base64 decoder");
            }
            
            String decodedJson = new String(decodedBytes, StandardCharsets.UTF_8);
            log.info("Successfully decoded state to JSON: {}", decodedJson);

            ObjectMapper mapper = new ObjectMapper();
            JsonNode stateNode = mapper.readTree(decodedJson);

            if (stateNode.has("from")) {
                String fromUrl = stateNode.get("from").asText();
                if (fromUrl != null && (fromUrl.startsWith("http://") || fromUrl.startsWith("https://"))) {
                    result.fromUrl = fromUrl;
                    log.debug("Extracted 'from' URL from state: {}", result.fromUrl);
                } else {
                    log.warn("Invalid 'from' URL found in state: {}. Using fallback.", fromUrl);
                }
            } else {
                log.debug("'from' attribute not found in state. Will use fallback URL.");
            }

            if (stateNode.has("institute_id")) {
                result.instituteId = stateNode.get("institute_id").asText(null);
                log.debug("Extracted 'institute_id' from state: {}", result.instituteId);
            } else {
                log.debug("'institute_id' attribute not found in state.");
            }

            // Extract user_type and account_type (accept snake_case or camelCase)
            if (stateNode.has("user_type")) {
                result.userType = stateNode.get("user_type").asText(null);
            } else if (stateNode.has("userType")) {
                result.userType = stateNode.get("userType").asText(null);
            }

            if (stateNode.has("account_type")) {
                result.accountType = stateNode.get("account_type").asText(null);
            } else if (stateNode.has("accountType")) {
                result.accountType = stateNode.get("accountType").asText(null);
            }

        } catch (Exception e) {
            log.warn("Failed to decode or parse the state parameter: '{}'. Error: {}. Using fallback URL.", encodedState, e.getMessage());
        }

        log.debug("Finished decoding state. FromURL: '{}', InstituteID: '{}'", result.fromUrl, result.instituteId);
        return result;
    }

    private void processOAuth2User(OAuth2AuthenticationToken oauthToken, String redirectUrl,
            HttpServletResponse response, String encodedState,String instituteId, String userType, String accountType) throws IOException {
        log.debug("Starting OAuth2 user processing for account type: {}", accountType);
        try {
            OAuth2User oauthUser = oauthToken.getPrincipal();
            Map<String, Object> attributes = oauthUser.getAttributes();
            // An institute's own client ("google@<institute>@<fp>") is still Google: same vendor rows and linking.
            String provider = InstituteAwareClientRegistrationRepository.baseRegistrationIdOf(
                    oauthToken.getAuthorizedClientRegistrationId());
            log.debug("OAuth2 user attributes count: {}", attributes.size());

            UserInfo userInfo = extractUserInfo(attributes, provider, response, redirectUrl,instituteId);
            if (userInfo == null)
                return;

            String email = userInfo.email;
            log.debug("Initial email from OAuth2: {}", email != null ? "[EMAIL]" : null);
            log.debug("Provider ID: {}", userInfo.providerId);

            if (email == null || userInfo.providerId.equalsIgnoreCase("github")) {
                email = oAuth2VendorToUserDetailService.getEmailByProviderIdAndSubject(userInfo.providerId,
                        userInfo.sub,userInfo.email);
                log.debug("Retrieved email from service: {}", email != null ? "[EMAIL]" : null);
            }
            boolean isEmailVerified = (email != null);
            log.debug("Email verified: {}", isEmailVerified);

            // Route by account type
            if ("signup".equalsIgnoreCase(accountType)) {
                log.debug("Routing to signup flow for user type: {}", userType);
                handleSignupFlow(userInfo, redirectUrl, response, encodedState, isEmailVerified, userType);
                return;
            }

            // Handle login flow
            handleLoginFlow(userInfo, redirectUrl, response, encodedState, isEmailVerified, userType);

        } catch (Exception e) {
            log.error("An unexpected error occurred during OAuth2 user processing.", e);
            sendErrorRedirect(response, redirectUrl, "internal_processing_error");
            return;
        }
    }

    private void handleSignupFlow(UserInfo userInfo, String redirectUrl, HttpServletResponse response,
            String encodedState, boolean isEmailVerified, String userType) throws IOException {
        log.debug("Handling signup flow for user: {} with userType: {}", userInfo.name, userType);

        String email = userInfo.email;
        if (email == null || userInfo.providerId.equalsIgnoreCase("github")) {
            email = oAuth2VendorToUserDetailService.getEmailByProviderIdAndSubject(userInfo.providerId, userInfo.sub, userInfo.email);
            log.debug("Retrieved email for signup: {}", email != null ? "[EMAIL]" : null);
        }

        // For admin signup, always return user data to frontend
        if (!"learner".equalsIgnoreCase(userType)) {
            log.debug("Processing admin signup flow");

            returnUserDataToFrontend(response, redirectUrl, userInfo, encodedState, isEmailVerified, false);
            oAuth2VendorToUserDetailService.saveOrUpdateOAuth2VendorToUserDetail(userInfo.providerId, email, userInfo.sub);
            log.info("Saved/Updated OAuth vendor details for admin user: {}", email);
            return;
        }

        // For learner signup, try to get existing user token first
        log.debug("Processing learner signup flow");
        JwtResponseDto jwtResponseDto = getTokenByUserTypeAndUserEmail(userType, userInfo.name, email, userInfo.instituteId, userInfo.sub, userInfo.providerId);
        log.debug("Attempting to get token for learner signup, email: {}", email != null ? "[EMAIL]" : null);

        if (jwtResponseDto != null) {
            // User found, redirect with tokens
            log.debug("Learner user found, redirecting with tokens");
            redirectWithTokens(response, redirectUrl, jwtResponseDto);
        } else {
            // New learner user, return user data for registration
            log.debug("New learner user, returning user data for registration");
            returnUserDataToFrontend(response, redirectUrl, userInfo, encodedState, isEmailVerified, false);
            oAuth2VendorToUserDetailService.saveOrUpdateOAuth2VendorToUserDetail(userInfo.providerId, email, userInfo.sub);
            log.info("Saved/Updated OAuth vendor details for new learner: {}", email);
        }
    }

    private void handleLoginFlow(UserInfo userInfo, String redirectUrl, HttpServletResponse response,
            String encodedState, boolean isEmailVerified, String userType) throws IOException {
        log.debug("Handling login flow for user: {} with userType: {}", userInfo.name, userType);

        String email = userInfo.email;
        if (email == null || userInfo.providerId.equalsIgnoreCase("github")) {
            log.debug("Re-fetching email for login flow for sub: {}", userInfo.sub);
            email = oAuth2VendorToUserDetailService.getEmailByProviderIdAndSubject(userInfo.providerId, userInfo.sub, userInfo.email);
        }
        log.info("Attempting login for user email: {}", email);

        // First try to login the user by email
        JwtResponseDto jwtResponseDto = getTokenByUserTypeAndUserEmail(userType, userInfo.name, email,
                userInfo.instituteId, userInfo.sub, userInfo.providerId);
        log.debug("Attempted to get token for login, result: {}", jwtResponseDto != null ? "success" : "user not found");

        if (jwtResponseDto != null) {
            log.info("Successfully generated tokens for user '{}'. Redirecting with tokens.", email);
            redirectWithTokens(response, redirectUrl, jwtResponseDto);
        } else {
            // Attempt guarded auto-signup for learners only when we have instituteId and email
            boolean isLearner = "learner".equalsIgnoreCase(userType);
            boolean hasInstitute = userInfo.instituteId != null && !userInfo.instituteId.isBlank();
            boolean hasEmail = email != null;
            log.debug("Auto-signup gating conditions -> isLearner={}, hasInstituteId={}, hasEmail={}, provider={}, subjectId={}",
                    isLearner, hasInstitute, hasEmail, userInfo.providerId, userInfo.sub);
            if ("learner".equalsIgnoreCase(userType)
                    && userInfo.instituteId != null && !userInfo.instituteId.isBlank()
                    && email != null) {
                try {
                    log.info("User not found. Attempting auto-signup for learner as per institute settings. email={} instituteId={} provider={} subjectId={}",
                            email, userInfo.instituteId, userInfo.providerId, userInfo.sub);
                    JwtResponseDto autoSignupJwt = getLearnerOAuth2Manager().createUserAndLogin(
                            userInfo.name,
                            email,
                            userInfo.instituteId,
                            userInfo.sub,
                            userInfo.providerId
                    );
                    if (autoSignupJwt != null) {
                        log.info("Auto-signup succeeded for learner '{}'. Redirecting with tokens.", email);
                        redirectWithTokens(response, redirectUrl, autoSignupJwt);
                        return;
                    } else {
                        log.warn("Auto-signup skipped or not allowed by policy for learner '{}'. Falling back to signup handoff.", email);
                    }
                } catch (Exception ex) {
                    log.warn("Auto-signup failed for learner '{}': {}. Falling back to signup handoff.", email, ex.getMessage());
                    log.debug("Auto-signup exception stack:", ex);
                }
            }
            log.warn("Login failed for user '{}' - user not found or auto-signup not performed. Redirecting to signup.", email);
            returnUserDataToFrontend(response, redirectUrl, userInfo, encodedState, isEmailVerified, true);
        }
    }

    private void returnUserDataToFrontend(HttpServletResponse response, String redirectUrl, UserInfo userInfo,
            String encodedState, boolean isEmailVerified, boolean hasError) throws IOException {
        log.info("Redirecting with user handoff to base URL: {} hasError={}", redirectUrl, hasError);
        log.debug("Preparing user data for frontend return, hasError: {}", hasError);

        if (userInfo == null) {
            log.error("UserInfo is null, cannot return user data to frontend");
            sendErrorRedirect(response, redirectUrl, "user_info_null");
            return;
        }

        if (redirectUrl == null || redirectUrl.trim().isEmpty()) {
            log.error("Redirect URL is null or empty, cannot redirect user");
            sendErrorRedirect(response, redirectUrl, "invalid_redirect_url");
            return;
        }

        String email = userInfo.email;
        if (email == null || userInfo.providerId.equalsIgnoreCase("github")) {
            email = oAuth2VendorToUserDetailService.getEmailByProviderIdAndSubject(userInfo.providerId, userInfo.sub, userInfo.email);
            log.debug("Retrieved email for frontend return: {}", email != null ? "[EMAIL]" : null);
        }

        String userJson;
        if (email != null) {
            userJson = String.format(
                    "{\"name\":\"%s\", \"email\":\"%s\", \"profile\":\"%s\", \"sub\":\"%s\", \"provider\":\"%s\"}",
                    userInfo.name, email, userInfo.picture, userInfo.sub, userInfo.providerId);
        } else {
            userJson = String.format(
                    "{\"name\":\"%s\", \"profile\":\"%s\", \"sub\":\"%s\", \"provider\":\"%s\"}",
                    userInfo.name, userInfo.picture, userInfo.sub, userInfo.providerId);
        }
        log.debug("Created user JSON for frontend, length: {}", userJson.length());
        log.debug("Constructed user JSON for frontend: {}", userJson);

        String encodedUserInfo = Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(userJson.getBytes(StandardCharsets.UTF_8));
        log.debug("Encoded user info for frontend return, length: {}", encodedUserInfo.length());

        String separator = redirectUrl.contains("?") ? "&" : "?";
        String redirectWithParams = String.format(
                "%s%ssignupData=%s&state=%s&emailVerified=%s%s",
                redirectUrl,
                separator,
                URLEncoder.encode(encodedUserInfo, StandardCharsets.UTF_8),
                URLEncoder.encode(encodedState != null ? encodedState : "", StandardCharsets.UTF_8),
                URLEncoder.encode(String.valueOf(isEmailVerified), StandardCharsets.UTF_8),
                hasError ? "&error=true" : "");
        log.debug("Frontend redirect URL prepared, will redirect with {} params", hasError ? "error=true" : "no error");

        log.info("Redirecting to frontend with user data: {}", redirectWithParams);
        response.sendRedirect(redirectWithParams);
    }

    private UserInfo extractUserInfo(Map<String, Object> attributes, String provider, HttpServletResponse response,
                                     String redirectUrl, String instituteId) throws IOException {
        log.debug("Extracting user info for provider: {}", provider);
        String email = null;
        String name = null;
        String picture = null;
        String sub = null;

        switch (provider) {
            case "google":
                email = (String) attributes.get("email");
                name = (String) attributes.get("name");
                picture = (String) attributes.get("picture");
                sub = (String) attributes.get("sub");
                log.info("Extracted from Google: Email='{}', Name='{}', Sub='{}'", email, name, sub);
                break;
            case "github":
                email = (String) attributes.get("email");
                name = (String) attributes.get("name");
                if (name == null) {
                    name = (String) attributes.get("login");
                    log.debug("GitHub name is null, using login '{}' instead.", name);
                }
                picture = (String) attributes.get("avatar_url");
                sub = String.valueOf(attributes.get("id"));
                log.info("Extracted from GitHub: Email='{}', Name='{}', Sub='{}'", email, name, sub);
                break;
            default:
                log.error("Unsupported OAuth2 provider detected: {}", provider);
                sendErrorRedirect(response, redirectUrl, "unsupported_provider");
                return null;
        }
        return new UserInfo(email, name, picture, provider, sub, instituteId);
    }

    private record UserInfo(String email, String name, String picture, String providerId, String sub,
                            String instituteId) {
    }

    private void redirectWithTokens(HttpServletResponse response, String redirectUrl, JwtResponseDto jwtResponseDto)
            throws IOException {
        // Session limit exceeded — redirect with error so frontend can show the popup
        if (jwtResponseDto.isSessionLimitExceeded()) {
            log.info("Session limit exceeded during OAuth2 login. Redirecting with session_limit_exceeded flag.");
            String separator = redirectUrl.contains("?") ? "&" : "?";
            String limitRedirectUrl = String.format(
                    "%s%ssession_limit_exceeded=true",
                    redirectUrl, separator);
            response.sendRedirect(limitRedirectUrl);
            return;
        }

        log.info("Redirecting after login success to base URL: {} (tokens omitted)", redirectUrl);
        String separator = redirectUrl.contains("?") ? "&" : "?";
        String tokenizedRedirectUrl = String.format(
                "%s%saccessToken=%s&refreshToken=%s",
                redirectUrl,
                separator,
                URLEncoder.encode(jwtResponseDto.getAccessToken(), StandardCharsets.UTF_8),
                URLEncoder.encode(jwtResponseDto.getRefreshToken(), StandardCharsets.UTF_8));

        log.info("Redirecting to: {}", tokenizedRedirectUrl);
        response.sendRedirect(tokenizedRedirectUrl);
    }

    private void sendErrorRedirect(HttpServletResponse response, String baseUrl, String errorMessage)
            throws IOException {
        log.warn("Redirecting with error to base URL: {} message={} ", baseUrl, errorMessage);
        if (response.isCommitted()) {
            log.warn("Cannot send error redirect because response is already committed. Error message was: {}", errorMessage);
            return;
        }
        String redirectUrl = baseUrl;
        if (!redirectUrl.contains("error=true")) {
            redirectUrl += redirectUrl.contains("?") ? "&error=true" : "?error=true";
        }
        redirectUrl += "&message=" + URLEncoder.encode(errorMessage, StandardCharsets.UTF_8);
        log.warn("Sending error redirect to: {}", redirectUrl);
        response.sendRedirect(redirectUrl);
    }

    private JwtResponseDto getTokenByUserTypeAndUserEmail(String userType, String fullName, String email,
            String instituteId, String subjectId, String vendorId) {

                if (email == null) {
                    log.warn("Cannot get token because user email is null.");
                    return null;
                }
        try {
            if ("learner".equalsIgnoreCase(userType)) {
                return getLearnerOAuth2Manager().loginUserByEmail(fullName, email, instituteId, subjectId, vendorId);
            } else {
                return getAdminOAuth2Manager().loginUserByEmail(email);
            }
            
        } catch (Exception e) {
            log.error("Failed to generate token for user '{}'. Exception: {}", email, e.getMessage());
            // It's often better to log the full stack trace for debugging
            log.debug("Full stack trace for token generation failure:", e);
        }
        return null;
    }

    // Backward compatibility method
    private JwtResponseDto getTokenByUserTypeAndUserEmail(String userType, String fullName, String email,
            String instituteId) {
        return getTokenByUserTypeAndUserEmail(userType, fullName, email, instituteId, null, null);
    }

    // Lazy initialization using ApplicationContext to break potential circular dependencies
    private LearnerOAuth2Manager getLearnerOAuth2Manager() {
        return applicationContext.getBean(LearnerOAuth2Manager.class);
    }

    private AdminOAuth2Manager getAdminOAuth2Manager() {
        return applicationContext.getBean(AdminOAuth2Manager.class);
    }

    private String deriveUserType(String userType, String url) {
        // First try to normalize the explicit user type from state
        String normalized = normalizeUserType(userType);
        if (normalized != null) {
            return normalized;
        }
        // Fall back to URL-based derivation
        return deriveUserTypeFromUrl(url);
    }

    private String deriveAccountType(String accountType, String url) {
        // First try to normalize the explicit account type from state
        String normalized = normalizeAccountType(accountType);
        if (normalized != null) {
            return normalized;
        }
        // Fall back to URL-based derivation
        return deriveAccountTypeFromUrl(url);
    }

    private String deriveUserTypeFromUrl(String url) {
        if (url == null) return "admin";
        return url.toLowerCase().contains("learner") ? "learner" : "admin";
    }

    private String deriveAccountTypeFromUrl(String url) {
        if (url == null) return "login";
        return url.toLowerCase().contains("signup") ? "signup" : "login";
    }

    private String normalizeUserType(String userType) {
        if (userType == null) return null;
        String normalized = userType.trim().toLowerCase();
        if ("learner".equals(normalized) || "admin".equals(normalized)) return normalized;
        return null;
    }

    private String normalizeAccountType(String accountType) {
        if (accountType == null) return null;
        String normalized = accountType.trim().toLowerCase();
        if ("signup".equals(normalized) || "login".equals(normalized)) return normalized;
        return null;
    }
}