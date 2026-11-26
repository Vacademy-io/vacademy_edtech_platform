package vacademy.io.assessment_service.features.assessment.copy;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.support.JdbcUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.assessment_service.features.assessment.enums.AssessmentStatus;
import vacademy.io.assessment_service.features.assessment.enums.UserRegistrationSources;
import vacademy.io.assessment_service.features.question_library.service.QuestionLibraryCopyService;
import vacademy.io.common.core.utils.DateUtil;
import vacademy.io.common.core.utils.RandomGenerator;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.ResultSetMetaData;
import java.sql.Timestamp;
import java.sql.Types;
import java.util.*;
import java.util.function.Consumer;

/**
 * Duplicates an assessment as a new DRAFT of the same institute.
 *
 * <p>Every row is copied column by column straight from the database ({@code SELECT *}),
 * so a column added by a later migration is carried over without touching this class.
 * Each copied row gets a new id and every reference inside the copy points at the copy:
 * questions, options and rich text (question text, explanations, instructions) are new
 * rows, never shared with the original, so editing the copy can never change the
 * original paper (or the question paper the original was built from).
 *
 * <p>Never copied: anything a learner produced (registrations through a link or a batch,
 * attempts, marks, reattempt requests, AI evaluation, copy checks, OMR scans), the
 * question paper / question bank links, and the partner API binding. The copy gets its
 * own join code and is a DRAFT, so no learner sees it until the admin publishes it.
 */
@Slf4j
@Service
public class AssessmentCopyService {

    private static final String ACTIVE = "ACTIVE";
    private static final String DELETED = "DELETED";
    private static final int IN_CHUNK = 1000;
    private static final Set<String> TIMESTAMP_COLUMNS = Set.of("created_at", "updated_at", "created_on", "updated_on");

    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate named;

    public AssessmentCopyService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
        this.named = new NamedParameterJdbcTemplate(jdbc);
    }

    @Transactional
    public AssessmentCopyResponse copy(String sourceAssessmentId, String instituteId, AssessmentCopyRequest request) {
        if (!StringUtils.hasText(sourceAssessmentId) || !StringUtils.hasText(instituteId)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "assessmentId and instituteId are required");
        }
        AssessmentCopyRequest options = request == null ? new AssessmentCopyRequest() : request;
        boolean copyQuestions = !Boolean.FALSE.equals(options.getCopyQuestions());
        boolean copyMarking = !Boolean.FALSE.equals(options.getCopyMarking());
        Timestamp now = new Timestamp(System.currentTimeMillis());

        Rows assessmentRows = select("""
                SELECT a.* FROM assessment a
                WHERE a.id = :id AND EXISTS (SELECT 1 FROM assessment_institute_mapping aim
                                             WHERE aim.assessment_id = a.id AND aim.institute_id = :institute)
                """, Map.of("id", sourceAssessmentId, "institute", instituteId));
        if (assessmentRows.isEmpty() || DELETED.equals(assessmentRows.rows.get(0).get("status"))) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "Assessment not found");
        }
        Map<String, Object> source = assessmentRows.rows.get(0);
        Rows mappingRows = select("""
                SELECT * FROM assessment_institute_mapping
                WHERE assessment_id = :id AND institute_id = :institute
                ORDER BY created_at NULLS LAST LIMIT 1
                """, Map.of("id", sourceAssessmentId, "institute", instituteId));

        // ---- what is copied ------------------------------------------------------------
        Rows sections = copyQuestions
                ? select("SELECT * FROM section WHERE assessment_id = :id AND status = 'ACTIVE' ORDER BY section_order",
                        Map.of("id", sourceAssessmentId))
                : Rows.EMPTY;
        Rows questionMappings = selectIn(
                "SELECT * FROM question_assessment_section_mapping WHERE section_id IN (:ids) AND status = 'ACTIVE'",
                sections.ids());
        Set<String> questionIds = new LinkedHashSet<>();
        questionMappings.rows.forEach(r -> questionIds.add((String) r.get("question_id")));
        Rows questions = selectIn("SELECT * FROM question WHERE id IN (:ids)", questionIds);
        Rows questionOptions = selectIn("SELECT * FROM \"option\" WHERE question_id IN (:ids)", questions.ids());
        Rows subQuestions = selectIn("SELECT * FROM sub_question WHERE question_id IN (:ids)", questions.ids());

        Set<String> richTextIds = new LinkedHashSet<>();
        collect(richTextIds, assessmentRows, "about_id", "instructions_id", "registration_instructions_id");
        collect(richTextIds, sections, "description_id");
        collect(richTextIds, questions, "text_id", "explanation_text_id", "parent_rich_text_id");
        collect(richTextIds, questionOptions, "text_id", "explanation_text_id");
        collect(richTextIds, subQuestions, "text_id", "explanation_text_id");
        Rows richTexts = selectIn("SELECT * FROM assessment_rich_text_data WHERE id IN (:ids)", richTextIds);

        // ---- old id -> new id ----------------------------------------------------------
        String newAssessmentId = UUID.randomUUID().toString();
        Map<String, String> ids = new HashMap<>();
        ids.put(sourceAssessmentId, newAssessmentId);
        for (Rows rows : List.of(sections, questions, questionOptions, subQuestions, richTexts)) {
            rows.ids().forEach(id -> ids.put(id, UUID.randomUUID().toString()));
        }
        CopyIdRemapper remap = new CopyIdRemapper(ids);

        // ---- the assessment ------------------------------------------------------------
        String name = StringUtils.hasText(options.getName())
                ? options.getName().trim()
                : "Copy of " + source.get("name");
        Timestamp start = dateOrKeep(options.getStartDate(), source.get("bound_start_time"), "start date");
        Timestamp end = dateOrKeep(options.getEndDate(), source.get("bound_end_time"), "end date");
        if (start != null && end != null && !end.after(start)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "The end date must be after the start date");
        }
        Timestamp registrationOpen = dateOrKeep(options.getRegistrationOpenDate(), source.get("registration_open_date"), "registration open date");
        Timestamp registrationClose = dateOrKeep(options.getRegistrationCloseDate(), source.get("registration_close_date"), "registration close date");
        if (registrationOpen != null && registrationClose != null && !registrationClose.after(registrationOpen)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Registration must close after it opens");
        }

        // Rich text before anything that points at it.
        insert("assessment_rich_text_data", richTexts, row -> row.put("id", remap.id((String) row.get("id"))), now);
        insert("assessment", assessmentRows, row -> {
            row.put("id", newAssessmentId);
            row.put("name", name);
            row.put("status", AssessmentStatus.DRAFT.name());
            remapColumns(row, remap, "about_id", "instructions_id", "registration_instructions_id");
            row.put("bound_start_time", start);
            row.put("bound_end_time", end);
            row.put("registration_open_date", registrationOpen);
            row.put("registration_close_date", registrationClose);
            // A copy is a dashboard assessment: never an API exam bound to a partner key.
            row.put("source", null);
            row.put("source_id", null);
            // The OMR lock records the original's first scan; the copy has none, so its sets stay editable.
            if (row.get("omr_config") != null) {
                row.put("omr_config", CopyIdRemapper.withoutKey(row.get("omr_config").toString(), "locked_at"));
            }
        }, now);

        String joinCode = newJoinCode();
        if (!mappingRows.isEmpty()) {
            insert("assessment_institute_mapping", mappingRows, row -> {
                row.put("id", UUID.randomUUID().toString());
                row.put("assessment_id", newAssessmentId);
                row.put("assessment_url", joinCode);
            }, now);
        } else {
            jdbc.update("INSERT INTO assessment_institute_mapping (id, assessment_id, institute_id, assessment_url, subject_id) VALUES (?, ?, ?, ?, 'N/A')",
                    UUID.randomUUID().toString(), newAssessmentId, instituteId, joinCode);
        }

        // ---- paper ---------------------------------------------------------------------
        Map<String, Integer> questionsPerSection = new HashMap<>();
        questionMappings.rows.forEach(r -> questionsPerSection.merge((String) r.get("section_id"), 1, Integer::sum));
        insert("section", sections, row -> {
            String oldId = (String) row.get("id");
            row.put("id", remap.id(oldId));
            row.put("assessment_id", newAssessmentId);
            remapColumns(row, remap, "description_id");
            if (!copyMarking) {
                int count = questionsPerSection.getOrDefault(oldId, 0);
                if (row.containsKey("total_marks")) row.put("total_marks", (float) count);
                if (row.get("marks_per_question") != null) row.put("marks_per_question", 1f);
                if (row.get("cut_off_marks") != null) row.put("cut_off_marks", 0f);
            }
        }, now);
        insert("question", questions, row -> {
            row.put("id", remap.id((String) row.get("id")));
            remapColumns(row, remap, "text_id", "explanation_text_id", "parent_rich_text_id");
            remapJsonColumns(row, remap, "auto_evaluation_json", "options_json", "evaluation_criteria_json");
            // The question bank and the Content Library list every question carrying the
            // institute's id, so a copy that kept it would show up there a second time. The
            // copy belongs to the new test only. A Question Library pick keeps its id: its
            // edit flow checks it, and LIBRARY_COPY already keeps it out of those lists.
            if (!QuestionLibraryCopyService.SOURCE_TYPE.equals(row.get("source_type"))) {
                row.put("institute_id", null);
            }
        }, now);
        insert("option", questionOptions, row -> {
            row.put("id", remap.id((String) row.get("id")));
            remapColumns(row, remap, "question_id", "text_id", "explanation_text_id");
        }, now);
        insert("sub_question", subQuestions, row -> {
            row.put("id", remap.id((String) row.get("id")));
            remapColumns(row, remap, "question_id", "text_id", "explanation_text_id");
        }, now);
        insert("question_assessment_section_mapping", questionMappings, row -> {
            row.put("id", UUID.randomUUID().toString());
            remapColumns(row, remap, "question_id", "section_id");
            if (!copyMarking) row.put("marking_json", CopyIdRemapper.defaultMarking((String) row.get("marking_json")));
        }, now);
        copyQuestionCompanions(questions.ids(), remap, now);
        if (copyQuestions) {
            insert("assessment_choice_group",
                    select("SELECT * FROM assessment_choice_group WHERE assessment_id = :id", Map.of("id", sourceAssessmentId)),
                    row -> {
                        row.put("id", UUID.randomUUID().toString());
                        row.put("assessment_id", newAssessmentId);
                        remapJsonColumns(row, remap, "question_ids");
                    }, now);
            insert("assessment_set_mapping",
                    select("SELECT * FROM assessment_set_mapping WHERE assessment_id = :id AND status IS DISTINCT FROM 'DELETED'",
                            Map.of("id", sourceAssessmentId)),
                    row -> {
                        row.put("id", UUID.randomUUID().toString());
                        row.put("assessment_id", newAssessmentId);
                        remapJsonColumns(row, remap, "json");
                    }, now);
        }

        // ---- settings that hang off the assessment --------------------------------------
        copyAssessmentRows("assessment_custom_fields", "status IS DISTINCT FROM 'DELETED'", sourceAssessmentId, newAssessmentId, now);
        copyAssessmentRows("assessment_notification_metadata", null, sourceAssessmentId, newAssessmentId, now);
        Rows userAccess = select("SELECT * FROM assessment_user_access WHERE assessment_id = :id", Map.of("id", sourceAssessmentId));
        // id is a sequence; let the database number the copies.
        insert("assessment_user_access", userAccess.without("id"), row -> row.put("assessment_id", newAssessmentId), now);
        insert("assessment_folder_mapping",
                select("SELECT * FROM assessment_folder_mapping WHERE assessment_id = :id AND institute_id = :institute",
                        Map.of("id", sourceAssessmentId, "institute", instituteId)),
                row -> {
                    row.put("id", UUID.randomUUID().toString());
                    row.put("assessment_id", newAssessmentId);
                }, now);
        // Report pages are shared by link (the editor copies a shared profile before changing it).
        insert("assessment_report_profile_link",
                select("SELECT * FROM assessment_report_profile_link WHERE assessment_id = :id", Map.of("id", sourceAssessmentId)),
                row -> row.put("assessment_id", newAssessmentId), now);
        Set<String> translatableIds = new LinkedHashSet<>();
        translatableIds.add(sourceAssessmentId);
        translatableIds.addAll(sections.ids());
        translatableIds.addAll(questions.ids());
        translatableIds.addAll(questionOptions.ids());
        copyTranslations(sourceAssessmentId, newAssessmentId, richTexts.ids(), translatableIds, remap, copyQuestions, now);

        // ---- participants --------------------------------------------------------------
        List<String> batchIds = options.getBatchIds() != null
                ? options.getBatchIds()
                : jdbc.queryForList("SELECT batch_id FROM assessment_batch_registration WHERE assessment_id = ? AND institute_id = ? AND status = 'ACTIVE'",
                        String.class, sourceAssessmentId, instituteId);
        Set<String> batches = new LinkedHashSet<>();
        batchIds.stream().filter(StringUtils::hasText).map(String::trim).forEach(batches::add);
        for (String batchId : batches) {
            jdbc.update("""
                    INSERT INTO assessment_batch_registration (id, assessment_id, batch_id, institute_id, registration_time, status, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
                    """, UUID.randomUUID().toString(), newAssessmentId, batchId, instituteId, now, now, now);
        }
        int participants = 0;
        if (Boolean.TRUE.equals(options.getCopyIndividualParticipants())) {
            Rows individuals = select("""
                    SELECT DISTINCT ON (user_id) * FROM assessment_user_registration
                    WHERE assessment_id = :id AND institute_id = :institute AND source = :source AND status = 'ACTIVE'
                    ORDER BY user_id, registration_time
                    """, Map.of("id", sourceAssessmentId, "institute", instituteId,
                    "source", UserRegistrationSources.ADMIN_PRE_REGISTRATION.name()));
            Object reattempts = source.get("reattempt_count");
            insert("assessment_user_registration", individuals, row -> {
                row.put("id", UUID.randomUUID().toString());
                row.put("assessment_id", newAssessmentId);
                row.put("registration_time", now);
                // A reattempt granted on the original is not carried into a new test.
                row.put("reattempt_count", reattempts);
            }, now);
            participants = individuals.rows.size();
        }

        log.info("[assessment-copy] {} -> {} (institute {}): {} sections, {} questions, {} batches, {} learners, marks {}",
                sourceAssessmentId, newAssessmentId, instituteId, sections.rows.size(), questions.rows.size(),
                batches.size(), participants, copyMarking ? "kept" : "reset");
        return new AssessmentCopyResponse(newAssessmentId, name, (String) source.get("play_mode"),
                AssessmentStatus.DRAFT.name(), sections.rows.size(), questions.rows.size(), batches.size(), participants);
    }

    /**
     * Topic tags of the copied questions (used by the test's reports). Question bank
     * ownership (question_institute_mapping) is not copied: the copy belongs to the test.
     */
    private void copyQuestionCompanions(Set<String> questionIds, CopyIdRemapper remap, Timestamp now) {
        if (questionIds.isEmpty()) return;
        insert("entity_tags",
                selectIn("SELECT * FROM entity_tags WHERE entity_id IN (:ids)", questionIds),
                row -> remapColumns(row, remap, "entity_id"), now);
    }

    /**
     * Translated text of the copied rich text and entities, so a translated paper stays
     * translated. {@code entityIds} = the original assessment and every copied section,
     * question and option.
     */
    private void copyTranslations(String sourceAssessmentId, String newAssessmentId, Set<String> richTextIds,
                                  Set<String> entityIds, CopyIdRemapper remap, boolean copyQuestions, Timestamp now) {
        insert("rich_text_translation",
                selectIn("SELECT * FROM rich_text_translation WHERE rich_text_id IN (:ids)", richTextIds),
                row -> {
                    row.put("id", UUID.randomUUID().toString());
                    remapColumns(row, remap, "rich_text_id");
                }, now);
        insert("entity_field_translation",
                selectIn("SELECT * FROM entity_field_translation WHERE entity_id IN (:ids)", entityIds),
                row -> {
                    row.put("id", UUID.randomUUID().toString());
                    remapColumns(row, remap, "entity_id");
                }, now);
        if (copyQuestions) {
            copyAssessmentRows("assessment_translation_coverage", null, sourceAssessmentId, newAssessmentId, now);
        }
    }

    /** Copies rows that belong to the assessment and nothing else (new id, new assessment_id). */
    private void copyAssessmentRows(String table, String extraCondition, String sourceAssessmentId,
                                    String newAssessmentId, Timestamp now) {
        String sql = "SELECT * FROM " + table + " WHERE assessment_id = :id"
                + (extraCondition == null ? "" : " AND " + extraCondition);
        insert(table, select(sql, Map.of("id", sourceAssessmentId)), row -> {
            row.put("id", UUID.randomUUID().toString());
            row.put("assessment_id", newAssessmentId);
        }, now);
    }

    private String newJoinCode() {
        for (int i = 0; i < 30; i++) {
            String code = RandomGenerator.generateNumber(6);
            Boolean taken = jdbc.queryForObject(
                    "SELECT EXISTS (SELECT 1 FROM assessment_institute_mapping WHERE assessment_url = ?)", Boolean.class, code);
            if (!Boolean.TRUE.equals(taken)) return code;
        }
        throw new VacademyException(HttpStatus.SERVICE_UNAVAILABLE, "Could not pick a join code for the copy, please try again");
    }

    private static Timestamp dateOrKeep(String requested, Object original, String label) {
        if (!StringUtils.hasText(requested)) {
            return original instanceof Timestamp ts ? ts : null;
        }
        try {
            return new Timestamp(DateUtil.convertStringToUTCDate(requested.trim()).getTime());
        } catch (VacademyException e) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Invalid " + label + ": " + requested);
        }
    }

    private static void collect(Set<String> into, Rows rows, String... columns) {
        for (Map<String, Object> row : rows.rows) {
            for (String column : columns) {
                Object value = row.get(column);
                if (value instanceof String s && StringUtils.hasText(s)) into.add(s);
            }
        }
    }

    private static void remapColumns(Map<String, Object> row, CopyIdRemapper remap, String... columns) {
        for (String column : columns) {
            if (row.get(column) instanceof String value) row.put(column, remap.id(value));
        }
    }

    private static void remapJsonColumns(Map<String, Object> row, CopyIdRemapper remap, String... columns) {
        for (String column : columns) {
            Object value = row.get(column);
            if (value instanceof String text) {
                row.put(column, remap.json(text));
            } else if (value != null) {
                // jsonb comes back as the driver's PGobject, whose toString() is the JSON text.
                // Sent back as text bound as OTHER, Postgres casts it to the column's jsonb.
                row.put(column, remap.json(value.toString()));
            }
        }
    }

    // ---- generic row copy ------------------------------------------------------------------

    /** Rows of one table with the column order and JDBC types they were read with. */
    private record Rows(List<String> columns, int[] types, List<Map<String, Object>> rows) {
        static final Rows EMPTY = new Rows(List.of(), new int[0], List.of());

        boolean isEmpty() {
            return rows.isEmpty();
        }

        Set<String> ids() {
            Set<String> ids = new LinkedHashSet<>();
            rows.forEach(r -> {
                if (r.get("id") instanceof String id) ids.add(id);
            });
            return ids;
        }

        Rows without(String column) {
            int index = columns.indexOf(column);
            if (index < 0) return this;
            List<String> keptColumns = new ArrayList<>(columns);
            keptColumns.remove(index);
            int[] keptTypes = new int[types.length - 1];
            for (int i = 0, j = 0; i < types.length; i++) if (i != index) keptTypes[j++] = types[i];
            List<Map<String, Object>> keptRows = new ArrayList<>();
            for (Map<String, Object> row : rows) {
                Map<String, Object> copy = new LinkedHashMap<>(row);
                copy.remove(column);
                keptRows.add(copy);
            }
            return new Rows(keptColumns, keptTypes, keptRows);
        }
    }

    private Rows select(String sql, Map<String, ?> params) {
        return named.query(sql, new MapSqlParameterSource(params), rs -> {
            ResultSetMetaData meta = rs.getMetaData();
            int count = meta.getColumnCount();
            List<String> columns = new ArrayList<>(count);
            int[] types = new int[count];
            for (int i = 1; i <= count; i++) {
                columns.add(meta.getColumnName(i));
                types[i - 1] = meta.getColumnType(i);
            }
            List<Map<String, Object>> rows = new ArrayList<>();
            while (rs.next()) {
                Map<String, Object> row = new LinkedHashMap<>();
                for (int i = 1; i <= count; i++) row.put(columns.get(i - 1), JdbcUtils.getResultSetValue(rs, i));
                rows.add(row);
            }
            return new Rows(columns, types, rows);
        });
    }

    /** {@code sql} must contain {@code IN (:ids)}; large id sets are read in chunks. */
    private Rows selectIn(String sql, Collection<String> ids) {
        if (ids == null || ids.isEmpty()) return Rows.EMPTY;
        List<String> all = new ArrayList<>(ids);
        Rows merged = null;
        for (int from = 0; from < all.size(); from += IN_CHUNK) {
            Rows chunk = select(sql, Map.of("ids", all.subList(from, Math.min(all.size(), from + IN_CHUNK))));
            if (merged == null) {
                merged = new Rows(chunk.columns, chunk.types, new ArrayList<>(chunk.rows));
            } else {
                merged.rows.addAll(chunk.rows);
            }
        }
        return merged;
    }

    /**
     * "Already sent" markers, e.g. assessment_notification_metadata.participant_reminder_sent_for
     * (V66) or assessment_user_registration.confirmation_email_sent_at (V67). Copied as is they
     * would tell the jobs that the copy's reminder / live / confirmation emails already went out.
     */
    static boolean isSentMarker(String column) {
        return column.endsWith("_sent_for") || column.endsWith("_sent_at");
    }

    /**
     * Inserts every row after {@code change}; creation/update stamps become now and every
     * "already sent" marker is cleared (the copy has sent nothing yet).
     */
    private void insert(String table, Rows rows, Consumer<Map<String, Object>> change, Timestamp now) {
        if (rows == null || rows.isEmpty()) return;
        List<Object[]> batch = new ArrayList<>(rows.rows.size());
        for (Map<String, Object> original : rows.rows) {
            Map<String, Object> row = new LinkedHashMap<>(original);
            change.accept(row);
            for (String column : TIMESTAMP_COLUMNS) {
                if (row.containsKey(column)) row.put(column, now);
            }
            for (String column : rows.columns) {
                if (isSentMarker(column)) row.put(column, null);
            }
            Object[] values = new Object[rows.columns.size()];
            for (int i = 0; i < values.length; i++) values[i] = row.get(rows.columns.get(i));
            batch.add(values);
        }
        StringBuilder sql = new StringBuilder("INSERT INTO \"").append(table).append("\" (");
        StringJoiner placeholders = new StringJoiner(", ");
        for (int i = 0; i < rows.columns.size(); i++) {
            if (i > 0) sql.append(", ");
            sql.append('"').append(rows.columns.get(i)).append('"');
            placeholders.add("?");
        }
        sql.append(") VALUES (").append(placeholders).append(')');
        jdbc.batchUpdate(sql.toString(), batch, sqlTypes(rows.types));
    }

    /** Result-set types as bind types; anything driver-specific is bound as OTHER (jsonb, uuid ...). */
    private static int[] sqlTypes(int[] types) {
        int[] out = new int[types.length];
        for (int i = 0; i < types.length; i++) {
            out[i] = types[i] == Types.JAVA_OBJECT || types[i] == Types.STRUCT ? Types.OTHER : types[i];
        }
        return out;
    }
}
