package vacademy.io.auth_service.core.config;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.config.oauth2.client.CommonOAuth2Provider;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import vacademy.io.auth_service.feature.institute_oauth.service.InstituteOAuthClientService;
import vacademy.io.auth_service.feature.institute_oauth.service.InstituteOAuthClientService.ActiveClient;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class InstituteAwareClientRegistrationRepositoryTest {

    static final String CALLBACK = "https://backend-stage.vacademy.io/login/oauth2/code/google";
    static final String BRAND_CLIENT_ID = "581140538323-brand.apps.googleusercontent.com";

    InstituteOAuthClientService service;
    InstituteAwareClientRegistrationRepository repo;

    static InMemoryClientRegistrationRepository platformRegistrations() {
        ClientRegistration google = CommonOAuth2Provider.GOOGLE.getBuilder("google")
                .clientId("platform.apps.googleusercontent.com")
                .clientSecret("platform-secret")
                .scope("openid", "profile", "email")
                .redirectUri(CALLBACK)
                .build();
        ClientRegistration github = CommonOAuth2Provider.GITHUB.getBuilder("github")
                .clientId("gh-id")
                .clientSecret("gh-secret")
                .build();
        return new InMemoryClientRegistrationRepository(google, github);
    }

    @BeforeEach
    void setUp() {
        service = mock(InstituteOAuthClientService.class);
        when(service.findActiveClient(anyString(), anyString())).thenReturn(Optional.empty());
        when(service.findActiveClient("stemx", "google"))
                .thenReturn(Optional.of(new ActiveClient(BRAND_CLIENT_ID, "brand-secret")));
        repo = new InstituteAwareClientRegistrationRepository(platformRegistrations(), service);
    }

    @Test
    void platformRegistrationsPassThroughUnchanged() {
        assertThat(repo.findByRegistrationId("google").getClientId()).isEqualTo("platform.apps.googleusercontent.com");
        assertThat(repo.findByRegistrationId("github").getClientId()).isEqualTo("gh-id");
        assertThat(repo.findByRegistrationId("nope")).isNull();
    }

    @Test
    void instituteRegistrationRoundTripsWithBrandCredentialsAndPlatformCallback() {
        String id = repo.instituteRegistrationId("google", "stemx");
        assertThat(id).startsWith("google@stemx@").hasSize("google@stemx@".length() + 12);

        ClientRegistration brand = repo.findByRegistrationId(id);
        ClientRegistration platform = repo.findByRegistrationId("google");
        assertThat(brand.getRegistrationId()).isEqualTo(id);
        assertThat(brand.getClientId()).isEqualTo(BRAND_CLIENT_ID);
        assertThat(brand.getClientSecret()).isEqualTo("brand-secret");
        assertThat(brand.getRedirectUri()).isEqualTo(CALLBACK);
        assertThat(brand.getScopes()).isEqualTo(platform.getScopes());
        assertThat(brand.getProviderDetails().getAuthorizationUri())
                .isEqualTo(platform.getProviderDetails().getAuthorizationUri());
        assertThat(brand.getProviderDetails().getJwkSetUri()).isEqualTo(platform.getProviderDetails().getJwkSetUri());
    }

    @Test
    void templatedPlatformCallbackKeepsTheBaseRegistrationIdInThePath() {
        ClientRegistration templated = CommonOAuth2Provider.GOOGLE.getBuilder("google")
                .clientId("platform.apps.googleusercontent.com").clientSecret("s").build();
        repo = new InstituteAwareClientRegistrationRepository(new InMemoryClientRegistrationRepository(templated), service);

        ClientRegistration brand = repo.findByRegistrationId(repo.instituteRegistrationId("google", "stemx"));

        assertThat(brand.getRedirectUri()).isEqualTo("{baseUrl}/{action}/oauth2/code/google");
    }

    @Test
    void noClientOrNotABaseIdKeepsThePlatformRegistration() {
        assertThat(repo.instituteRegistrationId("google", "other-institute")).isNull();
        assertThat(repo.instituteRegistrationId("google", null)).isNull();
        assertThat(repo.instituteRegistrationId("google", " ")).isNull();
        assertThat(repo.instituteRegistrationId("google", "bad@id")).isNull();
        assertThat(repo.instituteRegistrationId("unknown", "stemx")).isNull();
        assertThat(repo.instituteRegistrationId(repo.instituteRegistrationId("google", "stemx"), "stemx")).isNull();
        assertThat(repo.instituteRegistrationId(null, "stemx")).isNull();
    }

    @Test
    void swappedClientIdRefusesALoginStartedWithTheOldOne() {
        String oldId = repo.instituteRegistrationId("google", "stemx");
        when(service.findActiveClient("stemx", "google"))
                .thenReturn(Optional.of(new ActiveClient("999-new.apps.googleusercontent.com", "new-secret")));

        assertThat(repo.findByRegistrationId(oldId)).isNull();
        String newId = repo.instituteRegistrationId("google", "stemx");
        assertThat(newId).isNotEqualTo(oldId);
        assertThat(repo.findByRegistrationId(newId).getClientId()).isEqualTo("999-new.apps.googleusercontent.com");
    }

    @Test
    void disabledOrRemovedClientRefusesTheCallback() {
        String id = repo.instituteRegistrationId("google", "stemx");
        when(service.findActiveClient("stemx", "google")).thenReturn(Optional.empty());

        assertThat(repo.findByRegistrationId(id)).isNull();
    }

    @Test
    void malformedInstituteIdsResolveToNothing() {
        assertThat(repo.findByRegistrationId("google@")).isNull();
        assertThat(repo.findByRegistrationId("google@stemx")).isNull();
        assertThat(repo.findByRegistrationId("google@@abc")).isNull();
        assertThat(repo.findByRegistrationId("google@stemx@")).isNull();
        assertThat(repo.findByRegistrationId("google@stemx@abc@x")).isNull();
        assertThat(repo.findByRegistrationId("nope@stemx@abc")).isNull();
    }

    @Test
    void baseRegistrationIdOfStripsTheInstitutePart() {
        assertThat(InstituteAwareClientRegistrationRepository.baseRegistrationIdOf("google@stemx@0123456789ab")).isEqualTo("google");
        assertThat(InstituteAwareClientRegistrationRepository.baseRegistrationIdOf("google")).isEqualTo("google");
        assertThat(InstituteAwareClientRegistrationRepository.baseRegistrationIdOf("github")).isEqualTo("github");
        assertThat(InstituteAwareClientRegistrationRepository.baseRegistrationIdOf(null)).isNull();
    }

    @Test
    void iteratesOnlyThePlatformRegistrations() {
        List<String> ids = new ArrayList<>();
        repo.forEach(r -> ids.add(r.getRegistrationId()));
        assertThat(ids).containsExactlyInAnyOrder("google", "github");
    }
}
