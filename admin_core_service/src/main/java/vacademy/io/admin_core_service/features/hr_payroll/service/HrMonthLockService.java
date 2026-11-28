package vacademy.io.admin_core_service.features.hr_payroll.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.hr_payroll.repository.PayrollRunRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.time.LocalDate;
import java.util.List;

/**
 * Payroll month-lock (Phase C4): once a REGULAR payroll run for a month has
 * moved past DRAFT (PROCESSING/PROCESSED/APPROVED/PAID), that month's
 * attendance and leave records are frozen — bulk marking, regularization
 * approval, leave approval/cancellation touching the month must refuse,
 * otherwise the books silently diverge from what was paid. Rejecting or
 * cancelling the run unlocks the month again.
 */
@Service
public class HrMonthLockService {

    private static final List<String> LOCKING_STATUSES =
            List.of("PROCESSING", "PROCESSED", "APPROVED", "PAID");

    @Autowired
    private PayrollRunRepository payrollRunRepository;

    public boolean isMonthLocked(String instituteId, int month, int year) {
        return payrollRunRepository.existsByInstituteIdAndMonthAndYearAndRunTypeAndStatusIn(
                instituteId, month, year, "REGULAR", LOCKING_STATUSES);
    }

    public boolean isDateLocked(String instituteId, LocalDate date) {
        return isMonthLocked(instituteId, date.getMonthValue(), date.getYear());
    }

    /** Throws a clean error naming the action when the date's month is payroll-locked. */
    public void requireUnlocked(String instituteId, LocalDate date, String action) {
        if (date != null && isDateLocked(instituteId, date)) {
            throw new VacademyException("Cannot " + action + " for " + date.getMonthValue() + "/"
                    + date.getYear() + ": payroll for that month is already processed. "
                    + "Reject the payroll run first if a correction is needed.");
        }
    }
}
