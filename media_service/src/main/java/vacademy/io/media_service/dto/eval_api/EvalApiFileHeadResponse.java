package vacademy.io.media_service.dto.eval_api;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * What storage actually holds for an AI Evaluation API file. {@code size_bytes}
 * and {@code content_type} come from the object itself (null when the object
 * does not exist yet), {@code source}/{@code source_id} from file_metadata.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class EvalApiFileHeadResponse {
    private String fileId;
    private boolean exists;
    private Long sizeBytes;
    private String contentType;
    private String source;
    private String sourceId;
}
