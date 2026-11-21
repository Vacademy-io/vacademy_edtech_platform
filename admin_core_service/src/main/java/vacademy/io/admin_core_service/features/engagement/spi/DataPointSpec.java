package vacademy.io.admin_core_service.features.engagement.spi;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Catalog entry for a data point — drives the create-wizard picker AND the prompt assembly
 * (the LLM sees description, so a new provider becomes visible to the brain automatically:
 * the same catalog-as-grounding trick WorkflowCatalogController uses).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DataPointSpec {
    private String key;
    private String label;
    /** LLM-facing: what this block contains and how to interpret absence. */
    private String description;
    /** LOW | MEDIUM | HIGH — HIGH requires an explicit consent checkbox in the wizard. */
    private String sensitivity;
    /** IN_PROCESS | HTTP — cost hint for the wizard. */
    private String cost;
    /** Read for every engine whatever the selection (set by the catalog endpoint from the provider). */
    private Boolean alwaysOn;
}
