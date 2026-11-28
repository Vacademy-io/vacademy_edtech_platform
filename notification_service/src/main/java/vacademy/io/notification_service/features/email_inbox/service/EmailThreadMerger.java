package vacademy.io.notification_service.features.email_inbox.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.send.service.UnifiedSendService;
import vacademy.io.notification_service.service.EmailService;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * Collapses the "twin" rows one campaign email produces into a single thread entry.
 *
 * <p>An announcement send writes TWO {@code EMAIL} rows for the same recipient within a second
 * or two: {@code AnnouncementDeliveryService} logs {@code source='announcement-service'} with the
 * campaign TITLE as body, and the actual SMTP send ({@code EmailService}, via unified-send) logs
 * a second row with the full HTML as body. In the inbox they showed as two "Sent" cards — one
 * whose text was just the title, one whose preview was the preheader padding. Here the
 * announcement row is folded into its twin, contributing the title as the thread subject.
 *
 * <p>Pure and static so it is unit-testable without a Spring context.
 */
public final class EmailThreadMerger {

    public static final String ANNOUNCEMENT_SOURCE = "announcement-service";
    /**
     * The announcement row is written synchronously right after routeSync returns, while the
     * SMTP row is written inside EmailDispatcher's async task only AFTER the send succeeds — up to
     * 3 attempts with 10 s connect/read timeouts and 1 s/2 s backoff. A retried send therefore
     * lands its twin 30-40 s later; 60 s covers that worst case. Pairing is restricted to
     * 'unified-send' rows and is one-to-one, so the wider window does not raise false pairings.
     */
    public static final Duration TWIN_WINDOW = Duration.ofSeconds(60);

    private static final ObjectMapper JSON = new ObjectMapper();

    private EmailThreadMerger() {}

    /**
     * One thread entry after merging.
     *
     * @param row            the surviving notification_log row
     * @param derivedSubject campaign title taken from a merged announcement twin, or null
     * @param campaign       true when this row is (or was merged with) an announcement send
     */
    public record MergedRow(NotificationLog row, String derivedSubject, boolean campaign) {}

    /**
     * Merge announcement twins. Input order (newest-first as the repo returns it) is preserved;
     * non-EMAIL rows and rows without a twin pass through untouched.
     */
    public static List<MergedRow> merge(List<NotificationLog> rows) {
        if (rows == null || rows.isEmpty()) return List.of();

        int n = rows.size();
        boolean[] dropped = new boolean[n];
        // A unified row pairs with at most ONE announcement row. Without this a second campaign
        // whose own SMTP row is missing/late would fold into its neighbour's row and vanish.
        boolean[] taken = new boolean[n];
        String[] derivedSubject = new String[n];
        boolean[] campaign = new boolean[n];

        for (int i = 0; i < n; i++) {
            NotificationLog ann = rows.get(i);
            if (!isAnnouncementEmail(ann)) continue;
            // A FAILED announcement row (unsubscribed / missing address / thrown send) never had an
            // SMTP send, so it has no twin by construction — keep it as its own campaign card.
            int twin = "FAILED".equalsIgnoreCase(ann.getDeliveryStatus()) ? -1 : findTwin(rows, i, taken);
            if (twin < 0) {
                campaign[i] = true;
                continue;
            }
            dropped[i] = true;
            taken[twin] = true;
            campaign[twin] = true;
            if (derivedSubject[twin] == null && !hasPayloadSubject(rows.get(twin))) {
                derivedSubject[twin] = blankToNull(ann.getBody());
            }
        }

        List<MergedRow> out = new ArrayList<>(n);
        for (int i = 0; i < n; i++) {
            if (dropped[i]) continue;
            out.add(new MergedRow(rows.get(i), derivedSubject[i], campaign[i]));
        }
        return out;
    }

    static boolean isAnnouncementEmail(NotificationLog nl) {
        return nl != null
                && "EMAIL".equals(nl.getNotificationType())
                && ANNOUNCEMENT_SOURCE.equalsIgnoreCase(nl.getSource());
    }

    /** True for the SMTP row UnifiedSendService logs for a plain (announcement) send. */
    static boolean isUnifiedSendEmail(NotificationLog nl) {
        return nl != null
                && "EMAIL".equals(nl.getNotificationType())
                && UnifiedSendService.PLAIN_LOG_SOURCE.equalsIgnoreCase(nl.getSource());
    }

    /**
     * Index of the closest not-yet-taken {@code unified-send} EMAIL row with the same recipient,
     * same institute sender and within {@link #TWIN_WINDOW}; -1 when none. Only that source is
     * ever written for an announcement's SMTP send, so OTP / inbox-reply / automation rows to
     * the same address in the same minute can never be captured as a twin.
     */
    private static int findTwin(List<NotificationLog> rows, int annIdx, boolean[] taken) {
        NotificationLog ann = rows.get(annIdx);
        Instant annAt = ann.getNotificationDate();
        if (annAt == null) return -1;

        int best = -1;
        long bestDelta = Long.MAX_VALUE;
        for (int j = 0; j < rows.size(); j++) {
            if (j == annIdx || taken[j]) continue;
            NotificationLog cand = rows.get(j);
            if (!isUnifiedSendEmail(cand)) continue;
            if (!sameAddress(ann.getChannelId(), cand.getChannelId())) continue;
            if (!sameAddress(ann.getSenderBusinessChannelId(), cand.getSenderBusinessChannelId())) continue;
            Instant candAt = cand.getNotificationDate();
            if (candAt == null) continue;
            long delta = Math.abs(Duration.between(annAt, candAt).toMillis());
            if (delta > TWIN_WINDOW.toMillis()) continue;
            if (delta < bestDelta) {
                bestDelta = delta;
                best = j;
            }
        }
        return best;
    }

    private static boolean sameAddress(String a, String b) {
        if (a == null || b == null) return Objects.equals(a, b);
        return a.trim().equalsIgnoreCase(b.trim());
    }

    /** True when the row's message_payload already carries a non-blank {@code subject}. */
    static boolean hasPayloadSubject(NotificationLog nl) {
        String payload = nl.getMessagePayload();
        if (payload == null || payload.isBlank()) return false;
        try {
            JsonNode node = JSON.readTree(payload);
            JsonNode subject = node == null ? null : node.get(EmailService.SUBJECT_PAYLOAD_KEY);
            return subject != null && !subject.isNull() && !subject.asText().isBlank();
        } catch (Exception e) {
            return false;
        }
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s;
    }
}
