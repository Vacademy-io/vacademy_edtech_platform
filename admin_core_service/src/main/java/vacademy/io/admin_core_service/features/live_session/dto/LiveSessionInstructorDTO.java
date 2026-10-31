package vacademy.io.admin_core_service.features.live_session.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * An instructor as the admin and learner UIs render them (V524).
 *
 * <p>{@code userId} is always present; the display fields are resolved from
 * auth_service and are null when that lookup fails or the user no longer
 * exists. Nulls are omitted rather than serialized so a partial directory
 * response degrades to "an instructor we can't name" instead of a card full of
 * empty strings.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonInclude(JsonInclude.Include.NON_NULL)
public class LiveSessionInstructorDTO {
    private String userId;
    private String fullName;
    private String email;
    private String profilePicFileId;
}
