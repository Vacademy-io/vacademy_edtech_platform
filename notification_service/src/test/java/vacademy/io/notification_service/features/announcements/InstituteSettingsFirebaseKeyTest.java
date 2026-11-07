package vacademy.io.notification_service.features.announcements;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.notification_service.features.announcements.dto.InstituteAnnouncementSettingsRequest;
import vacademy.io.notification_service.features.announcements.dto.InstituteAnnouncementSettingsResponse;
import vacademy.io.notification_service.features.announcements.entity.InstituteAnnouncementSettings;
import vacademy.io.notification_service.features.announcements.repository.InstituteAnnouncementSettingsRepository;
import vacademy.io.notification_service.features.announcements.service.InstituteAnnouncementSettingsService;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * The institute-settings GET is public and learner-facing, so the stored Firebase service-account key must
 * never be serialized — and because the admin page saves back what it loaded (without the key), a save
 * without a key must keep the stored one rather than wipe it.
 */
class InstituteSettingsFirebaseKeyTest {

    private static final String INSTITUTE = "inst-1";
    private static final String STORED_KEY = "{\"type\":\"service_account\",\"project_id\":\"p\",\"private_key\":\"-----BEGIN PRIVATE KEY-----SECRET\"}";

    private InstituteAnnouncementSettingsRepository repo;
    private InstituteAnnouncementSettingsService service;
    private final ObjectMapper mapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
            .findAndRegisterModules();

    @BeforeEach
    void setUp() {
        repo = mock(InstituteAnnouncementSettingsRepository.class);
        service = new InstituteAnnouncementSettingsService(repo, mapper);
        when(repo.save(any())).thenAnswer(inv -> inv.getArgument(0));
    }

    private InstituteAnnouncementSettings storedRow(Map<String, Object> firebase) {
        Map<String, Object> settings = new LinkedHashMap<>();
        settings.put("general", Map.of("default_timezone", "Asia/Kolkata"));
        settings.put("firebase", firebase);
        InstituteAnnouncementSettings row = new InstituteAnnouncementSettings();
        row.setId("row-1");
        row.setInstituteId(INSTITUTE);
        row.setSettings(settings);
        when(repo.findByInstituteId(INSTITUTE)).thenReturn(Optional.of(row));
        return row;
    }

    private InstituteAnnouncementSettingsRequest request(InstituteAnnouncementSettingsRequest.FirebaseSettings firebase) {
        InstituteAnnouncementSettingsRequest.AnnouncementSettings settings = new InstituteAnnouncementSettingsRequest.AnnouncementSettings();
        settings.setFirebase(firebase);
        InstituteAnnouncementSettingsRequest req = new InstituteAnnouncementSettingsRequest();
        req.setInstituteId(INSTITUTE);
        req.setSettings(settings);
        return req;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> savedFirebase() {
        ArgumentCaptor<InstituteAnnouncementSettings> saved = ArgumentCaptor.forClass(InstituteAnnouncementSettings.class);
        verify(repo).save(saved.capture());
        return (Map<String, Object>) saved.getValue().getSettings().get("firebase");
    }

    @Test
    @DisplayName("GET never serializes the key; it reports configured=true instead")
    void responseIsRedacted() throws Exception {
        storedRow(new LinkedHashMap<>(Map.of("enabled", true, "serviceAccountJson", STORED_KEY)));

        InstituteAnnouncementSettingsResponse response = service.getSettingsByInstituteId(INSTITUTE);
        String json = mapper.writeValueAsString(response);

        assertThat(json).doesNotContain("PRIVATE KEY").doesNotContain("serviceAccountJson");
        assertThat(response.getSettings().getFirebase().getConfigured()).isTrue();
        assertThat(response.getSettings().getFirebase().getEnabled()).isTrue();
    }

    @Test
    @DisplayName("configured=false when no key is stored")
    void notConfigured() {
        storedRow(new LinkedHashMap<>(Map.of("enabled", false)));
        assertThat(service.getSettingsByInstituteId(INSTITUTE).getSettings().getFirebase().getConfigured()).isFalse();
    }

    @Test
    @DisplayName("saving without a key keeps the stored key (admin page never has it)")
    void saveWithoutKeyKeepsStoredKey() throws Exception {
        storedRow(new LinkedHashMap<>(Map.of("enabled", true, "serviceAccountJson", STORED_KEY)));
        InstituteAnnouncementSettingsRequest.FirebaseSettings fb = new InstituteAnnouncementSettingsRequest.FirebaseSettings();
        fb.setEnabled(true);

        InstituteAnnouncementSettingsResponse response = service.createOrUpdateSettings(request(fb));

        assertThat(savedFirebase()).containsEntry("serviceAccountJson", STORED_KEY).containsEntry("enabled", true);
        assertThat(mapper.writeValueAsString(response)).doesNotContain("PRIVATE KEY");
    }

    @Test
    @DisplayName("a save with no firebase block at all does not wipe the key or flip enabled")
    void saveWithoutFirebaseBlockKeepsKey() {
        storedRow(new LinkedHashMap<>(Map.of("enabled", true, "serviceAccountJson", STORED_KEY)));

        service.createOrUpdateSettings(request(null));

        assertThat(savedFirebase()).containsEntry("serviceAccountJson", STORED_KEY).containsEntry("enabled", true);
    }

    @Test
    @DisplayName("a newly pasted key replaces the stored one")
    void newKeyReplaces() {
        storedRow(new LinkedHashMap<>(Map.of("enabled", true, "serviceAccountJson", STORED_KEY)));
        InstituteAnnouncementSettingsRequest.FirebaseSettings fb = new InstituteAnnouncementSettingsRequest.FirebaseSettings();
        fb.setEnabled(true);
        fb.setServiceAccountJson("{\"type\":\"service_account\",\"private_key\":\"NEW\"}");

        service.createOrUpdateSettings(request(fb));

        assertThat(savedFirebase().get("serviceAccountJson")).asString().contains("NEW");
    }

    @Test
    @DisplayName("a brand-new row gets no key invented")
    void newRowHasNoKey() {
        when(repo.findByInstituteId(INSTITUTE)).thenReturn(Optional.empty());
        InstituteAnnouncementSettingsRequest.FirebaseSettings fb = new InstituteAnnouncementSettingsRequest.FirebaseSettings();
        fb.setEnabled(false);

        service.createOrUpdateSettings(request(fb));

        assertThat(savedFirebase().get("serviceAccountJson")).isNull();
    }
}
