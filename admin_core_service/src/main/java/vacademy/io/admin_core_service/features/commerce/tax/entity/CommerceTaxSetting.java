package vacademy.io.admin_core_service.features.commerce.tax.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCatalogueEntity;

/**
 * The tax settings of one institute: tax mode, the calculator settings and the seller details
 * used when a location has none. One row per institute; no row means tax is not set up.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_tax_setting")
public class CommerceTaxSetting extends CommerceCatalogueEntity {

    @Column(name = "tax_mode", nullable = false, length = 32)
    private String taxMode;

    @Column(name = "slab_basis", nullable = false, length = 32)
    private String slabBasis;

    @Column(name = "slab_compare", nullable = false, length = 32)
    private String slabCompare;

    @Column(name = "round_total_to", nullable = false, length = 32)
    private String roundTotalTo;

    @Column(name = "invoice_at", nullable = false, length = 32)
    private String invoiceAt;

    @Column(name = "seller_gstin", length = 15)
    private String sellerGstin;

    @Column(name = "seller_state_code", length = 8)
    private String sellerStateCode;

    @Column(name = "seller_legal_name", length = 255)
    private String sellerLegalName;

    @Column(name = "seller_address", columnDefinition = "TEXT")
    private String sellerAddress;

    @Column(name = "fy_start_month", nullable = false)
    private Integer fyStartMonth;
}
