package vacademy.io.admin_core_service.features.catalogue_folder.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;

import java.sql.Timestamp;

/**
 * A named folder tree of an institute, browsed by the `folderBrowser` section
 * of its catalogue sites. Shared: every section pointing at it shows the same
 * tree. See V556__Catalogue_folder_library.sql for the reasoning.
 */
@Entity
@Table(name = "catalogue_folder_library")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CatalogueFolderLibrary {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, unique = true)
    private String id;

    @Column(name = "institute_id", nullable = false, length = 36)
    private String instituteId;

    @Column(name = "name", nullable = false, length = 255)
    private String name;

    @Column(name = "description", columnDefinition = "TEXT")
    private String description;

    /** ACTIVE | DELETED. */
    @Column(name = "status", nullable = false, length = 32)
    private String status;

    @Column(name = "created_by", length = 36)
    private String createdBy;

    @Column(name = "updated_by", length = 36)
    private String updatedBy;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Timestamp createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Timestamp updatedAt;
}
