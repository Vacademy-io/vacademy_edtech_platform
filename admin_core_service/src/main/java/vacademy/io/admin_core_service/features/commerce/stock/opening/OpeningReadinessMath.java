package vacademy.io.admin_core_service.features.commerce.stock.opening;

import vacademy.io.admin_core_service.features.commerce.stock.service.StockCountMath;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * Whether a location's opening stock is ready (WP-53): costs loaded, opening receipts posted,
 * then a count of the location and a blind recount of at least a tenth of its lines that agrees
 * at 98 % or more. Pure: the service reads the facts, this decides.
 *
 * <p>Only counts that started after the last opening receipt posted at the location count: a
 * receipt after a passed recount sends the location back to receiving.
 */
public final class OpeningReadinessMath {

    /** The recount must check at least this share of the main count's lines (MIGRATION 1.8 step 4). */
    static final int SAMPLE_PERCENT = 10;

    public enum Status { NOT_STARTED, RECEIVING, COUNTING, RECOUNT_FAILED, PASSED }

    public static final String COSTS_MISSING = "COSTS_MISSING";
    public static final String UNCOSTED_OPENING_RECEIPT = "UNCOSTED_OPENING_RECEIPT";
    public static final String SAMPLE_TOO_SMALL = "SAMPLE_TOO_SMALL";
    public static final String AGREEMENT_BELOW_98 = "AGREEMENT_BELOW_98";

    private OpeningReadinessMath() {
    }

    /** Variants of the institute: tracked (not archived), of those with a standard cost, untracked. */
    public record Items(long tracked, long withCost, List<String> withoutCostSkus, long untracked) {
        public long withoutCost() {
            return Math.max(0, tracked - withCost);
        }
    }

    /** One opening receipt none of whose lines carries a cost. */
    public record UncostedReceipt(String id, String receiptNumber, String receivedDate, long lines, long units) {
    }

    /**
     * POSTED opening receipts at the location. {@code value} is null when nothing is costed.
     * {@code lastPostedAt} is the database time of the newest one, null when there is none.
     */
    public record Receipts(long count, long lines, long units, long unitsCosted, BigDecimal value,
                           LocalDateTime lastPostedAt, List<UncostedReceipt> uncosted) {
    }

    /** A count or recount at the location that started after the last opening receipt (not cancelled). */
    public record LaterCount(String id, String kind, String status, LocalDateTime startedAt) {
        boolean open() {
            return "OPEN".equals(status);
        }
    }

    /**
     * The latest POSTED recount whose main count (not cancelled) started after the last opening
     * receipt, with its stored agreement. {@code storedPasses} is null when the stored summary
     * has no verdict; the percent rule then decides.
     */
    public record Recount(String recountId, String recountNumber, String mainCountId, String mainCountNumber,
                          long mainLines, int compared, int agreeing, BigDecimal percent, Boolean storedPasses) {
    }

    /** The recount as the readiness answer shows it. */
    public record RecountVerdict(Recount recount, BigDecimal samplePercent, int sampleNeeded, boolean sampleOk,
                                 boolean agreementOk, boolean passes) {
    }

    public record Readiness(Status status, List<String> blockers, RecountVerdict recount, boolean ready) {
    }

    public static Readiness decide(Items items, Receipts receipts, List<LaterCount> laterCounts, Recount recount) {
        List<String> blockers = new ArrayList<>();
        if (items.withoutCost() > 0) {
            blockers.add(COSTS_MISSING);
        }
        if (receipts.uncosted() != null && !receipts.uncosted().isEmpty()) {
            blockers.add(UNCOSTED_OPENING_RECEIPT);
        }
        if (receipts.count() == 0) {
            return new Readiness(Status.NOT_STARTED, blockers, null, false);
        }
        List<LaterCount> later = laterCounts == null ? List.of() : laterCounts;
        if (recount == null) {
            Status status = later.isEmpty() ? Status.RECEIVING : Status.COUNTING;
            return new Readiness(status, blockers, null, false);
        }
        RecountVerdict verdict = verdict(recount);
        // The main count stays open while it is rechecked: that is not new work. Any other open
        // count or recount started after the receipt is a new round.
        boolean newRound = later.stream().anyMatch(c -> c.open() && !c.id().equals(recount.mainCountId()));
        if (newRound) {
            return new Readiness(Status.COUNTING, blockers, verdict, false);
        }
        if (!verdict.passes()) {
            if (!verdict.sampleOk()) {
                blockers.add(SAMPLE_TOO_SMALL);
            }
            if (!verdict.agreementOk()) {
                blockers.add(AGREEMENT_BELOW_98);
            }
            return new Readiness(Status.RECOUNT_FAILED, blockers, verdict, false);
        }
        return new Readiness(Status.PASSED, blockers, verdict, blockers.isEmpty());
    }

    public static RecountVerdict verdict(Recount recount) {
        int needed = sampleNeeded(recount.mainLines());
        boolean sampleOk = recount.compared() > 0 && recount.compared() >= needed;
        boolean agreementOk = agreementPasses(recount.storedPasses(), recount.percent(), recount.compared());
        return new RecountVerdict(recount, samplePercent(recount.compared(), recount.mainLines()), needed,
                sampleOk, agreementOk, sampleOk && agreementOk);
    }

    /** ceil(mainLines x 10 %): 10 of 100, 1 of 5, 0 of 0. */
    static int sampleNeeded(long mainLines) {
        return (int) ((Math.max(0, mainLines) * SAMPLE_PERCENT + 99) / 100);
    }

    /** compared x 100 / mainLines, one decimal; 0.0 when the main count has no lines. */
    static BigDecimal samplePercent(int compared, long mainLines) {
        if (mainLines <= 0) {
            return BigDecimal.ZERO.setScale(1);
        }
        return BigDecimal.valueOf(compared * 100L).divide(BigDecimal.valueOf(mainLines), 1, RoundingMode.HALF_UP);
    }

    /** The stored verdict when there is one, else at least 98.0 % of at least one line. */
    static boolean agreementPasses(Boolean stored, BigDecimal percent, int compared) {
        if (stored != null) {
            return stored;
        }
        return compared > 0 && percent != null && percent.compareTo(StockCountMath.PASS_PERCENT) >= 0;
    }
}
