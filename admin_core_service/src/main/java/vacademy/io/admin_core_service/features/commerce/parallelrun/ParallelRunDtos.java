package vacademy.io.admin_core_service.features.commerce.parallelrun;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;

/**
 * Request and answer bodies of {@code /commerce/v1/parallel-run} (snake_case keys). Money is a
 * decimal with two places; dates are India business dates {@code yyyy-MM-dd}.
 */
public final class ParallelRunDtos {

    private ParallelRunDtos() {
    }

    /** Body of {@code PUT /parallel-run/days/{date}}: the old system's day totals. */
    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SaveDayRequest {
        private Integer oldBillCount;
        private BigDecimal oldSalesValue;
        private BigDecimal oldTax;
        private BigDecimal oldCash;
        /** Optional: null = returns are not compared. */
        private BigDecimal oldReturns;
        /** Required when the day is DIFFERENT; at most 500 characters. */
        private String note;
        /** The version the client read; required when the day was saved before. */
        private Integer version;
    }

    /** The platform's figures of one day. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record PlatformView(long bills, BigDecimal salesValue, BigDecimal tax, BigDecimal cash,
                               BigDecimal returns, int openSessions) {
    }

    /** The old system's figures as saved; {@code returns} null when not given. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record OldView(int billCount, BigDecimal salesValue, BigDecimal tax, BigDecimal cash,
                          BigDecimal returns) {
    }

    /** Old system minus platform; {@code returns} null when the old returns were not given. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record DifferenceView(long bills, BigDecimal salesValue, BigDecimal tax, BigDecimal cash,
                                 BigDecimal returns) {
    }

    /**
     * One day of the run.
     *
     * @param status          CLEAN or DIFFERENT (saved, platform unchanged since), RECHECK (saved, but the
     *                        platform's figures changed after it was saved), NOT_SAVED (platform bills or an
     *                        open session, no saved row), NO_SALES (nothing on either side)
     * @param platform        the platform's figures now
     * @param old             the saved old-system figures; null when not saved
     * @param difference      old minus platform now; null when not saved
     * @param result          the saved verdict (as at save time); null when not saved
     * @param savedPlatform   the platform's figures the verdict was made on; null when not saved
     * @param platformChanged the platform's figures differ from {@code savedPlatform}
     * @param countsClean     the day adds to the streak (saved CLEAN and platform unchanged)
     * @param reviewedAt      India time with offset
     */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record DayView(String date, String status, PlatformView platform, OldView old,
                          DifferenceView difference, String result, PlatformView savedPlatform,
                          boolean platformChanged, boolean countsClean, String note, String reviewedBy,
                          String reviewedByName, String reviewedAt, Integer version) {
    }

    /**
     * The answer of {@code GET /parallel-run/days}.
     *
     * @param streak      consecutive clean days ending at the latest saved day (looked back at most
     *                    {@code streak_window_days} days)
     * @param passed      streak at least {@code clean_days_needed}
     * @param latestSaved the latest saved day of the location; null when none
     */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record DaysAnswer(String locationId, String from, String to, String today, List<DayView> days,
                             int streak, boolean passed, int cleanDaysNeeded, int streakWindowDays,
                             String latestSaved, BigDecimal tolerance, String asOf) {
    }
}
