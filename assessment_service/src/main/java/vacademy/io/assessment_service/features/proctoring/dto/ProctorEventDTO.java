package vacademy.io.assessment_service.features.proctoring.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Date;
import java.util.Map;

/** One signal from the learner's device, as sent (batched) and as read back by a reviewer. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonIgnoreProperties(ignoreUnknown = true)
public class ProctorEventDTO {
    /** Server-assigned; ignored on input. */
    private String id;
    private String eventType;
    private String severity;
    private Date occurredAt;
    private Date receivedAt;
    /** media_service file id of the snapshot, when the event carries one. */
    private String evidenceFileId;
    /** Small free-form detail: face count, seconds without a face, detector used ... */
    private Map<String, Object> meta;
}
