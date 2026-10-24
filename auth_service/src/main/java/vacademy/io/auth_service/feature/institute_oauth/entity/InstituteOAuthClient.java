package vacademy.io.auth_service.feature.institute_oauth.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.ToString;
import org.hibernate.annotations.UuidGenerator;

import java.util.Date;

/**
 * A white-label brand's own OAuth client (today: Google). While enabled, that institute's
 * "Continue with Google" starts with this client, so Google's sign-in screen shows the brand's
 * name. See V19__institute_oauth_client.sql.
 */
@Entity
@Table(name = "institute_oauth_client")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class InstituteOAuthClient {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    /** Base registration id this client replaces, e.g. "google". */
    @Column(name = "provider", nullable = false)
    private String provider;

    @Column(name = "client_id", nullable = false)
    private String clientId;

    @ToString.Exclude
    @Column(name = "client_secret_encrypted", nullable = false, columnDefinition = "text")
    private String clientSecretEncrypted;

    @Column(name = "enabled", nullable = false)
    private boolean enabled;

    @Column(name = "updated_by")
    private String updatedBy;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Date createdAt;

    @Column(name = "updated_at")
    private Date updatedAt;
}
