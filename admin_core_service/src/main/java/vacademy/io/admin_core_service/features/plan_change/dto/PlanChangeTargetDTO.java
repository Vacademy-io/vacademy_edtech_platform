package vacademy.io.admin_core_service.features.plan_change.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Builder;
import lombok.Data;

import java.util.Date;

/**
 * One plan the learner may switch to, already priced for THIS learner at THIS moment.
 *
 * <p>Everything the UI needs to render a decision without a second round trip: what the
 * plan is, what it costs today after proration, when it takes effect, and whether taking it
 * will require re-authorising auto-pay.
 *
 * <p>Serialized snake_case to match the learner app's other payment endpoints.
 */
@Data
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class PlanChangeTargetDTO {

    private String planId;
    private String planName;
    private String paymentOptionId;
    private String optionName;
    private String optionType;
    /** The invite this option is reachable through — becomes the plan's invite if chosen. */
    private String enrollInviteId;

    private Double price;
    private String currency;
    private Integer validityInDays;
    private String featureJson;
    private String description;

    /** UPGRADE | DOWNGRADE | LATERAL */
    private String direction;
    /** IMMEDIATE | END_OF_CYCLE */
    private String effectiveType;

    /** Unused value of the current plan, credited against the new plan's price. */
    private Double prorationCredit;
    /** What the learner pays right now. 0 for a scheduled downgrade. */
    private Double amountDueNow;

    /**
     * True when the learner's current plan was traded in, i.e. amountDueNow is the price
     * DIFFERENCE and the window is extended by the validity difference. False for a trial
     * or a lapsed plan: the target is bought outright at full price for its full validity.
     * The dialog uses this to say which of the two is being quoted.
     */
    private boolean tradeInApplied;

    /** Days this change adds to the access window. */
    private Integer extensionDays;
    /** When the learner would actually be on this plan. */
    private Date effectiveFrom;

    /**
     * True when picking this target invalidates the existing auto-pay mandate — either the
     * price exceeds the mandate's max_amount (every future recurring charge would be
     * rejected) or the target's invite uses a different gateway. The UI must force the
     * mandate-mode checkout in that case rather than silently leaving autopay broken.
     */
    private boolean requiresMandateReauth;

    /** True when this also moves the learner to a different payment option + enroll invite. */
    private boolean crossOption;
}
