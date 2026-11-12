package vacademy.io.admin_core_service.features.learner.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Whether the rent checkout must carry the catalogue's once-per-user charge (the refundable
 * security deposit) for the signed-in learner. {@code chargeKey} is the charge's
 * {@code additionalCharges[].key} and {@code amount} its configured price, whether or not it is
 * due; with no such charge configured: {@code due=false, charge_key=null, amount=0}.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class SecurityDepositStatusDTO {
    private boolean due;
    private String chargeKey;
    private double amount;

    public static SecurityDepositStatusDTO notConfigured() {
        return new SecurityDepositStatusDTO(false, null, 0.0);
    }
}
