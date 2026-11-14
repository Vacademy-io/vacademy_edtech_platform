package vacademy.io.admin_core_service.features.notification.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.institute.entity.PackageEntity;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class NotificationTemplateVariables {

        // User details
        private String userId;
        private String userName;
        private String userEmail;
        private String userMobile;
        private String userFullName;

        // Package details
        private String packageName;
        private String packageId;
        private String courseDescription;
        private String courseThumbnail;

        // Institute details
        private String instituteName;
        private String instituteId;

        // Payment details
        private String paymentType;
        private String paymentAmount;
        private String paymentStatus;
        private String paymentLink;

        // Enroll invite details
        private String enrollInviteCode;
        private String enrollInviteExpiryDate;

        // Additional context
        private String packageSessionId;
        private String levelName;
        private String sessionName;

        // Learner invitation response link
        private String learnerInvitationResponseLink;

        // Referral template variables
        private String name; // User's name for greeting
        private String referralLink; // The referral link (same as learnerInvitationResponseLink)
        private String shortReferralLink; // The short URL for referral link
        private String refCode;
        private String inviteCode; // The invite code
        private String themeColor; // Theme color from institute

        // Audience campaign details
        private String campaignName; // Campaign name for audience forms
        private java.util.Map<String, String> customFields; // Dynamic custom field key-value pairs
        private String submissionTime; // Submission timestamp with timezone

        // Family details
        private String parentName;
        private String childName;
        private String applicantId;

        // Application submission details
        private String userPassword; // User's password for portal access
        private String portalUrl; // Portal login URL
        private String trackingId; // Application tracking ID

        // Password-reset notification. The link already carries the learner's username as a
        // query parameter, so a template only needs {{reset_password_link}} to produce a
        // working "set a new password" button. resetPasswordLinkTemplate is the same URL with
        // a literal {username} left in place — it is what an admin copies when handing the
        // flow to a third-party system that will substitute its own usernames.
        private String resetPasswordLink;
        private String resetPasswordLinkTemplate;

        // Guardian account-created notification
        private String guardianName;
        private String guardianUsername;
        private String guardianEmail;
        private String guardianPassword;
        private String studentName;
        private String studentEmail;

        // Payment confirmation / receipt notification.
        // Declared here rather than assembled ad-hoc in the sender so the reflection-based
        // mapping in SendUniqueLinkService emits both {{camelCase}} and {{snake_case}} keys, and
        // so a template's own dynamic_parameters can override any of them.
        private String learnerName;
        private String courseName;
        private String amount;
        /**
         * What the order cost BEFORE any basket price, offer or coupon — i.e. the
         * courses at list price. Blank on an order with nothing taken off.
         */
        private String orderTotal;
        /** What was taken off. Blank when nothing was. */
        private String discountAmount;
        /** How many courses this one payment bought. Blank for a single course. */
        private String itemCount;
        /**
         * Pre-rendered receipt rows for the breakdown above "Amount Paid", so a
         * template can show "Subtotal / Discount / You pay" without needing
         * conditionals the placeholder substitution does not have. Blank when
         * there is nothing to break down, which collapses to today's single row.
         */
        private String amountBreakdownHtml;
        private String currency;
        private String currencySymbol;
        private String paymentDate;
        private String paymentMode;
        private String transactionId;
        private String invoiceNumber;
        private String receiptUrl;
        private String invoicePdfLink;
        private String instituteAddress;
        private String instituteContact;
        private String instituteEmail;
        private String instituteWebsite;
        private String instituteLogoUrl;
        private String instituteLogo; // ready-to-drop <img> tag
        // Ready-to-drop HTML block, empty when the gateway returned no receipt URL. Follows the
        // same convention as instituteLogo / the invoice template's line_items: a template cannot
        // express "render this row only if the value exists", so the sender emits the whole block.
        private String receiptButton;
        private String currentDate;
        private String year;

        // Channel-partner (sub-org) onboarding — SUB_ORG_PARTNER_WELCOME. The organisation is
        // the party being welcomed; userName/userPassword/portalUrl above carry the admin's
        // sign-in. certificateNote is a ready-to-drop HTML block (empty when no certificate was
        // issued), same convention as receiptButton.
        private String organisationName;
        private String organisationAddress;
        private String certificateNumber;
        private String certificateIssueDate;
        private String certificateValidTill;
        private String certificateNote;

        /**
         * Factory method to create variables from entities
         */
        public static NotificationTemplateVariables fromEntities(
                        UserDTO user,
                        PackageEntity packageEntity,
                        Institute institute,
                        PaymentOption paymentOption,
                        EnrollInvite enrollInvite,
                        String packageSessionId,
                        String levelName,
                        String sessionName) {

                return NotificationTemplateVariables.builder()
                                // User details
                                .userId(user.getId())
                                .userName(user.getUsername())
                                .userEmail(user.getEmail())
                                .userMobile(user.getMobileNumber())
                                .userFullName(user.getFullName())

                                // Package details
                                .packageName(packageEntity.getPackageName())
                                .packageId(packageEntity.getId())
                                .courseDescription(packageEntity.getCourseHtmlDescription())
                                .courseThumbnail(packageEntity.getThumbnailFileId())

                                // Institute details
                                .instituteName(institute.getInstituteName())
                                .instituteId(institute.getId())

                                .paymentType(paymentOption != null ? paymentOption.getType() : "ENROLLMENT")
                                .paymentAmount("0") // PaymentOption doesn't have amount field, get from PaymentPlan if
                                                    // needed
                                .paymentStatus("PENDING") // Default status

                                // Enroll invite details
                                .enrollInviteCode(enrollInvite != null ? enrollInvite.getInviteCode() : "")
                                .enrollInviteExpiryDate(enrollInvite != null && enrollInvite.getEndDate() != null
                                                ? enrollInvite.getEndDate().toString()
                                                : "")

                                // Additional context
                                .packageSessionId(packageSessionId)
                                .levelName(levelName)
                                .sessionName(sessionName)

                                // Learner invitation response link (will be set separately)
                                .learnerInvitationResponseLink("")

                                // Referral template variables (will be set separately)
                                .name("")
                                .referralLink("")
                                .shortReferralLink("")
                                .inviteCode("")
                                .themeColor("#FF9800") // Default orange color
                                .build();
        }
}
