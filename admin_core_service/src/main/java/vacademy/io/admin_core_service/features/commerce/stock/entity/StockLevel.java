package vacademy.io.admin_core_service.features.commerce.stock.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCatalogueEntity;

/**
 * Physical quantity of one variant at one location (V681). Read-only for JPA: every change is a
 * conditional UPDATE in StockLedgerService, never an entity save.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "stock_level")
public class StockLevel extends CommerceCatalogueEntity {

    @Column(name = "location_id", nullable = false, updatable = false, length = 36)
    private String locationId;

    @Column(name = "package_session_id", nullable = false, updatable = false)
    private String packageSessionId;

    @Column(name = "on_hand", nullable = false, insertable = false, updatable = false)
    private Integer onHand;

    @Column(name = "reorder_level", insertable = false, updatable = false)
    private Integer reorderLevel;
}
