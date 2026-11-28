package vacademy.io.admin_core_service.features.telephony;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.telephony.core.TtsVoiceCatalog;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TtsVoiceCatalogPlivoTest {

    @Test
    void plivoIsTheNewAgentDefaultWithMeera() {
        assertEquals("plivo", TtsVoiceCatalog.NEW_AGENT_DEFAULT);
        assertEquals("meera", TtsVoiceCatalog.defaultVoice(TtsVoiceCatalog.NEW_AGENT_DEFAULT));
        assertTrue(TtsVoiceCatalog.isVoiceOf("plivo", "Meera"));
        assertEquals("meera", TtsVoiceCatalog.canonicalVoice("plivo", "MEERA"));
        assertEquals("plivo", TtsVoiceCatalog.models().get(0).get("id"));
    }

    @Test
    void plivoIsARecognisedEngineWithItsVoices() {
        assertEquals("plivo", TtsVoiceCatalog.normalizeModel("Plivo"));
        assertEquals("plivo", TtsVoiceCatalog.normalizeModel("koyal-v1"));
        assertEquals(33, TtsVoiceCatalog.forModel("plivo").size());
        assertFalse(TtsVoiceCatalog.isVoiceOf("plivo", "priya"));
        Map<String, String> meera = TtsVoiceCatalog.forModel("plivo").stream()
                .filter(v -> "meera".equals(v.get("id"))).findFirst().orElseThrow();
        assertEquals("female", meera.get("gender"));
        assertEquals("hi", meera.get("language"));
    }

    @Test
    void aVoiceIsPickedInTheAgentsLanguage() {
        assertEquals("meera", TtsVoiceCatalog.voiceForLanguage("plivo", "hinglish", "female"));
        assertEquals("meera", TtsVoiceCatalog.voiceForLanguage("plivo", "hindi", null));
        assertEquals("aman", TtsVoiceCatalog.voiceForLanguage("plivo", "hindi", "male"));
        assertEquals("nisha", TtsVoiceCatalog.voiceForLanguage("plivo", "english", "female"));
        assertEquals("aarav", TtsVoiceCatalog.voiceForLanguage("plivo", "english", "male"));
        assertEquals("nandhini", TtsVoiceCatalog.voiceForLanguage("plivo", "tamil", "female"));
        // No Plivo voice for Malayalam; other engines carry no per-voice language.
        assertNull(TtsVoiceCatalog.voiceForLanguage("plivo", "malayalam", "female"));
        assertNull(TtsVoiceCatalog.voiceForLanguage("google", "english", "female"));
    }
}
