package vacademy.io.admin_core_service.features.learner_badge.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.institute.dto.settings.GenericSettingRequest;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.learner_badge.dto.BadgeDefinition;
import vacademy.io.admin_core_service.features.learner_badge.dto.BadgeDefinitionRequest;
import vacademy.io.admin_core_service.features.learner_badge.dto.CatalogueBadgeResponse;
import vacademy.io.common.institute.entity.Institute;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import vacademy.io.common.exceptions.VacademyException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.never;

/**
 * The server-side catalogue append exists so a badge created from the student view never
 * re-saves the whole BADGES_REWARDS_SETTING blob from client state. These tests pin what
 * makes that safe: the six defaults are materialised before the first append (both
 * frontends substitute defaults only while the list is EMPTY, so appending to an empty list
 * would make them show ONLY the new badge), replace-by-id is honoured, every other key of
 * the setting data survives untouched, and a blank id is minted.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class BadgeCatalogueServiceTest {

    private static final String INSTITUTE = "inst-1";
    private static final List<String> DEFAULT_IDS = List.of(
            "first_course", "streak_7", "streak_30", "perfect_score", "completionist", "dedicated_learner");

    @Mock private InstituteRepository instituteRepository;
    @Mock private InstituteSettingService instituteSettingService;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private BadgeCatalogueService service;
    private Institute institute;

    @BeforeEach
    void setUp() {
        service = new BadgeCatalogueService(instituteRepository, instituteSettingService, objectMapper);
        institute = new Institute();
        institute.setId(INSTITUTE);
        when(instituteRepository.findById(INSTITUTE)).thenReturn(Optional.of(institute));
    }

    private void stored(Object data) {
        when(instituteSettingService.getSettingData(institute, BadgeCatalogueService.SETTING_KEY)).thenReturn(data);
    }

    private static Map<String, Object> badge(String id, String name, String trigger, boolean enabled) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("name", name);
        m.put("description", name + " description");
        m.put("icon", "Star");
        m.put("trigger", trigger);
        m.put("threshold", 3);
        m.put("enabled", enabled);
        return m;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> savedData() {
        ArgumentCaptor<Object> captor = ArgumentCaptor.forClass(Object.class);
        verify(instituteSettingService).saveGenericSetting(
                eq(institute), eq(BadgeCatalogueService.SETTING_KEY), captor.capture());
        GenericSettingRequest request = (GenericSettingRequest) captor.getValue();
        assertEquals(BadgeCatalogueService.SETTING_NAME, request.getSettingName());
        return (Map<String, Object>) request.getSettingData();
    }

    @SuppressWarnings("unchecked")
    private static List<String> idsOf(Map<String, Object> data) {
        List<String> ids = new ArrayList<>();
        for (Object entry : (List<Object>) data.get("badges")) {
            ids.add(String.valueOf(((Map<String, Object>) entry).get("id")));
        }
        return ids;
    }

    // ------------------------------------------------------------------ reads

    @Test
    @DisplayName("the six defaults load from the classpath fixture in the documented order")
    void defaultsLoad() {
        List<BadgeDefinition> defaults = service.defaultBadges();
        assertEquals(DEFAULT_IDS, defaults.stream().map(BadgeDefinition::getId).toList());
        assertTrue(defaults.stream().allMatch(BadgeDefinition::isEffectivelyEnabled));
        assertTrue(defaults.stream().noneMatch(BadgeDefinition::isManual));
    }

    @Test
    @DisplayName("absent key → disabled, defaults as the badge list")
    void absentKeyReadsAsDefaults() {
        stored(null);
        BadgeCatalogueService.Catalogue c = service.read(INSTITUTE);
        assertFalse(c.isEnabled());
        assertTrue(c.isUsingDefaults());
        assertEquals(DEFAULT_IDS, c.getBadges().stream().map(BadgeDefinition::getId).toList());
    }

    @Test
    @DisplayName("syncable badges exclude manual and disabled entries and unparseable lists fall back to defaults")
    void syncableBadges() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("enabled", true);
        data.put("badges", List.of(
                badge("auto_ok", "Auto", "streak", true),
                badge("staff_only", "Staff", "manual", true),
                badge("switched_off", "Off", "streak", false)));
        stored(data);
        Map<String, BadgeDefinition> allowed = service.syncableBadges(INSTITUTE);
        assertEquals(List.of("auto_ok"), new ArrayList<>(allowed.keySet()));

        // Garbage where the list should be → WARN + the six defaults are accepted.
        Map<String, Object> broken = new LinkedHashMap<>();
        broken.put("badges", List.of("not-a-badge", 42));
        stored(broken);
        assertEquals(DEFAULT_IDS, new ArrayList<>(service.syncableBadges(INSTITUTE).keySet()));
    }

    // ----------------------------------------------------------------- writes

    @Test
    @DisplayName("appending to an empty catalogue materialises the defaults first, then the new badge")
    void appendToEmptyMaterialisesDefaults() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("version", 1);
        data.put("enabled", true);
        data.put("badges", List.of());
        stored(data);

        CatalogueBadgeResponse response = service.upsert(INSTITUTE,
                new BadgeDefinitionRequest(null, "Helper of the Month", "Helped classmates", null, null, null, null, true));

        Map<String, Object> saved = savedData();
        List<String> ids = idsOf(saved);
        assertEquals(7, ids.size());
        assertEquals(DEFAULT_IDS, ids.subList(0, 6));
        assertEquals(response.getBadge().getId(), ids.get(6));
        assertEquals(7, response.getBadges().size());
        assertTrue(response.isEnabled());
    }

    @Test
    @DisplayName("a blank id mints badge_<uuid> and manual defaults apply (Star icon, threshold 0, enabled)")
    void mintsIdAndDefaults() {
        stored(null);
        CatalogueBadgeResponse response = service.upsert(INSTITUTE,
                new BadgeDefinitionRequest("", "  Kindness  ", null, null, null, 50L, null, null));

        BadgeDefinition badge = response.getBadge();
        assertTrue(badge.getId().startsWith("badge_"), badge.getId());
        assertTrue(badge.getId().length() > "badge_".length() + 30);
        assertEquals("Kindness", badge.getName());
        assertEquals("", badge.getDescription());
        assertEquals("Star", badge.getIcon());
        assertEquals("manual", badge.getTrigger());
        assertEquals(0L, badge.getThreshold(), "threshold is forced to 0 for manual badges");
        assertEquals(Boolean.TRUE, badge.getEnabled());
        assertEquals(Boolean.FALSE, badge.getHidden());
        assertFalse(response.isEnabled(), "absent key → master toggle off");

        Map<String, Object> saved = savedData();
        assertEquals(1, saved.get("version"));
        assertEquals(false, saved.get("enabled"));
    }

    @Test
    @DisplayName("an existing id is replaced in place; other badges and unknown badge keys are kept")
    void replaceById() {
        Map<String, Object> keepMe = badge("b1", "Old", "streak", true);
        keepMe.put("someFutureKey", "kept");
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("enabled", true);
        data.put("badges", List.of(keepMe, badge("b2", "Second", "manual", true)));
        stored(data);

        service.upsert(INSTITUTE,
                new BadgeDefinitionRequest("b2", "Renamed", "d", "Trophy", "manual", 9L, false, true));

        Map<String, Object> saved = savedData();
        assertEquals(List.of("b1", "b2"), idsOf(saved));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> badges = (List<Map<String, Object>>) saved.get("badges");
        assertEquals("kept", badges.get(0).get("someFutureKey"));
        assertEquals("Renamed", badges.get(1).get("name"));
        assertEquals("Trophy", badges.get(1).get("icon"));
        assertEquals(0L, badges.get(1).get("threshold"));
        assertEquals(false, badges.get(1).get("enabled"));
        assertEquals(true, badges.get(1).get("hidden"));
    }

    @Test
    @DisplayName("every other key of the setting data (enabled, scoring, publicShowFullNames, version) is preserved")
    void preservesOtherKeys() {
        Map<String, Object> scoring = new LinkedHashMap<>();
        scoring.put("activityPerDay", 10);
        scoring.put("streakPerDay", 7);
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("version", 1);
        data.put("enabled", true);
        data.put("scoring", scoring);
        data.put("publicShowFullNames", true);
        data.put("badges", List.of(badge("b1", "One", "streak", true)));
        stored(data);

        service.upsert(INSTITUTE, new BadgeDefinitionRequest(null, "New", null, null, null, null, null, null));

        Map<String, Object> saved = savedData();
        assertEquals(1, saved.get("version"));
        assertEquals(true, saved.get("enabled"));
        assertEquals(true, saved.get("publicShowFullNames"));
        assertEquals(scoring, saved.get("scoring"));
        assertEquals(2, idsOf(saved).size());
        assertNotNull(saved.get("badges"));
    }

    @Test
    @DisplayName("one unreadable entry (threshold beyond int range) is skipped on read and PRESERVED on append; the rest survive")
    void partiallyUnreadableListIsPreserved() {
        Map<String, Object> huge = badge("huge", "Huge", "xp_total", true);
        huge.put("threshold", 10_000_000_000L);
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("enabled", true);
        data.put("badges", new ArrayList<>(List.of(badge("ok", "Ok", "streak", true), huge, "garbage")));
        stored(data);

        BadgeCatalogueService.Catalogue c = service.read(INSTITUTE);
        assertFalse(c.isUsingDefaults());
        assertEquals(2, c.getBadges().size(), "Long threshold now parses; only the garbage entry is unreadable");
        assertEquals(1, c.getUnreadableEntries());
        assertEquals(10_000_000_000L, c.getBadges().get(1).getThreshold());

        service.upsert(INSTITUTE, new BadgeDefinitionRequest(null, "Helper", null, null, null, null, null, null));
        Map<String, Object> saved = savedData();
        List<?> entries = (List<?>) saved.get("badges");
        assertEquals(4, entries.size(), "ok + huge + garbage kept, new badge appended");
        assertEquals("garbage", entries.get(2), "the unreadable raw entry is carried through untouched");
    }

    @Test
    @DisplayName("a stored list that is wholly unreadable is never replaced by the defaults on append")
    void whollyUnreadableListBlocksAppend() {
        Map<String, Object> broken = new LinkedHashMap<>();
        broken.put("badges", List.of("not-a-badge", 42));
        stored(broken);
        assertThrows(VacademyException.class,
                () -> service.upsert(INSTITUTE, new BadgeDefinitionRequest(null, "Helper", null, null, null, null, null, null)));
        verify(instituteSettingService, never()).saveGenericSetting(any(), any(), any());
    }

    @Test
    @DisplayName("an unknown trigger key is rejected")
    void unknownTriggerRejected() {
        stored(null);
        assertThrows(VacademyException.class,
                () -> service.upsert(INSTITUTE, new BadgeDefinitionRequest(null, "X", null, null, "points_total", 5L, null, null)));
    }

    @Test
    @DisplayName("a settings blob the parser rejects is treated as absent, not as a crash")
    void unparseableSettingsTreatedAsAbsent() {
        when(instituteSettingService.getSettingData(any(), any())).thenThrow(new RuntimeException("bad json"));
        BadgeCatalogueService.Catalogue c = service.read(INSTITUTE);
        assertTrue(c.isUsingDefaults());
        assertFalse(c.isEnabled());
        assertFalse(service.isEnabled(INSTITUTE));
    }
}
