package vacademy.io.notification_service.features.firebase_notifications;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.firebase.FirebaseApp;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.notification_service.features.announcements.entity.InstituteAnnouncementSettings;
import vacademy.io.notification_service.features.announcements.repository.InstituteAnnouncementSettingsRepository;
import vacademy.io.notification_service.features.firebase_notifications.service.MultiTenantFirebaseManager;

import java.security.KeyPairGenerator;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class MultiTenantFirebaseManagerCacheTest {

    private static final String PROJECT = "cache-test-project";
    private final AtomicLong now = new AtomicLong(1_000_000L);

    @AfterEach
    void deleteTestApps() {
        FirebaseApp.getApps().stream().filter(a -> a.getName().startsWith("fcm-" + PROJECT + "-")).toList()
                .forEach(FirebaseApp::delete);
    }

    /** A structurally valid, throwaway service-account JSON (fresh RSA key; never used on the network). */
    private static String fakeServiceAccount() throws Exception {
        KeyPairGenerator gen = KeyPairGenerator.getInstance("RSA");
        gen.initialize(2048);
        String pem = "-----BEGIN PRIVATE KEY-----\n"
                + Base64.getMimeEncoder(64, "\n".getBytes()).encodeToString(gen.generateKeyPair().getPrivate().getEncoded())
                + "\n-----END PRIVATE KEY-----\n";
        Map<String, Object> sa = new LinkedHashMap<>();
        sa.put("type", "service_account");
        sa.put("project_id", PROJECT);
        sa.put("private_key_id", UUID.randomUUID().toString().replace("-", ""));
        sa.put("private_key", pem);
        sa.put("client_email", "firebase-adminsdk@" + PROJECT + ".iam.gserviceaccount.com");
        sa.put("client_id", "1");
        sa.put("token_uri", "https://oauth2.googleapis.com/token");
        return new ObjectMapper().writeValueAsString(sa);
    }

    private static InstituteAnnouncementSettings row(String instituteId, Map<String, Object> firebase) {
        InstituteAnnouncementSettings row = new InstituteAnnouncementSettings();
        row.setInstituteId(instituteId);
        row.setSettings(Map.of("firebase", firebase));
        return row;
    }

    private MultiTenantFirebaseManager manager(InstituteAnnouncementSettingsRepository repo) {
        return new MultiTenantFirebaseManager(repo, now::get);
    }

    @Test
    @DisplayName("firebase.enabled=false is not enforced: the old admin page saved false by default")
    void enabledFalseStillSends() throws Exception {
        InstituteAnnouncementSettingsRepository repo = mock(InstituteAnnouncementSettingsRepository.class);
        when(repo.findByInstituteId("inst-1")).thenReturn(Optional.of(
                row("inst-1", Map.of("enabled", false, "serviceAccountJson", fakeServiceAccount()))));

        assertThat(manager(repo).getMessagingForInstitute("inst-1")).isPresent();
    }

    @Test
    @DisplayName("a DB error after the cache expires keeps the last good app (push stays on)")
    void dbErrorKeepsLastGoodApp() throws Exception {
        InstituteAnnouncementSettingsRepository repo = mock(InstituteAnnouncementSettingsRepository.class);
        when(repo.findByInstituteId("inst-4")).thenReturn(Optional.of(
                row("inst-4", Map.of("serviceAccountJson", fakeServiceAccount()))));
        MultiTenantFirebaseManager manager = manager(repo);
        assertThat(manager.getMessagingForInstitute("inst-4")).isPresent();

        when(repo.findByInstituteId("inst-4")).thenThrow(new RuntimeException("db down"));
        now.addAndGet(6 * 60 * 1000L); // past the 5-minute expiry
        assertThat(manager.getMessagingForInstitute("inst-4")).isPresent();
        verify(repo, times(2)).findByInstituteId("inst-4");
    }

    @Test
    @DisplayName("a newly stored key is picked up once the short no-key cache expires")
    void newKeyPickedUpAfterNoKeyTtl() throws Exception {
        InstituteAnnouncementSettingsRepository repo = mock(InstituteAnnouncementSettingsRepository.class);
        when(repo.findByInstituteId("inst-5")).thenReturn(Optional.empty());
        MultiTenantFirebaseManager manager = manager(repo);
        assertThat(manager.getMessagingForInstitute("inst-5")).isEmpty();

        when(repo.findByInstituteId("inst-5")).thenReturn(Optional.of(
                row("inst-5", Map.of("serviceAccountJson", fakeServiceAccount()))));
        now.addAndGet(30 * 1000L);
        assertThat(manager.getMessagingForInstitute("inst-5")).isEmpty(); // still within 60 s
        now.addAndGet(31 * 1000L);
        assertThat(manager.getMessagingForInstitute("inst-5")).isPresent();
    }

    @Test
    @DisplayName("a malformed base64 key counts as no key (not as a lookup failure)")
    void malformedBase64IsNoKey() {
        InstituteAnnouncementSettingsRepository repo = mock(InstituteAnnouncementSettingsRepository.class);
        when(repo.findByInstituteId("inst-6")).thenReturn(Optional.of(
                row("inst-6", Map.of("serviceAccountJsonBase64", "abc=def"))));

        assertThat(manager(repo).getMessagingForInstitute("inst-6")).isEmpty();
    }

    @Test
    @DisplayName("an institute without a key is cached, not re-queried on every send")
    void missingKeyIsCached() {
        InstituteAnnouncementSettingsRepository repo = mock(InstituteAnnouncementSettingsRepository.class);
        when(repo.findByInstituteId("inst-2")).thenReturn(Optional.empty());
        MultiTenantFirebaseManager manager = manager(repo);

        for (int i = 0; i < 5; i++) {
            assertThat(manager.getMessagingForInstitute("inst-2")).isEmpty();
        }
        verify(repo, times(1)).findByInstituteId("inst-2");
    }

    @Test
    @DisplayName("a failed lookup doesn't throw and is retried after a short back-off, not on every send")
    void failedLookupBacksOff() {
        InstituteAnnouncementSettingsRepository repo = mock(InstituteAnnouncementSettingsRepository.class);
        when(repo.findByInstituteId("inst-3")).thenThrow(new RuntimeException("db down"));
        MultiTenantFirebaseManager manager = manager(repo);

        assertThat(manager.getMessagingForInstitute("inst-3")).isEmpty();
        assertThat(manager.getMessagingForInstitute("inst-3")).isEmpty();
        verify(repo, times(1)).findByInstituteId("inst-3");
        now.addAndGet(31 * 1000L);
        assertThat(manager.getMessagingForInstitute("inst-3")).isEmpty();
        verify(repo, times(2)).findByInstituteId("inst-3");
    }

    @Test
    @DisplayName("a null institute id is simply 'no Firebase', not an exception")
    void nullInstitute() {
        assertThat(manager(mock(InstituteAnnouncementSettingsRepository.class)).getMessagingForInstitute(null)).isEmpty();
    }
}
