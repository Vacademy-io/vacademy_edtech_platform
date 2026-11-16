package vacademy.io.admin_core_service.features.commerce.tax.calc;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/** A tax class with its rules, as the calculator needs it. No database access happens in the calculator. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class TaxClassRef {

    private String id;
    private String code;
    private String hsnCode;
    /** The unit a slab limit is quoted in (PCS, MTR). */
    private String unit;
    private List<TaxRateRule> rules;
}
