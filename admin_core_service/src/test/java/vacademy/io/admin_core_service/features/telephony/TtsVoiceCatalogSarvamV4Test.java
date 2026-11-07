package vacademy.io.admin_core_service.features.telephony;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.telephony.core.TtsVoiceCatalog;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Sarvam Bulbul v4 Flash: its own engine, and the SAME voices and genders as the voice
 * bot's list (voice_bot_service/app/sarvam_v4_voices.py). A voice only here is offered
 * and then dropped by the bot; a gender that differs makes the bot conjugate Hindi for
 * the wrong voice.
 */
class TtsVoiceCatalogSarvamV4Test {

    @Test
    void v4IsItsOwnEngineAndNeverV3() {
        assertEquals(TtsVoiceCatalog.MODEL_SARVAM_V4, TtsVoiceCatalog.normalizeModel("sarvam_v4"));
        assertEquals(TtsVoiceCatalog.MODEL_SARVAM_V4, TtsVoiceCatalog.normalizeModel("bulbul:v4-flash"));
        assertEquals(TtsVoiceCatalog.MODEL_SARVAM, TtsVoiceCatalog.normalizeModel("sarvam"));
        assertTrue(TtsVoiceCatalog.isVoiceOf("sarvam_v4", "shubh_enhi_ads"));
        assertFalse(TtsVoiceCatalog.isVoiceOf("sarvam_v4", "priya"));
        assertFalse(TtsVoiceCatalog.isVoiceOf("sarvam", "shubh_enhi_ads"));
        assertEquals("shubh_enhi_ads", TtsVoiceCatalog.defaultVoice("sarvam_v4"));
    }

    @Test
    void sameVoicesAndGendersAsTheVoiceBot() throws Exception {
        Path py = Path.of("..", "voice_bot_service", "app", "sarvam_v4_voices.py");
        Assumptions.assumeTrue(Files.exists(py), "voice bot source not checked out next to admin_core");
        String src = Files.readString(py);
        Set<String> male = idsIn(block(src, "SARVAM_V4_MALE"));
        Set<String> female = idsIn(block(src, "SARVAM_V4_FEMALE"));
        Set<String> catalogMale = new HashSet<>();
        Set<String> catalogFemale = new HashSet<>();
        for (Map<String, String> v : TtsVoiceCatalog.forModel("sarvam_v4")) {
            ("male".equals(v.get("gender")) ? catalogMale : catalogFemale).add(v.get("id"));
            assertNotNull(v.get("label"), v.get("id"));
        }
        assertEquals(male, catalogMale);
        assertEquals(female, catalogFemale);
        assertEquals(210, male.size() + female.size());
    }

    private static String block(String src, String name) {
        int start = src.indexOf(name + " = frozenset({");
        assertTrue(start >= 0, name);
        return src.substring(start, src.indexOf("})", start));
    }

    private static Set<String> idsIn(String text) {
        Set<String> out = new HashSet<>();
        Matcher m = Pattern.compile("\"([a-z]+_[a-z]+_[a-z_]+)\"").matcher(text);
        while (m.find()) out.add(m.group(1));
        return out;
    }
}
