package vacademy.io.admin_core_service.features.telleo.service;

import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.telephony.core.TtsVoiceCatalog;
import vacademy.io.admin_core_service.features.telleo.dto.TelleoAnswersDTO;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Turns the onboarding answers into a draft agent: a brief for the existing agent writer
 * (AiAgentAssistService), and a fixed template per use case for when the writer fails. Sign-up
 * must never depend on an LLM key; the shared ones have run out of credit before.
 *
 * <p>Every fact in the draft comes from the user's own answers. Nothing is copied from another
 * customer's agent.
 */
public final class TelleoAgentDraftBuilder {

    private TelleoAgentDraftBuilder() {}

    public static final Set<String> GOALS =
            Set.of("QUALIFY_LEADS", "BOOK_APPOINTMENTS", "PAYMENT_REMINDERS", "FEEDBACK", "OTHER");
    public static final Set<String> OUTCOMES = Set.of("BOOKED", "INTERESTED", "TRANSFER", "DETAILS_COLLECTED");
    /** Exactly what the voice bot accepts: "en" would silently take the Hindi path. */
    public static final Set<String> LANGUAGES = Set.of("english", "hindi", "hinglish");

    /** Trial calls stop at 3 minutes, so 60 credits (about 10 minutes) is roughly three full calls. */
    public static final int TRIAL_MAX_CALL_MINUTES = 3;

    private static final int MAX_TEXT = 400;

    /** What a draft agent is made of, whichever way it was written. */
    public record AgentDraft(String name, String openingLine, String systemPrompt,
                             List<String> extractionQuestions, List<String> dispositions) {
    }

    // ── Validation ──────────────────────────────────────────────────────────────

    /** Trimmed, bounded and defaulted answers, or a 400 naming the first problem. */
    public static TelleoAnswersDTO clean(TelleoAnswersDTO in) {
        if (in == null) throw bad("Answer the questions first.");
        String business = text(in.getBusinessDescription());
        if (business == null) throw bad("Tell us what your business does.");
        String goal = upper(in.getGoal());
        if (goal == null || !GOALS.contains(goal)) throw bad("Pick what the agent should do.");
        String goalDetail = text(in.getGoalDetail());
        if ("OTHER".equals(goal) && goalDetail == null) throw bad("Tell us what the agent should do.");
        String audience = text(in.getAudience());
        if (audience == null) throw bad("Tell us who the agent will call.");
        String outcome = upper(in.getSuccessOutcome());
        if (outcome == null || !OUTCOMES.contains(outcome)) outcome = "INTERESTED";
        String language = lower(in.getLanguage());
        if (language == null || !LANGUAGES.contains(language)) language = "english";
        String gender = "male".equals(lower(in.getVoiceGender())) ? "male" : "female";
        String website = text(in.getWebsite());
        if (website != null && !website.matches("(?i)^(https?://)?[a-z0-9.-]+\\.[a-z]{2,}(/\\S*)?$")) website = null;
        String agentName = text(in.getAgentName());
        if (agentName != null && (agentName.length() > 30 || !agentName.matches("^[\\p{L} .'-]+$"))) agentName = null;
        return TelleoAnswersDTO.builder()
                .businessDescription(business)
                .website(website)
                .goal(goal)
                .goalDetail(goalDetail)
                .audience(audience)
                .successOutcome(outcome)
                .pricing(text(in.getPricing()))
                .language(language)
                .voiceGender(gender)
                .agentName(agentName)
                .build();
    }

    // ── Brief for the agent writer ──────────────────────────────────────────────

    public static String brief(TelleoAnswersDTO a, String company) {
        StringBuilder b = new StringBuilder();
        b.append("Company: ").append(company).append('\n');
        b.append("What the business does: ").append(a.getBusinessDescription()).append('\n');
        if (a.getWebsite() != null) b.append("Website: ").append(a.getWebsite()).append('\n');
        b.append("The agent's job: ").append(goalPhrase(a)).append('\n');
        b.append("Who it calls and why they expect the call: ").append(a.getAudience()).append('\n');
        b.append("A good call ends with: ").append(outcomePhrase(a.getSuccessOutcome())).append('\n');
        b.append("Price and offers: ").append(a.getPricing() == null
                ? "The agent does not quote any price or offer; it says the team will confirm."
                : a.getPricing()).append('\n');
        b.append("Agent name: ").append(agentName(a)).append(" (").append(a.getVoiceGender()).append(" voice)\n");
        b.append("Language: ").append(a.getLanguage()).append('\n');
        b.append("Calls are at most ").append(TRIAL_MAX_CALL_MINUTES)
                .append(" minutes, so keep the script short and reach the close quickly.\n");
        b.append("Use only the facts above. Where something is missing, the agent says the team will confirm.");
        return b.toString();
    }

    /** The writer's answer as a draft, or null when it is unusable (the template is used instead). */
    @SuppressWarnings("unchecked")
    public static AgentDraft fromAssist(Map<String, Object> result, TelleoAnswersDTO a, String company) {
        if (result == null) return null;
        Object prompt = result.get("prompt");
        Object opening = result.get("opening_line");
        if (!(prompt instanceof String p) || p.isBlank() || !(opening instanceof String o) || o.isBlank()) return null;
        List<String> questions = null;
        List<String> outcomes = null;
        if (result.get("derived") instanceof Map<?, ?> derived) {
            if (derived.get("extraction_questions") instanceof List<?> q) questions = strings((List<Object>) q);
            if (derived.get("dispositions") instanceof List<?> d) outcomes = strings((List<Object>) d);
        }
        AgentDraft fallback = template(a, company);
        return new AgentDraft(fallback.name(), o.trim(), p.trim(),
                questions == null || questions.isEmpty() ? fallback.extractionQuestions() : questions,
                outcomes == null || outcomes.isEmpty() ? fallback.dispositions() : outcomes);
    }

    // ── The fixed template ──────────────────────────────────────────────────────

    public static AgentDraft template(TelleoAnswersDTO a, String company) {
        String name = agentName(a);
        String reason = switch (a.getGoal()) {
            case "BOOK_APPOINTMENTS" -> "to help you book a time with our team";
            case "PAYMENT_REMINDERS" -> "about a pending payment";
            case "FEEDBACK" -> "to ask for your quick feedback";
            default -> "about your enquiry";
        };
        List<String> questions = new ArrayList<>(switch (a.getGoal()) {
            case "BOOK_APPOINTMENTS" -> List.of("What they need help with", "Preferred day", "Preferred time");
            case "PAYMENT_REMINDERS" -> List.of("Whether they know about the payment", "Date they will pay",
                    "Reason for delay");
            case "FEEDBACK" -> List.of("Rating out of ten", "What they liked", "What could be better");
            default -> List.of("What they are looking for", "When they need it", "Budget");
        });
        List<String> outcomes = switch (a.getGoal()) {
            case "BOOK_APPOINTMENTS" -> List.of("Appointment_Booked", "Callback", "Not_Interested", "Wrong_Person", "Incomplete");
            case "PAYMENT_REMINDERS" -> List.of("Will_Pay", "Already_Paid", "Dispute", "Callback", "Wrong_Person", "Incomplete");
            case "FEEDBACK" -> List.of("Positive", "Neutral", "Negative", "Callback", "Wrong_Person", "Incomplete");
            default -> List.of("Interested", "Callback", "Not_Interested", "Wrong_Person", "Incomplete");
        };
        String opening = opening(a.getLanguage(), a.getVoiceGender(), name, company, reason);

        StringBuilder p = new StringBuilder();
        p.append("You are ").append(name).append(", a friendly phone agent for ").append(company).append(". ");
        p.append("You have already said the opening line; do not introduce yourself again.\n\n");
        p.append("ABOUT THE BUSINESS\n").append(a.getBusinessDescription()).append('\n');
        if (a.getWebsite() != null) p.append("Website: ").append(a.getWebsite()).append('\n');
        p.append("\nWHO YOU ARE CALLING\n").append(a.getAudience()).append('\n');
        p.append("\nYOUR GOAL\n").append(capitalise(goalPhrase(a))).append(". A good call ends with ")
                .append(outcomePhrase(a.getSuccessOutcome())).append(".\n");
        p.append("\nPRICE AND OFFERS\n").append(a.getPricing() == null
                ? "Do not quote any price, discount or offer. Say: \"Our team will confirm the details for you.\""
                : a.getPricing() + "\nSay nothing about price beyond this. For anything else, say the team will confirm.")
                .append('\n');
        p.append("\nSCRIPT (one step at a time; skip a step the caller has already answered)\n");
        p.append("1. If they cannot talk now, ask when to call back, confirm it once and end politely.\n");
        int step = 2;
        for (String q : questions) {
            p.append(step++).append(". Find out: ").append(q.toLowerCase(Locale.ROOT))
                    .append(". Ask one short question, listen, then go to the next step.\n");
        }
        p.append(step).append(". Close: ").append(closePhrase(a.getSuccessOutcome()))
                .append(" Repeat it back once, thank them and say goodbye.\n");
        p.append("\nRULES\n");
        p.append("- Speak in ").append(languageRule(a.getLanguage())).append('\n');
        p.append("- At most two short sentences and one question per turn.\n");
        p.append("- Say numbers, dates and times as words.\n");
        p.append("- Never invent facts. If you do not know, say the team will confirm.\n");
        p.append("- If they ask a question mid-script, answer in one sentence and continue from the same step.\n");
        p.append("- If they are not interested, thank them once and end the call. If they ask who gave you "
                + "their number, say they enquired with ").append(company).append(".\n");
        p.append("- Keep the call under ").append(TRIAL_MAX_CALL_MINUTES).append(" minutes.\n");
        return new AgentDraft(name, opening, p.toString(), questions, outcomes);
    }

    /** One short spoken line, under 240 characters, with only the {{name}} placeholder. */
    static String opening(String language, String gender, String name, String company, String reason) {
        boolean male = "male".equals(gender);
        return switch (language) {
            case "hindi" -> "नमस्ते {{name}}, मैं " + company + " से " + name + " बोल " + (male ? "रहा" : "रही")
                    + " हूँ। क्या अभी दो मिनट बात हो सकती है?";
            case "hinglish" -> "Hello {{name}}, main " + company + " se " + name + " bol " + (male ? "raha" : "rahi")
                    + " hoon. Kya abhi do minute baat ho sakti hai?";
            default -> "Hi {{name}}, this is " + name + " from " + company + ", calling " + reason
                    + ". Is this a good time to talk?";
        };
    }

    // ── Voice ───────────────────────────────────────────────────────────────────

    /** A voice of the new-agent engine with the chosen gender, so the two always match. */
    public static String voiceFor(String language, String gender) {
        String model = TtsVoiceCatalog.NEW_AGENT_DEFAULT;
        List<Map<String, String>> voices = TtsVoiceCatalog.forModel(model);
        String wantedPrefix = "english".equals(language) ? "en-IN" : "hi-IN";
        return voices.stream()
                .filter(v -> gender.equals(v.get("gender")) && v.get("id").startsWith(wantedPrefix))
                .map(v -> v.get("id")).findFirst()
                .or(() -> voices.stream().filter(v -> gender.equals(v.get("gender"))).map(v -> v.get("id")).findFirst())
                .orElse(TtsVoiceCatalog.defaultVoice(model));
    }

    // ── helpers ─────────────────────────────────────────────────────────────────

    static String agentName(TelleoAnswersDTO a) {
        if (a.getAgentName() != null) return a.getAgentName();
        return "male".equals(a.getVoiceGender()) ? "Arjun" : "Riya";
    }

    private static String goalPhrase(TelleoAnswersDTO a) {
        return switch (a.getGoal()) {
            case "QUALIFY_LEADS" -> "call people who enquired, understand what they need and find out if they are a good fit";
            case "BOOK_APPOINTMENTS" -> "book an appointment with the team";
            case "PAYMENT_REMINDERS" -> "remind customers about a pending payment and get a date they will pay";
            case "FEEDBACK" -> "collect quick feedback from customers";
            default -> a.getGoalDetail();
        };
    }

    private static String outcomePhrase(String outcome) {
        return switch (outcome) {
            case "BOOKED" -> "a booked appointment";
            case "TRANSFER" -> "the person agreeing to speak with the team";
            case "DETAILS_COLLECTED" -> "all the details collected";
            default -> "the person saying they are interested";
        };
    }

    private static String closePhrase(String outcome) {
        return switch (outcome) {
            case "BOOKED" -> "agree a day and time for the appointment.";
            case "TRANSFER" -> "tell them someone from the team will call them back, and confirm a good time.";
            case "DETAILS_COLLECTED" -> "confirm the details you collected.";
            default -> "tell them the team will share the next steps, and confirm they are interested.";
        };
    }

    private static String languageRule(String language) {
        return switch (language) {
            case "hindi" -> "simple spoken Hindi, written in Devanagari. Use \"aap\" throughout.";
            case "hinglish" -> "natural Hinglish (Hindi with common English words), written in Latin script.";
            default -> "simple, polite Indian English.";
        };
    }

    private static List<String> strings(List<Object> in) {
        List<String> out = new ArrayList<>();
        for (Object o : in) {
            if (o instanceof String s && !s.isBlank() && out.size() < 8) out.add(s.trim());
        }
        return out;
    }

    private static String text(String s) {
        if (s == null) return null;
        String t = s.replaceAll("[\\r\\n\\t]+", " ").replaceAll("[<>\\[\\]{}]", "").trim();
        if (t.isEmpty()) return null;
        return t.length() > MAX_TEXT ? t.substring(0, MAX_TEXT) : t;
    }

    private static String upper(String s) {
        return s == null || s.isBlank() ? null : s.trim().toUpperCase(Locale.ROOT);
    }

    private static String lower(String s) {
        return s == null || s.isBlank() ? null : s.trim().toLowerCase(Locale.ROOT);
    }

    private static String capitalise(String s) {
        return s == null || s.isEmpty() ? s : Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }

    private static VacademyException bad(String message) {
        return new VacademyException(HttpStatus.BAD_REQUEST, message);
    }
}
