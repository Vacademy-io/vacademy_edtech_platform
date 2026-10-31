package vacademy.io.admin_core_service.features.super_admin.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.Query;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.super_admin.dto.TtsCacheDTOs;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The TTS speech-cache analytics tab, and the bot-facing ingest behind it.
 *
 * <p>Every screen reads {@code tts_cache_entry}, which the voice bot mirrors in
 * every two minutes (V469). Nothing here calls the bot: a screen keeps rendering
 * while the box restarts, the rows join to {@code ai_agent} for real names, and
 * the data carries history the bot's own ledger structurally cannot — that
 * ledger is a current-state snapshot on one disk.
 *
 * <p>SQL discipline in this file, learned the hard way on 2026-08-24: every cast
 * is {@code CAST(x AS t)}, never {@code x::t}. Hibernate parses ':' in a native
 * query as a named-parameter marker, eats one colon and ships Postgres ":bigint",
 * which took the calls summary endpoint down. There are also no semicolons in
 * any SQL comment here, for the reason recorded in the native-query notes.
 */
@Service
@RequiredArgsConstructor
public class TtsCacheAnalyticsService {

    private static final Logger log = LoggerFactory.getLogger(TtsCacheAnalyticsService.class);

    /**
     * Characters of TTS per call-minute. The measured figure the rate card is
     * itself built on, so a saving priced through it cannot disagree with the
     * cost figures shown elsewhere.
     */
    private static final double CHARS_PER_CALL_MINUTE = 779.0;

    @PersistenceContext
    private EntityManager em;

    private final SuperAdminCallService callService;

    // ── ingest (bot -> admin-core) ──────────────────────────────────────────

    /**
     * Absorb one ledger report from the voice bot.
     *
     * <p>Upsert rather than replace: a report is bounded (the bot sends its top
     * rows, not everything), so deleting what is missing would erase entries
     * merely because they fell below the cut. {@code reported_at} is how a row
     * that has genuinely gone away is spotted — it stops moving.
     */
    @Transactional
    @SuppressWarnings("unchecked")
    public int ingest(List<Map<String, Object>> entries) {
        if (entries == null || entries.isEmpty()) return 0;
        int n = 0;
        for (Map<String, Object> e : entries) {
            String key = str(e.get("cacheKey"));
            String agentId = str(e.get("agentId"));
            if (key == null || agentId == null) continue;
            try {
                em.createNativeQuery("""
                        INSERT INTO tts_cache_entry (cache_key, agent_id, institute_id, engine,
                               model, voice, sentence, chars, is_fixed, sightings, hits,
                               rendered, bytes, duration_ms, first_seen_at, last_seen_at,
                               last_hit_at, reported_at)
                        VALUES (:k, :a, :inst, :eng, :mdl, :voi, :sen, :ch, :fx, :sg, :hi,
                                :rd, :by, :dur, :fs, :ls, :lh, now())
                        ON CONFLICT (cache_key, agent_id) DO UPDATE SET
                            institute_id = COALESCE(EXCLUDED.institute_id, tts_cache_entry.institute_id),
                            engine = EXCLUDED.engine, model = EXCLUDED.model, voice = EXCLUDED.voice,
                            sentence = EXCLUDED.sentence, chars = EXCLUDED.chars,
                            is_fixed = EXCLUDED.is_fixed, sightings = EXCLUDED.sightings,
                            hits = EXCLUDED.hits, rendered = EXCLUDED.rendered,
                            bytes = EXCLUDED.bytes, duration_ms = EXCLUDED.duration_ms,
                            last_seen_at = EXCLUDED.last_seen_at, last_hit_at = EXCLUDED.last_hit_at,
                            reported_at = now()
                        """)
                        .setParameter("k", key).setParameter("a", agentId)
                        .setParameter("inst", str(e.get("instituteId")))
                        .setParameter("eng", str(e.get("engine")))
                        .setParameter("mdl", str(e.get("model")))
                        .setParameter("voi", str(e.get("voice")))
                        .setParameter("sen", str(e.get("sentence")))
                        .setParameter("ch", num(e.get("chars")).intValue())
                        .setParameter("fx", Boolean.TRUE.equals(e.get("isFixed")))
                        .setParameter("sg", num(e.get("sightings")).intValue())
                        .setParameter("hi", num(e.get("hits")).intValue())
                        .setParameter("rd", Boolean.TRUE.equals(e.get("rendered")))
                        .setParameter("by", num(e.get("bytes")).intValue())
                        .setParameter("dur", num(e.get("durationMs")).intValue())
                        .setParameter("fs", epoch(e.get("firstSeenAt")))
                        .setParameter("ls", epoch(e.get("lastSeenAt")))
                        .setParameter("lh", epoch(e.get("lastHitAt")))
                        .executeUpdate();
                n++;
            } catch (Exception ex) {
                // One malformed row must not cost the whole report. The bot will
                // send it again in two minutes.
                log.warn("tts-cache ingest: skipped {}/{}: {}", key, agentId, ex.getMessage());
            }
        }
        return n;
    }

    /** Hand the bot any queued flushes, marking them claimed so a second poll
     *  (or the other replica) does not run them twice. */
    @Transactional
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> claimCommands(int limit) {
        List<Object[]> rows = em.createNativeQuery("""
                UPDATE tts_cache_command SET status = 'CLAIMED', claimed_at = now()
                WHERE id IN (SELECT id FROM tts_cache_command
                             WHERE status = 'PENDING'
                             ORDER BY created_at
                             LIMIT :lim FOR UPDATE SKIP LOCKED)
                RETURNING id, kind, agent_id, cache_key, dry_run
                """).setParameter("lim", Math.max(1, Math.min(limit, 50))).getResultList();
        List<Map<String, Object>> out = new ArrayList<>();
        for (Object[] r : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", r[0]);
            m.put("kind", r[1]);
            m.put("agentId", r[2]);
            m.put("cacheKey", r[3]);
            m.put("dryRun", r[4]);
            out.add(m);
        }
        return out;
    }

    /** Record what a flush actually did. A destructive action with no log is not
     *  one anybody should be able to trigger from a web page. */
    @Transactional
    public void recordCommandResult(String id, boolean ok, String result,
                                    Integer entriesRemoved, Long bytesRemoved) {
        em.createNativeQuery("""
                UPDATE tts_cache_command
                SET status = :st, result = :res, entries_removed = :ent,
                    bytes_removed = :byt, finished_at = now()
                WHERE id = :id
                """)
                .setParameter("st", ok ? "DONE" : "FAILED")
                .setParameter("res", result)
                .setParameter("ent", entriesRemoved)
                .setParameter("byt", bytesRemoved)
                .setParameter("id", id)
                .executeUpdate();
    }

    // ── screen 1: the tab landing ───────────────────────────────────────────

    @Transactional(readOnly = true)
    @SuppressWarnings("unchecked")
    public List<TtsCacheDTOs.Agent> agents(String instituteId) {
        Map<String, Double> card = callService.rateCard();
        List<Object[]> rows = em.createNativeQuery("""
                SELECT e.agent_id,
                       COALESCE(a.name, e.agent_id),
                       e.institute_id,
                       i.name,
                       max(e.engine), max(e.voice),
                       COALESCE(a.speech_cache_mode, 'OFF'),
                       count(*) FILTER (WHERE e.rendered),
                       count(*) FILTER (WHERE NOT e.rendered),
                       count(*) FILTER (WHERE e.rendered AND e.hits = 0),
                       COALESCE(sum(e.bytes) FILTER (WHERE e.rendered), 0),
                       COALESCE(sum(e.hits), 0),
                       COALESCE(sum(e.sightings), 0),
                       COALESCE(sum(e.hits * e.chars), 0),
                       max(e.last_hit_at), max(e.reported_at)
                FROM tts_cache_entry e
                LEFT JOIN ai_agent a ON a.id = e.agent_id
                LEFT JOIN institutes i ON i.id = e.institute_id
                WHERE (CAST(:inst AS text) IS NULL OR e.institute_id = CAST(:inst AS text))
                GROUP BY e.agent_id, a.name, e.institute_id, i.name, a.speech_cache_mode
                ORDER BY COALESCE(sum(e.hits), 0) DESC
                """).setParameter("inst", blank(instituteId)).getResultList();

        // Last 7 days per agent, from what the calls measured.
        Map<String, Object[]> week = new java.util.HashMap<>();
        for (Object[] w : (List<Object[]>) em.createNativeQuery("""
                SELECT r.campaign_id, max(a.tts_model), count(*),
                       COALESCE(sum(CAST(NULLIF(r.diagnostics->'tts'->>'cacheHits', '') AS bigint)), 0),
                       COALESCE(sum(CAST(NULLIF(r.diagnostics->'tts'->>'cacheMisses', '') AS bigint)), 0),
                       COALESCE(sum(CAST(NULLIF(r.diagnostics->'tts'->>'cacheCharsSaved', '') AS bigint)), 0),
                       COALESCE(sum(CAST(NULLIF(r.diagnostics->'tts'->>'chars', '') AS bigint)), 0)
                FROM ai_call_result r
                JOIN ai_agent a ON a.id = r.campaign_id
                WHERE r.diagnostics IS NOT NULL AND r.created_at >= now() - interval '7 days'
                  AND (CAST(:inst AS text) IS NULL OR r.institute_id = CAST(:inst AS text))
                GROUP BY r.campaign_id
                """).setParameter("inst", blank(instituteId)).getResultList()) {
            week.put((String) w[0], w);
        }
        List<TtsCacheDTOs.Agent> out = new ArrayList<>();
        for (Object[] r : rows) {
            String engine = (String) r[4];
            Object[] w = week.get((String) r[0]);
            Long calls7 = w == null ? null : num(w[2]).longValue();
            Double hitRate7 = null, charShare7 = null, inr7 = null, inrPerCall7 = null;
            if (w != null) {
                long h = num(w[3]).longValue(), m = num(w[4]).longValue();
                long saved = num(w[5]).longValue(), vendor = num(w[6]).longValue();
                hitRate7 = h + m > 0 ? round((double) h / (h + m) * 100) : null;
                charShare7 = saved + vendor > 0 ? round((double) saved / (saved + vendor) * 100) : null;
                inr7 = inrFor(card, (String) w[1], saved);
                inrPerCall7 = inr7 != null && calls7 > 0 ? round(inr7 / calls7) : null;
            }
            long hits = num(r[11]).longValue();
            long sightings = num(r[12]).longValue();
            long charsSaved = num(r[13]).longValue();
            out.add(TtsCacheDTOs.Agent.builder()
                    .agentId((String) r[0]).agentName((String) r[1])
                    .instituteId((String) r[2]).instituteName((String) r[3])
                    .engine(engine).voice((String) r[5])
                    .speechCacheMode((String) r[6])
                    .entries(num(r[7]).longValue())
                    .unrenderedEntries(num(r[8]).longValue())
                    .neverHitEntries(num(r[9]).longValue())
                    .bytes(num(r[10]).longValue())
                    .hits(hits).sightings(sightings)
                    .hitRate(sightings > 0 ? round((double) hits / sightings * 100) : null)
                    .charsSaved(charsSaved)
                    .inrSaved(inrFor(card, engine, charsSaved))
                    .lastHitAt(date(r[14])).reportedAt(date(r[15]))
                    .calls7d(calls7).hitRate7d(hitRate7).charShare7d(charShare7)
                    .inrSaved7d(inr7).inrSavedPerCall7d(inrPerCall7)
                    .build());
        }
        return out;
    }

    // ── the switch: every agent's speech-cache tier ─────────────────────────

    private static final java.util.Set<String> MODES = java.util.Set.of("OFF", "FIXED", "FULL");

    /** Every AI agent with its tier — including agents that never cached, so
     *  an OFF agent can be switched on from the portal. */
    @Transactional(readOnly = true)
    public List<TtsCacheDTOs.AgentMode> agentModes(String instituteId) {
        List<Object[]> rows = em.createNativeQuery("""
                SELECT a.id, a.name, a.institute_id, i.name, a.tts_model, a.voice,
                       COALESCE(a.speech_cache_mode, 'OFF'), a.updated_at
                FROM ai_agent a
                LEFT JOIN institutes i ON i.id = a.institute_id
                WHERE (CAST(:inst AS text) IS NULL OR a.institute_id = CAST(:inst AS text))
                ORDER BY i.name NULLS LAST, a.name
                """).setParameter("inst", blank(instituteId)).getResultList();
        List<TtsCacheDTOs.AgentMode> out = new ArrayList<>();
        for (Object[] r : rows) {
            out.add(TtsCacheDTOs.AgentMode.builder()
                    .agentId((String) r[0]).agentName((String) r[1])
                    .instituteId((String) r[2]).instituteName((String) r[3])
                    .ttsModel((String) r[4]).voice((String) r[5])
                    .speechCacheMode((String) r[6]).updatedAt(date(r[7]))
                    .build());
        }
        return out;
    }

    /**
     * Set one agent's speech-cache tier. The bot reads it at the start of every
     * call, so it takes effect on the next call — no restart, no deploy. Until
     * this existed the only way was SQL on the primary.
     */
    @Transactional
    public TtsCacheDTOs.ModeChange setMode(String agentId, String mode, String userId) {
        String m = mode == null ? "" : mode.trim().toUpperCase();
        if (!MODES.contains(m)) {
            throw new IllegalArgumentException("speech cache mode must be OFF, FIXED or FULL, got " + mode);
        }
        List<?> prev = em.createNativeQuery(
                "SELECT COALESCE(speech_cache_mode, 'OFF') FROM ai_agent WHERE id = :id")
                .setParameter("id", agentId).getResultList();
        if (prev.isEmpty()) {
            throw new IllegalArgumentException("no AI agent " + agentId);
        }
        em.createNativeQuery("UPDATE ai_agent SET speech_cache_mode = :m, updated_at = now() WHERE id = :id")
                .setParameter("m", m).setParameter("id", agentId).executeUpdate();
        log.info("tts-cache: agent {} speech cache {} -> {} by super-admin {}",
                agentId, prev.get(0), m, userId);
        return TtsCacheDTOs.ModeChange.builder()
                .agentId(agentId).previousMode((String) prev.get(0)).speechCacheMode(m).build();
    }

    // ── screen 2: the sentences ─────────────────────────────────────────────

    @Transactional(readOnly = true)
    @SuppressWarnings("unchecked")
    public TtsCacheDTOs.Page<TtsCacheDTOs.Entry> entries(String agentId, String q,
                                                         int page, int size) {
        String where = """
                FROM tts_cache_entry e
                WHERE e.agent_id = :a AND e.rendered
                  AND (CAST(:q AS text) IS NULL OR e.sentence ILIKE CONCAT('%', CAST(:q AS text), '%'))
                """;
        Query sel = em.createNativeQuery("""
                SELECT e.cache_key, e.sentence, e.chars, e.is_fixed, e.engine, e.voice,
                       e.sightings, e.hits, e.rendered, e.bytes, e.duration_ms,
                       e.first_seen_at, e.last_seen_at, e.last_hit_at
                """ + where + " ORDER BY e.hits DESC, e.chars DESC OFFSET :off LIMIT :lim");
        bindEntry(sel, agentId, q).setParameter("off", (long) page * size)
                .setParameter("lim", size);
        List<TtsCacheDTOs.Entry> content = new ArrayList<>();
        for (Object[] r : (List<Object[]>) sel.getResultList()) {
            content.add(entryOf(r, null, null));
        }
        Query cnt = em.createNativeQuery("SELECT count(*) " + where);
        long total = num(bindEntry(cnt, agentId, q).getSingleResult()).longValue();
        return TtsCacheDTOs.Page.<TtsCacheDTOs.Entry>builder()
                .content(content).totalElements(total).page(page).pageSize(size).build();
    }

    // ── screen 3: what is NOT cached ────────────────────────────────────────

    @Transactional(readOnly = true)
    @SuppressWarnings("unchecked")
    public TtsCacheDTOs.Page<TtsCacheDTOs.Entry> misses(String agentId, int page, int size) {
        return misses(agentId, page, size, null);
    }

    /** @param days only sentences said in the last {@code days} days — the weekly review — or all when null. */
    @Transactional(readOnly = true)
    @SuppressWarnings("unchecked")
    public TtsCacheDTOs.Page<TtsCacheDTOs.Entry> misses(String agentId, int page, int size, Integer days) {
        Map<String, Double> card = callService.rateCard();
        String where = """
                FROM tts_cache_entry e
                WHERE e.agent_id = :a AND NOT e.rendered
                  AND (CAST(:d AS integer) IS NULL
                       OR e.last_seen_at >= now() - CAST(:d AS integer) * interval '1 day')
                """;
        Query sel = em.createNativeQuery("""
                SELECT e.cache_key, e.sentence, e.chars, e.is_fixed, e.engine, e.voice,
                       e.sightings, e.hits, e.rendered, e.bytes, e.duration_ms,
                       e.first_seen_at, e.last_seen_at, e.last_hit_at
                """ + where + " ORDER BY e.sightings * e.chars DESC OFFSET :off LIMIT :lim");
        sel.setParameter("a", agentId).setParameter("d", days).setParameter("off", (long) page * size)
                .setParameter("lim", size);
        List<TtsCacheDTOs.Entry> content = new ArrayList<>();
        for (Object[] r : (List<Object[]>) sel.getResultList()) {
            int sightings = num(r[6]).intValue();
            int chars = num(r[2]).intValue();
            boolean fixed = Boolean.TRUE.equals(r[3]);
            // A fixed line renders on its FIRST qualifying sighting, an LLM
            // sentence on its second. So a fixed line still sitting here was not
            // merely below a threshold — something refused it.
            String reason = fixed
                    ? "authored line not yet rendered — the last render failed, or it has "
                      + "never been spoken on a call healthy enough to count"
                    : (sightings < 2
                       ? "seen once — an LLM sentence renders on its second qualifying sighting"
                       : "seen " + sightings + " times but not rendered — the render is failing, "
                         + "or the calls carrying it were dropped by the health gate");
            // Everything spent re-synthesising it so far, at the engine's rate.
            Double wasted = inrFor(card, (String) r[4], (long) sightings * chars);
            content.add(entryOf(r, reason, wasted));
        }
        Query cnt = em.createNativeQuery("SELECT count(*) " + where);
        cnt.setParameter("a", agentId).setParameter("d", days);
        long total = num(cnt.getSingleResult()).longValue();
        return TtsCacheDTOs.Page.<TtsCacheDTOs.Entry>builder()
                .content(content).totalElements(total).page(page).pageSize(size).build();
    }

    // ── screen 3b: the trend — is the cache paying, and did a prompt edit reset it ──

    /**
     * Per-day hit rate and rupees saved for one agent, from what each call MEASURED
     * (diagnostics.tts: cacheHits / cacheMisses / cacheCharsSaved / chars), not from
     * the ledger's lifetime counters. A prompt change shows up here as a dip: its
     * new lines have to be warmed or relearned before they hit.
     */
    @Transactional(readOnly = true)
    @SuppressWarnings("unchecked")
    public List<TtsCacheDTOs.TrendDay> trend(String agentId, int days) {
        Map<String, Double> card = callService.rateCard();
        List<?> model = em.createNativeQuery("SELECT tts_model FROM ai_agent WHERE id = :a")
                .setParameter("a", agentId).getResultList();
        String engine = model.isEmpty() ? null : (String) model.get(0);
        List<Object[]> rows = em.createNativeQuery("""
                SELECT to_char(r.created_at + interval '5 hours 30 minutes', 'YYYY-MM-DD') AS d,
                       count(*),
                       COALESCE(sum(CAST(NULLIF(r.diagnostics->'tts'->>'cacheHits', '') AS bigint)), 0),
                       COALESCE(sum(CAST(NULLIF(r.diagnostics->'tts'->>'cacheMisses', '') AS bigint)), 0),
                       COALESCE(sum(CAST(NULLIF(r.diagnostics->'tts'->>'cacheCharsSaved', '') AS bigint)), 0),
                       COALESCE(sum(CAST(NULLIF(r.diagnostics->'tts'->>'chars', '') AS bigint)), 0)
                FROM ai_call_result r
                WHERE r.campaign_id = :a AND r.diagnostics IS NOT NULL
                  AND r.created_at >= now() - CAST(:d AS integer) * interval '1 day'
                GROUP BY 1 ORDER BY 1
                """).setParameter("a", agentId).setParameter("d", days).getResultList();
        List<TtsCacheDTOs.TrendDay> out = new ArrayList<>();
        for (Object[] r : rows) {
            long calls = num(r[1]).longValue();
            long hits = num(r[2]).longValue();
            long misses = num(r[3]).longValue();
            long saved = num(r[4]).longValue();
            long vendor = num(r[5]).longValue();
            Double inr = inrFor(card, engine, saved);
            out.add(TtsCacheDTOs.TrendDay.builder()
                    .day((String) r[0]).calls(calls).cacheHits(hits).cacheMisses(misses)
                    .hitRate(hits + misses > 0 ? round((double) hits / (hits + misses) * 100) : null)
                    .charShare(saved + vendor > 0 ? round((double) saved / (saved + vendor) * 100) : null)
                    .charsSaved(saved).vendorChars(vendor)
                    .inrSaved(inr)
                    .inrSavedPerCall(inr != null && calls > 0 ? round(inr / calls) : null)
                    .build());
        }
        return out;
    }

    // ── screen 3c: one line, several cache entries ──────────────────────────

    /**
     * Sentences that differ only by punctuation, spacing or an address word
     * (सर/मैम/जी) are separate cache entries — the key is an exact hash — so each
     * form is learned and paid for on its own. Grouped here so the prompt can pin
     * ONE form. Measured on Shreya's week: merging them is worth ~3 points of
     * cacheable characters, so this is a clean-up list, not the main lever.
     */
    @Transactional(readOnly = true)
    @SuppressWarnings("unchecked")
    public List<TtsCacheDTOs.VariantGroup> variants(String agentId, int days) {
        Map<String, Double> card = callService.rateCard();
        List<Object[]> rows = em.createNativeQuery("""
                SELECT e.cache_key, e.sentence, e.chars, e.is_fixed, e.engine, e.voice,
                       e.sightings, e.hits, e.rendered, e.bytes, e.duration_ms,
                       e.first_seen_at, e.last_seen_at, e.last_hit_at
                FROM tts_cache_entry e
                WHERE e.agent_id = :a
                  AND e.last_seen_at >= now() - CAST(:d AS integer) * interval '1 day'
                ORDER BY e.sightings DESC
                LIMIT 5000
                """).setParameter("a", agentId).setParameter("d", days).getResultList();
        Map<String, List<Object[]>> groups = new LinkedHashMap<>();
        for (Object[] r : rows) {
            String k = canonicalLine((String) r[1]);
            if (k.length() >= 8) groups.computeIfAbsent(k, x -> new ArrayList<>()).add(r);
        }
        List<TtsCacheDTOs.VariantGroup> out = new ArrayList<>();
        for (List<Object[]> g : groups.values()) {
            if (g.size() < 2) continue;
            long total = 0;
            for (Object[] r : g) total += num(r[6]).longValue();
            Object[] top = g.get(0);                      // rows arrive most-said first
            long split = total - num(top[6]).longValue();
            long splitChars = 0;
            for (int i = 1; i < g.size(); i++) {
                splitChars += num(g.get(i)[6]).longValue() * num(g.get(i)[2]).longValue();
            }
            List<TtsCacheDTOs.Entry> vs = new ArrayList<>();
            for (Object[] r : g) vs.add(entryOf(r, null, null));
            out.add(TtsCacheDTOs.VariantGroup.builder()
                    .canonical((String) top[1]).totalSightings(total).splitSightings(split)
                    .inrLost(inrFor(card, (String) top[4], splitChars))
                    .variants(vs).build());
        }
        out.sort((a, b) -> Long.compare(b.getSplitSightings(), a.getSplitSightings()));
        return out.size() > 100 ? out.subList(0, 100) : out;
    }

    /** Punctuation, spacing, case and address words removed — the sentence as spoken content. */
    static String canonicalLine(String s) {
        if (s == null) return "";
        String t = s.toLowerCase(java.util.Locale.ROOT)
                .replaceAll("[\\p{Punct}।॥…“”‘’—–]+", " ");
        t = (" " + t + " ").replaceAll("\\s(सर|मैम|मैडम|जी|sir|ma'am|madam)(?=\\s)", " ");
        return t.replaceAll("\\s+", " ").trim();
    }

    // ── screen 4: flush ─────────────────────────────────────────────────────

    /**
     * Queue a flush. Returns immediately with status PENDING — the audio lives on
     * the bot's disk, so the bot performs it on its next cycle and reports back.
     * The UI must say "queued", not "done".
     */
    @Transactional
    public TtsCacheDTOs.FlushResult queueFlush(String kind, String agentId, String cacheKey,
                                               boolean dryRun, String requestedBy) {
        Object[] r = (Object[]) em.createNativeQuery("""
                INSERT INTO tts_cache_command (kind, agent_id, cache_key, dry_run, requested_by)
                VALUES (:k, :a, :ck, :dry, :by)
                RETURNING id, status, dry_run, kind, agent_id, cache_key, created_at
                """)
                .setParameter("k", kind).setParameter("a", blank(agentId))
                .setParameter("ck", blank(cacheKey)).setParameter("dry", dryRun)
                .setParameter("by", requestedBy)
                .getSingleResult();
        return TtsCacheDTOs.FlushResult.builder()
                .commandId((String) r[0]).status((String) r[1])
                .dryRun(Boolean.TRUE.equals(r[2])).kind((String) r[3])
                .agentId((String) r[4]).cacheKey((String) r[5])
                .createdAt(date(r[6])).build();
    }

    /** The flush log — every queued command and what it did. */
    @Transactional(readOnly = true)
    @SuppressWarnings("unchecked")
    public List<TtsCacheDTOs.FlushResult> flushLog(String agentId, int limit) {
        List<Object[]> rows = em.createNativeQuery("""
                SELECT id, status, dry_run, kind, agent_id, cache_key, created_at,
                       entries_removed, bytes_removed, result, finished_at
                FROM tts_cache_command
                WHERE (CAST(:a AS text) IS NULL OR agent_id = CAST(:a AS text))
                ORDER BY created_at DESC LIMIT :lim
                """).setParameter("a", blank(agentId))
                .setParameter("lim", Math.max(1, Math.min(limit, 200))).getResultList();
        List<TtsCacheDTOs.FlushResult> out = new ArrayList<>();
        for (Object[] r : rows) {
            out.add(TtsCacheDTOs.FlushResult.builder()
                    .commandId((String) r[0]).status((String) r[1])
                    .dryRun(Boolean.TRUE.equals(r[2])).kind((String) r[3])
                    .agentId((String) r[4]).cacheKey((String) r[5]).createdAt(date(r[6]))
                    .entriesRemoved(r[7] == null ? null : num(r[7]).intValue())
                    .bytesRemoved(r[8] == null ? null : num(r[8]).longValue())
                    .result((String) r[9]).finishedAt(date(r[10]))
                    .build());
        }
        return out;
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private Query bindEntry(Query q, String agentId, String search) {
        return q.setParameter("a", agentId).setParameter("q", blank(search));
    }

    private TtsCacheDTOs.Entry entryOf(Object[] r, String reason, Double wasted) {
        String key = (String) r[0];
        boolean rendered = Boolean.TRUE.equals(r[8]);
        return TtsCacheDTOs.Entry.builder()
                .cacheKey(key).sentence((String) r[1]).chars(num(r[2]).intValue())
                .isFixed(Boolean.TRUE.equals(r[3])).engine((String) r[4]).voice((String) r[5])
                .sightings(num(r[6]).intValue()).hits(num(r[7]).intValue())
                .rendered(rendered)
                .bytes(r[9] == null ? null : num(r[9]).intValue())
                .durationMs(r[10] == null ? null : num(r[10]).intValue())
                .firstSeenAt(date(r[11])).lastSeenAt(date(r[12])).lastHitAt(date(r[13]))
                // Only a rendered entry has audio to play.
                .audioUrl(rendered
                        ? "/admin-core-service/super-admin/v1/calls/tts-cache/entries/" + key + "/audio"
                        : null)
                .reason(reason).inrWasted(wasted)
                .build();
    }

    /**
     * Rupees for a character count on one engine, through the same 779
     * chars/call-minute basis the rate card is built on. Null when the engine has
     * no confirmed per-minute cost — inventing a number there is worse than
     * omitting one.
     */
    private Double inrFor(Map<String, Double> card, String engine, long chars) {
        if (chars <= 0) return null;
        String e = (engine == null || engine.isBlank()) ? "sarvam" : engine.trim().toLowerCase();
        Double perMinute = card.get("tts_" + e);
        if (perMinute == null || perMinute <= 0) return null;
        return round(chars / CHARS_PER_CALL_MINUTE * perMinute);
    }

    private static String blank(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    private static String str(Object o) {
        if (o == null) return null;
        String s = String.valueOf(o).trim();
        return s.isEmpty() ? null : s;
    }

    private static Number num(Object o) {
        return (o instanceof Number n) ? n : 0;
    }

    /** The bot sends unix seconds as a float. Null stays null. */
    private static Timestamp epoch(Object o) {
        if (!(o instanceof Number n)) return null;
        double v = n.doubleValue();
        return v <= 0 ? null : new Timestamp((long) (v * 1000));
    }

    private static Date date(Object o) {
        return (o instanceof Timestamp t) ? new Date(t.getTime()) : null;
    }

    private static double round(double v) {
        return BigDecimal.valueOf(v).setScale(2, java.math.RoundingMode.HALF_UP).doubleValue();
    }
}
