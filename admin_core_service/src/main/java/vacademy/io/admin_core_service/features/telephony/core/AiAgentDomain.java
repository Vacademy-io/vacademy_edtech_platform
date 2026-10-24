package vacademy.io.admin_core_service.features.telephony.core;

import java.text.Normalizer;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Is an AI voice agent calling for an EDUCATION business, judged from its own script only?
 *
 * <p>The voice bot's platform rules and this service's prompt-assistant rulebook were written
 * around education (classes, fees, parents, "steer toward the demo"). A non-education agent
 * with a thin script borrows them: AAIBUZZ/IRPL calls c43e9ce7 and e6cb5f47 (2026-10-16) told
 * the caller "we are an edtech company… class 1 to 12" and booked a 5 PM demo that does not
 * exist. So both sides now treat a non-education ("general") agent differently, and leave an
 * education agent exactly as it was.
 *
 * <p>One-sided on purpose: a false "education" costs nothing (today's behaviour), a false
 * "general" changes a working agent — so the list is broad and one hit is enough. A blank
 * script is education (legacy). Keep the term list in step with
 * voice_bot_service/app/agent_domain.py.
 */
final class AiAgentDomain {

    private AiAgentDomain() {
    }

    /** VoiceBotInternalController.registryAgentMap's stand-in for a blank system prompt. */
    private static final String BLANK_PROMPT_STAND_IN = "You are a friendly, concise phone assistant.";

    /** English and romanised Hindi, whole words. "learn", "study", "degree" left out: every sales script has them. */
    private static final Pattern LATIN = Pattern.compile("\\b(?:"
            + "class(?:es|room|rooms|mates?)?|students?|parents?|parenting|guardians?|child(?:ren|'s)?|kids?"
            + "|schools?|schooling|pre-?schools?|colleges?|universit(?:y|ies)|courses?|courseware|coaching"
            + "|tuitions?|tutors?|tutoring|tutorials?|admissions?|exams?|examinations?|marks|syllabus"
            + "|teach(?:er|ers|ing)?|faculty|institutes?|academy|academies|academics?|learning|learners?"
            + "|e-?learning|lectures?|lecturers?|scholarships?|batch(?:es)?|cbse|icse|neet|jee|upsc|ssc"
            + "|ielts|toefl|olympiads?|grades?|subjects?|curricul(?:um|a)|lms|counsell?ors?|counsell?ing"
            + "|ed-?tech|educat(?:ion|ional|ors?)|homework|semesters?|diplomas?|quiz(?:zes)?|training"
            + "|trainers?|bootcamps?"
            // Exam prep, degrees, "your son/daughter"; see agent_domain.py for what is left out and why.
            + "|masterclass(?:es)?|mba|bba|bca|b\\.?\\s?tech|m\\.?\\s?tech|mbbs|cuet|clat|test series"
            + "|mock tests?|upskill(?:ing|s)?|bete|beti|pathshala"
            + "|padh(?:ai|aai|na|ne|te|ta|ti|o)|bach(?:cha|che|chon|chi)"
            + "|bac(?:cha|che|chon)|vidyarthi|vidyalaya|chhatra|shiksha|kaksha|pariksha|gurukul"
            // UNICODE_CHARACTER_CLASS: \b as Python's re sees it (Unicode-aware), so the two
            // copies agree on a word next to an accented or Indic letter.
            + ")\\b", Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CHARACTER_CLASS);

    /** Indic stems, matched as substrings after NFC (\b is unreliable inside Devanagari). */
    private static final List<String> INDIC = List.of(
            "बच्च", "पढ़", "पढा", "पढ़ा", "क्लास", "कक्षा", "छात्र", "विद्यार्थ", "स्टूडेंट", "स्टुडंट",
            "स्कूल", "शाळा", "पाठशाला", "विद्यालय", "कॉलेज", "कोचिंग", "ट्यूशन", "शिकवणी",
            "एडमिशन", "दाखिला", "परीक्षा", "एग्जाम", "एग्ज़ाम", "एक्जाम", "मार्क्स", "शिक्षा",
            "शिक्षक", "शैक्षणिक", "टीचर", "अध्यापक", "कोर्स", "सिलेबस", "पाठ्यक्रम", "अभ्यासक्रम",
            "अभिभावक", "माता-पिता", "पैरेंट", "पालक", "बैच", "इयत्ता", "छात्रवृत्ति", "स्कॉलरशिप",
            "लेक्चर", "ट्यूटर", "अकादमी", "एकेडमी", "लर्निंग", "सब्जेक्ट", "काउंसलर", "काउंसलिंग",
            "बेटा", "बेटी", "बेटे", "बेटों", "ट्रेनिंग", "मास्टरक्लास", "टेस्ट सीरीज",
            "શાળા", "વિદ્યાર્થી", "স্কুল", "ছাত্র", "ਸਕੂਲ", "ਵਿਦਿਆਰਥੀ")
            .stream().map(t -> Normalizer.normalize(t, Normalizer.Form.NFC)).toList();

    /** Any education word in any of the texts. */
    static boolean hasEducationSignal(String... texts) {
        for (String t : texts) {
            if (t == null || t.isBlank()) continue;
            String norm = Normalizer.normalize(t, Normalizer.Form.NFC).replace('_', ' ');
            if (LATIN.matcher(norm).find()) return true;
            for (String stem : INDIC) {
                if (norm.contains(stem)) return true;
            }
        }
        return false;
    }

    /**
     * A non-education agent: its script is not blank and neither it nor the agent's other
     * fields (opening line, name, questions, outcomes) carry an education word.
     */
    static boolean isGeneral(String script, String... otherFields) {
        if (script == null || script.isBlank()) return false;
        // The voice bot treats this stand-in (what registryAgentMap sends for a blank prompt)
        // as blank too, so a legacy agent is education on both sides.
        if (BLANK_PROMPT_STAND_IN.equals(script.trim())) return false;
        return !hasEducationSignal(script) && !hasEducationSignal(otherFields);
    }

    /** The agent context's own fields, for {@link #isGeneral}. */
    static String[] fieldsOf(AiAgentAssistService.AgentContext agent, String... more) {
        if (agent == null) return more;
        List<String> out = new java.util.ArrayList<>(java.util.Arrays.asList(more));
        out.add(agent.name());
        out.add(agent.openingLine());
        out.add(agent.useCase());
        if (agent.extractionQuestions() != null) out.addAll(agent.extractionQuestions());
        if (agent.dispositions() != null) out.addAll(agent.dispositions());
        return out.toArray(new String[0]);
    }
}
