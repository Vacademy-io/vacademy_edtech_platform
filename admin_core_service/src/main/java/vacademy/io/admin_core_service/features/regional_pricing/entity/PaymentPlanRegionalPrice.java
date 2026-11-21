package vacademy.io.admin_core_service.features.regional_pricing.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

import java.math.BigDecimal;
import java.util.Date;

/**
 * One regional price for a payment plan (V585). {@code countryCode} null means the row
 * applies to every country whose currency is {@link #currency}; a country row wins over it.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "payment_plan_regional_price")
public class PaymentPlanRegionalPrice {
    @Id
    @UuidGenerator
    private String id;

    @Column(name = "payment_plan_id", nullable = false)
    private String paymentPlanId;

    @Column(name = "currency", nullable = false, length = 3)
    private String currency;

    @Column(name = "country_code", length = 2)
    private String countryCode;

    @Column(name = "actual_price", nullable = false)
    private BigDecimal actualPrice;

    @Column(name = "elevated_price")
    private BigDecimal elevatedPrice;

    /** {@link vacademy.io.admin_core_service.features.regional_pricing.enums.RegionalPriceSource} */
    @Column(name = "price_source", nullable = false)
    private String priceSource;

    @Column(name = "base_price_at_compute")
    private BigDecimal basePriceAtCompute;

    @Column(name = "base_currency", length = 3)
    private String baseCurrency;

    @Column(name = "fx_rate_used")
    private BigDecimal fxRateUsed;

    @Column(name = "computed_at")
    private Date computedAt;

    @Column(name = "needs_review", nullable = false)
    private boolean needsReview = false;

    @Column(name = "status", nullable = false)
    private String status = "ACTIVE";

    @Column(name = "created_at", insertable = false, updatable = false)
    private Date createdAt;

    @Column(name = "updated_at")
    private Date updatedAt;
}
