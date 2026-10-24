package vacademy.io.admin_core_service.features.telephony.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.agent.dto.ConversationSession;
import vacademy.io.admin_core_service.features.agent.service.LLMService;
import vacademy.io.admin_core_service.features.ai_models.service.AiModelDefaultsResolver;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.credits.client.MeteringFields;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiAgentAssistJob;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiCallResult;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.AiAgentAssistJobRepository;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.AiCallResultRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * LLM-assisted authoring for AI voice agents: draft a system prompt from a plain
 * brief, score/critique an existing prompt against a rubric distilled from live-call
 * failures, apply selected suggestions, revise from admin feedback grounded in the
 * agent's real recent calls (transcripts + the bot's per-call fault codes), and
 * regenerate the whole prompt + opening line from the admin's free-form notes.
 *
 * Every operation is one LLM round-trip with a STRICT-JSON contract and one re-emit
 * retry, on the 'agent_assist' default model first and its fallback if that fails. Each result
 * also carries {@code lint}: deterministic checks for the spoken-line defects we kept
 * finding on live calls, so the admin sees them even when the model misses them.
 *
 * A long prompt on a reasoning model takes minutes, so the admin UI runs these as
 * background jobs ({@link #startJob}/{@link #getJob}); the synchronous methods remain
 * for older clients.
 *
 * Metering: flat {@link #COST} credit per successful operation, post-paid via
 * CreditClient.deductPrecomputed (request_type "content", as course-assist).
 */
@Slf4j
@Service
public class AiAgentAssistService {

    private static final BigDecimal COST = BigDecimal.ONE;
    private static final int MAX_ATTEMPTS = 2;
    /** Cap of recent call records fed into feedback grounding. */
    private static final int FEEDBACK_CALLS = 12;
    /** Per-transcript head/tail char caps so 12 calls can't blow the context. */
    private static final int TRANSCRIPT_HEAD = 1500;
    private static final int TRANSCRIPT_TAIL = 900;
    /** A RUNNING job not touched for this long belonged to a pod that died. */
    private static final Duration STALE_JOB = Duration.ofMinutes(15);

    public static final Set<String> OPERATIONS = Set.of("draft", "analyze", "improve", "feedback", "regenerate");

    @Autowired
    @Lazy
    private LLMService llmService;

    @Autowired
    @Lazy
    private CreditClient creditClient;

    @Autowired
    private AiCallResultRepository aiCallResultRepository;

    @Autowired
    private AiAgentAssistJobRepository jobRepository;

    @Autowired
    private AiModelDefaultsResolver modelDefaults;

    /** ai_model_defaults row for the prompt assistant (GLM default, gemini-2.5-flash fallback). */
    static final String USE_CASE = "agent_assist";

    private final ObjectMapper objectMapper = new ObjectMapper();

    private final ExecutorService jobs = Executors.newFixedThreadPool(4, r -> {
        Thread t = new Thread(r, "agent-assist-job");
        t.setDaemon(true);
        return t;
    });

    /**
     * GLM-5.3 Flash: always reasons, ~$0.005 per full rewrite of a 25k-char prompt (~2 min).
     * Probed 2026-09-29 on the live Shreya prompt: effort=low wrote "के बाद में" for "के बारे
     * में" three times; medium got the Hindi right. Sonnet: same quality class, 40x the cost.
     *
     * Optional override. Blank (the default) = the agent_assist row in ai_model_defaults.
     */
    @Value("${agent.assist.model:}")
    private String model;

    /**
     * Optional override of the model used when the primary errors, truncates, or twice returns
     * unreadable JSON. Blank (the default) = the agent_assist row's fallback.
     */
    @Value("${agent.assist.fallback-model:}")
    private String fallbackModel;

    /** Output budget. A full rewrite of a ~20k-char Hindi prompt plus reasoning needs ~20k. */
    @Value("${agent.assist.max-tokens:32000}")
    private int maxTokens;

    /**
     * Kept at medium for the Hindi quality noted above. Isoquant has no "medium", so the
     * Isoquant leg runs at "high" and an OpenRouter leg at "medium" (LlmGatewayRouter).
     */
    @Value("${agent.assist.reasoning-effort:medium}")
    private String reasoningEffort;

    /** The agent the admin is editing — sent with every operation (unsaved edits included). */
    public record AgentContext(String name, String language, String openingLine, String useCase,
                               List<String> extractionQuestions, List<String> dispositions) {
    }

    // ── What we learned on live calls. Shared by every operation. ─────────────
    private static final String VOICE_RULEBOOK = """
            HOW THIS PLATFORM RUNS THE PROMPT (write for it):
            - The OPENING LINE is spoken verbatim by the platform before the caller says anything.
              The prompt must NOT tell the agent to introduce itself again — step 1 of the script is
              what comes AFTER the opening.
            - Every reply is spoken by a text-to-speech voice, a few seconds at a time. The platform
              already handles: silence and "hello, are you there?" checks, the caller interrupting,
              repeating a line the caller didn't hear, switching language when the caller asks,
              voicemail/IVR detection, the goodbye after the call is concluded. Do NOT spend prompt
              words on these.
            - The whole prompt is re-sent on EVERY turn of EVERY call: its length is paid for and
              adds latency each time. Aim for 6,000-12,000 characters; say each rule ONCE; no
              repeated "IMPORTANT" blocks, no duplicate examples.
            - Placeholders the platform fills at call time: {{name}} (the lead's first name; if
              unknown it becomes "aap" in Hindi and disappears in English), {{today}}, {{tomorrow}},
              {{day}}, {{time}}. Any other {{field}} only works if the lead list has a column of that
              exact name — otherwise it is spoken as NOTHING. Never use <name>, [child name],
              (student name) or similar: they are read out literally or mangled.

            SPOKEN-LINE RULES (every line the agent is meant to SAY, including the opening line):
            1. SCRIPT. {script_rule}
            2. ONE FORM, NO SLASHES. Never "बेटा/बेटी", "sir/ma'am", "he/she", "आप/तुम", "Class 11/12".
               The model reads both halves aloud. Pick one neutral form ("बच्चे", "आपका बच्चा",
               "your child") or tell the agent to use the caller's own word once known.
            3. NO DASH-SPLIT LINES. Write "जी, समझ गई। अब बताइए…" not "जी, समझ गई — अब बताइए…".
               A line shaped "जी, X — Y" gets cut at the dash by the platform's echo trimmer.
            4. SHORT TURNS. At most 2-3 short sentences and ONE question per turn. Long pitches are
               cut off by the platform after ~240 characters and callers tune out.
            5. ONE ACKNOWLEDGEMENT. One brief praise or ack per turn ("बढ़िया।"), never stacked
               ("बहुत बढ़िया! Great! Wonderful!").
            6. NUMBERS AS WORDS. Fees, dates, times, classes in words the voice can say:
               "पैंतीस हज़ार रुपये", "ग्यारहवीं क्लास", "शाम पाँच बजे" — never "₹35,000", "11th", "5 PM".
            7. NEVER INVENT FACTS. Only fees, batches, timings, dates, discounts, results, addresses
               and "you enquired on our website" style sources that are WRITTEN in the prompt. If a
               caller asks something not covered, the agent says a counsellor will confirm it.
            8. CONSISTENT SELF. The agent's own gender stays fixed (a female agent says "बोल रही हूँ",
               "समझ गई"); address the caller with "आप" throughout.
            9. PROOFREAD LIKE A NATIVE SPEAKER. Before replying, re-read every sample line as a parent
               would hear it on the phone and fix the grammar: "बच्चे के बारे में" (about), never
               "बच्चे के बाद में" (after); correct postpositions and verb gender. The agent copies
               sample lines word for word, so one wrong word is spoken on every call.
            10. CACHE-FRIENDLY LINES. Spoken audio is reused across calls only when a sentence is
               byte-for-byte the same, so: give each fixed script line ONE exact wording and tell
               the agent to say it verbatim; do not put the child's or caller's name inside a long
               sentence (say "बच्चे", or put the name in its own short sentence before it); use the
               same punctuation every time a line appears; one address form per line, not a
               variable "सर/मैम" inside it.

            SCRIPT STRUCTURE (the #1 cause of repeated lines and stuck calls was a prompt that did not
            say what comes next):
            - Write the conversation as NUMBERED STEPS. Each step: its goal, the one question to ask
              (as a sample line), how to handle the likely answers, and "then go to step N".
            - Say explicitly: if the caller already gave an answer earlier, skip that step; never
              ask a question that was already answered; never say a line already said.
            - If the caller asks a question mid-script, answer it in one or two sentences, then
              continue from the SAME step — do not restart the script.
            - Program / fee / batch choice must be a RULE the agent can apply (e.g. a small table:
              class + goal -> program -> fee), not "recommend a suitable program".
            - End with a concrete close: the specific next step (counsellor callback, demo slot,
              WhatsApp details), confirmed back once, then a short goodbye.
            - Objections ("send me details", "not interested", "call later", "who gave you my
              number?"): one sentence acknowledgement + ONE small concrete offer, then accept.
            """;

    private static final String RUBRIC = """
            Score the SYSTEM PROMPT (and its opening line) for a real-time AI PHONE agent on these
            dimensions, 0-10 each. Every dimension is a failure mode seen on real calls:
            1. identity_opening — opening line: agent name + institute + reason in 1-2 short
               sentences ending in ONE easy question; the prompt does not re-introduce the agent.
            2. script_flow — numbered steps with explicit "next step"; skip-if-already-answered;
               resume-after-question; a concrete close. (Missing flow = repeated lines, stuck calls.)
            3. conversation_mechanics — short turns, one question per turn, one acknowledgement,
               pitch broken into short beats; no monologues.
            4. objection_handling — explicit handling for the common objections with ONE redirect
               then graceful acceptance.
            5. knowledge_answers — the facts callers ask about (fees, batches, timings, mode,
               location, results) are present, and program/fee choice is a rule, not a guess.
            6. language_script — the declared language and script rule followed in every sample
               line; no mixed-script words; numbers as words.
            7. spoken_hygiene — no unsupported placeholders, no <angle>/[bracket] slots, no slash
               pairs, no dash-split lines, no markdown read aloud, no invented facts; prompt length
               reasonable (every character is re-sent each turn).
            """;

    private static final String OUTPUT_ANALYSIS = """
            "score": <0-100 overall integer>,
            "persona": "<2-5 word label you infer, e.g. 'Admissions sales caller' — infer freely>",
            "dimensions": [ {"key": "identity_opening", "label": "Identity & opening", "score": <0-10>, "comment": "<one short sentence>"} , ... all 7 ],
            "suggestions": [ {"title": "<short imperative>", "detail": "<why, one sentence, reference the rubric>", "addition": "<ready-to-insert prompt text implementing it, following the spoken-line rules>"} , 3-6 items, highest impact first ],
            "derived": {
              "opening_line": "<the single spoken opening line — follows every spoken-line rule; only supported placeholders>",
              "extraction_questions": ["<3-6 things the agent should find out, each a short phrase>"],
              "dispositions": ["<4-6 call outcome labels fitting this agent, e.g. Interested, Demo_Booked, Callback, Not_Interested, Wrong_Person, Incomplete>"]
            }""";

    /** For operations that rewrite: the new prompt and opening line are top-level fields. */
    private static final String OUTPUT_REWRITE_HEAD = """
            "prompt": "<the full system prompt>",
            "opening_line": "<the opening line to use with it — follows every spoken-line rule>",
            "change_summary": "<3-6 short sentences: what you changed and why>",
            """;

    /**
     * The agent's side fields are read by other parts of the platform (the opening line is spoken
     * verbatim; the questions drive post-call extraction; the outcomes are the call's disposition
     * labels), so a rewrite that changes the script must hand back a MATCHING set.
     */
    private static final String KEEP_IN_SYNC = """

            KEEP EVERYTHING IN SYNC. The agent has four parts that must agree: the system prompt, the
            opening line, the questions to find out, and the call outcomes. In your JSON, "opening_line"
            and "derived.opening_line" are the SAME line, and it must fit step 1 of the new script (the
            script continues from it and never repeats the introduction). "derived.extraction_questions"
            are exactly the facts the new script collects, in the order it asks them (short phrases in
            English, e.g. "Student's class"). "derived.dispositions" are the outcomes the new script can
            end in (e.g. Interested, Demo_Booked, Callback, Not_Interested, Wrong_Person, Incomplete).
            Start from the current questions/outcomes given below: keep the ones that still apply
            (same wording, so reports stay comparable), drop ones the script no longer covers, add new
            ones it does.
            """;

    // ─────────────────────────────────────────────────────────────────────────

    public Map<String, Object> draft(String instituteId, String brief, AgentContext agent) {
        require(brief, "brief");
        String system = expert("WRITE a complete, production-quality system prompt and opening line for "
                + "the agent from the admin's plain-language brief, then score your output against the rubric.",
                agent, AiAgentDomain.isGeneral(brief, AiAgentDomain.fieldsOf(agent)))
                + KEEP_IN_SYNC + "\nReply with ONLY this JSON object:\n{\n" + OUTPUT_REWRITE_HEAD + OUTPUT_ANALYSIS + "\n}";
        String user = "BRIEF FROM THE ADMIN:\n" + brief + agentFacts(agent);
        return finish(instituteId, "draft", rewrite(instituteId, system, user, "draft", agent), agent, null);
    }

    public Map<String, Object> analyze(String instituteId, String prompt, AgentContext agent) {
        require(prompt, "prompt");
        String system = expert("Critique the given prompt and opening line STRICTLY against the rubric "
                + "and rules. Be honest — a thin or pasted-from-a-doc prompt should score low with "
                + "actionable suggestions. Never invent facts about the business; suggestions must be "
                + "generic-safe or clearly marked for the admin to fill.", agent,
                AiAgentDomain.isGeneral(prompt, AiAgentDomain.fieldsOf(agent)))
                + "\nReply with ONLY this JSON object:\n{\n" + OUTPUT_ANALYSIS + "\n}";
        String user = "SYSTEM PROMPT TO REVIEW:\n" + prompt + agentFacts(agent);
        return finish(instituteId, "analyze", callJson(instituteId, system, user, "analyze"), agent, prompt);
    }

    public Map<String, Object> improve(String instituteId, String prompt, List<String> additions,
                                       AgentContext agent) {
        require(prompt, "prompt");
        if (additions == null || additions.isEmpty()) {
            throw new VacademyException("Select at least one suggestion to apply.");
        }
        StringBuilder adds = new StringBuilder();
        for (int i = 0; i < additions.size(); i++) {
            adds.append(i + 1).append(". ").append(additions.get(i)).append("\n");
        }
        String system = expert("REWRITE the given prompt to incorporate the selected improvements. "
                + "Preserve the author's intent, structure, facts, language and voice — integrate, "
                + "don't bolt on; remove content the improvements supersede. Then score the REVISED "
                + "prompt against the rubric.", agent,
                AiAgentDomain.isGeneral(prompt, AiAgentDomain.fieldsOf(agent)))
                + KEEP_IN_SYNC + "\nReply with ONLY this JSON object:\n{\n" + OUTPUT_REWRITE_HEAD + OUTPUT_ANALYSIS + "\n}";
        String user = "CURRENT PROMPT:\n" + prompt + agentFacts(agent)
                + "\n\nIMPROVEMENTS TO INCORPORATE:\n" + adds;
        return finish(instituteId, "improve", rewrite(instituteId, system, user, "improve", agent), agent, null);
    }

    public Map<String, Object> feedbackRevise(String instituteId, String agentId, String prompt,
                                              String feedback, AgentContext agent) {
        require(prompt, "prompt");
        require(feedback, "feedback");
        String callData = recentCallDigest(agentId, instituteId);
        String system = expert("The admin has feedback after real calls. Using their feedback AND the "
                + "actual recent call records (transcripts and the platform's fault codes may reveal "
                + "problems the admin didn't articulate), REWRITE the prompt to fix the issues that a "
                + "PROMPT can fix. Preserve intent, facts, language and voice. Then score the revised "
                + "prompt against the rubric.", agent,
                AiAgentDomain.isGeneral(prompt, AiAgentDomain.fieldsOf(agent)))
                + KEEP_IN_SYNC + "\nReply with ONLY this JSON object:\n{\n" + OUTPUT_REWRITE_HEAD
                + "\"call_insights\": [\"<0-5 short observations you drew from the actual call records>\"],\n"
                + OUTPUT_ANALYSIS + "\n}";
        String user = "CURRENT PROMPT:\n" + prompt + agentFacts(agent)
                + "\n\nADMIN FEEDBACK:\n" + feedback
                + "\n\nRECENT REAL CALLS FOR THIS AGENT:\n"
                + (callData.isBlank() ? "(no call records available)" : callData);
        return finish(instituteId, "feedback", rewrite(instituteId, system, user, "feedback", agent), agent, null);
    }

    /**
     * Regenerate the prompt AND opening line from the admin's free-form notes. Works with or
     * without a current prompt: with one, its facts and flow are kept unless the notes change
     * them; the agent's recent calls are read too, so a regenerate also fixes what went wrong.
     */
    public Map<String, Object> regenerate(String instituteId, String agentId, String prompt,
                                          String notes, AgentContext agent) {
        require(notes, "notes");
        boolean hasPrompt = prompt != null && !prompt.isBlank();
        String callData = hasPrompt ? recentCallDigest(agentId, instituteId) : "";
        String system = expert("REGENERATE the agent's full system prompt and opening line from the "
                + "admin's notes. The notes are the admin's instructions and take priority. "
                + (hasPrompt
                    ? "Start from the CURRENT PROMPT: keep every business fact (fees, programs, "
                      + "batches, timings, names, policies) and every step the notes don't change — "
                      + "do not drop facts to save space; restructure, tighten and fix everything else "
                      + "so the result follows every rule. Where the recent call records show a problem "
                      + "a prompt can fix, fix it too. "
                    : "")
                + "Then score the result against the rubric.", agent,
                AiAgentDomain.isGeneral(hasPrompt ? prompt : notes, AiAgentDomain.fieldsOf(agent, notes)))
                + KEEP_IN_SYNC + "\nReply with ONLY this JSON object:\n{\n" + OUTPUT_REWRITE_HEAD
                + "\"call_insights\": [\"<0-5 short observations from the call records, if any>\"],\n"
                + OUTPUT_ANALYSIS + "\n}";
        String user = "ADMIN'S NOTES (what they want):\n" + notes + agentFacts(agent)
                + (hasPrompt ? "\n\nCURRENT PROMPT:\n" + prompt : "\n\n(No current prompt — write from scratch.)")
                + (callData.isBlank() ? "" : "\n\nRECENT REAL CALLS FOR THIS AGENT:\n" + callData);
        return finish(instituteId, "regenerate", rewrite(instituteId, system, user, "regenerate", agent), agent, null);
    }

    // ── Background jobs ──────────────────────────────────────────────────────

    /** Records a RUNNING job and runs {@code work} off-thread; the caller polls {@link #getJob}. */
    public Map<String, Object> startJob(String instituteId, String agentId, String operation,
                                        Supplier<Map<String, Object>> work) {
        if (!OPERATIONS.contains(operation)) {
            throw new VacademyException("Unknown assist operation: " + operation);
        }
        Instant now = Instant.now();
        AiAgentAssistJob job = jobRepository.save(AiAgentAssistJob.builder()
                .id(UUID.randomUUID().toString())
                .instituteId(instituteId)
                .agentId(agentId)
                .operation(operation)
                .status(AiAgentAssistJob.RUNNING)
                .model(primaryModel())
                .createdAt(now)
                .updatedAt(now)
                .build());
        String jobId = job.getId();
        jobs.submit(() -> {
            try {
                Map<String, Object> result = work.get();
                complete(jobId, AiAgentAssistJob.DONE, result, null);
            } catch (VacademyException e) {
                complete(jobId, AiAgentAssistJob.FAILED, null, e.getMessage());
            } catch (Exception e) {
                log.warn("agent-assist job {} ({}) failed: {}", jobId, operation, e.getMessage());
                complete(jobId, AiAgentAssistJob.FAILED, null, "The AI assistant failed — please retry.");
            }
        });
        return jobView(job);
    }

    public Map<String, Object> getJob(String instituteId, String jobId) {
        AiAgentAssistJob job = jobRepository.findByIdAndInstituteId(jobId, instituteId)
                .orElseThrow(() -> new VacademyException("Assist job not found"));
        if (AiAgentAssistJob.RUNNING.equals(job.getStatus())
                && job.getUpdatedAt().isBefore(Instant.now().minus(STALE_JOB))) {
            job.setStatus(AiAgentAssistJob.FAILED);
            job.setError("The AI assistant was interrupted — please retry.");
            job.setUpdatedAt(Instant.now());
            jobRepository.save(job);
        }
        return jobView(job);
    }

    private void complete(String jobId, String status, Map<String, Object> result, String error) {
        try {
            jobRepository.findById(jobId).ifPresent(j -> {
                j.setStatus(status);
                j.setResult(result);
                j.setError(error);
                if (result != null && result.get("_model") instanceof String m) j.setModel(m);
                j.setUpdatedAt(Instant.now());
                jobRepository.save(j);
            });
        } catch (Exception e) {
            log.error("agent-assist: could not record job {} result: {}", jobId, e.getMessage());
        }
    }

    private static Map<String, Object> jobView(AiAgentAssistJob j) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("jobId", j.getId());
        m.put("operation", j.getOperation());
        m.put("status", j.getStatus());
        if (j.getResult() != null) m.put("result", j.getResult());
        if (j.getError() != null) m.put("error", j.getError());
        m.put("elapsedSeconds", Duration.between(j.getCreatedAt(),
                AiAgentAssistJob.RUNNING.equals(j.getStatus()) ? Instant.now() : j.getUpdatedAt()).toSeconds());
        return m;
    }

    @PreDestroy
    void shutdown() {
        jobs.shutdownNow();
    }

    // ── Prompt pieces ────────────────────────────────────────────────────────

    /**
     * For a non-education agent ({@link AiAgentDomain}). The rulebook's examples are all
     * education (fees, batches, parents, "counsellor callback, demo slot"), and the voice bot
     * showed what a model does with them when the script is thin: AAIBUZZ/IRPL calls c43e9ce7,
     * e6cb5f47 (2026-10-16) invented an edtech product and booked a demo. An education agent's
     * system prompt here is unchanged, byte for byte.
     */
    private static final String GENERAL_AGENT_NOTE = "This agent is NOT for an education business. "
            + "The examples in the rules below come from education agents (classes, fees, batches, "
            + "parents, children, counsellors, demos): copy their FORM, never their content, and do not "
            + "add students, parents, courses, classes or a demo to this agent. Never invent what the "
            + "business is, what it sells, its prices or offers, or why it is calling this person: use "
            + "only what the admin wrote, and where that is missing, say so in a suggestion (or the "
            + "change_summary) instead of filling it in. ";

    private static String expert(String task, AgentContext agent, boolean general) {
        return "You are an expert architect of real-time AI PHONE agents for "
                + (general ? "businesses in India. " + GENERAL_AGENT_NOTE : "education businesses in India. ")
                + task + "\n\n"
                + VOICE_RULEBOOK.replace("{script_rule}", scriptRule(agent.language()))
                + "\n" + RUBRIC;
    }

    private static String agentFacts(AgentContext agent) {
        StringBuilder sb = new StringBuilder();
        if (notBlank(agent.name())) sb.append("\nAgent name: ").append(agent.name());
        sb.append("\nAgent language: ").append(languageLabel(agent.language()));
        if (notBlank(agent.useCase())) sb.append("\nUse case: ").append(agent.useCase());
        sb.append("\nCurrent opening line: ")
          .append(notBlank(agent.openingLine()) ? agent.openingLine() : "(none yet — write one)");
        sb.append("\nCurrent questions to find out: ").append(listOrNone(agent.extractionQuestions()));
        sb.append("\nCurrent call outcomes: ").append(listOrNone(agent.dispositions()));
        return sb.toString();
    }

    private static String listOrNone(List<String> items) {
        if (items == null || items.stream().noneMatch(AiAgentAssistService::notBlank)) return "(none yet)";
        return String.join("; ", items.stream().filter(AiAgentAssistService::notBlank).toList());
    }

    /** Normalised language family used by the rulebook and the lint. */
    static String languageFamily(String language) {
        String l = language == null ? "" : language.trim().toLowerCase(Locale.ROOT);
        if (l.isEmpty() || l.startsWith("hinglish") || l.equals("hi") || l.startsWith("hi-")
                || l.startsWith("hindi")) return "hindi";
        if (l.equals("en") || l.startsWith("en-") || l.startsWith("english")) return "english";
        if (l.startsWith("mr") || l.startsWith("marathi")) return "marathi";
        return l;
    }

    private static String languageLabel(String language) {
        return switch (languageFamily(language)) {
            case "hindi" -> "Hindi / Hinglish (Hindi written in Devanagari, English business words in Latin)";
            case "english" -> "English (Indian English)";
            case "marathi" -> "Marathi (Devanagari)";
            default -> language;
        };
    }

    private static String scriptRule(String language) {
        return switch (languageFamily(language)) {
            case "english" -> "Plain Indian English in Latin letters only; no Hindi words.";
            case "marathi" -> "Marathi words in DEVANAGARI (मराठी), never romanised; common English "
                    + "business words (fees, batch, online, demo, NEET) stay in Latin letters. Use "
                    + "Marathi forms, not Hindi (\"तुमचं\", not \"आपका\").";
            case "hindi" -> "Hindi words in DEVANAGARI, never romanised (\"आपका बच्चा किस क्लास में है?\", "
                    + "NOT \"aapka baccha kis class mein hai?\"); common English business words (fees, "
                    + "batch, online, demo, NEET, counsellor) stay in Latin letters, never spelt in "
                    + "Devanagari. Everyday phone Hindi, not textbook Hindi.";
            default -> "Write " + language + " words in that language's own script, never romanised; "
                    + "common English business words stay in Latin letters.";
        };
    }

    // ── Deterministic lint of the result ─────────────────────────────────────

    private static final Set<String> SUPPORTED_PLACEHOLDERS = Set.of(
            "name", "lead_name", "today", "tomorrow", "day", "date", "time", "datetime", "now",
            "year", "month", "institute_name", "lead_source");
    private static final Pattern CURLY = Pattern.compile("\\{\\{\\s*([^}]+?)\\s*}}");
    private static final Pattern ANGLE_SLOT = Pattern.compile("<\\s*[\\p{L}_ ]{2,30}\\s*>");
    private static final Pattern BRACKET_SLOT = Pattern.compile(
            "\\[\\s*(?:child|student|parent|kid|name|बच्चे|नाम)[^\\]]{0,25}]", Pattern.CASE_INSENSITIVE);
    private static final Pattern QUOTED = Pattern.compile("[\"“]([^\"“”\\n]{4,400})[\"”]");
    private static final Pattern SLASH_PAIR = Pattern.compile("[\\p{L}\\p{M}]+\\s?/\\s?[\\p{L}\\p{M}]+");
    private static final Pattern DASH_SPLIT = Pattern.compile("\\S\\s[—–]\\s\\S");
    private static final Pattern DIGITS = Pattern.compile("[₹]|\\d");
    private static final Pattern ROMAN_HINDI = Pattern.compile(
            "\\b(aap|aapka|aapke|hai|hain|kya|mein|nahi|nahin|kaise|bataiye|batayein|ji haan|theek|accha|achha)\\b",
            Pattern.CASE_INSENSITIVE);

    /**
     * The advisory finding for a non-education script that never says what is offered and/or why
     * the person is called. Not a defect the model can fix — it could only invent the missing
     * facts — so it is added only by the 4-argument lint, never by the 3-argument one that the
     * repair pass ({@link #fixable}) uses.
     */
    static final String GROUNDING_LINT_PREFIX = "The script may not say ";

    /**
     * Above this length the advisory stays quiet: a long script nearly always says what it sells,
     * in words a keyword check cannot list, and a wrong warning teaches admins to ignore the lint.
     * The incident script was 512 characters.
     */
    static final int GROUNDING_LINT_MAX_CHARS = 1500;

    /**
     * A business stating what it sells: "we offer…", "SolarCo installs…", "X, a fitness studio",
     * "X is a … company", "we are Acko", "our products…", a price (₹, rs, rupees, lakh, crore), or
     * the Hinglish/Hindi forms ("humari company loans deti hai", "Tata की गाड़ियाँ बेचता है").
     * Widened after review (2026-10-16): the first cut missed 6 of 6 realistic grounded scripts.
     */
    private static final Pattern STATES_OFFER = Pattern.compile(
            "\\bwe(?:'re| are)? (?:offer|provide|sell|supply|make|manufacture|build|run|deliver|help"
            + "|install|distribute|export|rent|lease|design|develop|manage|arrange|organi[sz]e)(?:s|ing)?\\b"
            + "|\\bwe(?:'re| are) (?:a|an|the|india's)\\b"
            // "We are Acko insurance": a capitalised name after "we are" (case-sensitive here only).
            + "|\\bwe(?:'re| are) (?-i:\\p{Lu})"
            // Any subject: "SolarCo installs rooftop solar", "Sharma Motors sells Tata cars".
            + "|\\b(?:sells|installs|offers|provides|supplies|manufactures|deals in|distributes|exports"
            + "|imports|rents out|leases|delivers|operates|repairs|builds|designs|develops)\\b"
            + "|(?:\\b(?:is|are)|,) (?:a|an|india's|the) [\\p{L}\\s&,-]{0,50}?(?:company|platform|provider"
            + "|manufacturer|agency|firm|brand|business|store|shop|startup|dealer|dealership|distributor"
            + "|clinic|hospital|developer|builder|consultancy|bank|insurer|app|software|service|services"
            + "|studio|gym|salon|spa|restaurant|cafe|hotel|resort|showroom|lab|pharmacy|centre|center"
            + "|outlet|chain|maker|supplier|retailer|wholesaler|exporter|importer|contractor|nbfc|lender)\\b"
            + "|\\bour (?:products?|services?|solutions?|platform|plans?|packages?|offers?|offerings?|range"
            + "|catalog(?:ue)?|projects?|properties|polic(?:y|ies)|app|software|machines?|menu|brands?)\\b"
            + "|[₹]\\s?\\d|\\brs\\.?\\s?\\d|\\d[\\d,]*\\s?(?:rupees|inr|/-)"
            + "|\\d[\\d,.]*\\s?(?:lakhs?|lacs?|crores?)\\b"
            + "|(?:hum|ham)\\s.{0,60}?(?:dete|karte|bechte|banate)\\s?hain"
            + "|\\b(?:hamara|hamari|hamare|humara|humari|humare)\\s(?:company|product|service|plan|offer"
            + "|package|brand)"
            + "|\\b(?:deti|deta|dete|bechti|bechta|bechte|banati|banata|banate|(?:provide|offer|supply)"
            + "\\s(?:karti|karta|karte))\\s(?:hai|hain)\\b"
            + "|हम\\s.{0,60}?(?:देते|करते|बेचते|बनाते|प्रदान करते)\\s?हैं"
            + "|(?:बेचता|बेचती|बेचते|बनाता|बनाती|बनाते|देता|देती|प्रदान करता|प्रदान करती)\\s?(?:है|हैं)"
            + "|(?:हमारा|हमारी|हमारे)\\s(?:company|product|service|plan|offer|package|कंपनी|प्रोडक्ट|सर्विस"
            + "|प्लान|ऑफ़र|ऑफर)"
            + "|(?:रुपये|रुपए|लाख|करोड़)",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);

    /**
     * A concrete reason for THIS call: their enquiry, a form, a visit, an order, a trial or test
     * drive, a renewal or expiry, a follow-up on something.
     */
    private static final Pattern STATES_REASON = Pattern.compile(
            "\\b(?:enquir|inquir)\\w*"
            + "|\\b(?:filled|submitted|signed up|registered|visited|downloaded|requested|booked|ordered"
            + "|purchased|bought|subscribed|applied|attended|responded|showed interest|expressed interest"
            + "|left (?:their|your|a) (?:number|details))\\b"
            + "|\\b(?:took|taken|tried|used) (?:a|an|the|our|your|their)?\\s?(?:free )?(?:trial|test drive"
            + "|demo|sample|quote|quotation)\\b|\\btest[- ]drove\\b"
            + "|\\bcalling (?:about|regarding|because|to (?:follow|confirm|remind|inform|tell|invite|update"
            + "|offer|share|check|introduce|let))\\b"
            + "|\\bfollow(?:ing)?[- ]?up (?:on|about|regarding|after)\\b"
            + "|\\b(?:reason for (?:the|this|your|our) call|purpose of (?:the|this|your|our) call)\\s*(?:is|:)"
            + "|\\b(?:renewal|renewing|reminder|expir\\w*|overdue|abandoned cart|feedback on)\\b"
            + "|(?:आपने|aapne|inhone|unhone|इन्होंने|उन्होंने)\\s.{0,60}?(?:enquiry|inquiry|इन्क्वायरी|पूछताछ"
            + "|form|फ़ॉर्म|फॉर्म|visit|विज़िट|विजिट|register|रजिस्टर|download|order|ऑर्डर|book|बुक"
            + "|test drive|trial)"
            + "|(?:form|फ़ॉर्म|फॉर्म)\\s?(?:bhara|bhari|bhare|भरा|भरी|भरे)"
            + "|के (?:बारे|सिलसिले) में (?:कॉल|call)|ke (?:baare|silsile) mein call",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);

    /**
     * Plain-language findings the admin sees next to the result. Never blocks anything. Exactly
     * the findings this method gave before the grounding advisory existed (the repair pass in
     * {@link #fixable} uses it, and must never be asked to "fix" a missing offer by inventing one).
     */
    static List<String> lint(String prompt, String openingLine, String language) {
        return lintSpokenLines(prompt, openingLine, language);
    }

    /**
     * As {@link #lint(String, String, String)}, plus — for a non-education agent only — an
     * advisory when the script never says what is offered or why the call is made. An education
     * agent's findings are exactly what they were before this check existed.
     */
    static List<String> lint(String prompt, String openingLine, String language, AgentContext agent) {
        List<String> issues = lintSpokenLines(prompt, openingLine, language);
        String grounding = groundingFinding(prompt, openingLine, agent);
        if (grounding != null) issues.add(grounding);
        return issues;
    }

    /**
     * AAIBUZZ/IRPL calls c43e9ce7, e6cb5f47 (2026-10-16): a 512-character script that said
     * "briefly explain why you are calling" and never said why, nor what AAIBUZZ sells. The bot
     * filled both gaps itself (an edtech product, a demo booking). Null when nothing is missing.
     */
    static String groundingFinding(String prompt, String openingLine, AgentContext agent) {
        if (!AiAgentDomain.isGeneral(prompt, AiAgentDomain.fieldsOf(agent, openingLine))) return null;
        if (prompt.length() > GROUNDING_LINT_MAX_CHARS) return null;
        String all = prompt + "\n" + (openingLine == null ? "" : openingLine);
        boolean offer = STATES_OFFER.matcher(all).find();
        boolean reason = STATES_REASON.matcher(all).find();
        if (offer && reason) return null;
        String missing = !offer && !reason ? "what you offer or why you are calling this person"
                : !offer ? "what you offer" : "why you are calling this person";
        // "may not": a keyword check can miss a sentence that does say it; the admin decides.
        return GROUNDING_LINT_PREFIX + missing + ". If it does not, the agent cannot know it, and an "
                + "agent in that position has made it up on live calls (an invented product, a demo "
                + "nobody offered). Consider a sentence or two: what the business sells and why this "
                + "person is being called (for example, they enquired, visited or ordered).";
    }

    private static List<String> lintSpokenLines(String prompt, String openingLine, String language) {
        List<String> issues = new ArrayList<>();
        String fam = languageFamily(language);
        List<String> spoken = new ArrayList<>();
        if (notBlank(openingLine)) spoken.add(openingLine);
        if (notBlank(prompt)) {
            Matcher q = QUOTED.matcher(prompt);
            while (q.find()) spoken.add(q.group(1));
        }
        String all = (prompt == null ? "" : prompt) + "\n" + (openingLine == null ? "" : openingLine);

        Set<String> unknown = new LinkedHashSet<>();
        Matcher c = CURLY.matcher(all);
        while (c.find()) {
            String key = c.group(1).trim().toLowerCase(Locale.ROOT);
            if (!SUPPORTED_PLACEHOLDERS.contains(key)) unknown.add(key);
        }
        if (!unknown.isEmpty()) {
            issues.add("Placeholders " + fmt(unknown) + " are only filled if your lead list has a column "
                    + "with that exact name — otherwise the agent says nothing there.");
        }
        Set<String> slots = new LinkedHashSet<>();
        for (Pattern p : List.of(ANGLE_SLOT, BRACKET_SLOT)) {
            Matcher m = p.matcher(all);
            while (m.find() && slots.size() < 4) slots.add(m.group());
        }
        if (!slots.isEmpty()) {
            issues.add("Template slots " + fmt(slots) + " are read aloud or mangled on calls — use {{name}}, "
                    + "a neutral word (\"बच्चे\" / \"your child\"), or the caller's own word.");
        }
        Set<String> slashes = new LinkedHashSet<>();
        Set<String> dashes = new LinkedHashSet<>();
        Set<String> digits = new LinkedHashSet<>();
        Set<String> romanised = new LinkedHashSet<>();
        int dashCount = 0, digitCount = 0, romanCount = 0;
        for (String line : spoken) {
            Matcher s = SLASH_PAIR.matcher(line);
            while (s.find() && slashes.size() < 4) {
                if (!s.group().toLowerCase(Locale.ROOT).matches("(and|or|w)/(or|and|o)")) slashes.add(s.group());
            }
            if (DASH_SPLIT.matcher(line).find()) {
                dashCount++;
                if (dashes.size() < 3) dashes.add(snippet(line));
            }
            if (DIGITS.matcher(line.replaceAll("\\{\\{[^}]*}}", "")).find()) {
                digitCount++;
                if (digits.size() < 3) digits.add(snippet(line));
            }
            if (("hindi".equals(fam) || "marathi".equals(fam)) && ROMAN_HINDI.matcher(line).find()) {
                romanCount++;
                if (romanised.size() < 3) romanised.add(snippet(line));
            }
        }
        if (!slashes.isEmpty()) {
            issues.add("Either/or pairs " + fmt(slashes) + " in lines the agent says — it reads both halves. "
                    + "Pick one form.");
        }
        if (!dashes.isEmpty()) {
            issues.add(count(dashCount) + "split by a dash get cut at the dash, e.g. " + fmt(dashes)
                    + ". Use a full stop instead.");
        }
        if (!digits.isEmpty()) {
            issues.add(count(digitCount) + "contain digits or ₹ (write numbers as words), e.g. " + fmt(digits));
        }
        if (!romanised.isEmpty()) {
            issues.add(count(romanCount) + "have Hindi written in English letters (write it in Devanagari), "
                    + "e.g. " + fmt(romanised));
        }
        if (prompt != null && prompt.length() > 15000) {
            issues.add(String.format("The prompt is %,d characters. It is re-sent on every turn of every "
                    + "call — trimming it lowers cost and reply delay.", prompt.length()));
        }
        return issues;
    }

    private static String count(int n) {
        return n == 1 ? "1 spoken line " : n + " spoken lines ";
    }

    private static String snippet(String line) {
        String s = line.strip();
        return "\"" + (s.length() > 60 ? s.substring(0, 57) + "…" : s) + "\"";
    }

    private static String fmt(Set<String> items) {
        return String.join(", ", items);
    }

    /** Attach lint + charge. The lint covers the NEW prompt when the op rewrote it. */
    private Map<String, Object> finish(String instituteId, String op, Map<String, Object> out,
                                       AgentContext agent, String reviewedPrompt) {
        String prompt = out.get("prompt") instanceof String p ? p : null;
        String opening = out.get("opening_line") instanceof String o ? o : null;
        if (opening == null && out.get("derived") instanceof Map<?, ?> d
                && d.get("opening_line") instanceof String o2) {
            opening = o2;
        }
        if (prompt != null && opening != null) {
            // A rewrite: one opening line, whichever field the model filled.
            out.put("opening_line", opening);
            if (out.get("derived") instanceof Map<?, ?> d) {
                @SuppressWarnings("unchecked")
                Map<String, Object> derived = (Map<String, Object>) d;
                derived.put("opening_line", opening);
            }
        }
        if (prompt == null) {
            // analyze: lint what the admin currently has.
            prompt = reviewedPrompt;
            opening = agent.openingLine();
        }
        out.put("lint", lint(prompt, opening, agent.language(), agent));
        charge(instituteId, op, agent != null ? agent.name() : null);
        return out;
    }

    // ── Call grounding ───────────────────────────────────────────────────────

    /** What each platform fault code means for the prompt author. */
    private static final Map<String, String> FAULT_MEANING = new LinkedHashMap<>();
    static {
        FAULT_MEANING.put("REPEATED_LINE", "the agent said the same sentence twice — usually the prompt "
                + "does not say what comes next after a step (PROMPT CAN FIX)");
        FAULT_MEANING.put("REPLY_LOOP", "the agent kept re-delivering a line (PROMPT CAN HELP: clearer next step)");
        FAULT_MEANING.put("HANDBACK_LOOP", "the agent ran out of new things to say and kept handing the turn "
                + "back — the script has a dead end (PROMPT CAN FIX)");
        FAULT_MEANING.put("FALSE_REASK", "the agent asked again for something already answered (PROMPT CAN FIX: "
                + "skip steps already answered)");
        FAULT_MEANING.put("OPENING_REPLAYED", "the introduction was said again mid-call (PROMPT CAN FIX: "
                + "never re-introduce)");
        FAULT_MEANING.put("PROMPT_UNFILLED", "a {{placeholder}} had no value and was spoken as nothing "
                + "(PROMPT CAN FIX)");
        FAULT_MEANING.put("DEAD_AIR", "long silence from the agent (platform/audio — not a prompt issue)");
        FAULT_MEANING.put("ANSWER_DELETED", "a caller answer was lost in speech recognition (platform)");
        FAULT_MEANING.put("STT_DEAF", "speech recognition heard nothing (platform)");
        FAULT_MEANING.put("CALLER_IGNORED", "the caller spoke and the agent stayed silent while its "
                + "opening was owed (platform — not a prompt issue)");
        FAULT_MEANING.put("LIKELY_MACHINE", "voicemail or IVR answered (ignore)");
    }

    /** Compact digest of the agent's recent calls: outcome, health, faults, summary, transcript. */
    private String recentCallDigest(String agentId, String instituteId) {
        if (agentId == null || agentId.isBlank()) return "";
        try {
            List<AiCallResult> rows = aiCallResultRepository
                    .findTop12ByCampaignIdAndInstituteIdOrderByCreatedAtDesc(agentId, instituteId);
            if (rows.isEmpty()) return "";
            Map<String, Integer> faultCounts = new TreeMap<>();
            StringBuilder calls = new StringBuilder();
            int i = 0;
            for (AiCallResult r : rows) {
                if (++i > FEEDBACK_CALLS) break;
                if (notBlank(r.getDiagFaults())) {
                    for (String f : r.getDiagFaults().split(",")) {
                        if (!f.isBlank()) faultCounts.merge(f.trim(), 1, Integer::sum);
                    }
                }
                calls.append("--- call ").append(i)
                     .append(" | disposition=").append(nullSafe(r.getDisposition()))
                     .append(" | duration=").append(r.getDurationSeconds() == null ? "?" : r.getDurationSeconds()).append("s")
                     .append(" | interest=").append(nullSafe(r.getInterestLevel()))
                     .append(" | lead_rating=").append(r.getLeadRating() == null ? "?" : r.getLeadRating())
                     .append(" | health=").append(nullSafe(r.getDiagHealth()))
                     .append(notBlank(r.getDiagFaults()) ? " | faults=" + r.getDiagFaults() : "")
                     .append(" ---\n");
                if (notBlank(r.getAiSummary())) {
                    calls.append("summary: ").append(r.getAiSummary().strip()).append("\n");
                }
                String t = r.getTranscript();
                if (notBlank(t)) {
                    String snip = t.strip();
                    if (snip.length() > TRANSCRIPT_HEAD + TRANSCRIPT_TAIL) {
                        snip = snip.substring(0, TRANSCRIPT_HEAD) + "\n …[middle omitted]…\n"
                                + snip.substring(snip.length() - TRANSCRIPT_TAIL);
                    }
                    calls.append("transcript: ").append(snip).append("\n");
                }
            }
            StringBuilder sb = new StringBuilder();
            if (!faultCounts.isEmpty()) {
                sb.append("FAULTS THE PLATFORM DETECTED ACROSS THESE CALLS:\n");
                faultCounts.forEach((f, n) -> sb.append("- ").append(f).append(" ×").append(n).append(": ")
                        .append(FAULT_MEANING.getOrDefault(f, "platform/audio issue — not a prompt issue"))
                        .append("\n"));
                sb.append("Only change the prompt for faults marked PROMPT CAN FIX / HELP.\n\n");
            }
            return sb.append(calls).toString();
        } catch (Exception e) {
            log.warn("agent-assist: could not load recent calls for agent {}: {}", agentId, e.getMessage());
            return "";
        }
    }

    // ── LLM plumbing ─────────────────────────────────────────────────────────

    /**
     * A rewrite, then ONE repair turn when the lint finds spoken-line defects in it. Probed on
     * the live Shreya prompt: GLM copied eight {@code <name>} slots and dash-split lines from
     * the old prompt despite the rulebook — pointing at the exact findings fixes them far more
     * reliably than the general rule. The repair is kept only if it leaves fewer findings.
     */
    private Map<String, Object> rewrite(String instituteId, String system, String user, String op,
                                        AgentContext agent) {
        Map<String, Object> out = callJson(instituteId, system, user, op);
        List<String> findings = fixable(out, agent);
        if (findings.isEmpty()) return out;
        try {
            StringBuilder ask = new StringBuilder("The platform's checker found these problems in the "
                    + "prompt / opening line you wrote:\n");
            findings.forEach(f -> ask.append("- ").append(f).append("\n"));
            ask.append("""
                    The quoted lines are EXAMPLES — fix every occurrence in the whole prompt and the
                    opening line, not just those. Change nothing else. A child/student/parent name slot
                    becomes "बच्चे" / "your child" (or {{name}} for the person being called); a
                    program/fee slot becomes the real words for each case (write one line per
                    program); numbers become words; a dash inside a spoken line becomes a full stop;
                    an either/or pair becomes one form. Keep "derived" in sync with the fixed prompt.
                    Reply with the COMPLETE JSON object again, same keys.""");
            String usedModel = out.get("_model") instanceof String m ? m : primaryModel();
            Map<String, Object> copy = new LinkedHashMap<>(out);
            copy.remove("_model");
            List<ConversationSession.ChatMessage> history = new ArrayList<>(List.of(
                    ConversationSession.ChatMessage.system(system),
                    ConversationSession.ChatMessage.user(user),
                    ConversationSession.ChatMessage.assistant(objectMapper.writeValueAsString(copy)),
                    ConversationSession.ChatMessage.user(ask.toString())));
            Map<String, Object> fixed = callJsonOn(usedModel, instituteId, history, op + "-repair");
            if (fixed.get("prompt") instanceof String && fixable(fixed, agent).size() < findings.size()) {
                fixed.put("repaired", Boolean.TRUE);
                return fixed;
            }
        } catch (Exception e) {
            log.warn("agent-assist {} repair pass failed, keeping first result: {}", op, e.getMessage());
        }
        return out;
    }

    /** Lint findings the model can fix in place (the length note is advice, not a defect). */
    static List<String> fixable(Map<String, Object> out, AgentContext agent) {
        String prompt = out.get("prompt") instanceof String p ? p : null;
        if (prompt == null) return List.of();
        String opening = out.get("opening_line") instanceof String o ? o
                : out.get("derived") instanceof Map<?, ?> d && d.get("opening_line") instanceof String o2 ? o2
                : null;
        return lint(prompt, opening, agent.language()).stream()
                .filter(f -> !f.startsWith("The prompt is "))
                .toList();
    }

    /**
     * [primary, fallback]: the property overrides when set, else the agent_assist row in
     * ai_model_defaults (the super-admin portal edits it).
     */
    private List<String> models() {
        List<String> chain = modelDefaults.resolve(USE_CASE).withPreferred(model).models();
        String primary = chain.get(0);
        String fallback = notBlank(fallbackModel) ? fallbackModel.trim()
                : chain.size() > 1 ? chain.get(1) : null;
        return fallback == null || fallback.equals(primary) ? List.of(primary) : List.of(primary, fallback);
    }

    private String primaryModel() {
        return models().get(0);
    }

    /** Primary model, then the fallback model; each with a strict-JSON contract + one re-emit. */
    private Map<String, Object> callJson(String instituteId, String system, String user, String op) {
        List<String> chain = models();
        String primary = chain.get(0);
        try {
            return callJsonOn(primary, instituteId, system, user, op);
        } catch (Exception primaryFailure) {
            if (chain.size() < 2) {
                throw asAssistError(primaryFailure);
            }
            String fallback = chain.get(1);
            log.warn("agent-assist {} on {} failed ({}); retrying on {}", op, primary,
                    primaryFailure.getMessage(), fallback);
            try {
                return callJsonOn(fallback, instituteId, system, user, op);
            } catch (Exception fallbackFailure) {
                throw asAssistError(fallbackFailure);
            }
        }
    }

    private Map<String, Object> callJsonOn(String useModel, String instituteId, String system,
                                           String user, String op) {
        return callJsonOn(useModel, instituteId, new ArrayList<>(List.of(
                ConversationSession.ChatMessage.system(system),
                ConversationSession.ChatMessage.user(user))), op);
    }

    private Map<String, Object> callJsonOn(String useModel, String instituteId,
                                           List<ConversationSession.ChatMessage> history, String op) {

        for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            ConversationSession session = ConversationSession.builder()
                    .instituteId(instituteId)
                    .model(useModel)
                    .maxTokens(maxTokens)
                    .history(new ArrayList<>(history))
                    .build();
            session.getContext().put(LLMService.CTX_LONG_RUNNING, Boolean.TRUE);
            session.getContext().put(LLMService.CTX_TEMPERATURE, 0.4);
            session.getContext().put(LLMService.CTX_USE_CASE, USE_CASE);
            // This class runs its own primary -> fallback loop (callJson); one model per call.
            session.getContext().put(LLMService.CTX_NO_FAILOVER, Boolean.TRUE);
            // Billed as a flat COST per operation (charge()), never per token on top.
            session.getContext().put(LLMService.CTX_BILLED_BY_CALLER, Boolean.TRUE);
            // Anthropic via OpenRouter: extended thinking rejects a non-1 temperature and
            // json_object is not uniformly supported — the fallback runs plain.
            if (!useModel.startsWith("anthropic/")) {
                session.getContext().put(LLMService.CTX_JSON_MODE, Boolean.TRUE);
                if (notBlank(reasoningEffort)) {
                    session.getContext().put(LLMService.CTX_REASONING_EFFORT, reasoningEffort);
                }
            }
            LLMService.LLMResponse resp = llmService.generateChatCompletion(session);
            String raw = resp != null ? resp.getContent() : null;
            if (resp != null && "length".equals(resp.getFinishReason())) {
                throw new VacademyException("The AI assistant ran out of room before finishing — please retry.");
            }
            if (raw == null || raw.isBlank()) {
                throw new VacademyException("The AI assistant returned an empty response — please retry.");
            }
            try {
                JsonNode n = objectMapper.readTree(extractJson(raw));
                @SuppressWarnings("unchecked")
                Map<String, Object> out = objectMapper.convertValue(n, Map.class);
                out.put("_model", useModel);
                log.info("agent-assist {} ok institute={} model={} score={}", op, instituteId, useModel,
                        out.get("score"));
                return out;
            } catch (Exception parseError) {
                if (attempt == MAX_ATTEMPTS) {
                    throw new VacademyException("The AI assistant produced an unreadable response — please retry.");
                }
                history.add(ConversationSession.ChatMessage.assistant(raw));
                history.add(ConversationSession.ChatMessage.user(
                        "Your previous message was not valid JSON. Reply with ONLY the JSON object "
                        + "described — no prose, no markdown fences."));
            }
        }
        throw new IllegalStateException("unreachable");
    }

    private static VacademyException asAssistError(Exception e) {
        if (e instanceof VacademyException ve) return ve;
        return new VacademyException("The AI assistant failed — please retry.");
    }

    /** Post-paid flat charge; a metering failure never fails the delivered work. */
    private void charge(String instituteId, String op, String agentName) {
        try {
            creditClient.deductPrecomputed(instituteId, "content",
                    "AI agent prompt assist: " + op, COST,
                    "agent-assist:" + UUID.randomUUID(),
                    assistMetering(op, agentName));
        } catch (Exception e) {
            log.warn("agent-assist: credit charge failed for {} ({}): {}", instituteId, op, e.getMessage());
        }
    }

    /**
     * Usage-metering fields for one assist operation. An admin started it from the
     * voice-agent editor; who exactly is not threaded this deep, so the actor is sent
     * as a USER with no id and no role: the event stays UNRESOLVED instead of taking
     * the ledger's hard-coded "SYSTEM" billing label (deductPrecomputed) as its role.
     */
    static MeteringFields assistMetering(String op, String agentName) {
        Map<String, Object> context = new LinkedHashMap<>();
        if (op != null) context.put("operation", op);
        if (agentName != null && !agentName.isBlank()) context.put("agent_name", agentName);
        return MeteringFields.builder()
                .useCase("agent_assist")
                .actorKind(MeteringFields.ACTOR_USER)
                .surface(MeteringFields.SURFACE_ADMIN_APP)
                .sourceService(MeteringFields.SOURCE_ADMIN_CORE)
                .usageContext(context)
                .build();
    }

    private static String extractJson(String raw) {
        String s = raw.strip();
        if (s.startsWith("```")) {
            int first = s.indexOf('\n');
            int lastFence = s.lastIndexOf("```");
            if (first >= 0 && lastFence > first) s = s.substring(first + 1, lastFence).strip();
        }
        int start = s.indexOf('{');
        int end = s.lastIndexOf('}');
        if (start >= 0 && end > start) return s.substring(start, end + 1);
        return s;
    }

    private static boolean notBlank(String s) { return s != null && !s.isBlank(); }

    private static String nullSafe(String s) { return s == null ? "?" : s; }

    private static void require(String v, String field) {
        if (v == null || v.isBlank()) throw new VacademyException("Missing required field: " + field);
    }
}
