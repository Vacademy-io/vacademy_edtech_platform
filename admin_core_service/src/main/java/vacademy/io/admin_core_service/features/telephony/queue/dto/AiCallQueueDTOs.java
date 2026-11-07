package vacademy.io.admin_core_service.features.telephony.queue.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * Wire shapes for the AI call queue APIs, kept together because they are small and
 * only ever used as a set.
 */
public final class AiCallQueueDTOs {

    private AiCallQueueDTOs() {}

    /** What an enqueue produced — returned by the manual-call and bulk-campaign paths. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class EnqueueResult {
        private String queueItemId;
        /** True when this call created a new queue item; false when one was already pending. */
        private boolean queued;
        /** Items ahead of this one in its own institute's lane (1-based position = ahead + 1). */
        private long aheadInLane;
        /** Rough wait, from the lane's effective slot count and the assumed call length. */
        private long etaMinutes;
        private String message;
    }

    /** One row of the queue view. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class QueueItemView {
        private String id;
        private String instituteId;
        /** Display name of the institute, for the cross-institute dashboard. */
        private String instituteName;
        /** The AI agent as a person names it, resolved from campaignId. */
        private String agentName;
        private String provider;
        private String source;
        /** Which throttle profile this call carries: MANUAL, AUTOMATION, BULK_MANUAL... */
        private String callTrigger;
        private int priority;
        private String sourceRef;
        /** The campaign name behind a BULK row, so two concurrent runs are distinguishable. */
        private String sourceName;
        private String status;
        private String statusReason;
        private String responseId;
        private String userId;
        /** The lead's name from their CRM record. Null when the record has none. */
        private String leadName;
        private String phoneNumber;
        private String campaignId;
        private String campaignName;
        private int attempts;
        private String notBefore;
        private String expiresAt;
        private String callLogId;
        private String dispatchedAt;
        private String createdAt;
        /** Only populated for QUEUED rows. */
        private Long aheadInLane;
        private Long etaMinutes;
        /**
         * Live state of the actual call, for rows that have already dialled. The queue's
         * own status stops at DIALED and never moves again, so these three are the only
         * way to tell a call that is on a line right now from one that ended hours ago.
         */
        private String callStatus;
        private Integer callDurationSeconds;
        /** True while the call is still up (non-terminal call-log status). */
        private boolean live;
    }

    /**
     * One bulk run, as the campaign progress dialog needs it.
     *
     * <p>Counts come from the QUEUE, not the call log. The call log only knows about
     * calls that already dialled, so a run of 100 against a 3-line fleet looked like a
     * run of 3 — and a lead the queue cancelled or expired never produced a call-log row
     * at all, so a progress bar counting them could never reach its own total.
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class BulkRunSummary {
        private String audienceId;
        /** Everything this run enqueued. The honest denominator. */
        private long total;
        private long waiting;
        /** Handed to the provider, not yet finished. */
        private long dialing;
        /** Reached a terminal call status. */
        private long completed;
        /** Ended without a call: cancelled, expired, or failed to place. */
        private long dropped;
        /** completed + dropped — everything that will not change again. */
        private long finished;
        private boolean runFinished;
        /** Rough time for what is still waiting, at this institute's current share. */
        private long etaMinutes;
        private Map<String, Long> byStatus;
    }

    /**
     * Institute-facing summary: "how deep is my queue and when will it clear?".
     *
     * <p>Deliberately carries NO capacity numbers. How many lines the fleet has, and
     * how many of them this institute may hold, are internal operating facts — an
     * institute seeing "2 of 3" learns that it shares a small pool with other tenants,
     * which is not its business and invites the wrong conversation. The wait is
     * expressed as time ({@link #etaMinutes}), which is the part that actually concerns
     * them. The capacity figures stay on the super-admin and internal endpoints.
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class QueueSummary {
        private String instituteId;
        private long queued;
        /** This institute's own calls currently on a line. Not a share of anything. */
        private long inFlight;
        private boolean paused;
        private long etaMinutes;
        private Map<String, Long> byStatus;
    }

    /** Fleet capacity + live occupancy, for the ops/settings screen. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class CapacityView {
        /** What is ACTUALLY enforced right now: min(hardware, ops limit). */
        private int vacademyAiCapacity;
        private int vacademyAiInFlight;
        /** What the boxes could carry, before any ops limit. */
        private int physicalCapacity;
        /**
         * The ops ceiling, or null when none is set and the hardware decides.
         * 0 means dialing is paused — the queue still accepts and holds calls.
         */
        private Integer fleetLimit;
        private int aavtaarCapacity;
        private int aavtaarInFlight;
        /**
         * True when the concurrency limit is BYPASSED entirely (unlimited calls).
         *
         * <p>Named for what it does. The underlying flag reads
         * {@code ai_call_capacity_enabled=false}, which looks like an off switch for AI
         * calling and is the opposite — surfacing it as "capacityEnabled" invited an
         * operator wanting to stop calls to uncap the fleet instead. To stop or throttle
         * calling, set {@code fleetLimit}; never this.
         */
        private boolean concurrencyLimitBypassed;
        private long totalQueued;
        private int lanesWithWork;
        /** The cap an institute with no override currently gets. */
        private int dynamicLaneCapacity;
        private int avgCallSeconds;
        private int reservedInteractiveSlots;
        private List<BoxView> boxes;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class BoxView {
        private String id;
        private String slug;
        private String baseUrl;
        private int maxConcurrent;
        private int priority;
        private boolean enabled;
        private String healthStatus;
        private Integer activeCalls;
        private String lastHealthCheck;
        private String notes;
        /** False when the box is enabled but known DOWN, i.e. lending no capacity. */
        private boolean countsTowardCapacity;
    }

    /** Create/update payload for a box. */
    @Data
    public static class BoxUpsertRequest {
        private String slug;
        private String baseUrl;
        private Integer maxConcurrent;
        private Integer priority;
        private Boolean enabled;
        private String notes;
    }

    /** Per-institute override payload. {@code maxConcurrent = null} restores the dynamic default. */
    @Data
    public static class LaneUpsertRequest {
        private Integer maxConcurrent;
        private Integer weight;
        private Boolean paused;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class LaneView {
        private String instituteId;
        private String instituteName;
        /** Null = no override; the institute follows {@code effectiveMaxConcurrent}. */
        private Integer maxConcurrent;
        private int effectiveMaxConcurrent;
        private int weight;
        private boolean paused;
        private long queued;
        private long inFlight;
        /** Rough time for this lane to clear at its current share of the fleet. */
        private long etaMinutes;
        /** When the longest-waiting item was queued — the number an ops screen watches. */
        private String oldestQueuedAt;
        private String lastDispatchedAt;
    }

    /**
     * The whole AI call queue in one payload — what the fleet can carry, who is holding
     * it, and what is waiting.
     *
     * <p>Assembled from a SINGLE capacity snapshot, so every number in it describes the
     * same instant. Fetching capacity and lanes through separate calls lets a dashboard
     * render an occupancy read at one moment beside lane shares computed at another,
     * which is exactly how "these numbers do not add up" tickets are born.
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class QueueSnapshot {
        /** When this snapshot was taken (ISO-8601, UTC). */
        private String generatedAt;
        private CapacityView capacity;
        private List<LaneView> lanes;
        /** The head of the queue, in dial order. Bounded — see {@link #waitingTotal}. */
        private List<QueueItemView> waiting;
        /** Everything waiting fleet-wide, so a UI can say "showing 50 of 487". */
        private long waitingTotal;
        /** Fleet-wide counts per lifecycle state (QUEUED / DIALED / FAILED / ...). */
        private Map<String, Long> totalsByStatus;
    }
}
