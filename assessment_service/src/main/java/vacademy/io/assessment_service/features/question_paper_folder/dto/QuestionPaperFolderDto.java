package vacademy.io.assessment_service.features.question_paper_folder.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class QuestionPaperFolderDto {
    private String id;
    private String name;
    private String description;
    private String imageUrl;
    private Integer displayOrder;
    private String status;
    private String parentId;
    /** Papers in the folder that the All tab lists (ACTIVE or FAVOURITE). */
    private Long paperCount;
}
