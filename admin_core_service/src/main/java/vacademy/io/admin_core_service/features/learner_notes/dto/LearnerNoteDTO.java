package vacademy.io.admin_core_service.features.learner_notes.dto;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

@Data
@NoArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LearnerNoteDTO {
    private String id;
    private String instituteId;
    private String slideId;
    private String slideType;
    private String slideTitle;
    private String chapterName;
    private String courseName;
    private String courseId;
    private String levelId;
    private String subjectId;
    private String moduleId;
    private String chapterId;
    private String packageSessionId;
    private String kind;
    private String color;
    private Integer pageIndex;
    private Long timeMs;
    private String anchorJson;
    private String quoteText;
    private String noteText;

    // Set by the server only. The app sends a note back with these still on it;
    // they are ignored on the way in, and always go out as ISO strings.
    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    private Integer reviewStage;
    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    @JsonFormat(shape = JsonFormat.Shape.STRING)
    private Instant nextReviewAt;
    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    @JsonFormat(shape = JsonFormat.Shape.STRING)
    private Instant lastReviewedAt;
    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    @JsonFormat(shape = JsonFormat.Shape.STRING)
    private Instant createdAt;
    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    @JsonFormat(shape = JsonFormat.Shape.STRING)
    private Instant updatedAt;
}
