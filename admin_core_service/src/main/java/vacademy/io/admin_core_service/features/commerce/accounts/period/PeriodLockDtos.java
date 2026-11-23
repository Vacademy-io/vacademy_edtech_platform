package vacademy.io.admin_core_service.features.commerce.accounts.period;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.ToString;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/** Request and answers of the period-lock routes. */
public final class PeriodLockDtos {

    private PeriodLockDtos() {
    }

    /** Body of {@code PUT /period-lock}. {@code locked_through} null = nothing closed (unlock all). */
    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class PeriodLockRequest {
        private String clientRequestId;
        private LocalDate lockedThrough;
        /** Required for an unlock (3 to 500 characters); optional for a lock. */
        private String reason;
        /** Required for an unlock: the caller's own PIN. Never part of the request hash. */
        @ToString.Exclude
        private Approval approval;
    }

    /** The PIN approval of an unlock. */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Approval {
        private String approverUserId;
        @ToString.Exclude
        private String pin;
    }

    /** The lock as stored, and what a change did. */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class PeriodLockView {
        private LocalDate lockedThrough;
        private String lockedBy;
        private LocalDateTime lockedAt;
        /** The day after {@code locked_through}; null when nothing is closed. */
        private LocalDate firstOpenDate;
        private boolean changed;
        /** LOCK, UNLOCK or NONE. */
        private String direction;
        private PreviewView preview;
    }

    /** What is still open on or before a date: one item per contributor kind. */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class PreviewView {
        private LocalDate through;
        private List<PreviewItem> items;
    }

    /** How many documents of one kind are open, with up to ten of them. */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class PreviewItem {
        private String kind;
        private long count;
        private List<PreviewSample> sample;
    }

    /** One document of a preview item. */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class PreviewSample {
        private String id;
        private String number;
        private LocalDate date;
    }
}
