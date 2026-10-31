package vacademy.io.admin_core_service.features.telephony;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.telephony.core.TtsVoiceCatalog;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TtsVoiceCatalogNavanaTest {

    @Test
    void navanaIsARecognisedEngineWithItsVoices() {
        assertEquals("navana", TtsVoiceCatalog.normalizeModel("Navana"));
        assertEquals("navana", TtsVoiceCatalog.normalizeModel("bodhi"));
        assertEquals("bhavana", TtsVoiceCatalog.defaultVoice("navana"));
        assertTrue(TtsVoiceCatalog.isVoiceOf("navana", "Anirban"));
        assertFalse(TtsVoiceCatalog.isVoiceOf("navana", "mrunal"));
        assertEquals(55, TtsVoiceCatalog.forModel("navana").size());
        assertTrue(TtsVoiceCatalog.models().stream().anyMatch(m -> "navana".equals(m.get("id"))));
    }
}
