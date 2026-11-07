package vacademy.io.admin_core_service.features.catalogue_resources.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UuidGenerator;

import java.sql.Timestamp;

/**
 * One freebie (resource card file or link) opened on a catalogue site.
 *
 * audienceResponseId ties the download to a lead when the visitor filled a
 * form in that browser; otherwise it is null and the row only counts towards
 * the file's total.
 */
@Entity
@Table(name = "catalogue_resource_download")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CatalogueResourceDownload {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, unique = true)
    private String id;

    @Column(name = "institute_id", nullable = false, length = 36)
    private String instituteId;

    @Column(name = "catalogue_id", length = 36)
    private String catalogueId;

    @Column(name = "page_route", nullable = false, length = 255)
    private String pageRoute;

    @Column(name = "audience_id", length = 36)
    private String audienceId;

    @Column(name = "audience_response_id", length = 36)
    private String audienceResponseId;

    @Column(name = "user_id", length = 36)
    private String userId;

    @Column(name = "resource_title", length = 255)
    private String resourceTitle;

    @Column(name = "resource_url", nullable = false, length = 1024)
    private String resourceUrl;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;
}
