package vacademy.io.admin_core_service.features.commerce.tax.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** The tax settings of an institute. In an update a null field means "leave unchanged". */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class TaxSettingDTO {

    /** False until the settings have been saved once; the other fields then show the defaults. */
    private Boolean configured;
    private String taxMode;
    private String slabBasis;
    private String slabCompare;
    private String roundTotalTo;
    private String invoiceAt;
    private String sellerGstin;
    private String sellerStateCode;
    private String sellerLegalName;
    private String sellerAddress;
    private Integer fyStartMonth;
}
