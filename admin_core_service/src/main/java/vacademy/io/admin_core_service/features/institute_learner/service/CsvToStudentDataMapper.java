package vacademy.io.admin_core_service.features.institute_learner.service;

import org.apache.commons.csv.CSVRecord;
import vacademy.io.admin_core_service.features.institute_learner.dto.InstituteStudentDTO;
import vacademy.io.admin_core_service.features.institute_learner.dto.InstituteStudentDetails;
import vacademy.io.admin_core_service.features.institute_learner.dto.StudentExtraDetails;
import vacademy.io.common.auth.dto.UserDTO;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

public class CsvToStudentDataMapper {

    public static List<InstituteStudentDTO> mapCsvRecordsToInstituteStudentDTOs(Iterable<CSVRecord> records,
                                                                                String instituteId, String packageSessionId) {
        List<InstituteStudentDTO> students = new ArrayList<>();

        for (CSVRecord record : records) {
            UserDTO userDetails = new UserDTO(
                    null,
                    getFieldValue(record, "USERNAME"),
                    getFieldValue(record, "EMAIL"),
                    getFieldValue(record, "FULL_NAME"),
                    getFieldValue(record, "ADDRESS_LINE"),
                    getFieldValue(record, "CITY"),
                    getFieldValue(record, "REGION"),
                    getFieldValue(record, "PIN_CODE"),
                    getFieldValue(record, "MOBILE_NUMBER"),
                    parseDate(getFieldValue(record, "DATE_OF_BIRTH")),
                    getFieldValue(record, "GENDER"),
                    false,
                    "PASSWORD",
                    null,
                    null,
                    null,
                    null,
                    null,
                    null, // preferredLocale (added to UserDTO by i18n Phase 0) — CSV import sets none
                    null, // authorSubtitle (added to UserDTO by Add Authors flow) — CSV import sets none
                    null, // authorDescription (added to UserDTO by Add Authors flow) — CSV import sets none
                    null, // usernameExplicit (username strategy hint) — legacy CSV sets none
                    null, // usernameFieldValues (username strategy hint) — legacy CSV sets none
                    null); // roleLabel (per-course author role, response-only) — CSV import sets none

            StudentExtraDetails studentExtraDetails = new StudentExtraDetails(
                    getFieldValue(record, "FATHER_NAME"),
                    getFieldValue(record, "MOTHER_NAME"),
                    getFieldValue(record, "PARENTS_MOBILE_NUMBER"),
                    getFieldValue(record, "PARENTS_EMAIL"),
                    getFieldValue(record, "PARENTS_TO_MOTHER_MOBILE_NUMBER"),
                    getFieldValue(record, "PARENTS_TO_MOTHER_EMAIL"),
                    getFieldValue(record, "LINKED_INSTITUTE_NAME"),
                    null,
                    null,
                    null);

            InstituteStudentDetails instituteStudentDetails = new InstituteStudentDetails(
                    instituteId,
                    packageSessionId,
                    getFieldValue(record, "ENROLLMENT_NUMBER"),
                    getFieldValue(record, "ENROLLMENT_STATUS"),
                    parseDate(getFieldValue(record, "ENROLLMENT_DATE")),
                    getFieldValue(record, "GROUP_ID"),
                    getFieldValue(record, "ACCESS_DAYS"), null, null, null, null, null);

            InstituteStudentDTO student = new InstituteStudentDTO(userDetails, studentExtraDetails,
                    instituteStudentDetails, null, null, null);
            students.add(student);

        }

        return students;
    }

    private static Date parseDate(String dateStr) {
        if (dateStr == null || dateStr.isEmpty()) {
            return null;
        }

        String[] formats = {
                "dd/MM/yyyy",
                "dd-MM-yyyy",
                "dd.MM.yyyy"
        };

        for (String format : formats) {
            try {
                SimpleDateFormat formatter = new SimpleDateFormat(format);
                formatter.setLenient(false);
                return formatter.parse(dateStr);
            } catch (ParseException ignored) {
            }
        }

        return null;
    }

    private static String getFieldValue(CSVRecord record, String fieldName) {
        return record.isMapped(fieldName) ? record.get(fieldName) : null;
    }

}
