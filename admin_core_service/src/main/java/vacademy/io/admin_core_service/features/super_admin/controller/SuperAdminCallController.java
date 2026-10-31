package vacademy.io.admin_core_service.features.super_admin.controller;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.super_admin.dto.SuperAdminCallDTO;
import vacademy.io.admin_core_service.features.super_admin.dto.SuperAdminCallSummaryDTO;
import vacademy.io.admin_core_service.features.super_admin.dto.TtsCacheDTOs;
import vacademy.io.admin_core_service.features.super_admin.dto.TtsCacheSummaryDTO;
import vacademy.io.admin_core_service.features.super_admin.service.TtsCacheAnalyticsService;
import vacademy.io.admin_core_service.features.super_admin.dto.SuperAdminPageResponse;
import vacademy.io.admin_core_service.features.super_admin.service.SuperAdminCallService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;

import java.util.List;
import java.util.Map;

/**
 * Cross-institute AI call review for the health-check portal.
 *
 * <p>SUPER-ADMIN ONLY, checked on every method. These endpoints deliberately do
 * NOT scope to the caller's institute — that is the whole point of them — so the
 * guard is the only thing standing between this and every institute's call
 * recordings. See the /v1/reports/** IDOR for why that is written down.
 */
@Slf4j
@RestController
@RequestMapping("/admin-core-service/super-admin/v1/calls")
public class SuperAdminCallController {

    @Autowired
    private SuperAdminCallService service;

    @Autowired
    private TtsCacheAnalyticsService ttsCache;

    @Autowired
    private vacademy.io.admin_core_service.features.telephony.core.AiAgentService aiAgentService;

    @GetMapping
    public ResponseEntity<SuperAdminPageResponse<SuperAdminCallDTO>> list(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam(required = false) String instituteId,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(required = false) String health,
            @RequestParam(required = false) String disposition,
            @RequestParam(required = false) String agentId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(service.list(instituteId, from, to, health,
                disposition, agentId, page, Math.min(Math.max(size, 1), 200)));
    }

    @GetMapping("/summary")
    public ResponseEntity<SuperAdminCallSummaryDTO> summary(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam(required = false) String instituteId,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(required = false) String health,
            @RequestParam(required = false) String disposition,
            @RequestParam(required = false) String agentId) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(service.summary(instituteId, from, to, health, disposition, agentId));
    }

    /**
     * TTS speech-cache monitoring: fleet totals plus a per-day series.
     *
     * <p>Lives here rather than proxying the voice bot's own ledger, because the
     * ledger is a snapshot on one box's disk with no history — it can say what is
     * cached right now but never what the hit rate was last Tuesday. Every call's
     * counters land in ai_call_result.diagnostics, so Postgres has the series.
     */
    @GetMapping("/tts-cache/summary")
    public ResponseEntity<TtsCacheSummaryDTO> ttsCacheSummary(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam(required = false) String instituteId,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(required = false) String agentId) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(service.ttsCacheSummary(instituteId, from, to, agentId));
    }

    /** The rate card the costs above were computed from — so the UI can show its work. */
    @GetMapping("/rate-card")
    public ResponseEntity<Map<String, Double>> rateCard(
            @RequestAttribute("user") CustomUserDetails user) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(service.rateCard());
    }

    // ── TTS speech-cache analytics tab ──────────────────────────────────────
    //
    // All reads come from tts_cache_entry, which the voice bot mirrors in every
    // two minutes. Nothing here calls the bot, so a screen keeps rendering while
    // the box restarts — and reportedAt on every row lets the UI say how stale
    // it is rather than implying live.

    /** Tab landing: every agent that has contributed to the cache. */
    @GetMapping("/tts-cache/agents")
    public ResponseEntity<List<TtsCacheDTOs.Agent>> ttsCacheAgents(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam(required = false) String instituteId) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(ttsCache.agents(instituteId));
    }

    /** The sentences one agent has cached audio for. */
    @GetMapping("/tts-cache/agents/{agentId}/entries")
    public ResponseEntity<TtsCacheDTOs.Page<TtsCacheDTOs.Entry>> ttsCacheEntries(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable String agentId,
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(ttsCache.entries(agentId, q, Math.max(page, 0),
                Math.min(Math.max(size, 1), 200)));
    }

    /** What is NOT cached, dearest first, with why and what it has cost. */
    @GetMapping("/tts-cache/agents/{agentId}/misses")
    public ResponseEntity<TtsCacheDTOs.Page<TtsCacheDTOs.Entry>> ttsCacheMisses(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable String agentId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size,
            @RequestParam(required = false) Integer days) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(ttsCache.misses(agentId, Math.max(page, 0),
                Math.min(Math.max(size, 1), 200), days == null ? null : Math.min(Math.max(days, 1), 90)));
    }

    /** Per-day hit rate and rupees saved for one agent, from its calls' diagnostics. */
    @GetMapping("/tts-cache/agents/{agentId}/trend")
    public ResponseEntity<List<TtsCacheDTOs.TrendDay>> ttsCacheTrend(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable String agentId,
            @RequestParam(defaultValue = "14") int days) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(ttsCache.trend(agentId, Math.min(Math.max(days, 1), 90)));
    }

    /** One spoken line split across several cache entries by punctuation or address words. */
    @GetMapping("/tts-cache/agents/{agentId}/variants")
    public ResponseEntity<List<TtsCacheDTOs.VariantGroup>> ttsCacheVariants(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable String agentId,
            @RequestParam(defaultValue = "7") int days) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(ttsCache.variants(agentId, Math.min(Math.max(days, 1), 90)));
    }

    /**
     * Drop one cached sentence. QUEUED, not immediate: the audio is a file on the
     * bot's disk, so the bot performs it on its next cycle. dryRun defaults TRUE
     * — the destructive reading of an ambiguous request is the wrong one.
     */
    @DeleteMapping("/tts-cache/entries/{cacheKey}")
    public ResponseEntity<TtsCacheDTOs.FlushResult> ttsCacheDeleteEntry(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable String cacheKey,
            @RequestParam(defaultValue = "true") boolean dryRun) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(ttsCache.queueFlush("DELETE_ENTRY", null, cacheKey,
                dryRun, user.getUserId()));
    }

    /** Drop everything one agent contributed. Audio another agent still uses is
     *  kept — the key is shared, and a flush must not take somebody else's. */
    @PostMapping("/tts-cache/agents/{agentId}/flush")
    public ResponseEntity<TtsCacheDTOs.FlushResult> ttsCacheFlushAgent(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable String agentId,
            @RequestParam(defaultValue = "true") boolean dryRun) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(ttsCache.queueFlush("FLUSH_AGENT", agentId, null,
                dryRun, user.getUserId()));
    }

    /** Every AI agent and its speech-cache tier (OFF | FIXED | FULL), for the switch. */
    @GetMapping("/tts-cache/agent-modes")
    public ResponseEntity<List<TtsCacheDTOs.AgentMode>> ttsCacheAgentModes(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam(required = false) String instituteId) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(ttsCache.agentModes(instituteId));
    }

    /** Set one agent's speech-cache tier; effective from its next call. */
    @PutMapping("/tts-cache/agents/{agentId}/mode")
    public ResponseEntity<?> ttsCacheSetMode(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable String agentId,
            @RequestBody TtsCacheDTOs.ModeRequest body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        try {
            TtsCacheDTOs.ModeChange change = ttsCache.setMode(agentId,
                    body == null ? null : body.getMode(), user.getUserId());
            // Switching a tier on should not mean waiting for the cache to learn:
            // pre-render the opening (and, on FULL, the script's quoted lines) now.
            if (!"OFF".equals(change.getSpeechCacheMode())) {
                aiAgentService.warmSpeechCache(agentId);
            }
            return ResponseEntity.ok(change);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /** Every flush ever queued, and what it did. */
    @GetMapping("/tts-cache/flush-log")
    public ResponseEntity<List<TtsCacheDTOs.FlushResult>> ttsCacheFlushLog(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam(required = false) String agentId,
            @RequestParam(defaultValue = "50") int limit) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(ttsCache.flushLog(agentId, limit));
    }
}
