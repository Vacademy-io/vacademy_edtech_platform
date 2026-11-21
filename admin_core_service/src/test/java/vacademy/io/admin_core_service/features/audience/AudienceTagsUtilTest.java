package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.audience.util.AudienceTagsUtil;
import vacademy.io.common.exceptions.VacademyException;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.SortedMap;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Lead list tags are grouped on by reports, so every spelling of a key must land on one
 * canonical key, and the stored JSON must be stable (sorted) whatever order the client sent.
 */
class AudienceTagsUtilTest {

    @Test
    void keysAreTrimmedLowerCasedAndSeparatorsBecomeUnderscores() {
        assertEquals("state", AudienceTagsUtil.normalizeKey("  State "));
        assertEquals("lead_source", AudienceTagsUtil.normalizeKey("Lead Source"));
        assertEquals("lead_source", AudienceTagsUtil.normalizeKey("lead-source"));
        assertEquals("lead_source", AudienceTagsUtil.normalizeKey("Lead -  Source"));
        assertEquals("batch_2026", AudienceTagsUtil.normalizeKey("batch_2026"));
    }

    @Test
    void invalidKeysAreRejectedAsBadRequest() {
        for (String bad : List.of("", "   ", "state!", "kursé", "a".repeat(41))) {
            VacademyException ex = assertThrows(VacademyException.class, () -> AudienceTagsUtil.normalizeKey(bad));
            assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
        }
        assertThrows(VacademyException.class, () -> AudienceTagsUtil.normalizeKey(null));
    }

    @Test
    void normalizeSortsTrimsAndDropsBlankValues() {
        Map<String, String> raw = new LinkedHashMap<>();
        raw.put("State", "  Maharashtra ");
        raw.put("course", "MBA");
        raw.put("channel", "  ");
        raw.put("batch", null);

        SortedMap<String, String> tags = AudienceTagsUtil.normalize(raw);

        assertEquals(List.of("course", "state"), List.copyOf(tags.keySet()));
        assertEquals("Maharashtra", tags.get("state"));
        assertEquals("{\"course\":\"MBA\",\"state\":\"Maharashtra\"}", AudienceTagsUtil.toJson(tags));
    }

    @Test
    void emptyOrNullTagsStoreAsNull() {
        assertTrue(AudienceTagsUtil.normalize(null).isEmpty());
        assertNull(AudienceTagsUtil.toJson(AudienceTagsUtil.normalize(Map.of())));
        assertNull(AudienceTagsUtil.toJson(AudienceTagsUtil.normalize(Map.of("state", " "))));
    }

    @Test
    void sameKeyInTwoSpellingsIsRejected() {
        Map<String, String> raw = new LinkedHashMap<>();
        raw.put("Lead Source", "Google");
        raw.put("lead_source", "Meta");
        VacademyException ex = assertThrows(VacademyException.class, () -> AudienceTagsUtil.normalize(raw));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
    }

    @Test
    void valuesMustBeShortAndFreeOfControlCharacters() {
        assertEquals("x".repeat(60), AudienceTagsUtil.normalize(Map.of("k", "x".repeat(60))).get("k"));
        assertThrows(VacademyException.class, () -> AudienceTagsUtil.normalize(Map.of("k", "x".repeat(61))));
        assertThrows(VacademyException.class, () -> AudienceTagsUtil.normalize(Map.of("k", "Maha\nrashtra")));
        assertThrows(VacademyException.class, () -> AudienceTagsUtil.normalize(Map.of("k", "a\u0000b")));
        // Non-Latin values are fine and measured in characters, not UTF-16 units.
        assertEquals("महाराष्ट्र", AudienceTagsUtil.normalize(Map.of("state", "महाराष्ट्र")).get("state"));
    }

    @Test
    void atMostTenTags() {
        Map<String, String> ten = new HashMap<>();
        for (int i = 0; i < 10; i++) ten.put("k" + i, "v");
        assertEquals(10, AudienceTagsUtil.normalize(ten).size());

        Map<String, String> eleven = new HashMap<>(ten);
        eleven.put("k10", "v");
        assertThrows(VacademyException.class, () -> AudienceTagsUtil.normalize(eleven));

        // A removed (blank) key does not count toward the limit.
        Map<String, String> tenPlusRemoval = new HashMap<>(ten);
        tenPlusRemoval.put("k10", "");
        assertEquals(10, AudienceTagsUtil.normalize(tenPlusRemoval).size());
    }

    @Test
    void fromJsonIsTolerantOfBadOrMissingData() {
        assertTrue(AudienceTagsUtil.fromJson(null).isEmpty());
        assertTrue(AudienceTagsUtil.fromJson("not json").isEmpty());
        assertTrue(AudienceTagsUtil.fromJson("[1,2]").isEmpty());
        SortedMap<String, String> tags = AudienceTagsUtil.fromJson("{\"state\":\"Goa\",\"n\":3,\"course\":\"BBA\"}");
        assertEquals(Map.of("state", "Goa", "course", "BBA"), tags);
    }
}
