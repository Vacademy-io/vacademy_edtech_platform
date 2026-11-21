package vacademy.io.admin_core_service.features.commerce.shipment.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCatalogueEntity;

/** The units of one order line in a shipment (V688). The SALE movements of a ship name this row. */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_shipment_line")
public class CommerceShipmentLine extends CommerceCatalogueEntity {

    @Column(name = "shipment_id", nullable = false, updatable = false, length = 36)
    private String shipmentId;

    @Column(name = "order_line_id", nullable = false, updatable = false, length = 36)
    private String orderLineId;

    @Column(name = "quantity", nullable = false)
    private Integer quantity;
}
