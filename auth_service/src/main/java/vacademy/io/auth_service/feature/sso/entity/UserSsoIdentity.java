package vacademy.io.auth_service.feature.sso.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UuidGenerator;

import java.util.Date;

/** The provider's permanent user id for one connection, linked to one of our users. */
@Entity
@Table(name = "user_sso_identity")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UserSsoIdentity {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "connection_id", nullable = false)
    private String connectionId;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "issuer", nullable = false)
    private String issuer;

    @Column(name = "subject", nullable = false)
    private String subject;

    @Column(name = "user_id", nullable = false)
    private String userId;

    @Column(name = "email")
    private String email;

    @Column(name = "granted_package_session_ids", columnDefinition = "text")
    private String grantedPackageSessionIds;

    @Column(name = "last_login_at")
    private Date lastLoginAt;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Date createdAt;

    @Column(name = "updated_at")
    private Date updatedAt;
}
