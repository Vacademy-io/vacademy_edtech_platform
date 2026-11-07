package vacademy.io.admin_core_service.features.engagement.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CreateEngineRequest {
    private String name;
    private String objective;
    /** The admin's free-text brief — becomes prompt version 1 (immutable base_text). */
    private String brief;
    /** en | hi | hinglish */
    private String language;
    /** Selected data-point keys (always-on ones are added regardless). */
    private List<String> dataPoints;
    /** Raw JSON: {WHATSAPP:{enabled,auto,autoReply},EMAIL:{...},IN_APP:{...},AI_CALL:{...}} */
    private String channels;
    /** Raw JSON: [{type:"PACKAGE_SESSION"|"AUDIENCE"|"USER", id:"..."}] */
    private String audience;
    /** Raw JSON: {startHour,endHour,timezone} */
    private String quietHours;
    private Integer cadenceHours;
    /** Phase 2: % of the audience (0..100) enrolled but never messaged, for lift measurement. */
    private Integer holdoutPct;
    /** Phase 2: human-approved sends before this engine may auto-send (null = global default). */
    private Integer firstN;
    /**
     * Institute team members alerted by bell alert and email when the engine needs a human. Staff
     * of the engine's institute only; null on an edit leaves the current contacts as they are.
     */
    private List<String> notifyUserIds;
    /** Material the agent may send when asked (brochures, demo videos…). Optional. */
    private List<EngagementAssetRequest> assets;
}
