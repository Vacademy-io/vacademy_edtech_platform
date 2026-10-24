package vacademy.io.admin_core_service.features.hr_salary.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

import java.time.LocalDateTime;

@AllArgsConstructor
@NoArgsConstructor
@Getter
@Setter
@Entity
@Table(name = "hr_salary_component")
public class SalaryComponent {

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "name", nullable = false, length = 100)
    private String name;

    @Column(name = "code", nullable = false, length = 30)
    private String code;

    @Column(name = "type", nullable = false, length = 30)
    private String type;

    @Column(name = "category", length = 30)
    private String category;

    @Column(name = "is_taxable")
    private Boolean isTaxable;

    @Column(name = "is_statutory")
    private Boolean isStatutory;

    @Column(name = "is_active")
    private Boolean isActive;

    @Column(name = "display_order")
    private Integer displayOrder;

    @Column(name = "description", columnDefinition = "TEXT")
    private String description;

    /** GL account this component posts to (V484); null -> type-based default. */
    @Column(name = "gl_account_code", length = 50)
    private String glAccountCode;

    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", insertable = false)
    private LocalDateTime updatedAt;

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = java.time.LocalDateTime.now();
    }
}
