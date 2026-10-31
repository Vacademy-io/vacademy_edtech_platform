package vacademy.io.admin_core_service.features.packages.dto;

/**
 * One row of {@code PackageRepository#countActiveLearnersPerCatalogPackage}: a catalogue
 * course and how many distinct learners are actively enrolled in it.
 *
 * <p>Internal only. The count is turned into a rank by {@code CatalogPopularityService} and
 * never leaves the server -- the public popularity endpoint returns ranks, not numbers.
 */
public interface PackagePopularityProjection {

    String getPackageId();

    Long getLearnerCount();
}
