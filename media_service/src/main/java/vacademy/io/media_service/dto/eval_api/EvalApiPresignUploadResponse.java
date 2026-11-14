package vacademy.io.media_service.dto.eval_api;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

/**
 * Presigned PUT for one AI Evaluation API upload. The signature covers the
 * Content-Type and Content-Length headers, so the PUT must send exactly the
 * {@code headers} given here and a body of exactly the declared size.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class EvalApiPresignUploadResponse {
    private String fileId;
    private String uploadUrl;
    private String method;
    private Map<String, String> headers;
    /** ISO-8601 UTC instant. */
    private String expiresAt;
}
