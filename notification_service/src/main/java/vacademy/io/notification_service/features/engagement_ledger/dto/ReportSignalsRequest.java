package vacademy.io.notification_service.features.engagement_ledger.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Per-action delivery, reply and pricing signals for the engagement daily report (admin_core).
 * One call per chunk of engine actions, never one per action.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ReportSignalsRequest {

    public static final int MAX_ACTION_IDS = 2000;
    public static final int DEFAULT_REPLY_WINDOW_HOURS = 72;
    public static final int MIN_REPLY_WINDOW_HOURS = 1;
    public static final int MAX_REPLY_WINDOW_HOURS = 168;

    private String instituteId;

    /** engagement_action ids, as stamped in notification_log.correlation_id at send time. */
    private List<String> actionIds;

    /** How long after a WhatsApp send an inbound message still counts as its reply. Default 72, clamped to 1..168. */
    private Integer replyWindowHours;
}
