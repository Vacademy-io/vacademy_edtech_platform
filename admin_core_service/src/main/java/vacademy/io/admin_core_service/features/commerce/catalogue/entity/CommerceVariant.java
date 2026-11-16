package vacademy.io.admin_core_service.features.commerce.catalogue.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;

/** Extension row of a variant; the variant id used everywhere is the package session id. */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_variant")
public class CommerceVariant extends CommerceCatalogueEntity {

    @Column(name = "package_session_id", nullable = false, updatable = false)
    private String packageSessionId;

    @Column(name = "package_id", nullable = false, updatable = false)
    private String packageId;

    @Column(name = "sku", nullable = false, length = 100)
    private String sku;

    @Column(name = "barcode", length = 100)
    private String barcode;

    @Column(name = "label_code", length = 32)
    private String labelCode;

    @Column(name = "stock_policy", nullable = false, length = 32)
    private String stockPolicy;

    @Column(name = "lead_time_days")
    private Integer leadTimeDays;

    @Column(name = "weight_grams")
    private Integer weightGrams;

    @Column(name = "length_mm")
    private Integer lengthMm;

    @Column(name = "width_mm")
    private Integer widthMm;

    @Column(name = "height_mm")
    private Integer heightMm;

    /** Weighted average cost; after the insert it is written only by StockLedgerService (native SQL). */
    @Column(name = "cost_price", precision = 14, scale = 4, updatable = false)
    private BigDecimal costPrice;

    /** Cost a manager or the accountant sets by hand; nullable. */
    @Column(name = "standard_cost", precision = 14, scale = 4, updatable = false)
    private BigDecimal standardCost;

    @Column(name = "media_id")
    private String mediaId;

    @Column(name = "position", nullable = false)
    private Integer position;

    @Column(name = "status", nullable = false, length = 32)
    private String status;

    @Column(name = "external_ref")
    private String externalRef;
}
