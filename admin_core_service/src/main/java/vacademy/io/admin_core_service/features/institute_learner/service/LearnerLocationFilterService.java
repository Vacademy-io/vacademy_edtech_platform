package vacademy.io.admin_core_service.features.institute_learner.service;

import org.springframework.stereotype.Service;
import org.springframework.util.CollectionUtils;
import vacademy.io.admin_core_service.features.common.service.CustomFieldListFilterResolver.Resolution;
import vacademy.io.admin_core_service.features.institute_learner.dto.student_list_dto.LearnerLocationFilterOptionsDTO;
import vacademy.io.admin_core_service.features.institute_learner.dto.student_list_dto.StudentListFilter;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;

/**
 * City and region (state) filters on the learner list, plus the values offered for them.
 * <p>
 * Values are matched on student.city / student.region ignoring case and surrounding spaces,
 * because they are typed free-hand (CSV import, forms, profile edits).
 */
@Service
public class LearnerLocationFilterService {

    private final InstituteStudentRepository instituteStudentRepository;

    public LearnerLocationFilterService(InstituteStudentRepository instituteStudentRepository) {
        this.instituteStudentRepository = instituteStudentRepository;
    }

    /**
     * Trims, lower-cases and de-duplicates the filter's cities and regions in place. A side
     * left with no value becomes null, which every list query reads as "no filter".
     */
    public static void normalizeFilter(StudentListFilter filter) {
        if (filter == null) {
            return;
        }
        filter.setCities(normalize(filter.getCities()));
        filter.setRegions(normalize(filter.getRegions()));
    }

    static List<String> normalize(List<String> values) {
        if (values == null || values.isEmpty()) {
            return null;
        }
        LinkedHashSet<String> out = new LinkedHashSet<>();
        for (String value : values) {
            if (value == null) {
                continue;
            }
            String clean = value.trim().toLowerCase(Locale.ROOT);
            if (!clean.isEmpty()) {
                out.add(clean);
            }
        }
        return out.isEmpty() ? null : new ArrayList<>(out);
    }

    /** True when a normalized filter asks for a city or a region. */
    public static boolean hasFilter(StudentListFilter filter) {
        return filter != null
                && (!CollectionUtils.isEmpty(filter.getCities()) || !CollectionUtils.isEmpty(filter.getRegions()));
    }

    /**
     * The institute's learners that match the (normalized) city and region filter, as a
     * matched-id resolution to AND with the custom-field and UTM ones. Null when the filter
     * asks for no city or region. With no institute to scope to, it matches nobody rather
     * than searching every institute.
     */
    public Resolution resolve(StudentListFilter filter) {
        if (!hasFilter(filter)) {
            return null;
        }
        if (CollectionUtils.isEmpty(filter.getInstituteIds())) {
            return new Resolution(new HashSet<>(), null);
        }
        List<String> userIds = instituteStudentRepository.findInstituteUserIdsByCityAndRegion(
                filter.getInstituteIds(), filter.getCities(), filter.getRegions());
        return new Resolution(new HashSet<>(userIds), null);
    }

    /** The cities and regions the institute's learners have, most common first. */
    public LearnerLocationFilterOptionsDTO getOptions(String instituteId) {
        return LearnerLocationFilterOptionsDTO.builder()
                .cities(toOptions(instituteStudentRepository.findCityFilterOptions(instituteId)))
                .regions(toOptions(instituteStudentRepository.findRegionFilterOptions(instituteId)))
                .build();
    }

    private static List<LearnerLocationFilterOptionsDTO.Option> toOptions(List<Object[]> rows) {
        List<LearnerLocationFilterOptionsDTO.Option> options = new ArrayList<>();
        if (rows == null) {
            return options;
        }
        for (Object[] row : rows) {
            if (row == null || row.length < 2 || row[0] == null) {
                continue;
            }
            String value = row[0].toString().trim();
            if (value.isEmpty()) {
                continue;
            }
            long count = row[1] instanceof Number number ? number.longValue() : 0L;
            options.add(new LearnerLocationFilterOptionsDTO.Option(value, count));
        }
        return options;
    }
}
