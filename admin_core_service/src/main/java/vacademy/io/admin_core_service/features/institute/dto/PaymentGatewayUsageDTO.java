package vacademy.io.admin_core_service.features.institute.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * How many live invite links depend on one payment gateway. The admin UI shows it in
 * the deactivate confirmation, because deactivating the gateway stops checkout on
 * every paid invite link counted here.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PaymentGatewayUsageDTO {

    private String vendor;

    /** ACTIVE invite links whose enroll_invite.vendor is this gateway. */
    @JsonProperty("active_invites")
    private long activeInvites;

    /** Of those, the links selling at least one non-free plan (their checkout needs the gateway). */
    @JsonProperty("paid_active_invites")
    private long paidActiveInvites;
}
