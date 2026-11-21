package vacademy.io.assessment_service.features.assessment_folder.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class FolderTestOrderRequest {
    private String folderId;
    /** NAME or CUSTOM. */
    private String mode;
    /** CUSTOM only: the folder's tests in their new order. Tests left out keep their place after these. */
    private List<String> assessmentIds = new ArrayList<>();
}
