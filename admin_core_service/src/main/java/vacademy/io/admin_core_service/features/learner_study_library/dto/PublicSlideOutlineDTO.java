package vacademy.io.admin_core_service.features.learner_study_library.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One slide as an open (no login) endpoint may show it: the outline of a course, never its
 * content. Built only by {@code PublicSlideOutlines}.
 *
 * <p>The per-type objects ({@code video_slide}, {@code document_slide}, ...) keep the same JSON
 * names as the learner slide DTO, so a page that picks an icon from which of them is present, or
 * from {@code document_slide.type}, keeps working. They carry only the fields of {@link Part}.
 */
@Data
@NoArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonInclude(JsonInclude.Include.NON_NULL)
public class PublicSlideOutlineDTO {
    private String id;
    private String sourceType;
    private String title;
    private String imageFileId;
    private String status;
    private Integer slideOrder;
    private Part videoSlide;
    private Part documentSlide;
    private Part questionSlide;
    private Part assignmentSlide;
    private Part quizSlide;
    private Part htmlVideoSlide;
    private Part audioSlide;
    private Part scormSlide;
    private Part assessmentSlide;

    /**
     * The type-specific part of a slide, reduced to format, sizes and durations. An empty object
     * still says which kind of slide it is.
     */
    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class Part {
        /** Document format, for example PDF, DOC or PRESENTATION. */
        private String type;
        private Integer totalPages;
        private Integer publishedDocumentTotalPages;
        private Long videoLengthInMillis;
        private Long publishedVideoLengthInMillis;
        private Long audioLengthInMillis;
        private Long publishedAudioLengthInMillis;
        private Integer timeLimitInMinutes;
    }
}
