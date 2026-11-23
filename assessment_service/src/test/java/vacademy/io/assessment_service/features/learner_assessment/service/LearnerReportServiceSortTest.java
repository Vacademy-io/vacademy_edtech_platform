package vacademy.io.assessment_service.features.learner_assessment.service;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.StudentReportFilter;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class LearnerReportServiceSortTest {

    private static StudentReportFilter withSort(Map<String, String> sort) {
        StudentReportFilter filter = new StudentReportFilter();
        filter.setSortColumns(sort);
        return filter;
    }

    @Test
    void newestFirstByDefault() {
        assertThat(LearnerReportService.isOldestFirst(null)).isFalse();
        assertThat(LearnerReportService.isOldestFirst(new StudentReportFilter())).isFalse();
        assertThat(LearnerReportService.isOldestFirst(withSort(Map.of()))).isFalse();
        assertThat(LearnerReportService.isOldestFirst(withSort(Map.of("attempt_date", "DESC")))).isFalse();
    }

    @Test
    void oldestFirstWhenAttemptDateIsAscending() {
        assertThat(LearnerReportService.isOldestFirst(withSort(Map.of("attempt_date", "ASC")))).isTrue();
        assertThat(LearnerReportService.isOldestFirst(withSort(Map.of("attempt_date", "asc")))).isTrue();
        assertThat(LearnerReportService.isOldestFirst(withSort(Map.of("attemptDate", "ASC")))).isTrue();
    }

    @Test
    void otherSortKeysKeepTheDefault() {
        assertThat(LearnerReportService.isOldestFirst(withSort(Map.of("name", "ASC")))).isFalse();
    }
}
