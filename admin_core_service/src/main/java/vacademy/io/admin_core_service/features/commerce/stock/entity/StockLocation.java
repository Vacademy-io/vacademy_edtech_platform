package vacademy.io.admin_core_service.features.commerce.stock.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCatalogueEntity;

import java.time.LocalDate;

/** A place of the seller: any mix of store, warehouse and source (V681). */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "stock_location")
public class StockLocation extends CommerceCatalogueEntity {

    @Column(name = "code", nullable = false, length = 32)
    private String code;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "address_line1")
    private String addressLine1;

    @Column(name = "address_line2")
    private String addressLine2;

    @Column(name = "city", length = 100)
    private String city;

    @Column(name = "pincode", length = 10)
    private String pincode;

    @Column(name = "state_code", length = 8)
    private String stateCode;

    @Column(name = "gstin", length = 15)
    private String gstin;

    @Column(name = "is_store", nullable = false)
    private boolean store;

    @Column(name = "is_warehouse", nullable = false)
    private boolean warehouse;

    /** A place of the seller's own where goods are made or come from. Never a supplier. */
    @Column(name = "is_source", nullable = false)
    private boolean source;

    @Column(name = "is_temporary", nullable = false)
    private boolean temporary;

    @Column(name = "starts_on")
    private LocalDate startsOn;

    @Column(name = "ends_on")
    private LocalDate endsOn;

    /** Changed only by StockLocationService.setSellsOnline, which keeps the sellable counters in step. */
    @Column(name = "sells_online", nullable = false, updatable = false)
    private boolean sellsOnline;

    @Column(name = "is_pos_enabled", nullable = false)
    private boolean posEnabled;

    @Column(name = "status", nullable = false, length = 32)
    private String status;
}
