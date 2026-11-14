package vacademy.io.admin_core_service.features.invoice.util;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.enroll_invite.repository.PackageSessionLearnerInvitationToPaymentOptionRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * The tags of the course a payment bought ({@code package.comma_separated_tags}, e.g. "Vet Course",
 * "vet nurses"), for the {@code {{invoice_item_tag}}} shown under the item on the invoice and the
 * payment confirmation. Resolved the same way as the invoice's package type:
 * UserPlan -> EnrollInvite -> invite/package-session mapping -> PackageEntity.
 */
@Slf4j
@Component
public class CourseTagResolver {

    @Autowired
    private PackageSessionLearnerInvitationToPaymentOptionRepository packageSessionInvitationRepository;

    /** "Vet Course, vet nurses", or "" when the course has no tags or cannot be resolved. Never throws. */
    public String tagsFor(PaymentLog paymentLog) {
        try {
            if (paymentLog == null || paymentLog.getUserPlan() == null
                    || paymentLog.getUserPlan().getEnrollInvite() == null
                    || paymentLog.getUserPlan().getEnrollInvite().getId() == null) {
                return "";
            }
            var rows = packageSessionInvitationRepository.findByEnrollInviteIdAndStatusWithPackageSession(
                    paymentLog.getUserPlan().getEnrollInvite().getId(), List.of("ACTIVE"));
            Set<String> tags = new LinkedHashSet<>();
            for (var row : rows) {
                if (row.getPackageSession() != null && row.getPackageSession().getPackageEntity() != null) {
                    tags.addAll(split(row.getPackageSession().getPackageEntity().getTags()));
                }
            }
            return String.join(", ", tags);
        } catch (Exception e) {
            log.warn("Could not resolve course tags for payment log {}: {}",
                    paymentLog != null ? paymentLog.getId() : null, e.getMessage());
            return "";
        }
    }

    /** Comma-separated tags, trimmed, blanks and repeats dropped (case-insensitively). */
    public static List<String> split(String commaSeparated) {
        if (commaSeparated == null || commaSeparated.isBlank()) {
            return List.of();
        }
        Set<String> seen = new LinkedHashSet<>();
        List<String> out = new java.util.ArrayList<>();
        for (String raw : commaSeparated.split(",")) {
            String tag = raw.trim();
            if (!tag.isEmpty() && seen.add(tag.toLowerCase(java.util.Locale.ENGLISH))) {
                out.add(tag);
            }
        }
        return out;
    }
}
