package vacademy.io.admin_core_service.features.live_session.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * What a live-session delete is about to remove, captured before the delete for
 * the admin activity log ({@code before_payload}). {@code label} feeds the row's
 * description, so the log reads "Priya deleted live class "Maths" on 08 Sep 2026
 * at 10:00" instead of a bare count.
 */
@AllArgsConstructor
@Data
@NoArgsConstructor
public class LiveSessionDeleteAuditDTO {
    /** The session the deleted classes belong to; null when the request spans several. */
    private String sessionId;
    private String label;
    private List<Item> items;

    @AllArgsConstructor
    @Data
    @NoArgsConstructor
    public static class Item {
        private String sessionId;
        private String scheduleId;
        private String title;
        private String meetingDate;
        private String startTime;
        private String timezone;
    }
}
