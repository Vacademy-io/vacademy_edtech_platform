package vacademy.io.admin_core_service.features.user_subscription.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * One member's referral details for the admin student profile: their code, a shareable link
 * for a chosen invite, who they referred and how many rewards they have earned.
 */
@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class MemberReferralDTO {

    /** Why there is no code or link: NOT_A_MEMBER or NO_INVITE. Null when there is one. */
    private String unavailableReason;

    private String referralCode;
    private String shortReferralLink;
    private String referralLink;

    /** The invite the link opens. */
    private String inviteId;
    private String inviteName;
    /** False when that invite has no referral programme, so the code would not be applied. */
    private boolean inviteHasReferralProgram;

    /** Invites the link can be switched to: the ones with a referral programme attached. */
    private List<InviteOption> invites = new ArrayList<>();

    private List<ReferredFriend> referrals = new ArrayList<>();

    /** Referrer discounts: waiting for the friend to pay, ready for the next renewal, used. */
    private int rewardsPending;
    private int rewardsReady;
    private int rewardsUsed;

    @Data
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class InviteOption {
        private String id;
        private String name;

        public InviteOption(String id, String name) {
            this.id = id;
            this.name = name;
        }
    }

    @Data
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ReferredFriend {
        private String userId;
        private String fullName;
        private String email;
        private String mobileNumber;
        /** PENDING until the friend makes their first real payment, then ACTIVE. */
        private String status;
        private LocalDateTime referredAt;
    }
}
