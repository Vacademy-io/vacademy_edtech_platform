package vacademy.io.admin_core_service.features.engagement.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Human edits to an AI-proposed (or Meta-rejected) template before approval. Any field left null
 * keeps its current value; the service re-validates the {{n}} ↔ variable/sample alignment after
 * applying the edits, so a human can't approve a template Meta will reject for a sample mismatch.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TemplateEditRequest {
    private String body;                 // with {{1}}, {{2}} … sequential from 1
    private String category;             // MARKETING | UTILITY | AUTHENTICATION
    private List<String> variableNames;  // parallel to sampleValues
    private List<String> sampleValues;
    private String footerText;           // <=60 chars, static
    private java.util.Map<String, String> variableSources; // {variableName: source}, see templates.TemplateVariableSources
    private String purpose;
}
