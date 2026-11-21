package vacademy.io.auth_service.feature.institute_oauth.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.auth_service.feature.institute_oauth.entity.InstituteOAuthClient;
import vacademy.io.auth_service.feature.institute_oauth.repository.InstituteOAuthClientRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Base64;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class InstituteOAuthClientServiceTest {

    static final String KEY = Base64.getEncoder().encodeToString(new byte[] {
            1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
            17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32 });
    static final String CLIENT_ID = "581140538323-brand.apps.googleusercontent.com";

    InstituteOAuthClientRepository repository;
    OAuthClientSecretCipher cipher;
    InstituteOAuthClientService service;

    @BeforeEach
    void setUp() {
        repository = mock(InstituteOAuthClientRepository.class);
        when(repository.findByInstituteIdAndProvider(anyString(), anyString())).thenReturn(Optional.empty());
        when(repository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        cipher = new OAuthClientSecretCipher(KEY);
        service = new InstituteOAuthClientService(repository, cipher);
    }

    InstituteOAuthClient row(boolean enabled, String encryptedSecret) {
        return InstituteOAuthClient.builder().instituteId("stemx").provider("google")
                .clientId(CLIENT_ID).clientSecretEncrypted(encryptedSecret).enabled(enabled).build();
    }

    @Test
    void activeClientIsDecryptedAndCached() {
        when(repository.findByInstituteIdAndProvider("stemx", "google"))
                .thenReturn(Optional.of(row(true, cipher.encrypt("brand-secret"))));

        assertThat(service.findActiveClient("stemx", "google"))
                .contains(new InstituteOAuthClientService.ActiveClient(CLIENT_ID, "brand-secret"));
        service.findActiveClient("stemx", "google");
        verify(repository, times(1)).findByInstituteIdAndProvider("stemx", "google");
    }

    @Test
    void missesAreCachedToo() {
        assertThat(service.findActiveClient("other", "google")).isEmpty();
        assertThat(service.findActiveClient("other", "google")).isEmpty();
        verify(repository, times(1)).findByInstituteIdAndProvider("other", "google");
    }

    @Test
    void disabledOrUndecryptableRowsAreNoClient() {
        when(repository.findByInstituteIdAndProvider("stemx", "google")).thenReturn(Optional.of(row(false, cipher.encrypt("s"))));
        assertThat(service.findActiveClient("stemx", "google")).isEmpty();

        when(repository.findByInstituteIdAndProvider("hand-typed", "google")).thenReturn(Optional.of(row(true, "GOCSPX-plaintext")));
        assertThat(service.findActiveClient("hand-typed", "google")).isEmpty();
    }

    @Test
    void lookupFailuresFailOpenAndAreNotCached() {
        when(repository.findByInstituteIdAndProvider("stemx", "google")).thenThrow(new RuntimeException("db down"));

        assertThat(service.findActiveClient("stemx", "google")).isEmpty();
        assertThat(service.findActiveClient("stemx", "google")).isEmpty();
        verify(repository, times(2)).findByInstituteIdAndProvider("stemx", "google");
    }

    @Test
    void withoutAKeyOrForOtherProvidersNothingIsLookedUp() {
        InstituteOAuthClientService keyless = new InstituteOAuthClientService(repository, new OAuthClientSecretCipher(""));

        assertThat(keyless.findActiveClient("stemx", "google")).isEmpty();
        assertThat(service.findActiveClient("stemx", "github")).isEmpty();
        assertThat(service.findActiveClient(null, "google")).isEmpty();
        verify(repository, never()).findByInstituteIdAndProvider(anyString(), anyString());
    }

    @Test
    void saveEncryptsTheSecretAndEvictsTheCachedMiss() {
        assertThat(service.findActiveClient("stemx", "google")).isEmpty();

        InstituteOAuthClient saved = service.save("stemx", "google", " " + CLIENT_ID + " ", " brand-secret ", null, "admin-1");

        assertThat(saved.getClientId()).isEqualTo(CLIENT_ID);
        assertThat(saved.isEnabled()).isTrue();
        assertThat(saved.getUpdatedBy()).isEqualTo("admin-1");
        assertThat(saved.getClientSecretEncrypted()).isNotEqualTo("brand-secret");
        assertThat(cipher.decryptOrNull(saved.getClientSecretEncrypted())).isEqualTo("brand-secret");

        when(repository.findByInstituteIdAndProvider("stemx", "google")).thenReturn(Optional.of(saved));
        assertThat(service.findActiveClient("stemx", "google")).isPresent();
    }

    @Test
    void updateWithoutASecretKeepsTheStoredOne() {
        InstituteOAuthClient existing = row(true, cipher.encrypt("old-secret"));
        String storedSecret = existing.getClientSecretEncrypted();
        when(repository.findByInstituteIdAndProvider("stemx", "google")).thenReturn(Optional.of(existing));

        InstituteOAuthClient saved = service.save("stemx", "google", CLIENT_ID, null, false, "admin-1");

        assertThat(saved.getClientSecretEncrypted()).isEqualTo(storedSecret);
        assertThat(saved.isEnabled()).isFalse();
    }

    @Test
    void saveRejectsBadInput() {
        assertThatThrownBy(() -> service.save("stemx", "google", "not-a-google-id", "s", true, "a"))
                .isInstanceOf(VacademyException.class);
        assertThatThrownBy(() -> service.save("stemx", "google", CLIENT_ID, " ", true, "a"))
                .isInstanceOf(VacademyException.class);
        assertThatThrownBy(() -> service.save("stemx", "facebook", CLIENT_ID, "s", true, "a"))
                .isInstanceOf(VacademyException.class);
        assertThatThrownBy(() -> service.save(" ", "google", CLIENT_ID, "s", true, "a"))
                .isInstanceOf(VacademyException.class);
        assertThatThrownBy(() -> new InstituteOAuthClientService(repository, new OAuthClientSecretCipher(""))
                .save("stemx", "google", CLIENT_ID, "s", true, "a"))
                .isInstanceOf(VacademyException.class);
        verify(repository, never()).save(any());
    }

    @Test
    void cipherRejectsWrongKeysAndTamperedValues() {
        String encrypted = cipher.encrypt("brand-secret");
        OAuthClientSecretCipher otherKey = new OAuthClientSecretCipher(
                Base64.getEncoder().encodeToString(new byte[32]));

        assertThat(otherKey.decryptOrNull(encrypted)).isNull();
        assertThat(cipher.decryptOrNull("not base64 !")).isNull();
        assertThat(cipher.decryptOrNull(Base64.getEncoder().encodeToString(new byte[5]))).isNull();
        assertThat(new OAuthClientSecretCipher("c2hvcnQ=").isConfigured()).isFalse();
        assertThat(new OAuthClientSecretCipher("%%%").isConfigured()).isFalse();
        assertThat(cipher.encrypt("brand-secret")).isNotEqualTo(encrypted);
    }
}
