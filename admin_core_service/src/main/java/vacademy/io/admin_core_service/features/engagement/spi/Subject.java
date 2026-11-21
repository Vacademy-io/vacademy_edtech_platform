package vacademy.io.admin_core_service.features.engagement.spi;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * A member's identity as providers see it. memberId keys every fetch() result map.
 * userId is null for unconverted leads; audienceResponseId is null for pure learners.
 * phone/email are resolved once per cohort by ContactResolver before hydration.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Subject {
    private String memberId;
    private String userId;
    private String audienceResponseId;
    private String phone;
    private String email;
    private String name;
    /** The address is on notification-service's bounce blocklist: known, but nothing sent to it arrives. */
    private boolean emailUndeliverable;
}
