package vacademy.io.admin_core_service.features.learner.dto.v2;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;
import vacademy.io.common.common.dto.CustomFieldValueDTO;
import java.util.List;
import vacademy.io.common.auth.dto.learner.ReferRequestDTO;

@Data
public class LearnerPackageSessionEnrollmentItemDTO {
    @JsonProperty("package_session_id")
    private String packageSessionId;

    @JsonProperty("plan_id")
    private String planId;

    @JsonProperty("payment_option_id")
    private String paymentOptionId;

    @JsonProperty("enroll_invite_id")
    private String enrollInviteId;

    @JsonProperty("custom_field_values")
    private List<CustomFieldValueDTO> customFieldValues;

    @JsonProperty("refer_request")
    private ReferRequestDTO referRequest;

    /**
     * Copies of this item. Null means 1. Above 1 only for one-time items that are not a
     * charge (shipping / deposit); see MultiPackageLearnerEnrollService.
     */
    @JsonProperty("requested_quantity")
    private Integer requestedQuantity;

    /**
     * Rent (membership) line only: the books the learner picked, as rent-level package session
     * ids. Same meaning as on the v1 rent request: they are not enrolled by this order; the order
     * holds 1 of each (RENT_PREFERENCE) until an admin assigns them. Null for every other line.
     */
    @JsonProperty("requested_book_package_session_ids")
    private List<String> requestedBookPackageSessionIds;
}
