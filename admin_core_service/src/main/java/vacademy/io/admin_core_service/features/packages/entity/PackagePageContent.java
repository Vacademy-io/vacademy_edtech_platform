package vacademy.io.admin_core_service.features.packages.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * Course page content of one package (V579): a JSON object owned by the frontends
 * (FAQs, course mode, ...), served as {@code course.course_page_json} by course-init.
 * Its own table because {@code PackageEntity} is shared through common_service.
 */
@Entity
@Table(name = "package_page_content")
@Getter
@Setter
@NoArgsConstructor
public class PackagePageContent {

    @Id
    @Column(name = "package_id")
    private String packageId;

    @Column(name = "content_json", columnDefinition = "TEXT")
    private String contentJson;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    public PackagePageContent(String packageId, String contentJson) {
        this.packageId = packageId;
        this.contentJson = contentJson;
    }

    @PrePersist
    void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = createdAt;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
