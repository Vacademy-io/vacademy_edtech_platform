package vacademy.io.admin_core_service.features.suborg.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.List;

/**
 * Adds many learners to one batch of a sub-organization from the parent institute's sub-org
 * page. A learner with {@code id} set is an existing account; otherwise the email (or mobile)
 * identifies them and a new account is created when none exists.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class SubOrgBulkAddMembersRequestDTO {

    private String instituteId;
    private String subOrgId;
    private String packageSessionId;
    private List<UserDTO> learners;
}
