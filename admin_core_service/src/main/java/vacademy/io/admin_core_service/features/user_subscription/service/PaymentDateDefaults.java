package vacademy.io.admin_core_service.features.user_subscription.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Date;

/**
 * The payment date stored on a hand-recorded (MANUAL / OFFLINE) payment_log when the admin left the
 * date blank: today in the institute's timezone (Settings, Language, Institute timezone).
 *
 * <p>Typed dates already arrive as a day; only the blank case changes. {@code new Date()} on the UTC server stores the UTC day, which is the previous day for a payment
 * recorded between midnight and 05:30 IST. The money reports count a hand-recorded payment on this
 * date, so it has to be the institute's own day. Gateway payments keep their existing behaviour.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class PaymentDateDefaults {

    private final InstituteTimezoneService instituteTimezoneService;
    private final EnrollInviteRepository enrollInviteRepository;

    /** True for the vendors an admin records by hand. */
    public static boolean isHandRecorded(String vendor) {
        return "MANUAL".equalsIgnoreCase(vendor) || "OFFLINE".equalsIgnoreCase(vendor);
    }

    /** Today in the institute's timezone (Asia/Kolkata when the institute or its zone is unknown). */
    public Date today(String instituteId) {
        LocalDate day = LocalDate.now(instituteId == null || instituteId.isBlank()
                ? InstituteTimezoneService.DEFAULT_ZONE
                : instituteTimezoneService.getZone(instituteId));
        // Midnight in the JVM zone, so the DATE column stores exactly this day. A plain
        // java.util.Date (not java.sql.Date) because callers call toInstant() on it.
        return Date.from(day.atStartOfDay(ZoneId.systemDefault()).toInstant());
    }

    /** Today in the timezone of the institute that owns the plan's enrolment invite. */
    public Date todayForPlan(UserPlan plan) {
        String instituteId = null;
        try {
            if (plan != null && plan.getEnrollInviteId() != null) {
                instituteId = enrollInviteRepository.findById(plan.getEnrollInviteId())
                        .map(invite -> invite.getInstituteId())
                        .orElse(null);
            }
        } catch (Exception e) {
            log.warn("[payment-date] could not resolve institute for plan {}: {}",
                    plan.getId(), e.getMessage());
        }
        return today(instituteId);
    }

    /**
     * The date to store when none was given: the institute's today for a hand-recorded payment,
     * the current instant (as before) for a gateway one.
     */
    public Date defaultFor(String vendor, UserPlan plan) {
        return isHandRecorded(vendor) ? todayForPlan(plan) : new Date();
    }
}
