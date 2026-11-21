package vacademy.io.admin_core_service.features.telephony.core.dto;

import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Click-to-call request body. instituteId is required because
 * CustomUserDetails doesn't carry it — the frontend has it in local context
 * and passes it explicitly.
 *
 * <p>The call subject arrives one of two ways:
 * <ul>
 *   <li>{@code responseId} — a CRM lead (audience_response). The phone comes
 *       off the lead row, falling back to the user's auth record.</li>
 *   <li>{@code userId} alone — an enrolled learner with no lead row, called
 *       from the LMS surfaces (students list / attendance / assessment
 *       side-view). The phone comes from auth_service and the orchestrator
 *       links a matching lead row when the learner happens to have one.</li>
 * </ul>
 * At least one of the two is required.
 */
@Data
@NoArgsConstructor
public class ConnectCallRequestDTO {
    private String instituteId;
    private String responseId;     // audience_response.id — optional for learner calls
    private String userId;         // the person being called when responseId is absent

    /**
     * Optional: the counsellor picked a specific provider number from the
     * runtime picker. When set + the id is enabled, the orchestrator uses it
     * directly and skips strategy selection. When null/blank, the configured
     * selector strategy decides (sticky-per-lead by default).
     */
    private String preferredNumberId;
}
