package vacademy.io.admin_core_service.features.product_page.dto;

import java.util.Date;

/**
 * One package session the public catalogue sells, with the bridge row
 * (invite + session + payment option) and payment plan a store page should
 * sell it on: its open DEFAULT invite's when it has one. Read by the
 * catalogue sync; see ProductPageCatalogueRepository for how the row is
 * chosen.
 *
 * Every column after the session's own may be null: no ACTIVE bridge row, an
 * inactive payment option, or no ACTIVE plan leave their part empty, exactly
 * as they leave the Courses page without a price.
 */
public interface ProductPageCatalogueSessionRow {

    String getPackageSessionId();

    String getPackageId();

    String getPackageName();

    String getLevelName();

    String getSessionName();

    /** Bridge row PK (package_session_learner_invitation_to_payment_option.id); v2 returns it as psli_id. */
    String getPsliId();

    /** The bridge row's invite, whatever its tag or status (v2 only reports DEFAULT invites). */
    String getInviteId();

    String getInviteStatus();

    String getInviteTag();

    Date getInviteStartDate();

    Date getInviteEndDate();

    String getInviteVendor();

    String getInviteCurrency();

    String getPaymentOptionId();

    String getPaymentOptionType();

    String getPaymentPlanId();

    Double getActualPrice();

    String getPlanCurrency();
}
