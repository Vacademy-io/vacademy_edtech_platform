package vacademy.io.admin_core_service.features.capabilities.entity;

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

/** Per-institute module mode (spec §5). No row = LEGACY. Written by platform staff only. */
@Entity
@Table(name = "institute_module_policy")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class InstituteModulePolicy {

    public static final String MODE_LEGACY = "LEGACY";
    public static final String MODE_MANAGED = "MANAGED";

    @Id
    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "mode", nullable = false, length = 16)
    private String mode;

    @Column(name = "updated_by")
    private String updatedBy;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
}
