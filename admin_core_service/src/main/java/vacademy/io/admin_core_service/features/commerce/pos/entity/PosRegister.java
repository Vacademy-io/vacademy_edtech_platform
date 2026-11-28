package vacademy.io.admin_core_service.features.commerce.pos.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCatalogueEntity;

/** A billing counter (till) of a location. Never deleted: a register with sessions is history. */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "pos_register")
public class PosRegister extends CommerceCatalogueEntity {

    @Column(name = "location_id", nullable = false, updatable = false, length = 36)
    private String locationId;

    @Column(name = "code", nullable = false, updatable = false, length = 16)
    private String code;

    @Column(name = "name", nullable = false, length = 60)
    private String name;

    @Column(name = "status", nullable = false, length = 16)
    private String status;

    @Column(name = "created_by", updatable = false, length = 36)
    private String createdBy;
}
