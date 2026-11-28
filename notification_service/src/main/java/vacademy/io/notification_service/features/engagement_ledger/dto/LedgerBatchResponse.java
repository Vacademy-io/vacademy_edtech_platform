package vacademy.io.notification_service.features.engagement_ledger.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.Map;

/**
 * Per-subject send/read/reply rollups. The {@code observable} flags are load-bearing: they tell
 * the brain what it CANNOT see (e.g. email read state, email replies while inbound email is off)
 * so silence is never mistaken for rejection. A channel block is null when the subject has no
 * identifier for that channel.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LedgerBatchResponse {

    /** subject key (echoed from the request) → ledger. */
    private Map<String, SubjectLedger> bySubject;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SubjectLedger {
        private ChannelLedger whatsapp;
        private ChannelLedger email;
        /** B5: contacts from every system, phone and email together; null unless asked for. */
        private ContactLedger contact;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ContactLedger {
        /** Touches in the contact window from any automated source (engine, workflow, announcement, chatbot per day). */
        private long touches;
        /** Last message a person sent from the inbox, any time in the window (the counsellor hold). */
        private Instant lastHumanSentAt;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ChannelLedger {
        private Instant lastSentAt;
        private Instant lastDeliveredAt;
        private Instant lastReadAt;
        private Instant lastReplyAt;
        /** Truncated preview (notification_log.body caps inbound text at ~100 chars). */
        private String lastReplyText;
        /** WhatsApp only: lastReplyAt + 24h — the free-form reply window Meta allows. */
        private Instant windowOpenUntil;
        private long recentSends;
        private long recentReads;
        private long recentFailures;
        /** Meta error code from the most recent FAILED event (e.g. 131049 = quality throttled). */
        private String lastFailureCode;
        /** What this channel can actually report: keys delivery/read/reply → true if the signal exists. */
        private Map<String, Boolean> observable;
    }
}
