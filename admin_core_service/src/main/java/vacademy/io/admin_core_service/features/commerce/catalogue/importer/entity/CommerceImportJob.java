package vacademy.io.admin_core_service.features.commerce.catalogue.importer.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCatalogueEntity;

import java.time.LocalDateTime;

/**
 * One commit of an import file (V684). The counters and next_group_index are written after
 * every product, so a job that stops with its pod is taken up again where it stopped.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_import_job")
public class CommerceImportJob extends CommerceCatalogueEntity {

    public static final String KIND_PRODUCTS = "PRODUCTS";

    public static final String QUEUED = "QUEUED";
    public static final String RUNNING = "RUNNING";
    public static final String COMPLETED = "COMPLETED";
    public static final String COMPLETED_WITH_ERRORS = "COMPLETED_WITH_ERRORS";
    public static final String FAILED = "FAILED";

    @Column(name = "kind", nullable = false, updatable = false, length = 32)
    private String kind;

    @Column(name = "status", nullable = false, length = 32)
    private String status;

    @Column(name = "file_name")
    private String fileName;

    @Column(name = "file_format", nullable = false, updatable = false, length = 8)
    private String fileFormat;

    @Column(name = "file_sha256", nullable = false, updatable = false, length = 64)
    private String fileSha256;

    @Column(name = "file_size", nullable = false, updatable = false)
    private Integer fileSize;

    @Column(name = "rows_total", nullable = false)
    private Integer rowsTotal;

    @Column(name = "rows_done", nullable = false)
    private Integer rowsDone;

    @Column(name = "rows_failed", nullable = false)
    private Integer rowsFailed;

    @Column(name = "products_total", nullable = false)
    private Integer productsTotal;

    @Column(name = "products_created", nullable = false)
    private Integer productsCreated;

    @Column(name = "products_updated", nullable = false)
    private Integer productsUpdated;

    @Column(name = "products_failed", nullable = false)
    private Integer productsFailed;

    @Column(name = "variants_created", nullable = false)
    private Integer variantsCreated;

    @Column(name = "variants_updated", nullable = false)
    private Integer variantsUpdated;

    @Column(name = "image_urls_queued", nullable = false)
    private Integer imageUrlsQueued;

    /** Index of the first product of the file that has not been handled yet. */
    @Column(name = "next_group_index", nullable = false)
    private Integer nextGroupIndex;

    /** How many times a worker has taken the job. A worker writes only while this is still its number. */
    @Column(name = "attempt", nullable = false)
    private Integer attempt;

    /** Errors only; exact even when issues_json is capped. */
    @Column(name = "error_count", nullable = false)
    private Integer errorCount;

    /** JSON list of ImportIssue, capped. */
    @Column(name = "issues_json")
    private String issuesJson;

    /** JSON list of the spreadsheet rows that were not written. */
    @Column(name = "failed_rows_json")
    private String failedRowsJson;

    /** JSON list of package ids of products the job created, capped. */
    @Column(name = "created_package_ids_json")
    private String createdPackageIdsJson;

    @Column(name = "failure_message")
    private String failureMessage;

    @Column(name = "created_by_user_id", updatable = false, length = 36)
    private String createdByUserId;

    @Column(name = "started_at")
    private LocalDateTime startedAt;

    @Column(name = "heartbeat_at")
    private LocalDateTime heartbeatAt;

    @Column(name = "finished_at")
    private LocalDateTime finishedAt;

    public boolean isActive() {
        return QUEUED.equals(status) || RUNNING.equals(status);
    }
}
