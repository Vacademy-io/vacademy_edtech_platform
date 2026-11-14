package vacademy.io.admin_core_service.features.catalog_api.settings;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

/** Per-institute overrides for the public catalogue API (V581). Null columns are derived. */
@Entity
@Table(name = "institute_catalog_api_settings")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class InstituteCatalogApiSettings {

    @Id
    @Column(name = "institute_id", length = 255)
    private String instituteId;

    /** Tag of the course catalogue (site) whose catalogue_json drives the API. */
    @Column(name = "site_tag")
    private String siteTag;

    /** Where course pages live, e.g. https://learning.brahmvarchas.org/store (no trailing slash). */
    @Column(name = "course_base_url", length = 500)
    private String courseBaseUrl;

    @Column(name = "updated_by")
    private String updatedBy;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
}
