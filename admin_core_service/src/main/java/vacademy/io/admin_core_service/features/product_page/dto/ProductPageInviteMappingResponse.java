package vacademy.io.admin_core_service.features.product_page.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentPlanDTO;

@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ProductPageInviteMappingResponse {

    private String id;

    /** Bridge table PK (package_session_learner_invitation_to_payment_option.id). */
    private String psInvitePaymentOptionId;

    /** Derived from psInvitePaymentOption for convenience. */
    private String enrollInviteId;
    private String packageSessionId;
    private String paymentOptionId;

    private String paymentPlanId;
    private PaymentPlanDTO paymentPlan;

    private boolean preselected;
    private int displayOrder;
    private String status;

    /** Resolved from the linked PackageSession hierarchy for display on the learner catalog. */
    private String packageId;
    private String packageName;
    private String levelName;
    private String sessionName;

    /** Payment option type (ONE_TIME, SUBSCRIPTION, FREE, DONATION, CPO). */
    private String paymentOptionType;

    /**
     * Whether the payment option prices by the viewer's country (regional pricing). Read by
     * RegionalPriceResolver in memory before the response is written; never serialized, so
     * the public product-page JSON is unchanged.
     */
    @com.fasterxml.jackson.annotation.JsonIgnore
    private Boolean regionalPricingEnabled;

    /** Course preview media (file ID) — resolved from the package for card thumbnails. */
    private String coursePreviewImageMediaId;

    /** Short course description (HTML) — resolved from the package for card blurbs. */
    private String aboutTheCourseHtml;

    /**
     * Course tags, comma separated (package.comma_separated_tags). Drives the tag
     * filter on the product page / catalogue offer sections.
     */
    private String tags;
}
