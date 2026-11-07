package vacademy.io.admin_core_service.features.telephony.core;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiAgentDTO;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Pre-renders an agent's FIXED lines into the voice bot's speech cache when the
 * agent is saved, so they are served from cache on call #1 rather than after the
 * cache has slowly learned them.
 *
 * <p>WHY ONLY THESE LINES. The bot's own utterances — the scripted opening, the
 * farewells, the nudge, the transfer-fail closing — never pass through the LLM,
 * are authored by an admin, and each is spoken as a standalone pipecat audio
 * context. That makes them the one class of sentence we can render ahead of time
 * without having to decide whether a caller really heard it. Everything the LLM
 * says has to earn its place in the cache the slow way, from calls that worked.
 *
 * <p>NEEDS telephony.vacademy-ai.client-secret (or VOICE_BOT_CLIENT_SECRET) on
 * admin-core — the same value the bot already holds. Blank is a SUPPORTED state,
 * not a broken one: warming simply does not happen, and the bot learns its fixed
 * lines from the first call instead, hitting from the second. All this buys is
 * moving the opening line's first hit from call 2 to call 1.
 *
 * <p>WHY IT CANNOT FAIL A SAVE. This spends money (each render is a vendor
 * synthesis) and crosses an ocean (admin core in Singapore, bot in Mumbai). An
 * admin pressing Save must never see either. Fire-and-forget, exactly like
 * {@link vacademy.io.admin_core_service.features.telephony.ivr.IvrPromptWarmer}:
 * a warm that fails simply means the first calls pay the vendor, as they do today.
 *
 * <p>ONLY THE OPENING LINE, and only when it carries no {{placeholder}}. The
 * handbacks, farewells, fillers and nudge are chosen inside the bot from the
 * agent's language, and nothing pre-warms them — they reach the cache the same
 * way an LLM sentence does, by being spoken on enough calls. So the first call
 * for a newly-enabled agent can serve the opening from cache and nothing else,
 * and an opening containing {{leadName}} means it serves nothing at all on that
 * call. That is expected, not a failure.
 */
@Component
public class AiAgentSpeechWarmer {

    private static final Logger log = LoggerFactory.getLogger(AiAgentSpeechWarmer.class);

    /** Terminal punctuation, matching the bot's own completeness gate. A line
     *  without it is refused there, so there is no point paying to send it. */
    private static final String TERMINAL = ".!?।…";

    private final ObjectMapper mapper = new ObjectMapper();
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5)).build();

    @Value("${telephony.vacademy-ai.bot-base-url:}")
    private String botBaseUrl;

    /**
     * Same secret the bot mints its single-use /ws tokens from, so no new
     * credential is introduced for this path.
     *
     * <p>A plain placeholder with a plain default, resolved against the env in
     * code rather than a nested {@code ${a:${b:}}} placeholder. The nested form
     * works, but an unresolvable placeholder fails CONTEXT STARTUP — the whole
     * service refuses to boot — and that is a wildly disproportionate blast
     * radius for a fire-and-forget cache warm.
     */
    @Value("${telephony.vacademy-ai.client-secret:}")
    private String clientSecretProperty;

    private String clientSecret() {
        if (clientSecretProperty != null && !clientSecretProperty.isBlank()) {
            return clientSecretProperty;
        }
        String env = System.getenv("VOICE_BOT_CLIENT_SECRET");
        return env == null ? "" : env;
    }

    @Async
    public void warm(AiAgentDTO agent) {
        if (agent == null) return;
        // NOTHING happens for an agent whose cache is OFF — which is every agent
        // until someone deliberately turns one on (V466 defaults the column to
        // OFF for every existing row). Warming regardless would spend a vendor
        // render, and disk, on every agent save across every institute for a
        // feature none of them are using.
        String mode = agent.getSpeechCacheMode() == null
                ? "OFF" : agent.getSpeechCacheMode().trim().toUpperCase();
        if (mode.equals("OFF")) return;
        String secret = clientSecret();
        if (botBaseUrl == null || botBaseUrl.isBlank() || secret.isBlank()) {
            return;                                   // not wired on this deployment
        }
        List<String> texts = fixedLines(agent);
        if (texts.isEmpty()) return;
        try {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("engine", engineOf(agent));
            body.put("model", "");                    // the bot resolves its own default
            body.put("voice", agent.getVoice() == null ? "" : agent.getVoice());
            body.put("pace", agent.getPace());
            body.put("temperature", agent.getTemperature());
            body.put("language", agent.getLanguage());
            body.put("texts", texts);

            String url = botBaseUrl.trim().replaceAll("/$", "")
                    + "/voice-bot-service/internal/tts-cache/warm";
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(90))  // N vendor renders, serially
                    .header("Content-Type", "application/json")
                    .header("X-Voice-Bot-Token", secret)
                    .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)))
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            log.info("ai agent speech warm ({}) agent={} lines={} -> {}",
                    res.statusCode(), agent.getId(), texts.size(),
                    res.body() == null ? "" : res.body().substring(0, Math.min(120, res.body().length())));
        } catch (Exception e) {
            log.warn("ai agent speech warm failed agent={}: {}", agent.getId(), e.getMessage());
        }
    }

    /**
     * The agent-specific fixed lines. A LinkedHashSet because the opening can
     * coincide with nothing else but duplicates cost a vendor render each.
     *
     * <p>Only the opening is agent-authored; the rest are the bot's own literals
     * and are warmed by the bot. What we can usefully pre-render from here is the
     * opening — the longest single utterance on the call, spoken on 100% of them,
     * and the one whose latency the runbook ties to the caller's "hello?"
     * cancelling it.
     */
    private List<String> fixedLines(AiAgentDTO agent) {
        Set<String> out = new LinkedHashSet<>();
        String opening = agent.getOpeningLine() == null ? "" : agent.getOpeningLine().trim();
        // A placeholder is filled per call, so the rendered audio would never be
        // reused. Those are left to the learn path, which picks them up once a
        // given name recurs.
        if (!opening.isEmpty() && !opening.contains("{{") && complete(opening)) {
            out.add(opening);
        }
        String mode = agent.getSpeechCacheMode() == null ? "" : agent.getSpeechCacheMode().trim().toUpperCase();
        if (mode.equals("FULL")) {
            out.addAll(scriptSentences(agent.getSystemPrompt(), MAX_SCRIPT_SENTENCES));
        }
        return new ArrayList<>(out);
    }

    /** The bot caps a warm at 64 texts; the opening takes one. */
    static final int MAX_SCRIPT_SENTENCES = 60;
    private static final Pattern QUOTED = Pattern.compile("[\"“]([^\"“”\n]{8,400})[\"”]");
    private static final Pattern SENTENCE_END = Pattern.compile("(?<=[।?!.？])\\s+");

    /**
     * The sentences a scripted prompt tells the agent to SAY — its quoted lines —
     * one per cache entry, split where the bot's sentence aggregator splits, so the
     * warmed key is the key a live sentence looks up. Warmed on save so that after
     * a prompt change the new lines hit from call #1 instead of the cache hit rate
     * dropping to zero and relearning (the gap measured on Shreya, 2026-09-30).
     *
     * <p>Only lines that can be spoken verbatim: no {{placeholder}}, no <slot> or
     * [slot], a letter in them, 8-240 characters, a sentence ending. A quoted
     * CALLER line ("अभी time नहीं") is warmed too and simply never hits — one
     * vendor render, skipped on every later save because the bot already has it.
     */
    static List<String> scriptSentences(String prompt, int cap) {
        List<String> out = new ArrayList<>();
        if (prompt == null || prompt.isBlank()) return out;
        Set<String> seen = new LinkedHashSet<>();
        Matcher m = QUOTED.matcher(prompt);
        while (m.find() && seen.size() < cap) {
            for (String part : SENTENCE_END.split(m.group(1).strip())) {
                String t = part.strip();
                if (t.length() < 8 || t.length() > 240) continue;
                if (t.contains("{{") || t.contains("<") || t.contains("[") || t.contains(">")) continue;
                if (t.codePoints().noneMatch(Character::isLetter)) continue;
                if (!complete(t)) continue;
                if (seen.add(t) && seen.size() >= cap) break;
            }
        }
        out.addAll(seen);
        return out;
    }

    private static boolean complete(String s) {
        String t = s.strip();
        while (!t.isEmpty() && "\"'’”)]".indexOf(t.charAt(t.length() - 1)) >= 0) {
            t = t.substring(0, t.length() - 1).strip();
        }
        return !t.isEmpty() && TERMINAL.indexOf(t.charAt(t.length() - 1)) >= 0;
    }

    /**
     * Must match what the BOT will actually construct, not merely what is stored.
     * An agent with no engine falls back to sarvam in both the bot and the billing
     * path, so it does here too — warming a google key for an agent that will
     * speak through Sarvam would just waste a render and never hit.
     */
    private static String engineOf(AiAgentDTO agent) {
        String m = agent.getTtsModel() == null ? "" : agent.getTtsModel().trim().toLowerCase();
        if (m.startsWith("google") || m.startsWith("chirp")) return "google";
        if (m.startsWith("edge")) return "edge";
        if (m.startsWith("smallest") || m.startsWith("lightning")) return m; // retain pro/model selection
        if (m.startsWith("rumik") || m.startsWith("silk")) return "rumik";
        if (m.startsWith("deepgram") || m.startsWith("aura")) return "deepgram";
        if (m.startsWith("navana") || m.startsWith("bodhi")) return "navana";
        // v4 before the Sarvam fallback: its own engine and voices (see TtsVoiceCatalog).
        if (m.startsWith("sarvam_v4") || m.startsWith("bulbul:v4")) return "sarvam_v4";
        return "sarvam";
    }
}
