package vacademy.io.admin_core_service.features.marketing.service;

import vacademy.io.admin_core_service.features.marketing.dto.AdPerformanceDTO;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/**
 * Budget-move advice for the ad performance report. Advice only: nothing ever changes a budget.
 *
 * <ol>
 *   <li>Candidates: platforms with spend &gt; 0 in the window.</li>
 *   <li>Best: lowest cost per admission among candidates with at least {@value #MIN_BEST_ADMISSIONS}
 *       admissions.</li>
 *   <li>Worst: among the other candidates whose spend is at least 5% of total spend, a platform with
 *       spend and no admissions first (the biggest spender of those), else the highest cost per
 *       admission. A worst platform that is not actually more expensive than the best gives no
 *       advice (moving money from a cheaper channel to a dearer one makes no sense).</li>
 *   <li>Amount: 15% of the worst platform's spend over the last 7 days of the window, rounded down
 *       to a multiple of 1,000; under 1,000 means no advice.</li>
 * </ol>
 */
public final class AdSuggestionCalculator {

    static final int MIN_BEST_ADMISSIONS = 3;
    static final BigDecimal MIN_SHARE_OF_SPEND = new BigDecimal("0.05");
    static final BigDecimal MOVE_SHARE = new BigDecimal("0.15");
    static final BigDecimal ROUND_TO = BigDecimal.valueOf(1000);

    private AdSuggestionCalculator() {
    }

    /** Spend and attributed admissions of one report platform over the whole window. */
    public record PlatformStat(String platform, BigDecimal spend, long admissions) {

        BigDecimal costPerAdmission() {
            return admissions > 0 ? spend.divide(BigDecimal.valueOf(admissions), 2, RoundingMode.HALF_UP) : null;
        }
    }

    /**
     * @param stats           per-platform window totals
     * @param last7DaysSpend  per-platform spend over the last 7 days of the window (missing = 0)
     * @return the suggestion, or null when there is not enough signal
     */
    public static AdPerformanceDTO.Suggestion suggest(Collection<PlatformStat> stats,
                                                      Map<String, BigDecimal> last7DaysSpend) {
        if (stats == null || stats.isEmpty()) return null;
        List<PlatformStat> candidates = new ArrayList<>();
        BigDecimal totalSpend = BigDecimal.ZERO;
        for (PlatformStat s : stats) {
            if (s == null || s.platform() == null || s.spend() == null || s.spend().signum() <= 0) continue;
            candidates.add(s);
            totalSpend = totalSpend.add(s.spend());
        }
        if (candidates.size() < 2) return null;

        PlatformStat best = candidates.stream()
                .filter(s -> s.admissions() >= MIN_BEST_ADMISSIONS)
                .min(Comparator.comparing(PlatformStat::costPerAdmission)
                        .thenComparing(PlatformStat::platform))
                .orElse(null);
        if (best == null) return null;

        BigDecimal minSpend = totalSpend.multiply(MIN_SHARE_OF_SPEND);
        List<PlatformStat> others = candidates.stream()
                .filter(s -> !s.platform().equals(best.platform()))
                .filter(s -> s.spend().compareTo(minSpend) >= 0)
                .toList();
        PlatformStat worst = others.stream()
                .filter(s -> s.admissions() == 0)
                .max(Comparator.comparing(PlatformStat::spend).thenComparing(PlatformStat::platform))
                .orElseGet(() -> others.stream()
                        .filter(s -> s.admissions() > 0)
                        .max(Comparator.comparing(PlatformStat::costPerAdmission)
                                .thenComparing(PlatformStat::platform))
                        .orElse(null));
        if (worst == null || worst.platform().equals(best.platform())) return null;
        BigDecimal bestCpa = best.costPerAdmission();
        BigDecimal worstCpa = worst.costPerAdmission();
        if (worstCpa != null && worstCpa.compareTo(bestCpa) <= 0) return null;

        BigDecimal recent = last7DaysSpend == null ? null : last7DaysSpend.get(worst.platform());
        BigDecimal amount = suggestedAmount(recent);
        if (amount == null) return null;

        return AdPerformanceDTO.Suggestion.builder()
                .bestPlatform(best.platform())
                .bestCostPerAdmission(bestCpa)
                .worstPlatform(worst.platform())
                .worstCostPerAdmission(worstCpa)
                .suggestedAmount(amount)
                .build();
    }

    /** 15% of the recent spend rounded down to a multiple of 1,000; null when that is under 1,000. */
    static BigDecimal suggestedAmount(BigDecimal recentSpend) {
        if (recentSpend == null || recentSpend.signum() <= 0) return null;
        BigDecimal raw = recentSpend.multiply(MOVE_SHARE);
        BigDecimal rounded = raw.divide(ROUND_TO, 0, RoundingMode.DOWN).multiply(ROUND_TO);
        return rounded.compareTo(ROUND_TO) < 0 ? null : rounded;
    }
}
