package vacademy.io.community_service.feature.session.dto.admin;

import com.fasterxml.jackson.databind.PropertyNamingStrategy;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.ToString;

/**
 * Response of POST /engage/admin/v2/create. The key sits beside the session and
 * never on {@link LiveSessionDto}, because that DTO is also what learners receive.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategy.SnakeCaseStrategy.class)
public class CreateSessionV2ResponseDto {
    private LiveSessionDto session;
    @ToString.Exclude
    private String presenterKey;
}
