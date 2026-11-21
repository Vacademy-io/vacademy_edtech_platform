package vacademy.io.auth_service.feature.login_link.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * Whether an institute's username-only login links still work. No row = they do
 * (require_login_code false). See V20__learner_login_code.sql.
 */
@Entity
@Table(name = "institute_login_link_policy")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class InstituteLoginLinkPolicy {

    @Id
    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "require_login_code", nullable = false)
    private boolean requireLoginCode;

    /**
     * Comma-separated {@link vacademy.io.auth_service.feature.login_link.enums.LoginLinkRoute}
     * names that may still sign in without a code while {@link #requireLoginCode} is on.
     */
    @Column(name = "code_free_routes")
    private String codeFreeRoutes;

    @Column(name = "updated_by")
    private String updatedBy;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /** The exempt routes, unknown names dropped. */
    public java.util.Set<vacademy.io.auth_service.feature.login_link.enums.LoginLinkRoute> codeFreeRouteSet() {
        java.util.Set<vacademy.io.auth_service.feature.login_link.enums.LoginLinkRoute> out =
                java.util.EnumSet.noneOf(vacademy.io.auth_service.feature.login_link.enums.LoginLinkRoute.class);
        if (codeFreeRoutes != null) {
            for (String part : codeFreeRoutes.split(",")) {
                vacademy.io.auth_service.feature.login_link.enums.LoginLinkRoute.parse(part).ifPresent(out::add);
            }
        }
        return out;
    }
}
