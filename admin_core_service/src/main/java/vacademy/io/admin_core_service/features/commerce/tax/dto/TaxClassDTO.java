package vacademy.io.admin_core_service.features.commerce.tax.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * A tax class in requests and responses. code is fixed after creation. In a request, rules
 * (when present) is the full set of rate rules of the class; absent leaves them as they are.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class TaxClassDTO {

    private String id;
    private String code;
    private String name;
    private String hsnCode;
    private String unit;
    private String status;
    private List<TaxRateRuleDTO> rules;
}
