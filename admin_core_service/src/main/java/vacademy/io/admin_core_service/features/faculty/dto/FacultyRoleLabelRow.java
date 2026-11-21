package vacademy.io.admin_core_service.features.faculty.dto;

/**
 * One author's display role in one course, read from faculty mapping rows.
 */
public interface FacultyRoleLabelRow {
    String getPackageId();

    String getUserId();

    String getRoleLabel();
}
