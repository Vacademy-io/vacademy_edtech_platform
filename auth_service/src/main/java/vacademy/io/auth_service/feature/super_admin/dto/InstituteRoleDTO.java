package vacademy.io.auth_service.feature.super_admin.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One staff role of an institute for the super-admin portal
 * (INSTITUTE_MODULES_AND_CONFIG_SPEC.md §12.3). kind: ADMIN | TEACHER | SYSTEM | CUSTOM.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class InstituteRoleDTO {
    private String roleId;
    private String roleName;
    private String kind;
    private long userCount;
}
