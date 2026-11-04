package vacademy.io.admin_core_service.features.student_analysis.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.ai_usage.repository.CreditUsageRepository;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Before-you-run credit estimate for the AI learner report (side view) and the batch AI
 * analysis (one such report per learner): the average this institute paid per report over the
 * last 90 days, or the platform average when it has run fewer than {@value #MIN_RUNS}, times
 * the number of learners, with the current balance. Read-only.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ReportAiEstimateService {

    /** ai_usage_event.use_case of the AI learner report. */
    static final String USE_CASE = "student_report";
    static final int MIN_RUNS = 3;
    private static final int LOOKBACK_DAYS = 90;

    private final CreditUsageRepository creditUsageRepository;
    private final CreditClient creditClient;

    public Map<String, Object> estimate(String instituteId, int learners) {
        int n = Math.max(1, learners);
        Timestamp since = Timestamp.from(Instant.now().minus(LOOKBACK_DAYS, ChronoUnit.DAYS));
        String basis = "NONE";
        Double perReport = null;
        long runs = 0;
        try {
            Object[] own = first(creditUsageRepository.findRunCostForInstitute(instituteId, USE_CASE, since));
            runs = asLong(own, 0);
            if (runs >= MIN_RUNS && asDouble(own, 1) != null) {
                perReport = asDouble(own, 1);
                basis = "INSTITUTE";
            } else {
                Object[] all = first(creditUsageRepository.findRunCostForPlatform(USE_CASE, since));
                if (asLong(all, 0) >= MIN_RUNS && asDouble(all, 1) != null) {
                    perReport = asDouble(all, 1);
                    runs = asLong(all, 0);
                    basis = "PLATFORM";
                }
            }
        } catch (Exception e) {
            log.warn("[ReportAiEstimate] estimate failed for institute={}: {}", instituteId, e.getMessage());
        }
        Optional<Double> balance = Optional.empty();
        try {
            balance = creditClient.readBalance(instituteId);
        } catch (Exception e) {
            log.warn("[ReportAiEstimate] balance read failed for institute={}: {}", instituteId, e.getMessage());
        }

        Map<String, Object> out = new LinkedHashMap<>();
        Double total = perReport == null ? null : round1(perReport * n);
        out.put("learners", n);
        out.put("per_report_credits", perReport == null ? null : round1(perReport));
        out.put("estimated_credits", total);
        out.put("basis", basis);
        out.put("sample_runs", runs);
        out.put("balance", balance.map(ReportAiEstimateService::round1).orElse(null));
        out.put("balance_after", balance.isPresent() && total != null ? round1(balance.get() - total) : null);
        out.put("sufficient", balance.isEmpty() || total == null || balance.get() >= total);
        return out;
    }

    private static Object[] first(List<Object[]> rows) {
        return rows == null || rows.isEmpty() ? null : rows.get(0);
    }

    private static long asLong(Object[] row, int i) {
        return row == null || row.length <= i || row[i] == null ? 0 : ((Number) row[i]).longValue();
    }

    private static Double asDouble(Object[] row, int i) {
        return row == null || row.length <= i || row[i] == null ? null : ((Number) row[i]).doubleValue();
    }

    private static Double round1(Double v) {
        return v == null ? null : Math.round(v * 10.0) / 10.0;
    }
}
