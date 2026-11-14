package vacademy.io.assessment_service.features.question_library.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/** What is hidden from one institute in the Content Library, as the platform portal sees it. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LibraryInstituteAccessDto {
    /** False when no owner institute is configured: there is no library to show. */
    private boolean libraryConfigured;
    /** True for the owner institute itself, which always sees and manages all of it. */
    private boolean owner;
    /** Topics hidden from this institute directly. Everything below each one is hidden too. */
    private List<String> hiddenNodeIds;
}
