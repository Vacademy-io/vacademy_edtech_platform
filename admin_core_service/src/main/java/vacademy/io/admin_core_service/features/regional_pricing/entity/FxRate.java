package vacademy.io.admin_core_service.features.regional_pricing.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.util.Date;

/** Daily exchange rate quoted against USD: units of {@link #currency} per 1 USD. */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "fx_rate")
public class FxRate {
    @Id
    @Column(name = "currency", length = 3)
    private String currency;

    @Column(name = "units_per_usd", nullable = false)
    private BigDecimal unitsPerUsd;

    @Column(name = "source")
    private String source;

    @Column(name = "fetched_at", nullable = false)
    private Date fetchedAt;
}
