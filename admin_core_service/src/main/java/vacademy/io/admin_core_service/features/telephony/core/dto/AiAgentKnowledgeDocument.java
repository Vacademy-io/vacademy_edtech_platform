package vacademy.io.admin_core_service.features.telephony.core.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * A reference document of an AI agent (V615): the text extracted from an uploaded PDF,
 * DOCX or TXT. The original file is not kept — the agent only ever needs the text, and
 * the admin can read and edit it in the editor.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonIgnoreProperties(ignoreUnknown = true)
public class AiAgentKnowledgeDocument {
    private String id;
    /** File name as uploaded, e.g. "Fee structure 2026.pdf". */
    private String name;
    /** PDF | DOCX | TXT. */
    private String kind;
    private String text;
    private Integer chars;
    /** ISO-8601 instant. */
    private String addedAt;
}
