package vacademy.io.admin_core_service.features.learner_notes.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class NotebookPageDTO {
    private List<LearnerNoteDTO> content;
    private int pageNo;
    private int pageSize;
    private long totalElements;
    private boolean last;
}
