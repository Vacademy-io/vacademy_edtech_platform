package vacademy.io.admin_core_service.features.telephony.core;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import vacademy.io.admin_core_service.features.call_intelligence.persistence.entity.CallIntelligence;
import vacademy.io.admin_core_service.features.call_intelligence.persistence.repository.CallIntelligenceRepository;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * Joins the exported call list with its Call Intelligence rows so the CSV/XLSX
 * can carry the AI analysis and full transcript. Analysis fields are a cheap
 * bulk DB read; transcripts are per-call S3 text fetches, so they're pulled
 * concurrently and only up to {@link #TRANSCRIPT_FETCH_CAP} analyzed calls —
 * beyond that the transcript cells carry an "omitted" note instead of stalling
 * a 25k-row export on thousands of HTTP round-trips.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CallExportAiEnricher {

    private static final int DB_CHUNK = 1000;
    private static final int TRANSCRIPT_FETCH_CAP = 500;
    private static final int FETCH_THREADS = 8;
    private static final String OMITTED_NOTE = "(omitted — export too large; open the call to view)";

    private final CallIntelligenceRepository repo;
    private final RestTemplate transcriptFetcher = buildFetcher();

    /** AI columns for one exported call. All fields may be null/blank. */
    public record AiRow(
            String summary, String goal, String outcome,
            String callerRating, String outcomeRating,
            String leadSentiment, String conversionLikelihood,
            String transcript, String transcriptEnglish) {
    }

    /** callLogId → AI columns, for every exported call that has a COMPLETED analysis. */
    public Map<String, AiRow> forCalls(List<String> callLogIds) {
        List<CallIntelligence> completed = new ArrayList<>();
        for (int i = 0; i < callLogIds.size(); i += DB_CHUNK) {
            List<String> chunk = callLogIds.subList(i, Math.min(i + DB_CHUNK, callLogIds.size()));
            for (CallIntelligence ci : repo.findByCallLogIdIn(chunk)) {
                if ("COMPLETED".equals(ci.getStatus())) completed.add(ci);
            }
        }
        if (completed.isEmpty()) return Map.of();

        boolean fetchTranscripts = completed.size() <= TRANSCRIPT_FETCH_CAP;
        Map<String, String[]> transcripts = fetchTranscripts
                ? fetchTranscripts(completed) : Map.of();

        Map<String, AiRow> out = new HashMap<>();
        for (CallIntelligence ci : completed) {
            String[] texts = transcripts.get(ci.getCallLogId());
            out.put(ci.getCallLogId(), new AiRow(
                    ci.getGeneralSummary(),
                    ci.getInferredGoal(),
                    ci.getGenericStatus(),
                    rating(ci.getCallerSelfGoalRating()),
                    rating(ci.getCallOutputRating()),
                    ci.getLeadSentiment(),
                    ci.getConversionLikelihood(),
                    transcriptCell(ci.getSourceTextKey(), texts, 0, fetchTranscripts),
                    transcriptCell(ci.getEnglishTextKey(), texts, 1, fetchTranscripts)));
        }
        return out;
    }

    private static String transcriptCell(String key, String[] texts, int idx, boolean fetched) {
        if (key == null || key.isBlank()) return null; // never had this transcript pass
        if (!fetched) return OMITTED_NOTE;
        return texts == null ? null : texts[idx];
    }

    /** callLogId → [sourceText, englishText], fetched concurrently. */
    private Map<String, String[]> fetchTranscripts(List<CallIntelligence> rows) {
        ExecutorService pool = Executors.newFixedThreadPool(FETCH_THREADS);
        try {
            Map<String, Future<String[]>> futures = new HashMap<>();
            for (CallIntelligence ci : rows) {
                String src = ci.getSourceTextKey();
                String eng = ci.getEnglishTextKey();
                if ((src == null || src.isBlank()) && (eng == null || eng.isBlank())) continue;
                futures.put(ci.getCallLogId(),
                        pool.submit(() -> new String[]{fetchText(src), fetchText(eng)}));
            }
            Map<String, String[]> out = new HashMap<>();
            futures.forEach((id, f) -> {
                try {
                    out.put(id, f.get());
                } catch (Exception e) {
                    log.warn("Transcript fetch failed for call {}", id, e);
                }
            });
            return out;
        } finally {
            pool.shutdown();
        }
    }

    private String fetchText(String url) {
        if (url == null || url.isBlank()) return null;
        try {
            return transcriptFetcher.getForObject(url, String.class);
        } catch (Exception e) {
            return null; // artifact gone / unreachable — cell stays blank
        }
    }

    private static String rating(BigDecimal v) {
        return v == null ? null : v.stripTrailingZeros().toPlainString();
    }

    private static RestTemplate buildFetcher() {
        SimpleClientHttpRequestFactory f = new SimpleClientHttpRequestFactory();
        f.setConnectTimeout(3_000);
        f.setReadTimeout(15_000);
        return new RestTemplate(f);
    }
}
