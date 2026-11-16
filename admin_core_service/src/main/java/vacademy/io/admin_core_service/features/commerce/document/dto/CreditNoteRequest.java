package vacademy.io.admin_core_service.features.commerce.document.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.util.List;

/** A credit note against one invoice: everything that is left of it (full), or the named lines. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CreditNoteRequest {

    /**
     * Required: the caller's key for this credit note, unique in the institute (up to 64
     * letters, digits, . _ : or -). A repeat of the same request is answered with the note the
     * first one issued; the same key with other content is refused.
     */
    private String clientRequestId;
    private String invoiceId;
    private String reason;
    /** Set by the return flow in code; ignored on the staff endpoint. */
    private String returnId;
    /** Defaults to today in India; never after today. Ignored on the staff endpoint. */
    private LocalDate documentDate;
    /** True credits everything not yet credited; {@code lines} is then ignored. */
    private Boolean full;
    private List<CreditNoteLineRequest> lines;
}
