package vacademy.io.admin_core_service.features.learner_reports.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/**
 * The institute's batch report template, saved under the BATCH_REPORT_SETTING institute
 * setting (Settings → Batch reports). It picks which sections a generated batch report renders.
 *
 * Unknown properties are ignored, so older saved settings (which also carried a pass mark) and
 * newer screens both load.
 */
@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class BatchReportSettingConfig {

    public static final String SETTING_KEY = "BATCH_REPORT_SETTING";

    /** Every section, in render order. */
    public static final List<String> ALL_SECTIONS = List.of(
            BatchReportSection.OVERVIEW,
            BatchReportSection.TIMELINE,
            BatchReportSection.RESULTS,
            BatchReportSection.ASSESSMENTS,
            BatchReportSection.STRENGTHS,
            BatchReportSection.SUBJECT_PROGRESS,
            BatchReportSection.TOP_PERFORMERS,
            BatchReportSection.NEEDS_ATTENTION,
            BatchReportSection.LEARNER_RESULTS,
            BatchReportSection.ACTIVITY,
            BatchReportSection.POINTS_BADGES);

    /** Section keys to render; null or empty means every section. */
    private List<String> sections = new ArrayList<>();

    /** Sections to render, in canonical order, with unknown keys dropped. */
    public List<String> resolvedSections() {
        if (sections == null || sections.isEmpty()) return ALL_SECTIONS;
        List<String> out = new ArrayList<>();
        for (String key : ALL_SECTIONS) {
            if (sections.contains(key)) out.add(key);
        }
        return out.isEmpty() ? ALL_SECTIONS : out;
    }

    /** Section keys. Strings rather than an enum so saved settings survive a section being removed. */
    public static final class BatchReportSection {
        public static final String OVERVIEW = "OVERVIEW";
        /** Score bands: learners at 60% and above, 40 to 60%, under 40%, not assessed. */
        public static final String RESULTS = "RESULTS";
        /** Average score per assessment over time, and per subject. */
        public static final String ASSESSMENTS = "ASSESSMENTS";
        /** Topic strengths and weaknesses rolled up across the batch. */
        public static final String STRENGTHS = "STRENGTHS";
        public static final String SUBJECT_PROGRESS = "SUBJECT_PROGRESS";
        public static final String TOP_PERFORMERS = "TOP_PERFORMERS";
        public static final String NEEDS_ATTENTION = "NEEDS_ATTENTION";
        public static final String LEARNER_RESULTS = "LEARNER_RESULTS";
        public static final String ACTIVITY = "ACTIVITY";
        /** Learners, time, scores, attendance, points and badges for each day, week or month. */
        public static final String TIMELINE = "TIMELINE";
        /** Points earned, badges awarded and the top earners. */
        public static final String POINTS_BADGES = "POINTS_BADGES";

        /** Sections that name other learners — never part of a copy sent to one parent. */
        public static final List<String> NAMES_LEARNERS =
                List.of(TOP_PERFORMERS, NEEDS_ATTENTION, LEARNER_RESULTS, ACTIVITY, POINTS_BADGES);

        private BatchReportSection() {
        }
    }
}
