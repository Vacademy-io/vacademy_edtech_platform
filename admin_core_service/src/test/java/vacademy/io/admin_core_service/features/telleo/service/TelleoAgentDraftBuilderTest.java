package vacademy.io.admin_core_service.features.telleo.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.telephony.core.TtsVoiceCatalog;
import vacademy.io.admin_core_service.features.telleo.dto.TelleoAnswersDTO;
import vacademy.io.admin_core_service.features.telleo.service.TelleoAgentDraftBuilder.AgentDraft;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TelleoAgentDraftBuilderTest {

    private static TelleoAnswersDTO answers(String goal, String language, String gender) {
        return TelleoAnswersDTO.builder()
                .businessDescription("We sell 2 and 3 BHK flats in Pune.")
                .goal(goal)
                .audience("People who filled our Facebook form for a site visit.")
                .successOutcome("BOOKED")
                .language(language)
                .voiceGender(gender)
                .build();
    }

    @Test
    void cleanDefaultsAndBoundsTheAnswers() {
        TelleoAnswersDTO clean = TelleoAgentDraftBuilder.clean(TelleoAnswersDTO.builder()
                .businessDescription("  Flats {{name}} in [Pune]\n")
                .goal("qualify_leads")
                .audience("Leads")
                .language("en")
                .voiceGender("robot")
                .successOutcome("whatever")
                .website("not a url at all")
                .build());
        // Braces and brackets would be read aloud or become placeholders: stripped.
        assertEquals("Flats name in Pune", clean.getBusinessDescription());
        assertEquals("QUALIFY_LEADS", clean.getGoal());
        // "en" would take the Hindi path in the voice bot: anything unknown becomes english.
        assertEquals("english", clean.getLanguage());
        assertEquals("female", clean.getVoiceGender());
        assertEquals("INTERESTED", clean.getSuccessOutcome());
        assertNull(clean.getWebsite());
    }

    @Test
    void cleanRefusesMissingEssentials() {
        assertThrows(VacademyException.class, () -> TelleoAgentDraftBuilder.clean(null));
        assertThrows(VacademyException.class, () -> TelleoAgentDraftBuilder.clean(
                TelleoAnswersDTO.builder().goal("FEEDBACK").audience("x").build()));
        assertThrows(VacademyException.class, () -> TelleoAgentDraftBuilder.clean(
                TelleoAnswersDTO.builder().businessDescription("x").goal("NOPE").audience("x").build()));
        assertThrows(VacademyException.class, () -> TelleoAgentDraftBuilder.clean(
                TelleoAnswersDTO.builder().businessDescription("x").goal("OTHER").audience("x").build()));
    }

    @Test
    void templateOpeningLinesFollowTheSpokenLineRules() {
        for (String goal : TelleoAgentDraftBuilder.GOALS) {
            for (String language : TelleoAgentDraftBuilder.LANGUAGES) {
                for (String gender : List.of("female", "male")) {
                    TelleoAnswersDTO a = answers(goal, language, gender);
                    if ("OTHER".equals(goal)) a.setGoalDetail("Confirm tomorrow's delivery slot");
                    AgentDraft draft = TelleoAgentDraftBuilder.template(a, "Sunrise Homes");
                    String opening = draft.openingLine();
                    assertTrue(opening.length() < 240, opening);
                    assertTrue(opening.contains("{{name}}"), opening);
                    assertFalse(opening.matches(".*[\\[\\]<>/].*"), opening);
                    assertTrue(opening.contains("Sunrise Homes"), opening);
                    assertFalse(draft.extractionQuestions().isEmpty());
                    assertFalse(draft.dispositions().isEmpty());
                    assertTrue(draft.systemPrompt().contains("We sell 2 and 3 BHK flats in Pune."));
                }
            }
        }
    }

    @Test
    void hindiOpeningConjugatesForTheVoiceGender() {
        assertTrue(TelleoAgentDraftBuilder.template(answers("FEEDBACK", "hindi", "female"), "X")
                .openingLine().contains("रही"));
        assertTrue(TelleoAgentDraftBuilder.template(answers("FEEDBACK", "hindi", "male"), "X")
                .openingLine().contains("रहा"));
    }

    @Test
    void withoutPricingTheAgentPromisesNothing() {
        String prompt = TelleoAgentDraftBuilder.template(answers("QUALIFY_LEADS", "english", "female"), "X")
                .systemPrompt();
        assertTrue(prompt.contains("Do not quote any price"));
    }

    @Test
    void voiceAlwaysMatchesTheChosenGenderAndEngine() {
        for (String language : TelleoAgentDraftBuilder.LANGUAGES) {
            for (String gender : List.of("female", "male")) {
                String voice = TelleoAgentDraftBuilder.voiceFor(language, gender);
                assertTrue(TtsVoiceCatalog.isVoiceOf(TtsVoiceCatalog.NEW_AGENT_DEFAULT, voice), voice);
                String actual = TtsVoiceCatalog.forModel(TtsVoiceCatalog.NEW_AGENT_DEFAULT).stream()
                        .filter(v -> voice.equals(v.get("id"))).map(v -> v.get("gender")).findFirst().orElse(null);
                assertEquals(gender, actual, voice);
            }
        }
    }

    @Test
    void writerAnswerIsUsedWhenComplete() {
        TelleoAnswersDTO a = answers("BOOK_APPOINTMENTS", "english", "female");
        AgentDraft draft = TelleoAgentDraftBuilder.fromAssist(Map.of(
                "prompt", "PROMPT",
                "opening_line", "Hi {{name}}, this is Riya.",
                "derived", Map.of("extraction_questions", List.of("Preferred day"),
                        "dispositions", List.of("Booked"))), a, "X");
        assertNotNull(draft);
        assertEquals("PROMPT", draft.systemPrompt());
        assertEquals(List.of("Preferred day"), draft.extractionQuestions());
        assertEquals(List.of("Booked"), draft.dispositions());
    }

    @Test
    void incompleteWriterAnswerFallsBackToTheTemplate() {
        TelleoAnswersDTO a = answers("BOOK_APPOINTMENTS", "english", "female");
        assertNull(TelleoAgentDraftBuilder.fromAssist(null, a, "X"));
        assertNull(TelleoAgentDraftBuilder.fromAssist(Map.of("prompt", " "), a, "X"));
        AgentDraft noDerived = TelleoAgentDraftBuilder.fromAssist(
                Map.of("prompt", "P", "opening_line", "O"), a, "X");
        assertNotNull(noDerived);
        assertFalse(noDerived.extractionQuestions().isEmpty());
    }
}
