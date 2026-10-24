package vacademy.io.auth_service.core.config;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.AuthorityUtils;
import org.springframework.security.oauth2.client.InMemoryOAuth2AuthorizedClientService;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.client.authentication.OAuth2LoginAuthenticationToken;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.oauth2.client.web.AuthenticatedPrincipalOAuth2AuthorizedClientRepository;
import org.springframework.security.oauth2.client.web.HttpSessionOAuth2AuthorizationRequestRepository;
import org.springframework.security.oauth2.client.web.OAuth2LoginAuthenticationFilter;
import org.springframework.security.oauth2.core.OAuth2AccessToken;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationRequest;
import org.springframework.security.oauth2.core.user.DefaultOAuth2User;
import vacademy.io.auth_service.feature.institute_oauth.service.InstituteOAuthClientService;
import vacademy.io.auth_service.feature.institute_oauth.service.InstituteOAuthClientService.ActiveClient;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The whole round trip through Spring's own classes, wired like ApplicationSecurityConfig: our
 * resolver starts the login and the session repository saves it, then Google's redirect lands on
 * the ONE shared callback path and Spring's OAuth2LoginAuthenticationFilter must pick the client
 * that started the login. The authorized-client store is built on the plain platform repository,
 * as Spring Boot's auto-configuration builds it in production.
 */
class InstituteOAuthLoginCallbackFlowTest {

    static final String BRAND_CLIENT_ID = InstituteAwareClientRegistrationRepositoryTest.BRAND_CLIENT_ID;

    InMemoryClientRegistrationRepository platform;
    InstituteAwareClientRegistrationRepository registrations;
    CustomAuthorizationRequestResolver resolver;
    HttpSessionOAuth2AuthorizationRequestRepository sessionRepository;
    OAuth2LoginAuthenticationFilter callbackFilter;
    AtomicReference<OAuth2LoginAuthenticationToken> exchanged;

    @BeforeEach
    void setUp() {
        InstituteOAuthClientService service = mock(InstituteOAuthClientService.class);
        when(service.findActiveClient(anyString(), anyString())).thenReturn(Optional.empty());
        when(service.findActiveClient("stemx", "google"))
                .thenReturn(Optional.of(new ActiveClient(BRAND_CLIENT_ID, "brand-secret")));

        platform = InstituteAwareClientRegistrationRepositoryTest.platformRegistrations();
        registrations = new InstituteAwareClientRegistrationRepository(platform, service);
        resolver = new CustomAuthorizationRequestResolver(registrations, "/auth-service/oauth2/authorization", null);
        sessionRepository = new HttpSessionOAuth2AuthorizationRequestRepository();

        callbackFilter = new OAuth2LoginAuthenticationFilter(registrations,
                new AuthenticatedPrincipalOAuth2AuthorizedClientRepository(new InMemoryOAuth2AuthorizedClientService(platform)),
                "/login/oauth2/code/*");
        callbackFilter.setAuthorizationRequestRepository(sessionRepository);
        exchanged = new AtomicReference<>();
        // Stands in for the code-for-token exchange with Google: echo a signed-in user.
        callbackFilter.setAuthenticationManager(authentication -> {
            OAuth2LoginAuthenticationToken login = (OAuth2LoginAuthenticationToken) authentication;
            exchanged.set(login);
            DefaultOAuth2User user = new DefaultOAuth2User(AuthorityUtils.createAuthorityList("OAUTH2_USER"),
                    Map.of("sub", "1234567890", "email", "learner@example.com"), "sub");
            OAuth2AccessToken accessToken = new OAuth2AccessToken(OAuth2AccessToken.TokenType.BEARER, "at",
                    Instant.now(), Instant.now().plusSeconds(3600));
            return new OAuth2LoginAuthenticationToken(login.getClientRegistration(), login.getAuthorizationExchange(),
                    user, user.getAuthorities(), accessToken);
        });
    }

    Authentication roundTrip(String stateJson) throws Exception {
        MockHttpSession session = new MockHttpSession();
        String state = CustomAuthorizationRequestResolverTest.state(stateJson);

        MockHttpServletRequest start = CustomAuthorizationRequestResolverTest.authorize("google", state);
        start.setSession(session);
        OAuth2AuthorizationRequest authorizationRequest = resolver.resolve(start);
        sessionRepository.saveAuthorizationRequest(authorizationRequest, start, new MockHttpServletResponse());

        MockHttpServletRequest callback = new MockHttpServletRequest("GET", "/login/oauth2/code/google");
        callback.setScheme("https");
        callback.setServerName("backend-stage.vacademy.io");
        callback.setServerPort(443);
        callback.setSecure(true);
        callback.setServletPath("/login/oauth2/code/google");
        callback.setParameter("code", "auth-code");
        callback.setParameter("state", state);
        callback.setSession(session);
        return callbackFilter.attemptAuthentication(callback, new MockHttpServletResponse());
    }

    @Test
    void brandLoginIsExchangedWithTheBrandClientOnTheSharedCallback() throws Exception {
        Authentication result = roundTrip("{\"institute_id\":\"stemx\",\"from\":\"https://learn.stemxindia.com/login\"}");

        OAuth2LoginAuthenticationToken login = exchanged.get();
        assertThat(login.getClientRegistration().getClientId()).isEqualTo(BRAND_CLIENT_ID);
        assertThat(login.getClientRegistration().getClientSecret()).isEqualTo("brand-secret");
        // Spring's exchange validator rejects the login unless these two match.
        assertThat(login.getAuthorizationExchange().getAuthorizationResponse().getRedirectUri())
                .isEqualTo(login.getAuthorizationExchange().getAuthorizationRequest().getRedirectUri())
                .isEqualTo(InstituteAwareClientRegistrationRepositoryTest.CALLBACK);

        String registrationId = ((OAuth2AuthenticationToken) result).getAuthorizedClientRegistrationId();
        assertThat(registrationId).startsWith("google@stemx@");
        assertThat(InstituteAwareClientRegistrationRepository.baseRegistrationIdOf(registrationId)).isEqualTo("google");
    }

    @Test
    void platformLoginIsExactlyAsBefore() throws Exception {
        Authentication result = roundTrip("{\"institute_id\":\"some-other-institute\",\"from\":\"https://learner.vacademy.io/login\"}");

        OAuth2LoginAuthenticationToken login = exchanged.get();
        assertThat(login.getClientRegistration()).isSameAs(platform.findByRegistrationId("google"));
        assertThat(login.getAuthorizationExchange().getAuthorizationResponse().getRedirectUri())
                .isEqualTo(login.getAuthorizationExchange().getAuthorizationRequest().getRedirectUri());
        assertThat(((OAuth2AuthenticationToken) result).getAuthorizedClientRegistrationId()).isEqualTo("google");
    }
}
