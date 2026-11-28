package vacademy.io.admin_core_service.features.fee_management.enums;

/**
 * Gap between installments in an installment schedule.
 *
 * <ul>
 *   <li>{@link #DAYS}: due date k = first due date + k × value days.</li>
 *   <li>{@link #MONTHS}: due date k = first due date + k × value months, always counted from
 *       the first date so the day of month does not drift (31 Jan → 28 Feb → 31 Mar).</li>
 * </ul>
 */
public enum InstallmentIntervalUnit {
    DAYS,
    MONTHS
}
