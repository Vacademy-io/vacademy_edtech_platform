package vacademy.io.admin_core_service.features.commerce.catalogue.importer.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCatalogueEntity;

/**
 * An image address named by an import file. The import only stores it. The migration tool
 * reads PENDING rows, downloads from the old shop under its own host allow-list,
 * uploads to the media service and attaches the file to the product; this service never
 * opens the address.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_import_image_queue")
public class CommerceImportImageQueue extends CommerceCatalogueEntity {

    public static final String PENDING = "PENDING";

    @Column(name = "job_id", nullable = false, updatable = false, length = 36)
    private String jobId;

    @Column(name = "package_id", nullable = false, updatable = false)
    private String packageId;

    @Column(name = "source_url", nullable = false, updatable = false)
    private String sourceUrl;

    @Column(name = "position", nullable = false)
    private Integer position;

    @Column(name = "status", nullable = false, length = 32)
    private String status;

    /** Set by the migration tool once the file is in the media library. */
    @Column(name = "media_id")
    private String mediaId;
}
