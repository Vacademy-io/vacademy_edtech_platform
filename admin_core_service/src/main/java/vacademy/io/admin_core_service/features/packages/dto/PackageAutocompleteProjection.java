package vacademy.io.admin_core_service.features.packages.dto;

/**
 * Projection interface for package autocomplete search results
 */
public interface PackageAutocompleteProjection {
    String getPackageSessionId();

    String getPackageId();

    String getPackageName();

    String getLevelId();

    String getLevelName();

    String getSessionId();

    String getSessionName();

    /** package_session.name — the batch's own name, null/blank when it was never named. */
    String getBatchName();
}
