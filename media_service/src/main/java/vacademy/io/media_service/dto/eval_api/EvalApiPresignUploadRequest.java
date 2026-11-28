package vacademy.io.media_service.dto.eval_api;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Body of {@code POST /media-service/internal/eval-api/v1/presign-upload}
 * (assessment_service, on behalf of an AI Evaluation API partner).
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class EvalApiPresignUploadRequest {
    private String instituteId;
    private String fileName;
    private String contentType;
    private Long sizeBytes;
}
