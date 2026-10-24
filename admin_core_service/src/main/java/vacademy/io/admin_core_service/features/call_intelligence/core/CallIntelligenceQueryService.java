package vacademy.io.admin_core_service.features.call_intelligence.core;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import vacademy.io.admin_core_service.features.call_intelligence.dto.CallIntelligenceAnalyticsDto;
import vacademy.io.admin_core_service.features.call_intelligence.dto.CallIntelligenceCoachingDto;
import vacademy.io.admin_core_service.features.call_intelligence.dto.CallIntelligenceDto;
import vacademy.io.admin_core_service.features.call_intelligence.dto.CallTranscriptDto;
import vacademy.io.admin_core_service.features.call_intelligence.persistence.entity.CallIntelligence;
import vacademy.io.admin_core_service.features.call_intelligence.persistence.repository.CallIntelligenceRepository;
import vacademy.io.admin_core_service.features.counsellor_workbench.service.CounsellorScopeService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.common.auth.dto.UserDTO;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * Read side of Call Intelligence: per-call and per-lead detail, plus the
 * per-counsellor and per-team (sales head) roll-ups that power the dashboards.
 * Team scope is resolved through {@link CounsellorScopeService} so a head only
 * ever sees their own reporting line.
 */
@Service
@RequiredArgsConstructor
public class CallIntelligenceQueryService {

    private static final long DEFAULT_WINDOW_DAYS = 30;

    private final CallIntelligenceRepository repo;
    private final CounsellorScopeService counsellorScopeService;
    private final AuthService authService;

    /** For fetching transcript artifacts from their stored S3 URLs. */
    private final RestTemplate transcriptFetcher = new RestTemplate();

    public Optional<CallIntelligenceDto> getByCallLogId(String callLogId) {
        return repo.findByCallLogId(callLogId).map(CallIntelligenceDto::from);
    }

    /**
     * Full transcript for one call, resolved server-side from the S3 text
     * artifacts the pipeline wrote. Empty Optional when the call was never
     * analyzed; a DTO with null texts when analysis ran but produced no
     * transcript (e.g. skipped before transcription).
     */
    public Optional<CallTranscriptDto> getTranscript(String callLogId) {
        return repo.findByCallLogId(callLogId).map(row -> CallTranscriptDto.builder()
                .callLogId(callLogId)
                .detectedLanguage(row.getDetectedLanguage())
                .sourceText(firstNonBlank(fetchText(row.getSourceTextKey()), inlineTranscript(row)))
                .englishText(fetchText(row.getEnglishTextKey()))
                .build());
    }

    /**
     * Since 2026-09-11 the pipeline transcribes through OpenRouter, which returns
     * text rather than a file: the transcript then lives in analysis_json
     * ("transcript") and there is no S3 artifact to fetch.
     */
    private static String inlineTranscript(CallIntelligence row) {
        Map<String, Object> a = row.getAnalysisJson();
        Object t = a == null ? null : a.get("transcript");
        return t == null ? null : String.valueOf(t);
    }

    private static String firstNonBlank(String a, String b) {
        return (a != null && !a.isBlank()) ? a : b;
    }

    private String fetchText(String url) {
        if (url == null || url.isBlank()) return null;
        try {
            return transcriptFetcher.getForObject(url, String.class);
        } catch (Exception e) {
            // Artifact gone / unreachable — surface as "no transcript" rather than 500.
            return null;
        }
    }

    public List<CallIntelligenceDto> getByResponseId(String responseId) {
        return repo.findByResponseIdOrderByCallStartedAtDesc(responseId).stream()
                .map(CallIntelligenceDto::from).toList();
    }

    /** One counsellor's intelligence over the window. */
    public CallIntelligenceAnalyticsDto counsellorAnalytics(String counsellorUserId, Long fromMillis, Long toMillis) {
        return aggregate(List.of(counsellorUserId), from(fromMillis), to(toMillis), false);
    }

    /**
     * Coaching insights for one counsellor: aggregates the transcript-derived
     * analysis across their COMPLETED calls into per-quality averages, recurring
     * coaching tips, common objections, and recent calls to drill into.
     */
    public CallIntelligenceCoachingDto coachingInsights(String counsellorUserId, Long fromMillis, Long toMillis) {
        List<CallIntelligence> rows = (counsellorUserId == null || counsellorUserId.isBlank())
                ? List.of()
                : repo.findByCounsellorUserIdAndStatusAndCallStartedAtBetweenOrderByCallStartedAtDesc(
                        counsellorUserId, "COMPLETED", from(fromMillis), to(toMillis));
        return buildCoaching(rows, counsellorUserId);
    }

    /**
     * Whole-team coaching: the same transcript-derived aggregation across EVERY
     * counsellor in the caller's reporting line — the team head's "how is my team
     * doing on calls, and what should we work on" view.
     */
    public CallIntelligenceCoachingDto teamCoachingInsights(String instituteId, String callerUserId,
                                                            Long fromMillis, Long toMillis) {
        List<String> ids = teamScopeIds(instituteId, callerUserId);
        List<CallIntelligence> rows = (ids == null || ids.isEmpty())
                ? List.of()
                : repo.findByCounsellorUserIdInAndStatusAndCallStartedAtBetweenOrderByCallStartedAtDesc(
                        ids, "COMPLETED", from(fromMillis), to(toMillis));
        return buildCoaching(rows, null);
    }

    /** Shared aggregation for the coaching DTO from a set of COMPLETED rows. */
    private CallIntelligenceCoachingDto buildCoaching(List<CallIntelligence> rows, String counsellorUserId) {
        double callerSum = 0, outputSum = 0;
        int callerN = 0, outputN = 0;
        // key -> [sumScore, count]
        Map<String, double[]> qualityAcc = new LinkedHashMap<>();
        // quality key -> counsellorUserId -> [sumScore, count] (team coaching only)
        Map<String, Map<String, double[]>> qualityByCounsellor = new LinkedHashMap<>();
        // normalized text -> [displayText, count]
        Map<String, Object[]> tipAcc = new LinkedHashMap<>();
        // normalized objection -> [displayText, count, handledCount]
        Map<String, Object[]> objAcc = new LinkedHashMap<>();
        Map<String, Long> sentiment = new LinkedHashMap<>();
        List<CallIntelligenceCoachingDto.RecentCall> recent = new ArrayList<>();

        for (CallIntelligence c : rows) {
            if (c.getCallerSelfGoalRating() != null) { callerSum += c.getCallerSelfGoalRating().doubleValue(); callerN++; }
            if (c.getCallOutputRating() != null) { outputSum += c.getCallOutputRating().doubleValue(); outputN++; }
            if (c.getLeadSentiment() != null) sentiment.merge(c.getLeadSentiment(), 1L, Long::sum);

            Map<String, Object> a = c.getAnalysisJson();
            if (a != null) {
                // Per-quality scores live under caller_self_goal_rating.qualities[].
                Map<String, Object> csg = asMap(a.get("caller_self_goal_rating"));
                if (csg != null) {
                    for (Object qo : asList(csg.get("qualities"))) {
                        Map<String, Object> qm = asMap(qo);
                        if (qm == null) continue;
                        String key = asStr(qm.get("key"));
                        Double score = asDbl(qm.get("score"));
                        if (key == null || score == null) continue;
                        double[] acc = qualityAcc.computeIfAbsent(key, k -> new double[2]);
                        acc[0] += score; acc[1] += 1;
                        // Attribute the score to its counsellor so team coaching can
                        // name who's weakest in each quality.
                        String cid = c.getCounsellorUserId();
                        if (cid != null) {
                            double[] cAcc = qualityByCounsellor
                                    .computeIfAbsent(key, k -> new LinkedHashMap<>())
                                    .computeIfAbsent(cid, k -> new double[2]);
                            cAcc[0] += score; cAcc[1] += 1;
                        }
                    }
                }
                for (Object t : asList(a.get("coaching_tips"))) {
                    String text = asStr(t);
                    if (text == null || text.isBlank()) continue;
                    Object[] acc = tipAcc.computeIfAbsent(text.trim().toLowerCase(), k -> new Object[]{text.trim(), 0L});
                    acc[1] = (Long) acc[1] + 1;
                }
                Map<String, Object> ca = asMap(a.get("call_analysis"));
                if (ca != null) {
                    for (Object oo : asList(ca.get("objections"))) {
                        Map<String, Object> om = asMap(oo);
                        if (om == null) continue;
                        String text = asStr(om.get("objection"));
                        if (text == null || text.isBlank()) continue;
                        Object[] acc = objAcc.computeIfAbsent(text.trim().toLowerCase(),
                                k -> new Object[]{text.trim(), 0L, 0L});
                        acc[1] = (Long) acc[1] + 1;
                        if (Boolean.TRUE.equals(om.get("handled"))) acc[2] = (Long) acc[2] + 1;
                    }
                }
            }
            if (recent.size() < 15) {
                recent.add(CallIntelligenceCoachingDto.RecentCall.builder()
                        .callLogId(c.getCallLogId())
                        .callStartedAt(c.getCallStartedAt())
                        .callerSelfGoalRating(c.getCallerSelfGoalRating())
                        .callOutputRating(c.getCallOutputRating())
                        .genericStatus(c.getGenericStatus())
                        .summary(c.getGeneralSummary())
                        .build());
            }
        }

        List<CallIntelligenceCoachingDto.QualityAvg> qualities = qualityAcc.entrySet().stream()
                .map(e -> CallIntelligenceCoachingDto.QualityAvg.builder()
                        .key(e.getKey())
                        .avgScore(e.getValue()[1] == 0 ? null : round1(e.getValue()[0] / e.getValue()[1]))
                        .count((long) e.getValue()[1])
                        .build())
                // Weakest first — that's where the coaching value is.
                .sorted(Comparator.comparing(q -> q.getAvgScore() == null ? Double.MAX_VALUE : q.getAvgScore()))
                .collect(Collectors.toList());

        // Team coaching only: for each quality, name the counsellors scoring below
        // the team average for it ("X can improve in this field"). One name batch.
        if (counsellorUserId == null && !qualityByCounsellor.isEmpty()) {
            Map<CallIntelligenceCoachingDto.QualityAvg,
                    List<CallIntelligenceCoachingDto.WeakCounsellor>> pending = new LinkedHashMap<>();
            List<String> idsToResolve = new ArrayList<>();
            for (CallIntelligenceCoachingDto.QualityAvg q : qualities) {
                Double teamAvg = q.getAvgScore();
                Map<String, double[]> perC = qualityByCounsellor.get(q.getKey());
                if (teamAvg == null || perC == null) continue;
                List<CallIntelligenceCoachingDto.WeakCounsellor> weak = new ArrayList<>();
                for (Map.Entry<String, double[]> e : perC.entrySet()) {
                    double[] v = e.getValue();
                    if (v[1] == 0) continue;
                    double avg = round1(v[0] / v[1]);
                    if (avg < teamAvg) {
                        weak.add(CallIntelligenceCoachingDto.WeakCounsellor.builder()
                                .counsellorUserId(e.getKey()).avgScore(avg).build());
                    }
                }
                weak.sort(Comparator.comparingDouble(
                        w -> w.getAvgScore() == null ? Double.MAX_VALUE : w.getAvgScore()));
                if (weak.size() > 3) weak = new ArrayList<>(weak.subList(0, 3));
                if (!weak.isEmpty()) {
                    pending.put(q, weak);
                    for (CallIntelligenceCoachingDto.WeakCounsellor w : weak) {
                        idsToResolve.add(w.getCounsellorUserId());
                    }
                }
            }
            Map<String, String> names = resolveNames(idsToResolve);
            for (Map.Entry<CallIntelligenceCoachingDto.QualityAvg,
                    List<CallIntelligenceCoachingDto.WeakCounsellor>> entry : pending.entrySet()) {
                for (CallIntelligenceCoachingDto.WeakCounsellor w : entry.getValue()) {
                    w.setName(Optional.ofNullable(names.get(w.getCounsellorUserId()))
                            .filter(s -> !s.isBlank()).orElse(w.getCounsellorUserId()));
                }
                entry.getKey().setWeakCounsellors(entry.getValue());
            }
        }

        List<CallIntelligenceCoachingDto.CoachingTip> tips = tipAcc.values().stream()
                .map(v -> CallIntelligenceCoachingDto.CoachingTip.builder()
                        .text((String) v[0]).count((Long) v[1]).build())
                .sorted(Comparator.comparingLong(CallIntelligenceCoachingDto.CoachingTip::getCount).reversed())
                .limit(8).toList();

        List<CallIntelligenceCoachingDto.ObjectionStat> objections = objAcc.values().stream()
                .map(v -> CallIntelligenceCoachingDto.ObjectionStat.builder()
                        .objection((String) v[0]).count((Long) v[1]).handledCount((Long) v[2]).build())
                .sorted(Comparator.comparingLong(CallIntelligenceCoachingDto.ObjectionStat::getCount).reversed())
                .limit(8).toList();

        return CallIntelligenceCoachingDto.builder()
                .counsellorUserId(counsellorUserId)
                .totalAnalyzed(rows.size())
                .avgCallerSelfGoalRating(callerN == 0 ? null : round1(callerSum / callerN))
                .avgCallOutputRating(outputN == 0 ? null : round1(outputSum / outputN))
                .qualityAverages(qualities)
                .topCoachingTips(tips)
                .topObjections(objections)
                .sentimentDistribution(sentiment)
                .recentCalls(recent)
                .build();
    }

    /** A sales head's whole team (self + all reports) over the window;
     *  pure admins get every user with analyzed calls in the institute. */
    public CallIntelligenceAnalyticsDto teamAnalytics(String instituteId, String callerUserId,
                                                      Long fromMillis, Long toMillis) {
        List<String> ids = teamScopeIds(instituteId, callerUserId);
        return aggregate(ids, from(fromMillis), to(toMillis), true);
    }

    /**
     * The user ids a caller's TEAM view covers.
     *
     * <ul>
     *   <li><b>Scoped caller</b> (non-admin COUNSELLOR): their reporting line
     *       (self + reports) — unchanged.</li>
     *   <li><b>Pure admin</b>: the counsellor roster UNION everyone who actually has
     *       analyzed calls in the institute.</li>
     * </ul>
     *
     * <p>The union matters: resolving an admin's cohort from the COUNSELLOR-role
     * roster alone (as this did briefly) hides every call made by a user without
     * that role — including admins themselves — and yields an EMPTY list when the
     * institute has granted no counsellor roles. An empty list short-circuits to
     * {@code totalAnalyzed = 0}, which silently blanked the AI Intelligence page and
     * all team analytics/coaching even though the calls were analyzed fine.
     */
    private List<String> teamScopeIds(String instituteId, String callerUserId) {
        if (counsellorScopeService.isScopedCaller(instituteId, callerUserId)) {
            return counsellorScopeService.scopedCounsellorUserIds(instituteId, callerUserId);
        }
        LinkedHashSet<String> ids = new LinkedHashSet<>(
                counsellorScopeService.allCounsellorUserIds(instituteId));
        ids.addAll(repo.findDistinctCounsellorUserIdsByInstituteId(instituteId));
        return new ArrayList<>(ids);
    }

    // -------------------------------------------------------------------------

    private CallIntelligenceAnalyticsDto aggregate(List<String> ids, Timestamp from, Timestamp to,
                                                   boolean includePerCounsellor) {
        if (ids == null || ids.isEmpty()) {
            return CallIntelligenceAnalyticsDto.builder()
                    .totalAnalyzed(0)
                    .statusDistribution(Map.of())
                    .sentimentDistribution(Map.of())
                    .perCounsellor(includePerCounsellor ? List.of() : null)
                    .build();
        }

        List<Object[]> aggRows = repo.aggregate(ids, from, to);
        Object[] agg = aggRows.isEmpty() ? new Object[]{0L, null, null} : aggRows.get(0);

        var builder = CallIntelligenceAnalyticsDto.builder()
                .totalAnalyzed(asLong(agg[0]))
                .avgCallerSelfGoalRating(asDouble(agg[1]))
                .avgCallOutputRating(asDouble(agg[2]))
                .statusDistribution(toCountMap(repo.statusDistribution(ids, from, to)))
                .sentimentDistribution(toCountMap(repo.sentimentDistribution(ids, from, to)));

        if (includePerCounsellor) {
            builder.perCounsellor(repo.perCounsellor(ids, from, to).stream()
                    .map(r -> CallIntelligenceAnalyticsDto.CounsellorStat.builder()
                            .counsellorUserId((String) r[0])
                            .totalAnalyzed(asLong(r[1]))
                            .avgCallerSelfGoalRating(asDouble(r[2]))
                            .avgCallOutputRating(asDouble(r[3]))
                            .build())
                    .toList());
        }
        return builder.build();
    }

    private static Map<String, Long> toCountMap(List<Object[]> rows) {
        Map<String, Long> m = new LinkedHashMap<>();
        for (Object[] r : rows) {
            String key = r[0] == null ? "UNKNOWN" : String.valueOf(r[0]);
            m.put(key, asLong(r[1]));
        }
        return m;
    }

    private static long asLong(Object o) {
        return o instanceof Number n ? n.longValue() : 0L;
    }

    private static Double asDouble(Object o) {
        return o instanceof Number n ? n.doubleValue() : null;
    }

    private static Timestamp from(Long millis) {
        if (millis != null) return new Timestamp(millis);
        return new Timestamp(System.currentTimeMillis() - DEFAULT_WINDOW_DAYS * 24L * 60 * 60 * 1000);
    }

    private static Timestamp to(Long millis) {
        return new Timestamp(millis != null ? millis : System.currentTimeMillis());
    }

    // --- analysis_json navigation helpers (JSONB → Map/List) -----------------

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object o) {
        return o instanceof Map ? (Map<String, Object>) o : null;
    }

    @SuppressWarnings("unchecked")
    private static List<Object> asList(Object o) {
        return o instanceof List ? (List<Object>) o : List.of();
    }

    private static String asStr(Object o) {
        return o == null ? null : String.valueOf(o);
    }

    private static Double asDbl(Object o) {
        if (o instanceof Number n) return n.doubleValue();
        if (o instanceof String s && !s.isBlank()) {
            try { return Double.parseDouble(s.trim()); } catch (NumberFormatException ignore) { /* fall through */ }
        }
        return null;
    }

    private static double round1(double v) {
        return Math.round(v * 10.0) / 10.0;
    }

    /** One auth-service batch; failures degrade to id-as-name instead of failing the roll-up. */
    private Map<String, String> resolveNames(Collection<String> userIds) {
        List<String> ids = userIds.stream()
                .filter(s -> s != null && !s.isBlank())
                .distinct()
                .collect(Collectors.toList());
        if (ids.isEmpty()) return Collections.emptyMap();
        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(ids);
            if (users == null || users.isEmpty()) return Collections.emptyMap();
            return users.stream()
                    .filter(u -> u != null && u.getId() != null)
                    .collect(Collectors.toMap(UserDTO::getId,
                            u -> Optional.ofNullable(u.getFullName()).orElse(u.getId()), (a, b) -> a));
        } catch (Exception ex) {
            return Collections.emptyMap();
        }
    }
}
