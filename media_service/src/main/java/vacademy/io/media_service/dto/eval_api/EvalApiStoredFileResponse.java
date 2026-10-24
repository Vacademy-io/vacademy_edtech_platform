package vacademy.io.media_service.dto.eval_api;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Result of a server-side upload into the AI Evaluation API private prefix. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class EvalApiStoredFileResponse {
    private String fileId;
    private Long sizeBytes;
    private String contentType;
    private String source;
    private String sourceId;
}
