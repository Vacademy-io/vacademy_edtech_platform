package vacademy.io.admin_core_service.features.telephony.core;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AiAgentAssistLintTest {

    private static boolean has(List<String> issues, String fragment) {
        return issues.stream().anyMatch(i -> i.contains(fragment));
    }

    @Test
    void cleanHindiPromptHasNoFindings() {
        String prompt = "Step 1: पूछिए \"आपका बच्चा किस क्लास में है?\" फिर step 2 पर जाइए।";
        String opening = "नमस्ते {{name}} जी, मैं श्रेया बोल रही हूँ Shiksha Nation से। क्या अभी दो मिनट बात हो सकती है?";
        assertEquals(List.of(), AiAgentAssistService.lint(prompt, opening, "hinglish"));
    }

    @Test
    void flagsTheLiveCallDefects() {
        String prompt = String.join("\n",
                "Say: \"नमस्ते <name> जी, आपका बेटा/बेटी किस क्लास में है?\"",
                "Say: \"जी, समझ गई — अब fees बताती हूँ।\"",
                "Say: \"Fees ₹35,000 है।\"",
                "Say: \"aapka baccha kis class mein hai?\"",
                "Use {{child_name}} when known.");
        List<String> issues = AiAgentAssistService.lint(prompt, null, "hinglish");
        assertTrue(has(issues, "<name>"), issues.toString());
        assertTrue(has(issues, "बेटा/बेटी"), issues.toString());
        assertTrue(has(issues, "dash"), issues.toString());
        assertTrue(has(issues, "digits"), issues.toString());
        assertTrue(has(issues, "English letters"), issues.toString());
        assertTrue(has(issues, "child_name"), issues.toString());
    }

    @Test
    void englishAgentIsNotFlaggedForLatinScriptOrSupportedPlaceholders() {
        String opening = "Hi {{name}}, this is Aarushi from Vacademy. Is now a good time?";
        String prompt = "Ask: \"Which course are you interested in?\" Today is {{today}}.";
        assertEquals(List.of(), AiAgentAssistService.lint(prompt, opening, "english"));
    }

    @Test
    void countsEveryDashLineNotJustTheExamples() {
        String prompt = "\"जी — एक\" \"जी — दो\" \"जी — तीन\" \"जी — चार\" \"जी — पाँच\"";
        assertTrue(has(AiAgentAssistService.lint(prompt, null, "hinglish"), "5 spoken lines"));
    }

    @Test
    void flagsLongPrompts() {
        assertTrue(has(AiAgentAssistService.lint("x".repeat(16000), null, "hinglish"), "re-sent"));
    }
}
