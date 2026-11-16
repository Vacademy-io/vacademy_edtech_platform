package vacademy.io.media_service.rendition;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/** What the internal rendition endpoint answers. Width and height are in display orientation. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ImageRenditionResult {

    private String fileId;
    private Integer width;
    private Integer height;
    private Integer pipelineVersion;
    private List<Rendition> renditions;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Rendition {
        private Integer width;
        private Integer height;
        private String url;
        private Long bytes;
        /** False when the object was already there from an earlier run. */
        private Boolean created;
    }
}
