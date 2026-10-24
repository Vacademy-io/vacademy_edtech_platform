package vacademy.io.admin_core_service.features.offline_payment.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/**
 * The offline payment modes an institute offers when an admin records a payment, set in
 * Settings → Payment Settings. See docs/OFFLINE_PAYMENT_RECORDING.md §4.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class OfflinePaymentModesDTO {

    /** When true, every record-payment dialog requires a mode. */
    private boolean requireMode;

    /** Mode code preselected in the dialogs; null = none. */
    private String defaultMode;

    @Builder.Default
    private List<Mode> modes = new ArrayList<>();

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Mode {
        /** Stable id (A–Z, 0–9, _). Never reused for something else: past payments refer to it. */
        private String code;
        private String label;
        @Builder.Default
        private boolean active = true;
        /** Label for the reference box, e.g. "UPI transaction ID", "Cheque number". */
        private String referenceLabel;
        /** Whether the reference must be filled for this mode. */
        private boolean referenceRequired;
        /** Whether a proof file must be attached for this mode. */
        private boolean proofRequired;
        /** Extra inputs for this mode: cheque_date, bank_name, payer_name. */
        @Builder.Default
        private List<String> extraFields = new ArrayList<>();
        /** Built-in extras that must be filled; a subset of {@link #extraFields}. */
        @Builder.Default
        private List<String> requiredExtraFields = new ArrayList<>();
        /** The institute's own inputs for this mode (cheque status, branch, transaction date ...). */
        @Builder.Default
        private List<CustomField> customFields = new ArrayList<>();
        /** What the options are called in the dialogs, e.g. "Account", "App"; null = a generic label. */
        private String subModeLabel;
        /** Whether one of the mode's active options must be picked. */
        private boolean subModeRequired;
        @Builder.Default
        private List<SubMode> subModes = new ArrayList<>();
    }

    /** An input the institute adds to a mode. Switched off rather than deleted, like modes. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class CustomField {
        /** Stable id within the mode (a–z, 0–9, _); past payments refer to it. */
        private String key;
        private String label;
        /** TEXT, DATE, NUMBER or SELECT. */
        @Builder.Default
        private String type = "TEXT";
        private boolean required;
        @Builder.Default
        private boolean active = true;
        /** The choices of a SELECT field. */
        @Builder.Default
        private List<String> options = new ArrayList<>();
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SubMode {
        private String code;
        private String label;
        @Builder.Default
        private boolean active = true;
    }
}
