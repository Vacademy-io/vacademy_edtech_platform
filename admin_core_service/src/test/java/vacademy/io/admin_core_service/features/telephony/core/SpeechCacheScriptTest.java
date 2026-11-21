package vacademy.io.admin_core_service.features.telephony.core;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiAgentDTO;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SpeechCacheScriptTest {

    @Test
    void quotedScriptLinesAreSplitIntoCacheableSentences() {
        String prompt = String.join("\n",
                "Step 3: say \"दूसरी, regular tests हों और parents के साथ proper reports share हों। और तीसरी, बच्चे के doubts समय पर solve हों।\"",
                "Close: \"क्या मैं Scholarship Quiz का link भी WhatsApp कर दूँ?\"",
                "Never: \"नमस्ते {{name}} जी।\" or \"<name> के marks?\" or \"[child] कैसा है?\"",
                "Fragment: \"बिना full stop वाली line\"");
        List<String> got = AiAgentSpeechWarmer.scriptSentences(prompt, 60);
        assertEquals(List.of(
                "दूसरी, regular tests हों और parents के साथ proper reports share हों।",
                "और तीसरी, बच्चे के doubts समय पर solve हों।",
                "क्या मैं Scholarship Quiz का link भी WhatsApp कर दूँ?"), got);
    }

    @Test
    void scriptSentencesAreCapped() {
        StringBuilder p = new StringBuilder();
        for (int i = 0; i < 80; i++) p.append("\"यह line नंबर ").append((char) ('a' + i % 26)).append(i).append(" है।\"\n");
        assertEquals(60, AiAgentSpeechWarmer.scriptSentences(p.toString(), 60).size());
    }

    @Test
    void scriptedSmallestAgentsDefaultToFull() {
        AiAgentDTO scripted = AiAgentDTO.builder().ttsModel("smallest_pro").systemPrompt("x".repeat(2500)).build();
        AiAgentDTO thin = AiAgentDTO.builder().ttsModel("smallest_pro").systemPrompt("short").build();
        AiAgentDTO sarvam = AiAgentDTO.builder().ttsModel("sarvam").systemPrompt("x".repeat(2500)).build();
        assertEquals("FULL", AiAgentService.defaultSpeechCacheMode(scripted));
        assertEquals("OFF", AiAgentService.defaultSpeechCacheMode(thin));
        assertEquals("OFF", AiAgentService.defaultSpeechCacheMode(sarvam));
    }
}
