package vacademy.io.admin_core_service.features.super_admin.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.Query;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.super_admin.dto.SuperAdminCallDTO;
import vacademy.io.admin_core_service.features.super_admin.dto.SuperAdminCallSummaryDTO;
import vacademy.io.admin_core_service.features.super_admin.dto.TtsCacheSummaryDTO;
import vacademy.io.admin_core_service.features.super_admin.dto.SuperAdminPageResponse;

import java.math.BigDecimal;
import java.util.*;

/**
 * Every AI call across every institute, with what it cost and what it earned.
 *
 * <p>WHAT IS REAL AND WHAT IS NOT. Duration, disposition, health and the
 * diagnostics blob are recorded per call and are exact. Cost is NOT: the voice
 * bot does not report token or character usage (ai_token_usage holds no voice
 * rows) and telephony_call_log.price is null on all 9,690 rows — so every rupee
 * is duration x a voice_call_rate_card row. The DTO carries costIsModelled so
 * the UI can say so rather than imply a precision we do not have.
 *
 * <p>Recording lives on the JOINED telephony_call_log row (274 of 280 recent
 * calls have one); ai_call_result.recording_url is empty on every row.
 */
@Slf4j
@Service
public class SuperAdminCallService {

    @PersistenceContext
    private EntityManager em;

    // EVERY bind parameter is CAST explicitly. Postgres cannot infer a type for
    // `$1 IS NULL` — the null-safe optional-filter idiom — and fails the whole
    // statement with "could not determine data type of parameter $1", which the
    // global handler turns into a 511. Live symptom: /calls and /calls/summary
    // both 511'd while /calls/rate-card returned 200, because rate-card is the
    // only query here that binds nothing.
    private static final String BASE_FROM = """
            FROM ai_call_result r
            LEFT JOIN telephony_call_log l ON l.id = r.call_log_id
            LEFT JOIN ai_agent a ON a.id = r.campaign_id
            LEFT JOIN institutes i ON i.id = r.institute_id
            WHERE r.provider IS DISTINCT FROM 'MOCK'
              AND (CAST(:instituteId AS text) IS NULL OR r.institute_id = CAST(:instituteId AS text))
              AND (CAST(:fromTs AS text) IS NULL OR r.created_at >= CAST(:fromTs AS timestamp))
              AND (CAST(:toTs   AS text) IS NULL OR r.created_at <  CAST(:toTs   AS timestamp))
              AND (CAST(:health AS text) IS NULL OR r.diag_health = CAST(:health AS text))
              AND (CAST(:disposition AS text) IS NULL OR r.disposition = CAST(:disposition AS text))
              AND (CAST(:agentId AS text) IS NULL OR r.campaign_id = CAST(:agentId AS text))
            """;

    /**
     * The TTS engine the call ACTUALLY used, from what the bot recorded on it
     * (diagnostics.tts.vendor = the service's model name), not the agent's current
     * setting: switching an agent's voice used to reprice every past call it made
     * (1,195 lightning_v3.1_pro calls belong to agents now on navana). The agent's
     * engine is only the fallback for a call that recorded nothing.
     *
     * <p>'bulbul_v4%' (LIKE's one-character wildcard), not 'bulbul:v4%': Hibernate
     * reads a ':' in native SQL as a parameter marker.
     */
    static final String ENGINE_SQL = """
            CASE
              WHEN r.diagnostics->'tts'->>'vendor' ILIKE 'bulbul_v4%' THEN 'sarvam_v4'
              WHEN r.diagnostics->'tts'->>'vendor' ILIKE 'bulbul%' THEN 'sarvam'
              WHEN r.diagnostics->'tts'->>'vendor' ILIKE 'lightning%pro%' THEN 'smallest_pro'
              WHEN r.diagnostics->'tts'->>'vendor' ILIKE 'lightning%' THEN 'smallest'
              WHEN r.diagnostics->'tts'->>'vendor' ILIKE '%bodhi%' THEN 'navana'
              WHEN r.diagnostics->'tts'->>'vendor' ILIKE 'google%' OR r.diagnostics->'tts'->>'vendor' ILIKE 'chirp%' THEN 'google'
              WHEN r.diagnostics->'tts'->>'vendor' ILIKE 'edge%' THEN 'edge'
              WHEN r.diagnostics->'tts'->>'vendor' ILIKE '%mulberry%' OR r.diagnostics->'tts'->>'vendor' ILIKE 'rumik%' THEN 'rumik'
              WHEN r.diagnostics->'tts'->>'vendor' ILIKE 'aura%' OR r.diagnostics->'tts'->>'vendor' ILIKE '%deepgram%' THEN 'deepgram'
              ELSE COALESCE(a.tts_model, 'sarvam')
            END""";

    /**
     * What the wallet ACTUALLY charged for the call, PER LEG: the ledger rows
     * CallBillingService wrote under its idempotency keys (AI leg by the report's call
     * uuid or the call log, telephony leg by the call log). chr(58) is ':' — see
     * ENGINE_SQL. Each column is NULL while that leg has no ledger row.
     *
     * <p>Per leg, not one sum: the two legs are charged independently (voice from the
     * Plivo status webhook, AI from the bot's report, each through its own ai_service
     * deduct), so for seconds — or ~15 min when ai_service is mid-deploy and the
     * reconciliation sweep has to heal it — only one of them is in. A single sum then
     * passed for the final charge: the voice leg alone (1 credit/min of 1 + 5) was shown
     * without "est." and the summary dropped the missing AI leg altogether.
     */
    private static final String LEDGER_JOIN = """
            LEFT JOIN LATERAL (
                SELECT SUM(ABS(t.amount)) FILTER (WHERE t.external_reference_id LIKE 'voice%') AS voice_credits,
                       SUM(ABS(t.amount)) FILTER (WHERE t.external_reference_id LIKE 'ai%') AS ai_credits
                  FROM credit_transactions t
                 WHERE t.institute_id = r.institute_id AND t.transaction_type = 'USAGE_DEDUCTION'
                   AND t.external_reference_id IN (
                       'ai_call' || chr(58) || 'uuid' || chr(58) || r.provider || chr(58) || r.call_uuid,
                       'ai_call' || chr(58) || r.call_log_id,
                       'voice_call' || chr(58) || r.call_log_id)) led ON TRUE
            """;

    /**
     * The telephony leg is still to be charged: no ledger row, the call log not
     * stamped, a Vacademy-paid trunk (CallBillingService.VOICE_BILLABLE_PROVIDERS) and a
     * connected call. Only such a leg is estimated. A log STAMPED with no ledger row was
     * charged 0 on purpose — bill() stamps a 0-rate (negotiated override) call without
     * writing a row — so it earns 0, not an estimate at the global rate forever.
     *
     * <p>Shared verbatim by list() and summary() so a row and the total it rolls into
     * can never disagree about which legs are estimated.
     */
    static final String VOICE_PENDING_SQL = "(led.voice_credits IS NULL AND l.credits_billed_at IS NULL"
            + " AND COALESCE(l.provider_type, '') IN ('PLIVO', 'VACADEMY_AI')"
            + " AND r.status ILIKE 'complete%' AND r.duration_seconds > 0)";

    /**
     * The AI leg is still to be charged — the same gates the live hook
     * (AiCallOutcomeProcessor) and CallBillingReconciliationJob apply: a metered
     * provider, a report that was not rejected, and a stable identity to bill under
     * (no call uuid and no pre-call correlation = never billed, so never pending).
     * ai_call_result.credits_billed_at with no ledger row = charged 0, as for the voice leg.
     */
    static final String AI_PENDING_SQL = "(led.ai_credits IS NULL AND r.credits_billed_at IS NULL"
            + " AND r.provider IN ('VACADEMY_AI', 'AAVTAAR')"
            + " AND COALESCE(r.processing_status, '') NOT IN ('REJECTED_UNVERIFIED', 'PARSE_FAILED')"
            + " AND (r.call_uuid IS NOT NULL OR (r.correlation_id IS NOT NULL AND r.call_log_id IS NOT NULL))"
            + " AND r.status ILIKE 'complete%' AND r.duration_seconds > 0)";

    /** Billing pulses of the calls matching {@code cond}, summed (summary columns). */
    private static String pulsesWhere(String cond) {
        return "COALESCE(sum(CASE WHEN " + cond
                + " THEN (r.duration_seconds + :pulse - 1) / :pulse ELSE 0 END), 0)";
    }

    /** BASE_FROM with the ledger join (list and summary only — the count needs neither). */
    private static String fromWithLedger() {
        int at = BASE_FROM.indexOf("WHERE r.provider");
        return BASE_FROM.substring(0, at) + LEDGER_JOIN + BASE_FROM.substring(at);
    }

    /** The billing pulse (telephony.billing.pulse-seconds; 30 s since 2026-09-30). */
    @org.springframework.beans.factory.annotation.Value("${telephony.billing.pulse-seconds:30}")
    private int pulseSeconds = 30;

    /** engine -> credits/min surcharge, read live so it cannot drift from billing. */
    @Transactional(readOnly = true)
    public Map<String, Double> ttsSurcharges() {
        Map<String, Double> out = new LinkedHashMap<>();
        List<Object[]> rows = em.createNativeQuery(
                "SELECT model, surcharge_credits_per_min FROM ai_tts_model_pricing WHERE is_active")
                .getResultList();
        for (Object[] r : rows) out.put((String) r[0], ((Number) r[1]).doubleValue());
        return out;
    }

    /** request_type -> (credits/min, per-call minimum), straight from credit_pricing. */
    @Transactional(readOnly = true)
    public Map<String, double[]> creditPricing() {
        Map<String, double[]> out = new LinkedHashMap<>();
        List<Object[]> rows = em.createNativeQuery(
                "SELECT request_type, token_rate, minimum_charge FROM credit_pricing WHERE is_active")
                .getResultList();
        for (Object[] r : rows) {
            out.put((String) r[0], new double[]{
                    ((Number) r[1]).doubleValue(), ((Number) r[2]).doubleValue()});
        }
        return out;
    }

    /**
     * What one call billed, and whether any of it is still an estimate.
     *
     * @param estimated true while some leg is still to be charged — the portal marks
     *                  the figure "est." exactly then
     */
    record Billed(double inr, boolean estimated) {}

    /**
     * Per leg: the ledger amount where that leg was charged, the pulse estimate only
     * for a leg still pending ({@link #VOICE_PENDING_SQL} / {@link #AI_PENDING_SQL}),
     * and 0 for anything else — a leg stamped billed with no ledger row (0-rate), a
     * leg that does not apply (own carrier, MOCK), a call that never connected.
     */
    Billed billed(Map<String, Double> card, Map<String, Double> surcharge,
                  Map<String, double[]> pricing, String engine, String direction, int seconds,
                  Number voiceLedger, Number aiLedger, boolean voicePending, boolean aiPending) {
        double creditInr = card.getOrDefault("credit_inr", 0d);
        double inr = 0d;
        if (voiceLedger != null) inr += voiceLedger.doubleValue() * creditInr;
        if (aiLedger != null) inr += aiLedger.doubleValue() * creditInr;
        inr += estimatedInr(card, surcharge, pricing, engine, direction, seconds, voicePending, aiPending);
        return new Billed(inr, voicePending || aiPending);
    }

    /**
     * What the PENDING legs of this call will bill, in rupees — mirroring CallBillingService.
     *
     * <p>Modelling this as a flat rupees-per-minute was wrong twice over, and the
     * founder caught both on a 30-second call the page priced at Rs 1.86 when the
     * wallet had really taken Rs 9.30:
     *
     * <ul>
     *   <li>Billing CEILS to whole minutes with a per-call floor —
     *       {@code max(minimum, ceil(secs/60) x perMinute)} — so a six-second call
     *       bills a full minute, not a tenth of one.</li>
     *   <li>There are TWO meters, not one: the telephony leg
     *       (voice_call_out/in, on Vacademy-paid trunks only) AND the AI leg
     *       (ai_call_out/in), and the TTS engine surcharge rides on the AI leg.</li>
     * </ul>
     *
     * <p>Rates come from credit_pricing and the surcharge from
     * ai_tts_model_pricing — the same two tables the billing path itself reads,
     * so this cannot drift from what the wallet actually charged. It is still a
     * RECONSTRUCTION, not the ledger: a negotiated per-institute override
     * suppresses the surcharge in the real path and is not modelled here.
     *
     * <p>Which legs apply (Vacademy-paid trunk, metered AI provider, connected, not
     * yet charged) is decided in SQL by the pending predicates, so list and summary
     * share one definition; this only prices them.
     */
    double estimatedInr(Map<String, Double> card, Map<String, Double> surcharge,
                        Map<String, double[]> pricing, String engine, String direction,
                        int seconds, boolean voicePending, boolean aiPending) {
        if (seconds <= 0 || (!voicePending && !aiPending)) return 0d;
        // Billed in pulses (30 s by default), as CallBillingService does:
        // ceil(secs / pulse) pulses at perMinute x pulse/60. It was ceil-MINUTES,
        // which overstated every call that was not a whole number of minutes
        // (a 77 s call: 2 minutes = 12 credits; the wallet took 9).
        int pulse = Math.max(1, pulseSeconds);
        double minutes = Math.ceil(seconds / (double) pulse) * pulse / 60.0;
        boolean inbound = "INBOUND".equalsIgnoreCase(direction);
        String e = (engine == null || engine.isBlank()) ? "sarvam" : engine.trim().toLowerCase();
        // An escape hatch for an engine priced outside the credit stack entirely.
        // Edge USED one while its discount was report-only; it now rides the same
        // negative surcharge the wallet charges, so no engine sets this today. It
        // replaces the whole credit stack, so it rides the leg the engine prices (AI)
        // and the telephony leg adds nothing — summary() applies it the same way.
        Double flat = card.get("billed_inr_per_min_" + e);
        if (flat != null && flat > 0) return aiPending ? flat * minutes : 0d;

        double credits = 0d;
        // Telephony leg — VOICE_PENDING_SQL already requires a Vacademy-paid trunk.
        if (voicePending) {
            double[] v = pricing.get(inbound ? "voice_call_in" : "voice_call_out");
            if (v != null) credits += Math.max(v[1], v[0] * minutes);
        }
        // AI leg — the engine surcharge rides here, and it can be NEGATIVE (Edge is
        // free to run, so it sells at 2 credits against the standard 5). Floor the
        // per-minute at zero exactly as CallBillingService does, so a surcharge
        // deeper than the base rate can never make this report a refund.
        double[] a = aiPending ? pricing.get(inbound ? "ai_call_in" : "ai_call_out") : null;
        if (a != null) {
            double perMin = Math.max(0d, a[0] + surcharge.getOrDefault(e, 0d));
            credits += Math.max(a[1], perMin * minutes);
        }
        return credits * card.getOrDefault("credit_inr", 0d);
    }

    /** component -> INR/min, from the rate card. Missing component = 0, never a guess. */
    @Transactional(readOnly = true)
    public Map<String, Double> rateCard() {
        Map<String, Double> out = new LinkedHashMap<>();
        List<Object[]> rows = em.createNativeQuery(
                "SELECT component, inr_per_min FROM voice_call_rate_card WHERE is_active").getResultList();
        for (Object[] r : rows) {
            out.put((String) r[0], ((Number) r[1]).doubleValue());
        }
        return out;
    }

    /**
     * Per-component rupee cost.
     *
     * <p>Plivo bills in 30-SECOND PULSES — a six-second call costs half a
     * minute, a 1:45 call two minutes — so the telephony leg is ceiled to the
     * pulse. (It was ceiled to whole minutes, which overstated every call by up
     * to half a minute: verified against the Plivo rate, 2026-09-23.) STT, TTS
     * and the LLM are usage meters (per second, per character, per token) and
     * stay fractional.
     */
    private Map<String, Double> breakdown(Map<String, Double> card, String ttsModel,
                                          double minutes, int seconds, Integer ttsChars) {
        return breakdown(card, ttsModel, minutes, seconds, ttsChars, null);
    }

    /** LLM rupees from the call's own tokens, or null when it reported none or the card lacks the rates. */
    static Double llmFromTokens(Map<String, Double> card, long[] usage) {
        if (usage == null) return null;
        Double in = card.get("llm_in_per_mtok"), cached = card.get("llm_cached_per_mtok"),
                out = card.get("llm_out_per_mtok");
        if (in == null || cached == null || out == null) return null;
        long prompt = usage[0], hit = Math.min(usage[1], usage[0]), completion = usage[2];
        return ((prompt - hit) * in + hit * cached + completion * out) / 1_000_000d;
    }

    /** diagnostics.infra.llmUsage → {promptTokens, cachedTokens, completionTokens}, or null. */
    private long[] llmUsage(String diagnosticsJson) {
        if (diagnosticsJson == null || diagnosticsJson.isBlank()) return null;
        try {
            com.fasterxml.jackson.databind.JsonNode u =
                    DIAG_MAPPER.readTree(diagnosticsJson).path("infra").path("llmUsage");
            if (!u.path("promptTokens").isNumber()) return null;
            return new long[]{u.path("promptTokens").asLong(), u.path("cachedTokens").asLong(0),
                    u.path("completionTokens").asLong(0)};
        } catch (Exception e) {
            return null;
        }
    }

    private Map<String, Double> breakdown(Map<String, Double> card, String ttsModel,
                                          double minutes, int seconds, Integer ttsChars,
                                          long[] llmUsage) {
        String engine = (ttsModel == null || ttsModel.isBlank()) ? "sarvam" : ttsModel.trim().toLowerCase();
        double billedMinutes = seconds <= 0 ? 0 : ((seconds + 29) / 30) / 2.0;
        Map<String, Double> b = new LinkedHashMap<>();
        b.put("plivo", round(card.getOrDefault("plivo", 0d) * billedMinutes));
        b.put("stt", round(card.getOrDefault("stt_sarvam", 0d) * minutes));
        // TTS is the one component the bot meters EXACTLY: the vendor bills per
        // character and diagnostics.tts.chars is the count it actually synthesised.
        // Prefer it over duration x the fleet average, because 779 chars/call-min is
        // a mean and every real call sits somewhere off it — an agent that monologues
        // exceeds it and was being under-costed, one whose caller does the talking was
        // being over-costed. Same divisor as the savings line, so the two still cannot
        // disagree, and the average stays as the fallback for any call whose blob is
        // absent (cache off, older row, a bot that crashed before reporting).
        double ttsPerMin = card.getOrDefault("tts_" + engine, 0d);
        b.put("tts", round(ttsChars != null && ttsChars > 0
                ? ttsChars / CHARS_PER_CALL_MINUTE * ttsPerMin
                : ttsPerMin * minutes));
        // The call's own tokens when it reported them (V542); the per-minute
        // average only for calls that did not.
        Double llm = llmFromTokens(card, llmUsage);
        b.put("llm", round(llm != null ? llm : card.getOrDefault("llm", 0d) * minutes));
        return b;
    }

    /**
     * Characters of TTS per call-minute. This is not a guess: it is the measured
     * figure the rate card is itself built on — {@code tts_google} 2.06 and
     * {@code tts_sarvam} 2.34 are both "779 chars/call-min measured" times the
     * vendor's per-character price (see V428). Keeping the divisor here, in one
     * named place next to the lookup, means the savings figure stays consistent
     * with the cost figure instead of drifting from it.
     */
    private static final double CHARS_PER_CALL_MINUTE = 779.0;

    /**
     * Rupees NOT spent because the speech cache served a sentence instead of the
     * vendor.
     *
     * <p>Derived from characters, not from duration: characters are what the
     * vendor actually meters, and they are the one TTS quantity the bot measures
     * exactly ({@code diagnostics.tts.cacheCharsSaved}). Converted at the rate
     * card's own per-minute price over the same measured character rate it was
     * built from, so this number and the {@code tts} cost line cannot disagree.
     *
     * <p>Returns null when the bot did not measure — the cache was off, or this
     * row predates it. Zero would be a claim that we looked and saved nothing.
     */
    private Double ttsCacheSavingInr(Map<String, Double> card, String ttsModel,
                                     Integer charsSaved) {
        if (charsSaved == null || charsSaved <= 0) return null;
        String engine = (ttsModel == null || ttsModel.isBlank())
                ? "sarvam" : ttsModel.trim().toLowerCase();
        Double perMinute = card.get("tts_" + engine);
        // edge is free and smallest has no confirmed invoice rate, so both sit at
        // 0.00 on the card. Saving characters there is a latency win, not a rupee
        // one, and reporting a rupee figure for it would be inventing revenue.
        if (perMinute == null || perMinute <= 0) return null;
        return round(charsSaved / CHARS_PER_CALL_MINUTE * perMinute);
    }

    /**
     * TTS speech-cache monitoring: fleet totals plus a per-day series.
     *
     * <p>Grouped by day AND engine because the rupee value of a saved character
     * differs sixfold across engines — summing characters fleet-wide and pricing
     * them once would be meaningless. The day rows are then folded up in Java.
     *
     * <p>Every cast is {@code CAST(x AS bigint)}, never {@code x::bigint}:
     * Hibernate parses ':' in a native query as a named-parameter marker, eats
     * one colon, and ships Postgres ":bigint". That is what took
     * /calls/summary down. The digit guard is here for the same reason as in
     * {@link #summary}: one malformed row must cost its own contribution, not
     * the whole range.
     */
    @Transactional(readOnly = true)
    @SuppressWarnings("unchecked")
    public TtsCacheSummaryDTO ttsCacheSummary(String instituteId, String from, String to,
                                              String agentId) {
        Map<String, Double> card = rateCard();
        Query q = em.createNativeQuery("""
                SELECT to_char(date_trunc('day', r.created_at), 'YYYY-MM-DD') AS d,
                       """ + ENGINE_SQL + """
                       AS engine,
                       count(*) FILTER (WHERE r.diagnostics->'tts'->>'cacheHits' ~ '^[0-9]+$'),
                       count(*) FILTER (WHERE r.diagnostics->'tts'->>'cacheHits' IS NULL),
                       COALESCE(sum(CASE WHEN r.diagnostics->'tts'->>'cacheHits' ~ '^[0-9]+$'
                                    THEN CAST(r.diagnostics->'tts'->>'cacheHits' AS bigint) END), 0),
                       COALESCE(sum(CASE WHEN r.diagnostics->'tts'->>'cacheMisses' ~ '^[0-9]+$'
                                    THEN CAST(r.diagnostics->'tts'->>'cacheMisses' AS bigint) END), 0),
                       COALESCE(sum(CASE WHEN r.diagnostics->'tts'->>'cacheCharsSaved' ~ '^[0-9]+$'
                                    THEN CAST(r.diagnostics->'tts'->>'cacheCharsSaved' AS bigint) END), 0),
                       COALESCE(sum(CASE WHEN r.diagnostics->'tts'->>'cacheSecsSaved' ~ '^[0-9.]+$'
                                    THEN CAST(r.diagnostics->'tts'->>'cacheSecsSaved' AS numeric) END), 0)
                FROM ai_call_result r
                LEFT JOIN ai_agent a ON a.id = r.campaign_id
                WHERE r.provider IS DISTINCT FROM 'MOCK'
                  AND (CAST(:inst AS text) IS NULL OR r.institute_id = CAST(:inst AS text))
                  AND (CAST(:frm  AS text) IS NULL OR r.created_at >= CAST(:frm AS timestamp))
                  AND (CAST(:to   AS text) IS NULL OR r.created_at <  CAST(:to  AS timestamp))
                  AND (CAST(:agt  AS text) IS NULL OR r.campaign_id = CAST(:agt AS text))
                GROUP BY 1, 2 ORDER BY 1
                """);
        q.setParameter("inst", blank(instituteId));
        q.setParameter("frm", blank(from));
        q.setParameter("to", blank(to));
        q.setParameter("agt", blank(agentId));

        Map<String, TtsCacheSummaryDTO.Day> byDay = new LinkedHashMap<>();
        Map<String, Long> hitsByEngine = new LinkedHashMap<>();
        long measured = 0, unmeasured = 0, hits = 0, misses = 0, chars = 0;
        double secs = 0d, inr = 0d;

        for (Object[] r : (List<Object[]>) q.getResultList()) {
            String day = (String) r[0];
            String engine = (String) r[1];
            long m = ((Number) r[2]).longValue();
            long um = ((Number) r[3]).longValue();
            long h = ((Number) r[4]).longValue();
            long ms = ((Number) r[5]).longValue();
            long ch = ((Number) r[6]).longValue();
            double sc = ((Number) r[7]).doubleValue();
            // Priced per engine, on the group that produced the characters.
            Double saved = ttsCacheSavingInr(card, engine, (int) Math.min(ch, Integer.MAX_VALUE));
            double savedInr = saved == null ? 0d : saved;

            measured += m; unmeasured += um; hits += h; misses += ms; chars += ch;
            secs += sc; inr += savedInr;
            if (h > 0) hitsByEngine.merge(engine, h, Long::sum);

            TtsCacheSummaryDTO.Day d = byDay.get(day);
            if (d == null) {
                d = TtsCacheSummaryDTO.Day.builder().day(day).build();
                byDay.put(day, d);
            }
            d.setMeasuredCalls(d.getMeasuredCalls() + m);
            d.setHits(d.getHits() + h);
            d.setMisses(d.getMisses() + ms);
            d.setCharsSaved(d.getCharsSaved() + ch);
            d.setInrSaved(round(d.getInrSaved() + savedInr));
        }
        // Days on which nothing was measured are dropped rather than plotted as a
        // 0% day: the cache being off is not the cache performing badly.
        List<TtsCacheSummaryDTO.Day> series = new ArrayList<>();
        for (TtsCacheSummaryDTO.Day d : byDay.values()) {
            if (d.getMeasuredCalls() == 0) continue;
            long t = d.getHits() + d.getMisses();
            d.setHitRate(t > 0 ? round((double) d.getHits() / t * 100) : null);
            series.add(d);
        }

        long total = hits + misses;
        return TtsCacheSummaryDTO.builder()
                .measuredCalls(measured).unmeasuredCalls(unmeasured)
                .hits(measured > 0 ? hits : null)
                .misses(measured > 0 ? misses : null)
                .hitRate(total > 0 ? round((double) hits / total * 100) : null)
                .charsSaved(measured > 0 ? chars : null)
                .secsSaved(measured > 0 ? round(secs) : null)
                .inrSaved(measured > 0 ? round(inr) : null)
                .hitsByEngine(hitsByEngine)
                .series(series)
                .build();
    }

    /**
     * One integer out of the diagnostics {@code tts} block.
     *
     * <p>Total by construction: the blob is written by a different service on a
     * different box, and a shape change there must cost this row a number, never
     * the whole listing. Absent or unparseable reads as "not measured" (null),
     * which is the same distinction the bot itself is careful to preserve.
     */
    private Integer diagInt(String diagnosticsJson, String field) {
        if (diagnosticsJson == null || diagnosticsJson.isBlank()) return null;
        try {
            com.fasterxml.jackson.databind.JsonNode tts =
                    DIAG_MAPPER.readTree(diagnosticsJson).path("tts").path(field);
            return tts.isNumber() ? tts.asInt() : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static final com.fasterxml.jackson.databind.ObjectMapper DIAG_MAPPER =
            new com.fasterxml.jackson.databind.ObjectMapper();

    private static double round(double v) {
        return BigDecimal.valueOf(v).setScale(2, java.math.RoundingMode.HALF_UP).doubleValue();
    }

    private void bind(Query q, String instituteId, String from, String to,
                      String health, String disposition, String agentId) {
        q.setParameter("instituteId", blank(instituteId));
        q.setParameter("fromTs", blank(from));
        q.setParameter("toTs", blank(to));
        q.setParameter("health", blank(health));
        q.setParameter("disposition", blank(disposition));
        q.setParameter("agentId", blank(agentId));
    }

    private static String blank(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    @Transactional(readOnly = true)
    public SuperAdminPageResponse<SuperAdminCallDTO> list(
            String instituteId, String from, String to, String health,
            String disposition, String agentId, int page, int size) {

        Map<String, Double> card = rateCard();
        Map<String, Double> surcharge = ttsSurcharges();
        Map<String, double[]> pricing = creditPricing();

        Query q = em.createNativeQuery("""
                SELECT r.id, r.correlation_id, r.institute_id, i.name,
                       r.campaign_id, a.name, """ + ENGINE_SQL + """
                       , a.voice,
                       r.phone_number, r.customer_name, r.direction, r.status, r.disposition,
                       r.call_start, r.duration_seconds,
                       COALESCE(l.recording_url, r.recording_url),
                       r.diag_health, r.diag_faults, CAST(r.diagnostics AS text),
                       l.provider_type, COALESCE(l.provider_call_id, r.call_uuid),
                       led.voice_credits, led.ai_credits,
                """ + " CASE WHEN " + VOICE_PENDING_SQL + " THEN 1 ELSE 0 END,"
                + " CASE WHEN " + AI_PENDING_SQL + " THEN 1 ELSE 0 END\n"
                + fromWithLedger() + " ORDER BY r.created_at DESC LIMIT :lim OFFSET :off");
        bind(q, instituteId, from, to, health, disposition, agentId);
        q.setParameter("lim", size);
        q.setParameter("off", (long) page * size);

        List<Object[]> rows = q.getResultList();
        List<SuperAdminCallDTO> content = new ArrayList<>(rows.size());
        for (Object[] r : rows) {
            int secs = r[14] == null ? 0 : ((Number) r[14]).intValue();
            double minutes = secs / 60.0;
            String tts = (String) r[6];
            Integer ttsChars = diagInt((String) r[18], "chars");
            Map<String, Double> b = breakdown(card, tts, minutes, secs, ttsChars,
                    llmUsage((String) r[18]));
            double cost = round(b.values().stream().mapToDouble(Double::doubleValue).sum());
            // Per leg: the ledger where that leg has been charged; the pulse
            // reconstruction only for a leg still pending (billing runs after the
            // call and is swept every 10 minutes), so the page never shows a guess
            // where the truth exists — nor passes one charged leg off as the whole
            // call. A call that did not connect is never charged (billing requires
            // "completed"), so it earns 0, not an estimate: 386 unanswered calls in
            // one week carried ~11 s of ring each and were being booked as revenue.
            Billed bill = billed(card, surcharge, pricing, tts, (String) r[10], secs,
                    (Number) r[21], (Number) r[22], flag(r[23]), flag(r[24]));
            double billed = round(bill.inr());
            double margin = round(billed - cost);
            String recording = (String) r[15];
            String diagJson = (String) r[18];
            Integer cacheHits = diagInt(diagJson, "cacheHits");
            Integer cacheChars = diagInt(diagJson, "cacheCharsSaved");
            content.add(SuperAdminCallDTO.builder()
                    .id((String) r[0]).correlationId((String) r[1])
                    .instituteId((String) r[2]).instituteName((String) r[3])
                    .agentId((String) r[4]).agentName((String) r[5])
                    .ttsModel(tts == null ? "sarvam" : tts).voice((String) r[7])
                    .phoneNumber((String) r[8]).customerName((String) r[9])
                    .direction((String) r[10]).status((String) r[11]).disposition((String) r[12])
                    .callStart(toDate(r[13]))
                    .durationSeconds(secs)
                    .recordingUrl(recording).hasRecording(recording != null && !recording.isBlank())
                    .health((String) r[16])
                    .faults(splitFaults((String) r[17]))
                    .diagnostics((String) r[18])
                    .costInr(cost).billedInr(billed).marginInr(margin)
                    // true = final (every leg charged, stamped at 0 or not
                    // applicable); false = some leg is still an estimate.
                    .billedFromLedger(!bill.estimated())
                    .marginPct(billed > 0 ? round(margin / billed * 100) : null)
                    // Still true overall: plivo, stt and llm remain duration-modelled.
                    // ttsCharsMeasured is what tells the UI that the TTS line, at least,
                    // is the vendor's own metered quantity on this particular call.
                    .costBreakdown(b).costIsModelled(true)
                    .ttsCharsMeasured(ttsChars)
                    .ttsCacheHits(cacheHits)
                    .ttsCacheMisses(diagInt(diagJson, "cacheMisses"))
                    .ttsCacheCharsSaved(cacheHits == null ? null : cacheChars)
                    .ttsCacheSavedInr(ttsCacheSavingInr(card, tts, cacheChars))
                    .providerCallId((String) r[20])
                    .build());
        }

        Query cq = em.createNativeQuery("SELECT count(*) " + BASE_FROM);
        bind(cq, instituteId, from, to, health, disposition, agentId);
        long total = ((Number) cq.getSingleResult()).longValue();

        return SuperAdminPageResponse.<SuperAdminCallDTO>builder()
                .content(content).page(page).size(size)
                .totalElements(total)
                .totalPages((int) Math.ceil((double) total / Math.max(size, 1)))
                .build();
    }

    /**
     * A native query's timestamp column comes back as whatever the Hibernate
     * version feels like — Hibernate 6 hands back java.time.Instant, older ones
     * java.sql.Timestamp. Casting to one of them blew up in production with
     * "class java.time.Instant cannot be cast to class java.sql.Timestamp", so
     * accept all of them rather than bet on the mapping.
     */
    private static Date toDate(Object o) {
        if (o == null) return null;
        if (o instanceof Date d) return d;                       // covers java.sql.Timestamp
        if (o instanceof java.time.Instant i) return Date.from(i);
        if (o instanceof java.time.LocalDateTime ldt) {
            return Date.from(ldt.atZone(java.time.ZoneOffset.UTC).toInstant());
        }
        if (o instanceof java.time.OffsetDateTime odt) return Date.from(odt.toInstant());
        return null;
    }

    /** A 0/1 (or boolean) column; NULL reads as false. */
    private static boolean flag(Object o) {
        if (o instanceof Boolean b) return b;
        return o instanceof Number n && n.intValue() != 0;
    }

    private static List<String> splitFaults(String csv) {
        if (csv == null || csv.isBlank()) return List.of();
        return Arrays.stream(csv.split("[,\\s]+")).filter(s -> !s.isBlank()).toList();
    }

    /**
     * Totals for the filtered set. Aggregated in SQL per TTS engine, because the
     * TTS rate differs per engine and summing a blended average would quietly
     * misprice any institute running a mix.
     */
    @Transactional(readOnly = true)
    public SuperAdminCallSummaryDTO summary(String instituteId, String from, String to,
                                            String health, String disposition, String agentId) {
        Map<String, Double> card = rateCard();
        Map<String, Double> surcharge = ttsSurcharges();
        Map<String, double[]> pricing = creditPricing();
        Query q = em.createNativeQuery("""
                SELECT
                       """ + ENGINE_SQL + """
                       AS engine,
                       count(*),
                       COALESCE(sum(r.duration_seconds),0),
                       count(*) FILTER (WHERE r.diag_health = 'RED'),
                       count(*) FILTER (WHERE r.diag_health = 'AMBER'),
                       count(*) FILTER (WHERE r.diag_health = 'GREEN'),
                       count(*) FILTER (WHERE COALESCE(l.recording_url, r.recording_url) IS NOT NULL),
                       -- [7] AI-leg, [8] voice-leg, [9] inbound AI-leg billing PULSES of
                       -- the legs still to be charged (the same predicates list() uses),
                       -- only those are reconstructed, charged legs come from [21].
                """ + pulsesWhere(AI_PENDING_SQL) + ",\n"
                + pulsesWhere(VOICE_PENDING_SQL) + ",\n"
                + pulsesWhere(AI_PENDING_SQL + " AND COALESCE(r.direction, '') ILIKE 'INBOUND'") + ",\n"
                + """
                       COALESCE(sum(CASE WHEN r.diagnostics->'tts'->>'cacheHits' ~ '^[0-9]+$'
                                         THEN CAST(r.diagnostics->'tts'->>'cacheHits' AS bigint) END), 0),
                       COALESCE(sum(CASE WHEN r.diagnostics->'tts'->>'cacheMisses' ~ '^[0-9]+$'
                                         THEN CAST(r.diagnostics->'tts'->>'cacheMisses' AS bigint) END), 0),
                       COALESCE(sum(CASE WHEN r.diagnostics->'tts'->>'cacheCharsSaved' ~ '^[0-9]+$'
                                         THEN CAST(r.diagnostics->'tts'->>'cacheCharsSaved' AS bigint) END), 0),
                       count(*) FILTER (WHERE r.diagnostics->'tts'->>'cacheHits' ~ '^[0-9]+$'),
                       COALESCE(sum(CASE WHEN r.diagnostics->'tts'->>'chars' ~ '^[0-9]+$'
                                         THEN CAST(r.diagnostics->'tts'->>'chars' AS bigint) END), 0),
                       COALESCE(sum(r.duration_seconds) FILTER (
                           WHERE r.diagnostics->'tts'->>'chars' IS NULL
                              OR NOT (r.diagnostics->'tts'->>'chars' ~ '^[0-9]+$')), 0),
                       -- [16] Plivo's 30-second pulses, as each row prices them
                       COALESCE(sum(CASE WHEN r.duration_seconds > 0
                                         THEN (r.duration_seconds + 29) / 30 ELSE 0 END), 0),
                       -- [17..19] LLM tokens of calls that reported usage, [20] seconds of those that did not
                       COALESCE(sum(CASE WHEN r.diagnostics->'infra'->'llmUsage'->>'promptTokens' ~ '^[0-9]+$'
                                         THEN CAST(r.diagnostics->'infra'->'llmUsage'->>'promptTokens' AS bigint) END), 0),
                       COALESCE(sum(CASE WHEN r.diagnostics->'infra'->'llmUsage'->>'cachedTokens' ~ '^[0-9]+$'
                                         THEN CAST(r.diagnostics->'infra'->'llmUsage'->>'cachedTokens' AS bigint) END), 0),
                       COALESCE(sum(CASE WHEN r.diagnostics->'infra'->'llmUsage'->>'completionTokens' ~ '^[0-9]+$'
                                         THEN CAST(r.diagnostics->'infra'->'llmUsage'->>'completionTokens' AS bigint) END), 0),
                       COALESCE(sum(r.duration_seconds) FILTER (
                           WHERE NOT COALESCE(r.diagnostics->'infra'->'llmUsage'->>'promptTokens' ~ '^[0-9]+$', false)), 0),
                       -- [21] what the ledger charged (both legs), [22] calls with any charge,
                       -- [23] inbound voice-leg pulses still to be charged
                       COALESCE(sum(led.voice_credits), 0) + COALESCE(sum(led.ai_credits), 0),
                       count(*) FILTER (WHERE led.voice_credits IS NOT NULL OR led.ai_credits IS NOT NULL),
                """ + pulsesWhere(VOICE_PENDING_SQL + " AND COALESCE(r.direction, '') ILIKE 'INBOUND'") + "\n"
                + fromWithLedger() + " GROUP BY 1");
        bind(q, instituteId, from, to, health, disposition, agentId);
        q.setParameter("pulse", Math.max(1, pulseSeconds));

        long calls = 0, red = 0, amber = 0, green = 0, rec = 0;
        double minutes = 0, cost = 0, billedTotal = 0;
        // Speech-cache totals. Read from the diagnostics jsonb rather than a
        // column: the bot already ships these per call, and a rollup table would
        // be a second source of truth to keep in step with it.
        long cacheHits = 0, cacheMisses = 0, cacheChars = 0;
        double cacheSaved = 0d;
        boolean cacheMeasured = false;
        Map<String, Double> agg = new LinkedHashMap<>(
                Map.of("plivo", 0d, "stt", 0d, "tts", 0d, "llm", 0d));
        Map<String, Long> byEngine = new LinkedHashMap<>();

        for (Object[] r : (List<Object[]>) q.getResultList()) {
            String engine = (String) r[0];
            long n = ((Number) r[1]).longValue();
            double mins = ((Number) r[2]).doubleValue() / 60.0;
            calls += n; minutes += mins;
            red += ((Number) r[3]).longValue();
            amber += ((Number) r[4]).longValue();
            green += ((Number) r[5]).longValue();
            rec += ((Number) r[6]).longValue();
            byEngine.merge(engine, n, Long::sum);
            // Pulses → billed minutes, per leg, for the legs not yet charged (see [7..9], [23]).
            double pulseMinutes = Math.max(1, pulseSeconds) / 60.0;
            double aiMins = ((Number) r[7]).longValue() * pulseMinutes;
            double voiceMins = ((Number) r[8]).longValue() * pulseMinutes;
            double aiInMins = ((Number) r[9]).longValue() * pulseMinutes;
            double voiceInMins = ((Number) r[23]).longValue() * pulseMinutes;
            double ledgerCredits = ((Number) r[21]).doubleValue();
            billedTotal += ledgerCredits * card.getOrDefault("credit_inr", 0d);

            Map<String, Double> b = new LinkedHashMap<>();
            // 30-second pulses, exactly as breakdown() prices each row. This used
            // ceil-MINUTES, so the totals overstated Plivo by up to half a minute
            // a call and disagreed with the rows they summed.
            double pulseMins = ((Number) r[16]).longValue() / 2.0;
            b.put("plivo", round(card.getOrDefault("plivo", 0d) * pulseMins));
            b.put("stt", round(card.getOrDefault("stt_sarvam", 0d) * mins));
            // Mirror of breakdown(): metered characters where the bot reported them,
            // the 779 chars/call-min average only for the calls it did not. Computed
            // the same way in both places so the summary can never drift from the
            // rows it is summing.
            // [13] is the count of calls that MEASURED; the characters are [14]
            // and the unmeasured seconds [15]. Reading 13/14 here billed a call
            // count as characters and characters as seconds — a group with 390k
            // characters invoiced ~6,500 phantom minutes of TTS.
            long measuredChars = ((Number) r[14]).longValue();
            double unmeasuredMins = ((Number) r[15]).longValue() / 60.0;
            double ttsPerMin = card.getOrDefault("tts_" + engine, 0d);
            b.put("tts", round(measuredChars / CHARS_PER_CALL_MINUTE * ttsPerMin
                               + unmeasuredMins * ttsPerMin));
            Double tokenLlm = llmFromTokens(card, new long[]{((Number) r[17]).longValue(),
                    ((Number) r[18]).longValue(), ((Number) r[19]).longValue()});
            double untokenedMins = ((Number) r[20]).longValue() / 60.0;
            b.put("llm", round(tokenLlm != null
                    ? tokenLlm + card.getOrDefault("llm", 0d) * untokenedMins
                    : card.getOrDefault("llm", 0d) * mins));
            b.forEach((k, v) -> agg.merge(k, v, Double::sum));
            cost += b.values().stream().mapToDouble(Double::doubleValue).sum();

            // Speech cache, priced per ENGINE because the rate differs sixfold
            // across them and this query is already grouped that way.
            long gHits = ((Number) r[10]).longValue();
            long gMiss = ((Number) r[11]).longValue();
            long gChars = ((Number) r[12]).longValue();
            if (((Number) r[13]).longValue() > 0) cacheMeasured = true;
            cacheHits += gHits;
            cacheMisses += gMiss;
            cacheChars += gChars;
            Double gSaved = ttsCacheSavingInr(card, engine, (int) Math.min(gChars, Integer.MAX_VALUE));
            if (gSaved != null) cacheSaved += gSaved;

            // Revenue of the legs the ledger has not charged yet, per engine and per
            // meter, in billing pulses (the charged ones were added above; a leg
            // stamped at 0 is in neither). Each leg carries its own inbound split: the
            // old single inbound count, taken over ALL calls, priced inbound minutes
            // of own-carrier calls at the voice_call_in rate. The per-call minimum is
            // not modelled in this aggregate (every row is 0).
            double credits = 0d;
            double[] vOut = pricing.get("voice_call_out"), vIn = pricing.get("voice_call_in");
            double[] aOut = pricing.get("ai_call_out"), aIn = pricing.get("ai_call_in");
            Double flatEngine = card.get("billed_inr_per_min_" + engine);
            if (flatEngine != null && flatEngine > 0) {
                // Flat rate replaces the credit stack; it rides the AI leg, as in estimatedInr().
                billedTotal += flatEngine * aiMins;
                continue;
            }
            if (vOut != null) credits += vOut[0] * Math.max(0, voiceMins - voiceInMins);
            if (vIn != null) credits += vIn[0] * voiceInMins;
            // Floored at zero per minute, as CallBillingService and estimatedInr() do.
            double sur = surcharge.getOrDefault(engine, 0d);
            if (aOut != null) credits += Math.max(0d, aOut[0] + sur) * Math.max(0, aiMins - aiInMins);
            if (aIn != null) credits += Math.max(0d, aIn[0] + sur) * aiInMins;
            billedTotal += credits * card.getOrDefault("credit_inr", 0d);
        }
        agg.replaceAll((k, v) -> round(v));
        double billed = round(billedTotal);
        double margin = round(billed - round(cost));
        return SuperAdminCallSummaryDTO.builder()
                .calls(calls).minutes(round(minutes))
                .costInr(round(cost)).billedInr(billed).marginInr(margin)
                .marginPct(billed > 0 ? round(margin / billed * 100) : null)
                .red(red).amber(amber).green(green).withRecording(rec)
                .costBreakdown(agg).byTtsModel(byEngine).costIsModelled(true)
                // Null, not zero, when NOTHING in the range measured the cache:
                // "it ran and saved nothing" and "it was never on" are different
                // answers, and a fleet chart that conflates them will report a
                // broken rollout as a working one.
                .ttsCacheHits(cacheMeasured ? cacheHits : null)
                .ttsCacheMisses(cacheMeasured ? cacheMisses : null)
                .ttsCacheHitRate(cacheMeasured && (cacheHits + cacheMisses) > 0
                        ? round((double) cacheHits / (cacheHits + cacheMisses) * 100)
                        : null)
                .ttsCacheCharsSaved(cacheMeasured ? cacheChars : null)
                .ttsCacheSavedInr(cacheMeasured ? round(cacheSaved) : null)
                .build();
    }
}
