package vacademy.io.admin_core_service.features.audience.dto;

import lombok.Data;

/**
 * Request body for partially updating a FormWebhookConnector from the admin UI.
 * Only fields that are non-null are applied — pass {@code defaultValuesJson} to
 * edit per-center metadata (the JSON merged into form payloads at webhook time), or
 * {@code platformFormName} to rename the connector.
 */
@Data
public class ConnectorUpdateRequest {
    /**
     * Stringified JSON object of default/static values, e.g.
     * {"center name": "Baner", "Schedule Link": "https://...", "School Phone": "..."}.
     * Pass an empty object "{}" to clear; null = don't touch.
     */
    private String defaultValuesJson;

    /**
     * Display name shown in the connector list (Meta: the form name; Google: whatever
     * the admin calls this lead form, since its id is the secret key). Blank clears it;
     * null = don't touch.
     */
    private String platformFormName;
}
