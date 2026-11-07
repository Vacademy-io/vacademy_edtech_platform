package vacademy.io.admin_core_service.features.telephony.core;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * The TTS engines we sell and the voices each one actually has.
 *
 * <p>ONE source of truth on the backend, because the voice list previously existed
 * in three hand-maintained copies (this controller, two frontend files) plus the
 * voice bot's Hindi gender map — and they drift silently. The frontend now reads
 * {@code GET /ai-agents/voices}, which is served from here.
 *
 * <p>Two invariants this class exists to protect:
 *
 * <ol>
 *   <li><b>Palettes do not overlap.</b> Sarvam bulbul:v3 and Rumik Silk Mulberry
 *       share not one voice name, and the wrong one fails differently on each
 *       (both probed live): Sarvam returns 400, i.e. no audio at all; Rumik silently
 *       falls back to a default speaker — {@code priya} yielded 184 KB of clean
 *       audio. The quiet substitution is the more dangerous of the two, because the
 *       call sounds fine while the voice is not the one anyone chose and the Hindi
 *       verb gender was conjugated for the configured voice instead.
 *   <li><b>Gender is load-bearing, not decoration.</b> Hindi first-person verbs are
 *       gendered, so the voice bot conjugates from a speaker-to-gender map. A voice
 *       whose gender is wrong here makes a male voice say {@code kar rahi hoon} —
 *       the single most immersion-breaking defect on these calls. This table and
 *       {@code voice_bot_service/app/bot.py} ({@code _MALE_VOICES},
 *       {@code RUMIK_VOICES}) MUST agree.
 * </ol>
 */
public final class TtsVoiceCatalog {

    private TtsVoiceCatalog() {}

    /** Rumik Silk Mulberry 1.5 — default for new agents. Rs 0.50/1k chars. */
    public static final String MODEL_RUMIK = "rumik";
    /** Sarvam bulbul:v3 — Rs 3.00/1k chars, carries the +4 credits/min surcharge. */
    public static final String MODEL_SARVAM = "sarvam";
    /**
     * Google Cloud TTS, Chirp3-HD tier — the founder picked it BY EAR on 2026-08-05
     * over Sarvam, Rumik and Google's own Neural2/WaveNet/Standard tiers, after Rumik
     * garbled core Hindi on the phone leg (a caller asked what "प्रतिलत" meant; the
     * model had written "प्रतिशत").
     *
     * <p>Economics, measured from our OWN calls rather than assumed — 779 characters
     * per CALL-minute across 13 production calls: $30/1M chars works out to
     * ~Rs 2.06/call-minute against Sarvam's Rs 2.34. It is CHEAPER than what we ship
     * today, and Chirp3-HD carries 1M free characters a month (~1,280 call-minutes).
     * Neural2/WaveNet ($16/1M ≈ Rs 1.10) are the cheaper fallback tiers.
     *
     * <p>No new vendor: it authenticates with the SAME service account as the Vertex
     * LLM. Voice ids are locale-prefixed ({@code hi-IN-Chirp3-HD-Achird}), so a
     * cross-vendor name is impossible to confuse with the other palettes.
     */
    public static final String MODEL_EDGE = "edge";
    public static final String MODEL_GOOGLE = "google";
    /**
     * Smallest.ai Lightning — Indian-language specialist (146 of its 234
     * lightning_v3.1 voices are Hindi-capable), added alongside Google on the
     * founder's instruction so the two can be compared on real calls.
     *
     * <p>⚠️ Its palettes are PER-MODEL and do not overlap: the API hard-rejects a
     * cross-model voice ("Voice 'devansh' is not available on the lightning_v3.1_pro
     * model"), which on a live call means silence. Only the lightning_v3.1 (standard)
     * palette is exposed here; that is what the bot defaults to.
     */
    public static final String MODEL_SMALLEST = "smallest";

    /**
     * Smallest.ai Lightning v3.1 <b>Pro</b> — a SEPARATE engine id on purpose, not a
     * variant of {@link #MODEL_SMALLEST}. The two share no voices: the API hard-rejects
     * a cross-model name ("Voice 'devansh' is not available on the lightning_v3.1_pro
     * model"), which on a live call is silence. Collapsing them into one id would put
     * both palettes behind one picker entry and make that silent call reachable in two
     * clicks, so they stay distinct all the way down to bot.py's _engine_palette.
     *
     * <p>Cost is $0.195/10K chars (~Rs 1.34/call-min) against standard's $0.175
     * (~Rs 1.20) — both well under Google's Rs 2.06, so neither carries a surcharge.
     */
    public static final String MODEL_SMALLEST_PRO = "smallest_pro";

    /**
     * Deepgram Aura-2 — <b>ENGLISH ONLY</b>. Verified against the live
     * {@code /v1/models} catalog on 2026-08-13: 102 TTS models across
     * en/es/de/fr/nl/it/ja and <b>no Hindi at any tier</b>, nor any announced.
     *
     * <p>So this engine is selectable only for English-speaking agents. Pointing a
     * Hinglish agent at it makes the voice read Devanagari as English letters —
     * the same class of failure Rumik produced, but total rather than partial.
     * Accent is American; Deepgram publishes no en-IN voice.
     */
    public static final String MODEL_DEEPGRAM = "deepgram";

    /**
     * Navana (Bodhi) — Indian-language voices where ONE voice id speaks all ten
     * languages (bn en gu hi kn ml mr or ta te). Streams through Navana's own
     * Pipecat service. Genders are read from the names (Navana publishes none).
     * Account default: two concurrent connections, held for a whole call.
     */
    public static final String MODEL_NAVANA = "navana";

    /**
     * Sarvam Bulbul v4 Flash ({@code bulbul:v4-flash}) — a SEPARATE engine from
     * {@link #MODEL_SARVAM} (v3), not a variant: its voices are personas named
     * {@code <speaker>_<language>_<style>} ("shubh_enhi_ads") and share no id with v3;
     * the API rejects a v3 name on v4 ("Speaker 'priya' is not compatible with model
     * bulbul:v4-flash") — a silent call. Rs 1 per 1,000 characters (a third of v3's
     * Rs 3), so it carries no surcharge. Same websocket contract as v3; probed live on
     * 2026-10-14 with the call's exact config: first audio 0.36 s against v3's 0.39 s.
     *
     * <p>Sarvam publishes no genders; every voice below was MEASURED (median pitch of a
     * real synthesis, decided per speaker together with the speaker's known v3 gender).
     * Speakers where the two disagree are left out until auditioned — see
     * voice_bot_service/app/sarvam_v4_voices.py, which MUST list the same voices.
     */
    public static final String MODEL_SARVAM_V4 = "sarvam_v4";

    /**
     * Engine stamped on a NEW agent. Existing agents are untouched — V421 pinned all
     * 17 of them to Sarvam, and they stay there until somebody changes them by hand.
     *
     * <p>Google Chirp3-HD as of 2026-08-05, replacing Rumik. Rumik was chosen for
     * cost (Rs 0.50/1k characters against Sarvam's Rs 3.00) but lost the argument on
     * the phone: it garbled core Hindi, and a live caller asked what "प्रतिलत" meant
     * when the model had written "प्रतिशत". Chirp3-HD was picked BY EAR over every
     * other engine AND is cheaper per call-minute than Sarvam (~Rs 2.06 vs Rs 2.34
     * at our measured 779 characters per call-minute), with ~1,280 free minutes a
     * month. Rumik stays selectable for anyone who wants the floor price.
     *
     * <p>It was held at Sarvam for several hours while four P0s from an adversarial
     * review were fixed — reply truncation from pipecat's one-message-per-sentence
     * streaming against Rumik's request/response socket; an idle-socket close that
     * starved the event loop for every concurrent call on the box; a barge-in cancel
     * that never reached the wire; and a fault-detection layer that was silently
     * unplugged. All four are fixed and proven by runtime traces against the live
     * API rather than by tests, since the tests were green throughout.
     *
     * <p>STILL NOT PROVEN: no Rumik call has ever been placed over a real phone line.
     * The first agent created after this ships is that call.
     */
    public static final String NEW_AGENT_DEFAULT = MODEL_GOOGLE;

    /**
     * Sarvam Bulbul v3 speakers (37, verified against docs.sarvam.ai 2026-07-16).
     * Genders per the voice bot's map.
     */
    private static final List<Map<String, String>> SARVAM_VOICES = List.of(
            v("ritu", "female", MODEL_SARVAM), v("priya", "female", MODEL_SARVAM),
            v("neha", "female", MODEL_SARVAM), v("pooja", "female", MODEL_SARVAM),
            v("simran", "female", MODEL_SARVAM), v("kavya", "female", MODEL_SARVAM),
            v("ishita", "female", MODEL_SARVAM), v("shreya", "female", MODEL_SARVAM),
            v("roopa", "female", MODEL_SARVAM), v("tanya", "female", MODEL_SARVAM),
            v("shruti", "female", MODEL_SARVAM), v("suhani", "female", MODEL_SARVAM),
            v("kavitha", "female", MODEL_SARVAM), v("rupali", "female", MODEL_SARVAM),
            v("niharika", "female", MODEL_SARVAM),
            v("shubh", "male", MODEL_SARVAM), v("aditya", "male", MODEL_SARVAM),
            v("rahul", "male", MODEL_SARVAM), v("rohan", "male", MODEL_SARVAM),
            v("amit", "male", MODEL_SARVAM), v("dev", "male", MODEL_SARVAM),
            v("ratan", "male", MODEL_SARVAM), v("varun", "male", MODEL_SARVAM),
            v("manan", "male", MODEL_SARVAM), v("sumit", "male", MODEL_SARVAM),
            v("kabir", "male", MODEL_SARVAM), v("aayan", "male", MODEL_SARVAM),
            v("ashutosh", "male", MODEL_SARVAM), v("advait", "male", MODEL_SARVAM),
            v("anand", "male", MODEL_SARVAM), v("tarun", "male", MODEL_SARVAM),
            v("sunny", "male", MODEL_SARVAM), v("mani", "male", MODEL_SARVAM),
            v("gokul", "male", MODEL_SARVAM), v("vijay", "male", MODEL_SARVAM),
            v("mohit", "male", MODEL_SARVAM), v("rehan", "male", MODEL_SARVAM),
            v("soham", "male", MODEL_SARVAM));

    /**
     * Sarvam Bulbul v4 Flash voices (210 of the 224 the API lists). Each carries a
     * label ("Shubh · Hinglish · ads") because the ids are not readable in a picker.
     */
    private static final List<Map<String, String>> SARVAM_V4_VOICES = List.of(
            vl("ishita_enhi_companion", "female", "Ishita · Hinglish · companion"),
            vl("ishita_enhi_customer", "female", "Ishita · Hinglish · customer"),
            vl("ishita_enhi_customer_expressive", "female", "Ishita · Hinglish · customer expressive"),
            vl("sanchita_enhi_companion", "female", "Sanchita · Hinglish · companion"),
            vl("shalini_enhi_companion", "female", "Shalini · Hinglish · companion"),
            vl("shalini_enhi_customer", "female", "Shalini · Hinglish · customer"),
            vl("shubh_enhi_ads", "male", "Shubh · Hinglish · ads"),
            vl("shubh_enhi_banking", "male", "Shubh · Hinglish · banking"),
            vl("shubh_enhi_companion", "male", "Shubh · Hinglish · companion"),
            vl("simran_enhi_banking_expressive", "female", "Simran · Hinglish · banking expressive"),
            vl("simran_enhi_companion", "female", "Simran · Hinglish · companion"),
            vl("simran_enhi_customer", "female", "Simran · Hinglish · customer"),
            vl("sunny_enhi_customer", "male", "Sunny · Hinglish · customer"),
            vl("aarti_hi_customer", "female", "Aarti · Hindi · customer"),
            vl("aayan_hi_conversational", "male", "Aayan · Hindi · conversational"),
            vl("aditya_hi_conversational", "male", "Aditya · Hindi · conversational"),
            vl("aditya_hi_sales", "male", "Aditya · Hindi · sales"),
            vl("amit_hi_conversational", "male", "Amit · Hindi · conversational"),
            vl("anand_hi_documentary", "male", "Anand · Hindi · documentary"),
            vl("anand_hi_news", "male", "Anand · Hindi · news"),
            vl("aparna_hi_customer", "female", "Aparna · Hindi · customer"),
            vl("aparna_hi_kyc", "female", "Aparna · Hindi · kyc"),
            vl("aryaman_hi_ads", "male", "Aryaman · Hindi · ads"),
            vl("ashutosh_hi_conversational", "male", "Ashutosh · Hindi · conversational"),
            vl("chaitra_hi_customer", "female", "Chaitra · Hindi · customer"),
            vl("chhavi_hi_kids", "female", "Chhavi · Hindi · kids"),
            vl("girish_hi_devotional", "male", "Girish · Hindi · devotional"),
            vl("ishita_hi_ads", "female", "Ishita · Hindi · ads"),
            vl("ishita_hi_ads_informal", "female", "Ishita · Hindi · ads informal"),
            vl("ishita_hi_banking", "female", "Ishita · Hindi · banking"),
            vl("ishita_hi_devotional", "female", "Ishita · Hindi · devotional"),
            vl("ishita_hi_edtech", "female", "Ishita · Hindi · edtech"),
            vl("ishita_hi_numbers", "female", "Ishita · Hindi · numbers"),
            vl("ishita_hi_social", "female", "Ishita · Hindi · social"),
            vl("kabir_hi_conversational", "male", "Kabir · Hindi · conversational"),
            vl("kavya_hi_conversational", "female", "Kavya · Hindi · conversational"),
            vl("kunal_hi_kids", "male", "Kunal · Hindi · kids"),
            vl("mahesh_hi_documentary", "male", "Mahesh · Hindi · documentary"),
            vl("manan_hi_conversational", "male", "Manan · Hindi · conversational"),
            vl("mani_hi_conversational", "male", "Mani · Hindi · conversational"),
            vl("mani_hi_devotional", "male", "Mani · Hindi · devotional"),
            vl("mohit_hi_conversational", "male", "Mohit · Hindi · conversational"),
            vl("mukul_hi_ads", "male", "Mukul · Hindi · ads"),
            vl("mukul_hi_suspense", "male", "Mukul · Hindi · suspense"),
            vl("nachiket_hi_devotional", "male", "Nachiket · Hindi · devotional"),
            vl("priya_hi_recovery", "female", "Priya · Hindi · recovery"),
            vl("rahul_hi_conversational", "male", "Rahul · Hindi · conversational"),
            vl("ratan_hi_customer_expressive", "male", "Ratan · Hindi · customer expressive"),
            vl("ratan_hi_devotional", "male", "Ratan · Hindi · devotional"),
            vl("ratan_hi_documentary", "male", "Ratan · Hindi · documentary"),
            vl("ratan_hi_latenight", "male", "Ratan · Hindi · latenight"),
            vl("ratan_hi_latenight_warm", "male", "Ratan · Hindi · latenight warm"),
            vl("ratan_hi_recovery", "male", "Ratan · Hindi · recovery"),
            vl("ratan_hi_social", "male", "Ratan · Hindi · social"),
            vl("ratan_hi_sports", "male", "Ratan · Hindi · sports"),
            vl("rehan_hi_social", "male", "Rehan · Hindi · social"),
            vl("ritu_hi_ads_formal", "female", "Ritu · Hindi · ads formal"),
            vl("ritu_hi_ads_informal", "female", "Ritu · Hindi · ads informal"),
            vl("ritu_hi_banking", "female", "Ritu · Hindi · banking"),
            vl("ritu_hi_conversation", "female", "Ritu · Hindi · conversation"),
            vl("ritu_hi_customer", "female", "Ritu · Hindi · customer"),
            vl("ritu_hi_customer_utility", "female", "Ritu · Hindi · customer utility"),
            vl("ritu_hi_customer_warm", "female", "Ritu · Hindi · customer warm"),
            vl("ritu_hi_edtech", "female", "Ritu · Hindi · edtech"),
            vl("ritu_hi_edtech_bot", "female", "Ritu · Hindi · edtech bot"),
            vl("ritu_hi_insurance", "female", "Ritu · Hindi · insurance"),
            vl("ritu_hi_kids", "female", "Ritu · Hindi · kids"),
            vl("ritu_hi_medical", "female", "Ritu · Hindi · medical"),
            vl("ritu_hi_reels", "female", "Ritu · Hindi · reels"),
            vl("ritu_hi_sales", "female", "Ritu · Hindi · sales"),
            vl("ritu_hi_social", "female", "Ritu · Hindi · social"),
            vl("ritu_hi_social_lively", "female", "Ritu · Hindi · social lively"),
            vl("roopa_hi_companion", "female", "Roopa · Hindi · companion"),
            vl("roopa_hi_conversational", "female", "Roopa · Hindi · conversational"),
            vl("roopa_hi_market", "female", "Roopa · Hindi · market"),
            vl("roopa_hi_narration", "female", "Roopa · Hindi · narration"),
            vl("roopa_hi_recovery", "female", "Roopa · Hindi · recovery"),
            vl("sanchita_hi_ads_formal", "female", "Sanchita · Hindi · ads formal"),
            vl("sanchita_hi_ads_informal", "female", "Sanchita · Hindi · ads informal"),
            vl("sanchita_hi_assistant", "female", "Sanchita · Hindi · assistant"),
            vl("sanchita_hi_banking", "female", "Sanchita · Hindi · banking"),
            vl("sanchita_hi_edtech", "female", "Sanchita · Hindi · edtech"),
            vl("sanchita_hi_feedback", "female", "Sanchita · Hindi · feedback"),
            vl("sanchita_hi_interview", "female", "Sanchita · Hindi · interview"),
            vl("sanchita_hi_kyc", "female", "Sanchita · Hindi · kyc"),
            vl("sanchita_hi_market", "female", "Sanchita · Hindi · market"),
            vl("sanchita_hi_romantic", "female", "Sanchita · Hindi · romantic"),
            vl("sanchita_hi_social", "female", "Sanchita · Hindi · social"),
            vl("sarika_hi_conversation", "female", "Sarika · Hindi · conversation"),
            vl("shalini_hi_companion", "female", "Shalini · Hindi · companion"),
            vl("shalini_hi_social", "female", "Shalini · Hindi · social"),
            vl("shilpa_hi_narration", "female", "Shilpa · Hindi · narration"),
            vl("shreya_hi_conversational", "female", "Shreya · Hindi · conversational"),
            vl("shreya_hi_news", "female", "Shreya · Hindi · news"),
            vl("shruti_hi_edtech", "female", "Shruti · Hindi · edtech"),
            vl("shubh_hi_ads", "male", "Shubh · Hindi · ads"),
            vl("shubh_hi_customer", "male", "Shubh · Hindi · customer"),
            vl("shubh_hi_devotional", "male", "Shubh · Hindi · devotional"),
            vl("shubh_hi_ecomm", "male", "Shubh · Hindi · ecomm"),
            vl("shubh_hi_recovery", "male", "Shubh · Hindi · recovery"),
            vl("shubh_hi_stories_dramatic", "male", "Shubh · Hindi · stories dramatic"),
            vl("shubh_hi_stories_mixed", "male", "Shubh · Hindi · stories mixed"),
            vl("simran_hi_assistant", "female", "Simran · Hindi · assistant"),
            vl("simran_hi_automobile", "female", "Simran · Hindi · automobile"),
            vl("simran_hi_conversation", "female", "Simran · Hindi · conversation"),
            vl("simran_hi_latenight", "female", "Simran · Hindi · latenight"),
            vl("simran_hi_narration", "female", "Simran · Hindi · narration"),
            vl("simran_hi_news", "female", "Simran · Hindi · news"),
            vl("simran_hi_news_breaking", "female", "Simran · Hindi · news breaking"),
            vl("simran_hi_recovery", "female", "Simran · Hindi · recovery"),
            vl("simran_hi_sales", "female", "Simran · Hindi · sales"),
            vl("simran_hi_social_energetic", "female", "Simran · Hindi · social energetic"),
            vl("simran_hi_social_excited", "female", "Simran · Hindi · social excited"),
            vl("suchitra_hi_ecomm", "female", "Suchitra · Hindi · ecomm"),
            vl("suhani_hi_social", "female", "Suhani · Hindi · social"),
            vl("suman_hi_companion", "female", "Suman · Hindi · companion"),
            vl("sumit_hi_conversational", "male", "Sumit · Hindi · conversational"),
            vl("sunny_hi_ads", "male", "Sunny · Hindi · ads"),
            vl("sunny_hi_reels", "male", "Sunny · Hindi · reels"),
            vl("tanya_hi_narration", "female", "Tanya · Hindi · narration"),
            vl("tarun_hi_conversational", "male", "Tarun · Hindi · conversational"),
            vl("tarun_hi_sales", "male", "Tarun · Hindi · sales"),
            vl("vaibhav_hi_social", "male", "Vaibhav · Hindi · social"),
            vl("vandana_hi_ecomm", "female", "Vandana · Hindi · ecomm"),
            vl("vipul_hi_social", "male", "Vipul · Hindi · social"),
            vl("aditi_en_stories", "female", "Aditi · English · stories"),
            vl("amelia_en_conversational", "female", "Amelia · English · conversational"),
            vl("aparna_en_companion", "female", "Aparna · English · companion"),
            vl("aparna_en_edtech", "female", "Aparna · English · edtech"),
            vl("chandrika_en_stories", "female", "Chandrika · English · stories"),
            vl("girish_en_devotional", "male", "Girish · English · devotional"),
            vl("girish_en_documentary", "male", "Girish · English · documentary"),
            vl("ishita_en_customer", "female", "Ishita · English · customer"),
            vl("ishita_en_medical", "female", "Ishita · English · medical"),
            vl("ishita_en_numbers", "female", "Ishita · English · numbers"),
            vl("ishita_en_social", "female", "Ishita · English · social"),
            vl("ishita_en_stories", "female", "Ishita · English · stories"),
            vl("nachiket_en_ads", "male", "Nachiket · English · ads"),
            vl("neha_en_customer", "female", "Neha · English · customer"),
            vl("neha_en_latenight", "female", "Neha · English · latenight"),
            vl("nupur_en_kids", "female", "Nupur · English · kids"),
            vl("ojas_en_social", "male", "Ojas · English · social"),
            vl("payal_en_edtech", "female", "Payal · English · edtech"),
            vl("ritu_en_edtech", "female", "Ritu · English · edtech"),
            vl("ritu_en_latenight", "female", "Ritu · English · latenight"),
            vl("ritu_en_medical", "female", "Ritu · English · medical"),
            vl("ritu_en_reels", "female", "Ritu · English · reels"),
            vl("roopa_en_conversational", "female", "Roopa · English · conversational"),
            vl("rustom_en_suspense", "male", "Rustom · English · suspense"),
            vl("sanchita_en_companion", "female", "Sanchita · English · companion"),
            vl("sanchita_en_insurance", "female", "Sanchita · English · insurance"),
            vl("sanchita_en_market", "female", "Sanchita · English · market"),
            vl("sanchita_en_recovery", "female", "Sanchita · English · recovery"),
            vl("sanchita_en_social", "female", "Sanchita · English · social"),
            vl("shabana_en_edtech", "female", "Shabana · English · edtech"),
            vl("shalini_en_companion", "female", "Shalini · English · companion"),
            vl("shalini_en_customer", "female", "Shalini · English · customer"),
            vl("shubh_en_ads", "male", "Shubh · English · ads"),
            vl("shubh_en_audiobook", "male", "Shubh · English · audiobook"),
            vl("shubh_en_narration", "male", "Shubh · English · narration"),
            vl("shubh_en_narration_gentle", "male", "Shubh · English · narration gentle"),
            vl("shubh_en_numbers", "male", "Shubh · English · numbers"),
            vl("shubh_en_recovery", "male", "Shubh · English · recovery"),
            vl("shubh_en_sports", "male", "Shubh · English · sports"),
            vl("simran_en_ads", "female", "Simran · English · ads"),
            vl("simran_en_automobile", "female", "Simran · English · automobile"),
            vl("simran_en_conversation", "female", "Simran · English · conversation"),
            vl("simran_en_customer", "female", "Simran · English · customer"),
            vl("simran_en_edtech", "female", "Simran · English · edtech"),
            vl("simran_en_edtech_bot", "female", "Simran · English · edtech bot"),
            vl("simran_en_narration", "female", "Simran · English · narration"),
            vl("simran_en_recovery", "female", "Simran · English · recovery"),
            vl("simran_en_sales", "female", "Simran · English · sales"),
            vl("simran_en_therapist", "female", "Simran · English · therapist"),
            vl("sophia_en_conversational", "female", "Sophia · English · conversational"),
            vl("sunny_en_social", "male", "Sunny · English · social"),
            vl("varun_en_ads", "male", "Varun · English · ads"),
            vl("varun_en_suspense", "male", "Varun · English · suspense"),
            vl("zarina_en_conversation", "female", "Zarina · English · conversation"),
            vl("ishita_mr_conversational", "female", "Ishita · Marathi · conversational"),
            vl("mrunal_mr_narration", "female", "Mrunal · Marathi · narration"),
            vl("mukul_mr_stories", "male", "Mukul · Marathi · stories"),
            vl("neha_mr_narration", "female", "Neha · Marathi · narration"),
            vl("nilesh_mr_conversation", "male", "Nilesh · Marathi · conversation"),
            vl("ritu_mr_insurance", "female", "Ritu · Marathi · insurance"),
            vl("ritu_mr_narration", "female", "Ritu · Marathi · narration"),
            vl("rupali_mr_stories", "female", "Rupali · Marathi · stories"),
            vl("soham_mr_narration", "male", "Soham · Marathi · narration"),
            vl("bhavik_gu_conversation", "male", "Bhavik · Gujarati · conversation"),
            vl("pooja_gu_conversational", "female", "Pooja · Gujarati · conversational"),
            vl("pooja_gu_customer", "female", "Pooja · Gujarati · customer"),
            vl("anand_pa_conversation", "male", "Anand · Punjabi · conversation"),
            vl("anand_pa_customer", "male", "Anand · Punjabi · customer"),
            vl("harpreet_pa_narration", "male", "Harpreet · Punjabi · narration"),
            vl("jaspal_pa_banking", "male", "Jaspal · Punjabi · banking"),
            vl("arnab_bn_conversation", "male", "Arnab · Bengali · conversation"),
            vl("bimal_bn_suspense", "male", "Bimal · Bengali · suspense"),
            vl("roopa_bn_conversational", "female", "Roopa · Bengali · conversational"),
            vl("chaitra_kn_conversation", "female", "Chaitra · Kannada · conversation"),
            vl("chaitra_kn_narration", "female", "Chaitra · Kannada · narration"),
            vl("chetan_kn_conversation", "male", "Chetan · Kannada · conversation"),
            vl("suchitra_kn_narration", "female", "Suchitra · Kannada · narration"),
            vl("aravind_ta_ads", "male", "Aravind · Tamil · ads"),
            vl("aravind_ta_suspense", "male", "Aravind · Tamil · suspense"),
            vl("gokul_ta_narration", "male", "Gokul · Tamil · narration"),
            vl("vijay_ta_narration", "male", "Vijay · Tamil · narration"),
            vl("kavitha_te_conversation", "female", "Kavitha · Telugu · conversation"),
            vl("kavitha_te_narration", "female", "Kavitha · Telugu · narration"),
            vl("pooja_te_conversation", "female", "Pooja · Telugu · conversation"),
            vl("tarun_te_narration", "male", "Tarun · Telugu · narration"));

    /**
     * Rumik Silk Mulberry 1.5 preset studio voices (docs.rumik.ai/mulberry).
     * Handles romanized Hindi correctly — verified by synthesizing both spellings
     * and reading the audio back through Sarvam STT, so no prompt change was needed
     * when switching engines.
     */
    private static final List<Map<String, String>> RUMIK_VOICES = List.of(
            v("ira", "female", MODEL_RUMIK), v("emma", "female", MODEL_RUMIK),
            v("mia", "female", MODEL_RUMIK), v("sophia", "female", MODEL_RUMIK),
            v("ava", "female", MODEL_RUMIK), v("siya", "female", MODEL_RUMIK),
            v("aisha", "female", MODEL_RUMIK), v("zoya", "female", MODEL_RUMIK),
            v("adam", "male", MODEL_RUMIK), v("lucas", "male", MODEL_RUMIK),
            v("noah", "male", MODEL_RUMIK), v("theo", "male", MODEL_RUMIK));

    /**
     * Google Cloud hi-IN voices, curated from the live {@code list_voices} API
     * (46 available; 30 of them Chirp3-HD). Genders are Google's own
     * {@code ssml_gender} — NOT guessed from the name, because nothing in
     * "Achird" (male) or "Achernar" (female) says which is which, and a wrong
     * gender here makes a male voice speak feminine Hindi.
     *
     * <p>Chirp3-HD leads because the founder chose it by ear; the Neural2 and
     * WaveNet entries are the ~half-price tiers, kept selectable for volume.
     */
    /**
     * Microsoft Edge read-aloud — FREE, no API key. Only these five exist for
     * India: two Hindi, three English. Names are locale-prefixed and end in
     * Neural, which is also how the bot distinguishes them from another
     * vendor's palette when a stale voice is stored.
     */
    private static final List<Map<String, String>> EDGE_VOICES = List.of(
            v("hi-IN-SwaraNeural", "female", MODEL_EDGE),
            v("hi-IN-MadhurNeural", "male", MODEL_EDGE),
            v("en-IN-NeerjaNeural", "female", MODEL_EDGE),
            v("en-IN-NeerjaExpressiveNeural", "female", MODEL_EDGE),
            v("en-IN-PrabhatNeural", "male", MODEL_EDGE));

    private static final List<Map<String, String>> GOOGLE_VOICES = List.of(
            v("hi-IN-Chirp3-HD-Achird", "male", MODEL_GOOGLE),
            v("hi-IN-Chirp3-HD-Charon", "male", MODEL_GOOGLE),
            v("hi-IN-Chirp3-HD-Fenrir", "male", MODEL_GOOGLE),
            v("hi-IN-Chirp3-HD-Orus", "male", MODEL_GOOGLE),
            v("hi-IN-Chirp3-HD-Puck", "male", MODEL_GOOGLE),
            v("hi-IN-Chirp3-HD-Schedar", "male", MODEL_GOOGLE),
            v("hi-IN-Chirp3-HD-Achernar", "female", MODEL_GOOGLE),
            v("hi-IN-Chirp3-HD-Aoede", "female", MODEL_GOOGLE),
            v("hi-IN-Chirp3-HD-Kore", "female", MODEL_GOOGLE),
            v("hi-IN-Chirp3-HD-Leda", "female", MODEL_GOOGLE),
            v("hi-IN-Chirp3-HD-Zephyr", "female", MODEL_GOOGLE),
            v("hi-IN-Chirp3-HD-Sulafat", "female", MODEL_GOOGLE),
            v("hi-IN-Neural2-B", "male", MODEL_GOOGLE),
            v("hi-IN-Neural2-C", "male", MODEL_GOOGLE),
            v("hi-IN-Neural2-A", "female", MODEL_GOOGLE),
            v("hi-IN-Neural2-D", "female", MODEL_GOOGLE),
            v("hi-IN-Wavenet-B", "male", MODEL_GOOGLE),
            v("hi-IN-Wavenet-C", "male", MODEL_GOOGLE),
            v("hi-IN-Wavenet-A", "female", MODEL_GOOGLE),
            v("hi-IN-Wavenet-D", "female", MODEL_GOOGLE));

    /**
     * Smallest.ai Lightning v3.1 (standard) Hindi voices with an Indian accent,
     * from the live {@code /waves/v1/lightning-v3.1/get_voices} catalog. Genders
     * are the vendor's own {@code tags.gender}.
     *
     * <p>Only v3.1 voices are listed: mixing in a {@code _pro} name (mandar,
     * manasi, meher…) would be rejected by the API on the standard model and the
     * call would go silent.
     */
    private static final List<Map<String, String>> SMALLEST_VOICES = List.of(
            v("devansh", "male", MODEL_SMALLEST),
            v("kaustubh", "male", MODEL_SMALLEST),
            v("virat", "male", MODEL_SMALLEST),
            v("karan", "male", MODEL_SMALLEST),
            v("yash", "male", MODEL_SMALLEST),
            v("debashis", "male", MODEL_SMALLEST),
            v("imogen", "female", MODEL_SMALLEST),
            v("nirupma", "female", MODEL_SMALLEST),
            v("niharika", "female", MODEL_SMALLEST));

    /**
     * Deepgram Aura-2 American-English voices, curated from the live catalog.
     * Genders are Deepgram's own {@code metadata.tags} (feminine/masculine), NOT
     * inferred from the mythological names — Janus and Juno are both FEMALE there,
     * which no reading of the names would tell you. Must stay in lockstep with
     * bot.py's _DEEPGRAM_MALE_VOICES or a male voice speaks feminine grammar.
     */
    private static final List<Map<String, String>> DEEPGRAM_VOICES = List.of(
            v("aura-2-apollo-en", "male", MODEL_DEEPGRAM),
            v("aura-2-arcas-en", "male", MODEL_DEEPGRAM),
            v("aura-2-atlas-en", "male", MODEL_DEEPGRAM),
            v("aura-2-hermes-en", "male", MODEL_DEEPGRAM),
            v("aura-2-mars-en", "male", MODEL_DEEPGRAM),
            v("aura-2-odysseus-en", "male", MODEL_DEEPGRAM),
            v("aura-2-asteria-en", "female", MODEL_DEEPGRAM),
            v("aura-2-athena-en", "female", MODEL_DEEPGRAM),
            v("aura-2-helena-en", "female", MODEL_DEEPGRAM),
            v("aura-2-hera-en", "female", MODEL_DEEPGRAM),
            v("aura-2-luna-en", "female", MODEL_DEEPGRAM),
            v("aura-2-cordelia-en", "female", MODEL_DEEPGRAM),
            v("aura-2-harmonia-en", "female", MODEL_DEEPGRAM),
            v("aura-2-electra-en", "female", MODEL_DEEPGRAM));

    private static final List<Map<String, String>> NAVANA_VOICES = List.of(
            v("achu", "male", MODEL_NAVANA),
            v("anirban", "male", MODEL_NAVANA),
            v("basava", "male", MODEL_NAVANA),
            v("basheer", "male", MODEL_NAVANA),
            v("bijay", "male", MODEL_NAVANA),
            v("chhotu", "male", MODEL_NAVANA),
            v("elango", "male", MODEL_NAVANA),
            v("faizal", "male", MODEL_NAVANA),
            v("gurdeep", "male", MODEL_NAVANA),
            v("imran", "male", MODEL_NAVANA),
            v("kannan", "male", MODEL_NAVANA),
            v("kishan", "male", MODEL_NAVANA),
            v("murugan", "male", MODEL_NAVANA),
            v("savio", "male", MODEL_NAVANA),
            v("shivanna", "male", MODEL_NAVANA),
            v("srinu", "male", MODEL_NAVANA),
            v("sulaiman", "male", MODEL_NAVANA),
            v("tanaji", "male", MODEL_NAVANA),
            v("temjen", "male", MODEL_NAVANA),
            v("vetri", "male", MODEL_NAVANA),
            v("xavier", "male", MODEL_NAVANA),
            v("ammu", "female", MODEL_NAVANA),
            v("ann", "female", MODEL_NAVANA),
            v("arasi", "female", MODEL_NAVANA),
            v("ayesha", "female", MODEL_NAVANA),
            v("bhavana", "female", MODEL_NAVANA),
            v("bimla", "female", MODEL_NAVANA),
            v("champa", "female", MODEL_NAVANA),
            v("falguni", "female", MODEL_NAVANA),
            v("flavia", "female", MODEL_NAVANA),
            v("harleen", "female", MODEL_NAVANA),
            v("ipsita", "female", MODEL_NAVANA),
            v("jayita", "female", MODEL_NAVANA),
            v("jessy", "female", MODEL_NAVANA),
            v("kayal", "female", MODEL_NAVANA),
            v("mahadevi", "female", MODEL_NAVANA),
            v("malar", "female", MODEL_NAVANA),
            v("maria", "female", MODEL_NAVANA),
            v("merin", "female", MODEL_NAVANA),
            v("mukta", "female", MODEL_NAVANA),
            v("nasrin", "female", MODEL_NAVANA),
            v("nayeema", "female", MODEL_NAVANA),
            v("netra", "female", MODEL_NAVANA),
            v("nila", "female", MODEL_NAVANA),
            v("ponni", "female", MODEL_NAVANA),
            v("porkavi", "female", MODEL_NAVANA),
            v("rukhiya", "female", MODEL_NAVANA),
            v("rukhsana", "female", MODEL_NAVANA),
            v("selvi", "female", MODEL_NAVANA),
            v("shabnam", "female", MODEL_NAVANA),
            v("sharon", "female", MODEL_NAVANA),
            v("shikha", "female", MODEL_NAVANA),
            v("vanaja", "female", MODEL_NAVANA),
            v("yasmin", "female", MODEL_NAVANA),
            v("zoya", "female", MODEL_NAVANA));

    /**
     * Lightning v3.1 <b>Pro</b> voices. Disjoint from the standard palette above —
     * see {@link #MODEL_SMALLEST_PRO}. Must stay in lockstep with bot.py's
     * _SMALLEST_PRO_MALE / _SMALLEST_PRO_FEMALE.
     */
    private static final List<Map<String, String>> SMALLEST_PRO_VOICES = List.of(
            v("mandar", "male", MODEL_SMALLEST_PRO),
            v("mathan", "male", MODEL_SMALLEST_PRO),
            v("barath", "male", MODEL_SMALLEST_PRO),
            v("manasi", "female", MODEL_SMALLEST_PRO),
            v("mrunal", "female", MODEL_SMALLEST_PRO),
            v("ketaki", "female", MODEL_SMALLEST_PRO),
            v("meher", "female", MODEL_SMALLEST_PRO));

    /**
     * The ONE place every palette is registered. Ordered (LinkedHashMap) because
     * {@link #all()} flattens it and the picker shows voices in this order.
     *
     * <p>Adding an engine means adding it HERE and nowhere else: all(), models(),
     * IDS_BY_MODEL and isVoiceOf() all derive from this map. all() used to keep its
     * own hand-written list of palettes and silently omitted smallest_pro and
     * deepgram — their engines showed in the picker with an EMPTY voice dropdown.
     */
    private static final Map<String, List<Map<String, String>>> BY_MODEL = new LinkedHashMap<>();
    static {
        BY_MODEL.put(MODEL_GOOGLE, GOOGLE_VOICES);
        BY_MODEL.put(MODEL_EDGE, EDGE_VOICES);
        BY_MODEL.put(MODEL_SMALLEST, SMALLEST_VOICES);
        BY_MODEL.put(MODEL_SMALLEST_PRO, SMALLEST_PRO_VOICES);
        BY_MODEL.put(MODEL_DEEPGRAM, DEEPGRAM_VOICES);
        BY_MODEL.put(MODEL_NAVANA, NAVANA_VOICES);
        BY_MODEL.put(MODEL_RUMIK, RUMIK_VOICES);
        BY_MODEL.put(MODEL_SARVAM, SARVAM_VOICES);
        BY_MODEL.put(MODEL_SARVAM_V4, SARVAM_V4_VOICES);
    }

    private static final Map<String, Set<String>> IDS_BY_MODEL = new LinkedHashMap<>();
    static {
        // LOWERCASED, because isVoiceOf() looks up a lowercased key and calls
        // itself case-insensitive. It was not: the ids went in with their own
        // casing, so every Google voice ('hi-IN-Chirp3-HD-...') failed the check,
        // AiAgentService dutifully "fell back" to defaultVoice — which is MALE —
        // and a female Chirp3-HD voice could not be saved at all. Sarvam, Rumik
        // and Smallest never noticed: their ids are already lowercase.
        BY_MODEL.forEach((model, voices) -> IDS_BY_MODEL.put(model,
                voices.stream().map(m -> m.get("id").toLowerCase(Locale.ROOT))
                        .collect(Collectors.toSet())));
    }

    /** Every voice, model-tagged. The frontend groups by {@code model}. */
    public static List<Map<String, String>> all() {
        // Derived from BY_MODEL on purpose — a hand-written palette list here is
        // exactly what shipped smallest_pro and deepgram with empty dropdowns.
        return BY_MODEL.values().stream().flatMap(List::stream).toList();
    }

    public static List<Map<String, String>> forModel(String model) {
        return BY_MODEL.getOrDefault(normalizeModel(model), SARVAM_VOICES);
    }

    /** Default voice when none is set, or when a cross-vendor name had to be dropped. */
    public static String defaultVoice(String model) {
        String m = normalizeModel(model);
        if (MODEL_RUMIK.equals(m)) return "ira";
        // The founder's pick, and male — agent personas here are predominantly male
        // and Hindi verb gender follows the voice.
        if (MODEL_EDGE.equals(m)) return "hi-IN-SwaraNeural";
        if (MODEL_GOOGLE.equals(m)) return "hi-IN-Chirp3-HD-Achird";
        if (MODEL_SMALLEST.equals(m)) return "devansh";
        if (MODEL_SMALLEST_PRO.equals(m)) return "mandar";
        // English-only engine; Asteria is its clear/confident female voice.
        if (MODEL_DEEPGRAM.equals(m)) return "aura-2-asteria-en";
        if (MODEL_NAVANA.equals(m)) return "bhavana";
        if (MODEL_SARVAM_V4.equals(m)) return "shubh_enhi_ads";
        return "priya";
    }

    /**
     * The palette's OWN spelling of {@code voice}, or null when it is not in it.
     *
     * <p>Exists because Google voice ids are CASE-SENSITIVE at the vendor
     * ({@code hi-IN-Chirp3-HD-Achernar}) while everything around them is
     * case-insensitive. AiAgentService used to store
     * {@code voice.trim().toLowerCase()}, which is harmless for Sarvam, Rumik and
     * Smallest (their names are lowercase anyway) and silently fatal for Google:
     * {@code hi-in-chirp3-hd-achernar} is rejected by the vendor, the bot falls
     * back to Sarvam, and Sarvam's default voice is MALE. The founder picked a
     * female Chirp3-HD voice on 2026-08-06, saved it, and every call still came
     * out male with nothing anywhere saying why.
     *
     * <p>So: accept any casing from any client, store the catalog's.
     */
    public static String canonicalVoice(String model, String voice) {
        if (voice == null || voice.isBlank()) return null;
        String want = voice.trim().toLowerCase(Locale.ROOT);
        for (Map<String, String> v : forModel(model)) {
            String id = v.get("id");
            if (id != null && id.toLowerCase(Locale.ROOT).equals(want)) return id;
        }
        return null;
    }

    /** True when {@code voice} is in {@code model}'s palette (case-insensitive). */
    public static boolean isVoiceOf(String model, String voice) {
        if (voice == null || voice.isBlank()) return false;
        return IDS_BY_MODEL.getOrDefault(normalizeModel(model), Set.of())
                .contains(voice.trim().toLowerCase(Locale.ROOT));
    }

    /**
     * Canonical engine key, or null when unrecognised.
     *
     * <p>Tolerant of what a client might plausibly send for the same engine
     * ({@code silk}, {@code mulberry}, {@code silk-mulberry}, {@code bulbul}) but
     * NOT of anything that merely looks adjacent. In particular {@code muga} does
     * not resolve to Rumik: Silk Muga 1 is a dearer model we have not wired, and
     * mapping it onto Mulberry would serve one engine while charging for another.
     * Unrecognised values are rejected by the caller rather than defaulted, so a
     * typo can never quietly reprice an agent.
     */
    public static String normalizeModel(String raw) {
        if (raw == null) return null;
        String m = raw.trim().toLowerCase(Locale.ROOT);
        if (m.isEmpty()) return null;
        // Any spelling of Muga ("silk muga" with a space used to fall through to Mulberry below).
        if (m.contains("muga")) return null;
        if (m.equals(MODEL_RUMIK) || m.startsWith("rumik") || m.startsWith("silk")
                || m.startsWith("mulberry")) return MODEL_RUMIK;
        // v4 BEFORE v3: "sarvam_v4" also startsWith("sarvam"), and running a v4 voice
        // on v3 is a 400 = a silent call.
        if (m.startsWith("sarvam_v4") || m.startsWith("sarvam-v4") || m.startsWith("bulbul:v4")
                || m.startsWith("bulbul_v4") || m.startsWith("bulbul-v4")) {
            return MODEL_SARVAM_V4;
        }
        if (m.equals(MODEL_SARVAM) || m.startsWith("sarvam") || m.startsWith("bulbul")) return MODEL_SARVAM;
        if (m.equals(MODEL_EDGE) || m.startsWith("edge") || m.startsWith("microsoft")) return MODEL_EDGE;
        if (m.equals(MODEL_GOOGLE) || m.startsWith("google") || m.startsWith("chirp")) return MODEL_GOOGLE;
        if (m.equals(MODEL_DEEPGRAM) || m.startsWith("deepgram") || m.startsWith("aura")) {
            return MODEL_DEEPGRAM;
        }
        if (m.equals(MODEL_NAVANA) || m.startsWith("navana") || m.startsWith("bodhi")) return MODEL_NAVANA;
        // Pro FIRST: "smallest_pro" also startsWith("smallest"), so the generic test
        // below would swallow it and run pro voices on the standard model = silence.
        if (m.contains("pro") && (m.startsWith("smallest") || m.startsWith("lightning"))) {
            return MODEL_SMALLEST_PRO;
        }
        if (m.equals(MODEL_SMALLEST) || m.startsWith("smallest") || m.startsWith("lightning")) {
            return MODEL_SMALLEST;
        }
        return null;
    }

    /** For the picker: engines with their label and voice list. */
    public static List<Map<String, Object>> models() {
        List<Map<String, Object>> out = new java.util.ArrayList<>();
        out.add(model(MODEL_GOOGLE, "Google Chirp3-HD",
                "Recommended — clearest Hindi; cheaper per minute than Sarvam"));
        out.add(model(MODEL_EDGE, "Microsoft Edge (free)",
                "No vendor cost — billed at a cheaper per-minute rate. Slightly slower to start."));
        out.add(model(MODEL_SMALLEST, "Smallest.ai Lightning v3.1",
                "Indian-language specialist"));
        out.add(model(MODEL_SMALLEST_PRO, "Smallest.ai Lightning v3.1 Pro",
                "Higher-quality Indian voices. Different voice list from v3.1."));
        out.add(model(MODEL_DEEPGRAM, "Deepgram Aura-2 (English only)",
                "English-only \u2014 no Hindi voice exists. Do not use for a Hinglish agent."));
        out.add(model(MODEL_NAVANA, "Navana (Bodhi)",
                "Indian voices; one voice speaks all ten languages. New — audition first."));
        out.add(model(MODEL_RUMIK, "Rumik Silk Mulberry 1.5",
                "Cheapest, but mispronounces some Hindi words on the phone"));
        out.add(model(MODEL_SARVAM_V4, "Sarvam Bulbul v4 Flash",
                "New — 200+ persona voices in 10 Indian languages; no extra charge. Audition first."));
        out.add(model(MODEL_SARVAM, "Sarvam Bulbul v3", "+4 credits per minute"));
        return out;
    }

    private static Map<String, Object> model(String id, String label, String note) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("label", label);
        m.put("note", note);
        m.put("defaultVoice", defaultVoice(id));
        m.put("voices", BY_MODEL.get(id));
        return m;
    }

    private static Map<String, String> v(String id, String gender, String model) {
        return Map.of("id", id, "gender", gender, "model", model);
    }

    /** A Bulbul v4 voice: its id is not readable on its own, so it carries a label. */
    private static Map<String, String> vl(String id, String gender, String label) {
        return Map.of("id", id, "gender", gender, "model", MODEL_SARVAM_V4, "label", label);
    }
}
