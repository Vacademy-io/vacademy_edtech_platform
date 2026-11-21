package vacademy.io.admin_core_service.features.telephony.core.dto;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class ConnectCallResponseDTO {
    private String callLogId;
    private String status;
    private String callerId;       // ExoPhone the lead will see — useful for UI display
    private String eventsStreamUrl;
    /**
     * True when the provider pushes live call-progress events (Exotel) so the
     * UI can stream RINGING → ANSWERED → COMPLETED. False for post-call providers
     * (Airtel): there is no live feed — the outcome only materialises when the
     * provider's CDR is imported minutes after hang-up. The UI uses this to show
     * an honest "call placed, outcome appears later" flow instead of a spinner
     * that never advances.
     */
    private boolean realtimeEvents;
    /**
     * The audience_response the call was logged against, when there is one.
     * Echoed back because a learner call sends no responseId but the
     * orchestrator may still have linked an existing lead row — the UI needs
     * that id to open the post-call disposition sheet (status + follow-up both
     * key off it). Null for a learner with no lead row: the caller should skip
     * disposition capture rather than send a blank id.
     */
    private String responseId;
}
