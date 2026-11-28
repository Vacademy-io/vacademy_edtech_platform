package vacademy.io.admin_core_service.features.invoice.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Request/response payloads for the invoice-numbering settings screen. Grouped in one
 * file because they are small, only ever used together, and only by
 * {@code InvoiceNumberingController}.
 */
public final class InvoiceNumberingDTOs {

    private InvoiceNumberingDTOs() {
    }

    /**
     * A candidate strategy the admin is editing. Mirrors {@code INVOICE_SETTING.numbering}
     * so the preview can be requested before (and without) saving.
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class PreviewRequest {
        private String instituteId;
        private String format;
        private Integer seqPadding;
        private String seqScope;
        private String instituteCode;
        private Integer fyStartMonth;
        private Boolean sanitizeTokens;
        /** Floor for the sequence: the next number is never lower than this. */
        private Long startFrom;
        /** Null means on: a number freed by a permanent delete is not issued again. */
        private Boolean neverReuseDeletedNumbers;
    }

    /**
     * What the format would produce. {@code samples} are rendered from the institute's real
     * values where they are free (name, state code, …) and representative stand-ins for
     * learner/course values, using consecutive sequence numbers starting at
     * {@code nextSequence} — none of which are consumed.
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class PreviewResponse {
        private boolean valid;
        private List<String> samples;
        private List<String> errors;
        private List<String> warnings;
        private long nextSequence;
        /** Highest position already issued in this window — a startFrom below this is ignored. */
        private long highestIssuedSequence;
        /** Worst-case rendered length, against a 100-character column. */
        private int maxLength;
    }

    /** One entry in the click-to-insert palette. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class TokenInfo {
        private String key;
        private String label;
        private String group;
        private String example;
        /** Needs an extra DB read; resolved only when the format uses it. */
        private boolean lazy;
        /** Makes numbering non-sequential — the UI badges these and warns on save. */
        private boolean riskyForTax;
    }

    /**
     * Current numbering state, used to populate the change-warning dialog: what the
     * institute uses today, what it would issue next, and how much history is at stake.
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class NumberingState {
        private String currentFormat;
        private String seqScope;
        private String currentExample;
        private String lastIssuedNumber;
        private long nextSequence;
        private long existingInvoiceCount;
    }
}
