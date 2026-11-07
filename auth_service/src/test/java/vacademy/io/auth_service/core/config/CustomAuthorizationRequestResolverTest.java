package vacademy.io.auth_service.core.config;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationRequest;
import org.springframework.security.oauth2.core.endpoint.OAuth2ParameterNames;
import vacademy.io.auth_service.feature.institute_oauth.service.InstituteOAuthClientService;
import vacademy.io.auth_service.feature.institute_oauth.service.InstituteOAuthClientService.ActiveClient;
import vacademy.io.common.institute.OriginInstituteResolver;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class CustomAuthorizationRequestResolverTest {

    static final String BASE_URI = "/auth-service/oauth2/authorization";
    static final String BRAND_CLIENT_ID = InstituteAwareClientRegistrationRepositoryTest.BRAND_CLIENT_ID;

    InstituteOAuthClientService service;
    OriginInstituteResolver originResolver;
    CustomAuthorizationRequestResolver resolver;

    @BeforeEach
    void setUp() {
        service = mock(InstituteOAuthClientService.class);
        when(service.findActiveClient(anyString(), anyString())).thenReturn(Optional.empty());
        when(service.findActiveClient("stemx", "google"))
                .thenReturn(Optional.of(new ActiveClient(BRAND_CLIENT_ID, "brand-secret")));
        originResolver = mock(OriginInstituteResolver.class);
        InstituteAwareClientRegistrationRepository registrations = new InstituteAwareClientRegistrationRepository(
                InstituteAwareClientRegistrationRepositoryTest.platformRegistrations(), service);
        resolver = new CustomAuthorizationRequestResolver(registrations, BASE_URI, originResolver);
    }

    static MockHttpServletRequest authorize(String registrationId, String state) {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", BASE_URI + "/" + registrationId);
        request.setServletPath(BASE_URI + "/" + registrationId);
        if (state != null) request.setParameter("state", state);
        return request;
    }

    static String state(String json) {
        return Base64.getUrlEncoder().encodeToString(json.getBytes(StandardCharsets.UTF_8));
    }

    @Test
    void instituteWithItsOwnClientStartsWithTheBrandClient() {
        String state = state("{\"from\":\"https://learn.stemxindia.com/login\",\"institute_id\":\"stemx\"}");

        OAuth2AuthorizationRequest req = resolver.resolve(authorize("google", state));

        assertThat(req.getClientId()).isEqualTo(BRAND_CLIENT_ID);
        assertThat((String) req.getAttribute(OAuth2ParameterNames.REGISTRATION_ID)).startsWith("google@stemx@");
        assertThat(req.getRedirectUri()).isEqualTo(InstituteAwareClientRegistrationRepositoryTest.CALLBACK);
        assertThat(req.getState()).isEqualTo(state);
        assertThat(req.getScopes()).containsExactlyInAnyOrder("openid", "profile", "email");
        verify(originResolver, never()).resolveInstituteIdFromHost(anyString());
    }

    @Test
    void standardBase64StateIsReadToo() {
        String state = Base64.getEncoder().encodeToString(
                "{\"institute_id\":\"stemx\",\"from\":\"https://learn.stemxindia.com/?a=1&b=>>\"}".getBytes(StandardCharsets.UTF_8));

        assertThat(resolver.resolve(authorize("google", state)).getClientId()).isEqualTo(BRAND_CLIENT_ID);
    }

    @Test
    void institutesWithoutAClientKeepThePlatformClient() {
        String state = state("{\"from\":\"https://learner.vacademy.io/login\",\"institute_id\":\"other\"}");

        OAuth2AuthorizationRequest req = resolver.resolve(authorize("google", state));

        assertThat(req.getClientId()).isEqualTo("platform.apps.googleusercontent.com");
        assertThat((String) req.getAttribute(OAuth2ParameterNames.REGISTRATION_ID)).isEqualTo("google");
        assertThat(req.getState()).isEqualTo(state);
    }

    @Test
    void withoutInstituteIdTheFromHostIsResolvedThroughDomainRouting() {
        when(originResolver.resolveInstituteIdFromHost("learn.stemxindia.com")).thenReturn("stemx");
        String state = state("{\"from\":\"https://learn.stemxindia.com/login?x=1\"}");

        assertThat(resolver.resolve(authorize("google", state)).getClientId()).isEqualTo(BRAND_CLIENT_ID);
    }

    @Test
    void unmappedFromHostKeepsThePlatformClient() {
        String state = state("{\"from\":\"https://dash.vacademy.io/login\",\"institute_id\":\"\"}");

        assertThat(resolver.resolve(authorize("google", state)).getClientId()).isEqualTo("platform.apps.googleusercontent.com");
    }

    @Test
    void missingOrGarbageStateKeepsThePlatformClient() {
        assertThat(resolver.resolve(authorize("google", null)).getClientId()).isEqualTo("platform.apps.googleusercontent.com");
        assertThat(resolver.resolve(authorize("google", "%%%not-base64")).getClientId()).isEqualTo("platform.apps.googleusercontent.com");
        assertThat(resolver.resolve(authorize("google", state("[1,2]"))).getClientId()).isEqualTo("platform.apps.googleusercontent.com");
        assertThat(resolver.resolve(authorize("google", state("not json"))).getClientId()).isEqualTo("platform.apps.googleusercontent.com");
    }

    @Test
    void lookupFailureKeepsThePlatformClient() {
        when(service.findActiveClient("stemx", "google")).thenThrow(new RuntimeException("db down"));
        String state = state("{\"institute_id\":\"stemx\"}");

        OAuth2AuthorizationRequest req = resolver.resolve(authorize("google", state));

        assertThat(req.getClientId()).isEqualTo("platform.apps.googleusercontent.com");
        assertThat(req.getState()).isEqualTo(state);
    }

    @Test
    void otherProvidersAreUntouchedAndNeverLookedUp() {
        String state = state("{\"from\":\"https://learn.stemxindia.com/login\"}");

        assertThat(resolver.resolve(authorize("github", state)).getClientId()).isEqualTo("gh-id");
        verify(originResolver, never()).resolveInstituteIdFromHost(anyString());
        verify(service, never()).findActiveClient(anyString(), anyString());
    }

    @Test
    void nonAuthorizationPathsResolveToNull() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/auth-service/v1/login");
        request.setServletPath("/auth-service/v1/login");

        assertThat(resolver.resolve(request)).isNull();
    }

    @Test
    void plainRepositoryBehavesAsBefore() {
        CustomAuthorizationRequestResolver legacy = new CustomAuthorizationRequestResolver(
                InstituteAwareClientRegistrationRepositoryTest.platformRegistrations(), BASE_URI);
        String state = state("{\"institute_id\":\"stemx\"}");

        OAuth2AuthorizationRequest req = legacy.resolve(authorize("google", state));

        assertThat(req.getClientId()).isEqualTo("platform.apps.googleusercontent.com");
        assertThat(req.getState()).isEqualTo(state);
    }
}
