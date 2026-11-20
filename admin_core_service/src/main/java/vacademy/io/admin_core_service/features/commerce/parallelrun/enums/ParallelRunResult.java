package vacademy.io.admin_core_service.features.commerce.parallelrun.enums;

/**
 * Verdict of one parallel-run day ({@code commerce_parallel_run_day.result}, V747): CLEAN when the
 * old system's bill count equals the platform's and each compared money figure is within the
 * tolerance, otherwise DIFFERENT (which needs a note).
 */
public enum ParallelRunResult {
    CLEAN,
    DIFFERENT
}
