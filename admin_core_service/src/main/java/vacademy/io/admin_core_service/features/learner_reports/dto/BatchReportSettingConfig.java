package vacademy.io.admin_core_service.features.learner_reports.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/**
 * The institute's batch report template, saved under the BATCH_REPORT_SETTING institute
 * setting (Settings → Batch reports). It picks which sections a generated batch report renders
 * and the quiz average a learner needs to count as passed.
 *
 * Unknown properties are ignored so a newer settings screen can save fields this version does
 * not read yet.
 */
@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class BatchReportSettingConfig {

    public static final String SETTING_KEY = "BATCH_REPORT_SETTING";

    /** Every section, in render order. */
    public static final List<String> ALL_SECTIONS = List.of(
            BatchReportSection.OVERVIEW,
            BatchReportSection.RESULTS,
            BatchReportSection.SUBJECT_PROGRESS,
            BatchReportSection.TOP_PERFORMERS,
            BatchReportSection.NEEDS_ATTENTION,
            BatchReportSection.LEARNER_RESULTS,
            BatchReportSection.ACTIVITY);

    public static final double DEFAULT_PASS_PERCENTAGE = 40.0;

    /** Section keys to render; null or empty means every section. */
    private List<String> sections = new ArrayList<>();

    /** A learner passes when their average quiz score is at least this. */
    private Double passPercentage = DEFAULT_PASS_PERCENTAGE;

    /** Sections to render, in canonical order, with unknown keys dropped. */
    public List<String> resolvedSections() {
        if (sections == null || sections.isEmpty()) return ALL_SECTIONS;
        List<String> out = new ArrayList<>();
        for (String key : ALL_SECTIONS) {
            if (sections.contains(key)) out.add(key);
        }
        return out.isEmpty() ? ALL_SECTIONS : out;
    }

    public double resolvedPassPercentage() {
        return passPercentage == null || passPercentage < 0 || passPercentage > 100
                ? DEFAULT_PASS_PERCENTAGE : passPercentage;
    }

    /** Section keys. Strings rather than an enum so saved settings survive a section being removed. */
    public static final class BatchReportSection {
        public static final String OVERVIEW = "OVERVIEW";
        public static final String RESULTS = "RESULTS";
        public static final String SUBJECT_PROGRESS = "SUBJECT_PROGRESS";
        public static final String TOP_PERFORMERS = "TOP_PERFORMERS";
        public static final String NEEDS_ATTENTION = "NEEDS_ATTENTION";
        public static final String LEARNER_RESULTS = "LEARNER_RESULTS";
        public static final String ACTIVITY = "ACTIVITY";

        /** Sections that name other learners — never part of a copy sent to one parent. */
        public static final List<String> NAMES_LEARNERS =
                List.of(TOP_PERFORMERS, NEEDS_ATTENTION, LEARNER_RESULTS, ACTIVITY);

        private BatchReportSection() {
        }
    }
}
