package vacademy.io.admin_core_service.features.faculty.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import lombok.Data;
import org.hibernate.annotations.UuidGenerator;
import vacademy.io.admin_core_service.features.faculty.dto.FacultyTopLevelResponse;

import java.sql.Timestamp;

@Entity
@Data
public class FacultySubjectPackageSessionMapping {
    @Id
    @UuidGenerator
    private String id;
    private String userId;
    private String packageSessionId;
    private String subjectId;
    private String name;
    private String status;

    @Column(name = "user_type")
    private String userType;

    @Column(name = "type_id")
    private String typeId;

    @Column(name = "access_type")
    private String accessType;

    @Column(name = "access_id")
    private String accessId;

    @Column(name = "access_permission")
    private String accessPermission;

    @Column(name = "linkage_type")
    private String linkageType;

    @Column(name = "suborg_id")
    private String suborgId;

    // SOFT sub-org removal: the last date the member keeps access. While status is
    // ACTIVE and this is in the future, the member is still enrolled; the nightly
    // SubOrgTeamAccessExpiryJob flips ACTIVE rows whose access_till_date has passed
    // to INACTIVE. NULL = no scheduled expiry.
    @Column(name = "access_till_date")
    private Timestamp accessTillDate;

    // Per-course display role (Author / Instructor / Acharya ...). NULL = the page
    // uses the institute's naming term.
    @Column(name = "role_label")
    private String roleLabel;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;
    @Column(name = "updated_at", insertable = false, updatable = false)
    private Timestamp updatedAt;

    public FacultySubjectPackageSessionMapping() {
    }

    public FacultySubjectPackageSessionMapping(String userId, String packageSessionId, String subjectId, String name,
            String status) {
        this.userId = userId;
        this.packageSessionId = packageSessionId;
        this.subjectId = subjectId;
        this.name = name;
        this.status = status;
    }
}
