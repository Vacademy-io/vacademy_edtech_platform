package vacademy.io.auth_service.core.config;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.web.DefaultOAuth2AuthorizationRequestResolver;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestResolver;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationRequest;
import org.springframework.security.oauth2.core.endpoint.OAuth2ParameterNames;
import vacademy.io.auth_service.feature.institute_oauth.service.InstituteOAuthClientService;
import vacademy.io.common.institute.OriginInstituteResolver;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

public class CustomAuthorizationRequestResolver implements OAuth2AuthorizationRequestResolver {

    private static final Logger log = LoggerFactory.getLogger(CustomAuthorizationRequestResolver.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final OAuth2AuthorizationRequestResolver defaultResolver;
    private final InstituteAwareClientRegistrationRepository instituteRegistrations;
    private final OriginInstituteResolver originInstituteResolver;

    public CustomAuthorizationRequestResolver(ClientRegistrationRepository repo, String baseUri) {
        this(repo, baseUri, null);
    }

    /**
     * With an {@link InstituteAwareClientRegistrationRepository}, a login for an institute that has
     * its own OAuth client starts with that client, so Google's sign-in screen shows the brand's
     * name. The institute comes from the FE's {@code state} ({@code institute_id}), else from the
     * host of its {@code from} URL via domain routing. Every failure keeps the platform client.
     */
    public CustomAuthorizationRequestResolver(ClientRegistrationRepository repo, String baseUri,
                                              OriginInstituteResolver originInstituteResolver) {
        DefaultOAuth2AuthorizationRequestResolver resolver = new DefaultOAuth2AuthorizationRequestResolver(repo, baseUri);
        resolver.setAuthorizationRequestCustomizer(this::customizeAuthorizationRequest);
        this.defaultResolver = resolver;
        this.instituteRegistrations = repo instanceof InstituteAwareClientRegistrationRepository aware ? aware : null;
        this.originInstituteResolver = originInstituteResolver;
    }

    private void customizeAuthorizationRequest(OAuth2AuthorizationRequest.Builder builder) {
        // Any additional customization can go here
    }

    @Override
    public OAuth2AuthorizationRequest resolve(HttpServletRequest request) {
        OAuth2AuthorizationRequest req = defaultResolver.resolve(request);
        return customizeState(request, useInstituteClient(request, req));
    }

    @Override
    public OAuth2AuthorizationRequest resolve(HttpServletRequest request, String clientRegistrationId) {
        OAuth2AuthorizationRequest req = defaultResolver.resolve(request, clientRegistrationId);
        return customizeState(request, useInstituteClient(request, req));
    }

    private OAuth2AuthorizationRequest useInstituteClient(HttpServletRequest request, OAuth2AuthorizationRequest req) {
        if (req == null || instituteRegistrations == null) return req;
        try {
            String registrationId = req.getAttribute(OAuth2ParameterNames.REGISTRATION_ID);
            if (!InstituteOAuthClientService.isSupportedProvider(registrationId)) return req;
            String instituteId = instituteIdFor(request);
            String instituteRegistrationId = instituteRegistrations.instituteRegistrationId(registrationId, instituteId);
            if (instituteRegistrationId == null) return req;
            OAuth2AuthorizationRequest instituteReq = defaultResolver.resolve(request, instituteRegistrationId);
            if (instituteReq == null) return req;
            log.info("OAuth2 login for institute {} uses its own {} client", instituteId, registrationId);
            return instituteReq;
        } catch (Exception e) {
            log.warn("Could not apply institute OAuth client; using the platform client: {}", e.getMessage());
            return req;
        }
    }

    private String instituteIdFor(HttpServletRequest request) {
        JsonNode state = decodeState(request.getParameter("state"));
        if (state == null) return null;
        String instituteId = state.path("institute_id").asText(null);
        if (instituteId != null && !instituteId.isBlank()) return instituteId;
        if (originInstituteResolver == null) return null;
        String host = hostOf(state.path("from").asText(null));
        return host == null ? null : originInstituteResolver.resolveInstituteIdFromHost(host);
    }

    /** The FE's state is base64 (URL-safe or standard) JSON; anything else yields null. */
    private static JsonNode decodeState(String encodedState) {
        if (encodedState == null || encodedState.isBlank()) return null;
        byte[] bytes;
        try {
            bytes = Base64.getUrlDecoder().decode(encodedState);
        } catch (IllegalArgumentException e) {
            try {
                bytes = Base64.getDecoder().decode(encodedState);
            } catch (IllegalArgumentException e2) {
                return null;
            }
        }
        try {
            JsonNode node = MAPPER.readTree(new String(bytes, StandardCharsets.UTF_8));
            return node != null && node.isObject() ? node : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static String hostOf(String url) {
        if (url == null || url.isBlank()) return null;
        try {
            return URI.create(url.trim()).getHost();
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private OAuth2AuthorizationRequest customizeState(HttpServletRequest request, OAuth2AuthorizationRequest req) {
        if (req == null) return null;
        String customState = request.getParameter("state");
        if (customState != null) {
            return OAuth2AuthorizationRequest.from(req)
                    .state(customState)
                    .build();
        }
        return req;
    }
}
