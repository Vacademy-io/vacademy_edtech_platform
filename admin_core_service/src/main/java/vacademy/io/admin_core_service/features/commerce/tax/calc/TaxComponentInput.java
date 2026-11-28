package vacademy.io.admin_core_service.features.commerce.tax.calc;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

/** A part of a set that is taxed on its own (a kurta and a dupatta sold at one price). */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class TaxComponentInput {

    private String componentRef;
    private String description;
    /** Share of the line price, in percent. The shares of a line add up to 100. */
    private BigDecimal priceSharePercent;
    private TaxClassRef taxClass;
}
