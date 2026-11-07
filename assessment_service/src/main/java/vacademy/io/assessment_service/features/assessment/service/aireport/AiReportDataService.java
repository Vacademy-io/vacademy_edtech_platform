package vacademy.io.assessment_service.features.assessment.service.aireport;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.assessment_service.features.assessment.service.HtmlBuilderService;
import vacademy.io.assessment_service.features.assessment.service.ReportLogoService;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.StudentReportAnswerReviewDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.StudentReportOverallDetailDto;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportModel.Criterion;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportModel.Potential;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportModel.QuestionDetail;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.DashboardChoiceGroups;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportModel.HistoryPoint;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportModel.Outcome;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportModel.QuestionRow;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportModel.SectionRow;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;
import vacademy.io.assessment_service.features.learner_assessment.dto.ReportBrandingDto;

import java.sql.Timestamp;
import java.util.*;

/**
 * Gathers the data for the student AI report in a handful of read-only queries.
 *
 * <p>Class figures use each learner's latest ENDED attempt in this institute — the same
 * population the leaderboard uses — so re-attempts are never double counted. Maximum marks
 * come from the questions' marking_json, never from {@code section.total_marks}.
 *
 * <p>Every external lookup (logo, institute name, enrollment number, history) is
 * best-effort: a failure leaves that field empty and the report still renders.
 */
@Slf4j
@Service
public class AiReportDataService {

    private final JdbcTemplate jdbcTemplate;
    private final NamedParameterJdbcTemplate namedJdbc;
    private final ObjectMapper objectMapper;
    private final AdminCoreServiceClient adminCoreServiceClient;
    private final ReportLogoService reportLogoService;
    private final DashboardChoiceGroups choiceGroups;
    private final HtmlBuilderService htmlBuilderService;
    private final vacademy.io.assessment_service.features.assessment.service.ReportBrandingHelper brandingHelper;

    // Built from the JdbcTemplate (as ApiCandidateStore does) so startup never depends on a
    // NamedParameterJdbcTemplate bean being auto-configured.
    public AiReportDataService(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper,
                               AdminCoreServiceClient adminCoreServiceClient, ReportLogoService reportLogoService,
                               DashboardChoiceGroups choiceGroups, HtmlBuilderService htmlBuilderService,
                               vacademy.io.assessment_service.features.assessment.service.ReportBrandingHelper brandingHelper) {
        this.jdbcTemplate = jdbcTemplate;
        this.namedJdbc = jdbcTemplate == null ? null : new NamedParameterJdbcTemplate(jdbcTemplate);
        this.objectMapper = objectMapper;
        this.adminCoreServiceClient = adminCoreServiceClient;
        this.reportLogoService = reportLogoService;
        this.choiceGroups = choiceGroups;
        this.htmlBuilderService = htmlBuilderService;
        this.brandingHelper = brandingHelper;
    }

    private static final int HISTORY_LIMIT = 5;

    // Each learner's latest ENDED attempt for the assessment in this institute.
    private static final String LATEST_ATTEMPTS_CTE = """
            WITH latest AS (
                SELECT x.attempt_id, x.user_id, x.total_marks, x.total_time_in_seconds
                FROM (
                    SELECT sa.id AS attempt_id, aur.user_id, sa.total_marks::float8 AS total_marks,
                           sa.total_time_in_seconds::bigint AS total_time_in_seconds,
                           ROW_NUMBER() OVER (PARTITION BY aur.user_id ORDER BY sa.created_at DESC) AS rn
                    FROM student_attempt sa
                    JOIN assessment_user_registration aur ON aur.id = sa.registration_id
                    WHERE aur.assessment_id = ? AND aur.institute_id = ?
                      AND sa.status = 'ENDED' AND aur.status = 'ACTIVE'
                ) x
                WHERE x.rn = 1
            )
            """;

    /**
     * @param detail the same per-question review the normal report renders (question text,
     *               responses, feedback); passed in by the caller to keep this service free of a
     *               dependency on AssessmentParticipantsManager. Nullable: the question-by-question
     *               pages are then left out.
     */
    public AiReportModel load(String userId, String assessmentId, String attemptId, String instituteId,
                              JsonNode ai, ReportBrandingDto branding, StudentReportOverallDetailDto detail) {
        Attempt attempt = loadAttempt(attemptId);
        Map<String, Object> assessment = jdbcTemplate.queryForMap(
                "SELECT name, duration FROM assessment WHERE id = ?", assessmentId);

        Structure structure = loadStructure(assessmentId);
        Map<String, StudentAnswer> answers = loadAnswers(attemptId);
        ClassData klass = loadClass(assessmentId, instituteId, attemptId, userId, attempt.totalMarks(), attempt.timeSeconds());

        List<QuestionRow> questions = buildQuestionRows(structure, answers, klass);
        List<SectionRow> sections = buildSectionRows(structure, questions, klass);
        double score = attempt.totalMarks() != null ? attempt.totalMarks()
                : questions.stream().mapToDouble(QuestionRow::marks).sum();
        // "Answer any N of M" papers are out of fewer marks than their questions add up to.
        Double paperMax = safe(() -> choiceGroups.paperMax(assessmentId));
        double maxScore = paperMax != null && paperMax > 0 ? paperMax
                : structure.questions().stream().mapToDouble(StructQuestion::max).sum();

        attachShortTexts(questions);

        String logoUri = logo(branding);
        String brand = validHex(branding != null ? branding.getPrimaryColor() : null, "#0F9A83");
        String accent = accentFor(branding);

        return AiReportModel.builder()
                .instituteName(safe(() -> adminCoreServiceClient.getInstituteName(instituteId)))
                .logoDataUri(logoUri)
                .logoAspect(aspect(logoUri))
                .assessmentName(Objects.toString(assessment.get("name"), "Assessment"))
                .studentName(attempt.studentName())
                .enrollmentNumber(safe(() -> adminCoreServiceClient.getEnrollmentNumber(userId, instituteId)))
                .attemptDate(attempt.submitTime())
                .brandColor(brand)
                .accentColor(accent)
                .score(score)
                .maxScore(maxScore)
                .timeTakenSeconds(attempt.timeSeconds())
                .durationLimitMinutes(assessment.get("duration") instanceof Number n && n.intValue() > 0 ? n.intValue() : null)
                .classScores(klass.scores())
                .rank(klass.rank())
                .participants(klass.scores().size())
                .percentile(klass.percentile())
                .classAverage(klass.average())
                .classHighest(klass.highest())
                .classAverageTimeSeconds(klass.averageTimeSeconds())
                .sections(sections)
                .questions(questions)
                .history(safeList(() -> loadHistory(userId, instituteId, assessmentId, attempt, score, maxScore)))
                .details(safeMap(() -> buildDetails(detail)))
                .potential(potential(questions, klass, score, maxScore))
                .markingNote(markingNote(structure.questions()))
                .ai(ai != null ? ai : objectMapper.createObjectNode())
                .build();
    }

    /** The institute logo: inlined (trimmed, scaled) when possible, else its URL; null when hidden or absent. */
    private String logo(ReportBrandingDto branding) {
        if (branding == null || !Boolean.TRUE.equals(branding.getShowLogoInHeader()) || !StringUtils.hasText(branding.getLogoFileId())) {
            return null;
        }
        String inline = safe(() -> reportLogoService.resolveInlineLogo(branding.getLogoFileId()));
        if (inline != null) return inline;
        String url = safe(() -> brandingHelper.resolveLogoUrl(branding));
        return StringUtils.hasText(url) ? url : null;
    }

    /** Width / height of an inline image, read from its bytes; null for URLs or unreadable data. */
    public static Double aspect(String dataUri) {
        if (dataUri == null || !dataUri.startsWith("data:image/")) return null;
        try {
            byte[] bytes = Base64.getDecoder().decode(dataUri.substring(dataUri.indexOf(',') + 1));
            java.awt.image.BufferedImage img = javax.imageio.ImageIO.read(new java.io.ByteArrayInputStream(bytes));
            return img == null || img.getHeight() == 0 ? null : (double) img.getWidth() / img.getHeight();
        } catch (Exception e) {
            return null;
        }
    }

    // ── Attempt ──

    record Attempt(Double totalMarks, Long timeSeconds, Timestamp submitTime, String studentName) {
    }

    private Attempt loadAttempt(String attemptId) {
        return jdbcTemplate.queryForObject("""
                SELECT sa.total_marks::float8 AS total_marks, sa.total_time_in_seconds::bigint AS total_time_in_seconds, sa.submit_time,
                       COALESCE(NULLIF(TRIM(aur.participant_name), ''), aur.username) AS student_name
                FROM student_attempt sa JOIN assessment_user_registration aur ON aur.id = sa.registration_id
                WHERE sa.id = ?
                """, (rs, i) -> new Attempt(
                (Double) rs.getObject("total_marks", Double.class),
                (Long) rs.getObject("total_time_in_seconds", Long.class),
                rs.getTimestamp("submit_time"),
                rs.getString("student_name")), attemptId);
    }

    // ── Paper structure ──

    record StructSection(String id, String name, int order) {
    }

    record StructQuestion(String questionId, String sectionId, int order, double max, double negative) {
    }

    record Structure(List<StructSection> sections, List<StructQuestion> questions) {
    }

    private Structure loadStructure(String assessmentId) {
        List<StructSection> sections = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        List<StructQuestion> questions = new ArrayList<>();
        // DISTINCT ON keeps the newest mapping when a question was linked to a section twice.
        jdbcTemplate.query("""
                SELECT DISTINCT ON (s.id, m.question_id)
                       s.id AS section_id, s.name AS section_name, COALESCE(s.section_order, 0) AS section_order,
                       m.question_id, COALESCE(m.question_order, 0) AS question_order, m.marking_json
                FROM section s
                JOIN question_assessment_section_mapping m ON m.section_id = s.id
                WHERE s.assessment_id = ? AND COALESCE(s.status, '') <> 'DELETED' AND COALESCE(m.status, '') <> 'DELETED'
                ORDER BY s.id, m.question_id, m.created_at DESC
                """, rs -> {
            String sid = rs.getString("section_id");
            if (seen.add(sid)) {
                sections.add(new StructSection(sid, rs.getString("section_name"), rs.getInt("section_order")));
            }
            questions.add(new StructQuestion(rs.getString("question_id"), sid,
                    rs.getInt("question_order"), maxMark(rs.getString("marking_json")), negativeMark(rs.getString("marking_json"))));
        }, assessmentId);

        sections.sort(Comparator.comparingInt(StructSection::order).thenComparing(StructSection::name, Comparator.nullsLast(String::compareTo)));
        Map<String, Integer> sectionPos = new HashMap<>();
        for (int i = 0; i < sections.size(); i++) sectionPos.put(sections.get(i).id(), i);
        questions.sort(Comparator.comparingInt((StructQuestion q) -> sectionPos.getOrDefault(q.sectionId(), 0))
                .thenComparingInt(StructQuestion::order));
        return new Structure(sections, questions);
    }

    /** marking_json data.negativeMark (a positive number meaning "minus this"); missing = 0. */
    double negativeMark(String markingJson) {
        if (!StringUtils.hasText(markingJson)) return 0;
        try {
            JsonNode mark = objectMapper.readTree(markingJson).path("data").path("negativeMark");
            if (mark.isNumber()) return Math.abs(mark.asDouble());
            String text = mark.asText("").trim();
            return text.isEmpty() ? 0 : Math.abs(Double.parseDouble(text));
        } catch (Exception e) {
            return 0;
        }
    }

    static String markingNote(List<StructQuestion> qs) {
        if (qs.isEmpty()) return null;
        double plus = qs.get(0).max(), minus = qs.get(0).negative();
        for (StructQuestion q : qs) {
            if (Math.abs(q.max() - plus) > 1e-9 || Math.abs(q.negative() - minus) > 1e-9) return null;
        }
        if (plus <= 0) return null;
        return "+" + AiReportCharts.num(plus) + " per correct answer"
                + (minus > 0 ? ", " + AiReportCharts.num(-minus) + " per wrong answer" : ", no negative marking") + ".";
    }

    /** marking_json data.totalMark, which is stored as a number or a string ("2.5"). Missing = 0. */
    double maxMark(String markingJson) {
        if (!StringUtils.hasText(markingJson)) return 0;
        try {
            JsonNode mark = objectMapper.readTree(markingJson).path("data").path("totalMark");
            if (mark.isNumber()) return mark.asDouble();
            String text = mark.asText("").trim();
            return text.isEmpty() ? 0 : Double.parseDouble(text);
        } catch (Exception e) {
            return 0;
        }
    }

    // ── The student's answers ──

    record StudentAnswer(double marks, String status, Long timeSeconds, boolean answered) {
    }

    private Map<String, StudentAnswer> loadAnswers(String attemptId) {
        Map<String, StudentAnswer> out = new HashMap<>();
        jdbcTemplate.query("""
                SELECT question_id, section_id, marks::float8 AS marks, status, time_taken_in_seconds::bigint AS time_taken_in_seconds, response_json
                FROM question_wise_marks WHERE attempt_id = ?
                """, rs -> {
            out.put(key(rs.getString("question_id"), rs.getString("section_id")), new StudentAnswer(
                    rs.getDouble("marks"), rs.getString("status"),
                    (Long) rs.getObject("time_taken_in_seconds", Long.class),
                    hasResponse(rs.getString("response_json"))));
        }, attemptId);
        return out;
    }

    /** True when the stored response carries an actual answer (an option, text or number). */
    boolean hasResponse(String responseJson) {
        if (!StringUtils.hasText(responseJson)) return false;
        try {
            JsonNode data = objectMapper.readTree(responseJson).path("responseData");
            if (data.isMissingNode() || data.isNull()) return false;
            Iterator<Map.Entry<String, JsonNode>> fields = data.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> f = fields.next();
                if ("type".equals(f.getKey())) continue;
                JsonNode v = f.getValue();
                if (v == null || v.isNull() || v.isMissingNode()) continue;
                if (v.isArray() && v.isEmpty()) continue;
                if (v.isTextual() && v.asText().isBlank()) continue;
                return true;
            }
        } catch (Exception ignored) {
            // unreadable response: treat as not answered
        }
        return false;
    }

    static Outcome outcomeOf(StudentAnswer a, double max) {
        if (a == null) return Outcome.SKIPPED;
        String status = a.status() == null ? "" : a.status().toUpperCase(Locale.ROOT);
        switch (status) {
            case "CORRECT":
                return Outcome.CORRECT;
            case "PARTIAL_CORRECT":
                return Outcome.PARTIAL;
            case "INCORRECT":
                return Outcome.WRONG;
            case "PENDING":
                if (!a.answered()) return Outcome.SKIPPED;
                return a.marks() > 0 ? byMarks(a.marks(), max) : Outcome.PENDING;
            default:
                // e.g. "evaluated" (teacher or AI marked): judge by the marks given.
                if (!a.answered() && a.marks() == 0) return Outcome.SKIPPED;
                return byMarks(a.marks(), max);
        }
    }

    private static Outcome byMarks(double marks, double max) {
        if (max > 0 && marks >= max) return Outcome.CORRECT;
        if (marks > 0) return Outcome.PARTIAL;
        return Outcome.WRONG;
    }

    // ── Class ──

    record QuestionStat(double correctPercent, Double avgTimeSeconds) {
    }

    record SectionStat(double avgMarks, double avgTimeSeconds, double topMarks) {
    }

    record ClassData(List<Double> scores, Integer rank, Double percentile, Double average, Double highest,
                     Long averageTimeSeconds, Map<String, QuestionStat> questions, Map<String, SectionStat> sections,
                     List<Double> others) {
    }

    private ClassData loadClass(String assessmentId, String instituteId, String attemptId, String userId, Double ownMarks,
                                Long ownTime) {
        List<Double> others = new ArrayList<>();
        List<double[]> otherPairs = new ArrayList<>(); // {marks, seconds (MAX_VALUE when unknown)}
        List<Long> times = new ArrayList<>();
        Map<String, QuestionStat> qStats = new HashMap<>();
        Map<String, SectionStat> sStats = new HashMap<>();
        try {
            jdbcTemplate.query(LATEST_ATTEMPTS_CTE + "SELECT user_id, total_marks, total_time_in_seconds FROM latest",
                    rs -> {
                        Long t = (Long) rs.getObject("total_time_in_seconds", Long.class);
                        if (t != null && t > 0) times.add(t);
                        if (userId.equals(rs.getString("user_id"))) return; // the student is added below, with THIS attempt
                        Double m = (Double) rs.getObject("total_marks", Double.class);
                        others.add(m == null ? 0.0 : m);
                        otherPairs.add(new double[]{m == null ? 0.0 : m, t == null ? Double.MAX_VALUE : t});
                    }, assessmentId, instituteId);

            jdbcTemplate.query(LATEST_ATTEMPTS_CTE + """
                    SELECT w.question_id, w.section_id, COUNT(*) AS n,
                           COUNT(*) FILTER (WHERE w.status = 'CORRECT') AS correct,
                           AVG(w.time_taken_in_seconds)::float8 AS avg_t
                    FROM question_wise_marks w JOIN latest l ON l.attempt_id = w.attempt_id
                    GROUP BY w.question_id, w.section_id
                    """, rs -> {
                long n = rs.getLong("n");
                if (n > 0) {
                    qStats.put(key(rs.getString("question_id"), rs.getString("section_id")), new QuestionStat(
                            100.0 * rs.getLong("correct") / n, (Double) rs.getObject("avg_t", Double.class)));
                }
            }, assessmentId, instituteId);

            jdbcTemplate.query(LATEST_ATTEMPTS_CTE + """
                    SELECT s.section_id, AVG(s.m)::float8 AS avg_m, AVG(s.t)::float8 AS avg_t, MAX(s.m)::float8 AS top_m FROM (
                        SELECT w.attempt_id, w.section_id, SUM(w.marks) AS m, SUM(COALESCE(w.time_taken_in_seconds, 0)) AS t
                        FROM question_wise_marks w JOIN latest l ON l.attempt_id = w.attempt_id
                        GROUP BY w.attempt_id, w.section_id
                    ) s GROUP BY s.section_id
                    """, rs -> {
                sStats.put(rs.getString("section_id"), new SectionStat(rs.getDouble("avg_m"), rs.getDouble("avg_t"), rs.getDouble("top_m")));
            }, assessmentId, instituteId);
        } catch (Exception e) {
            log.warn("[ai-report] class figures unavailable for assessment {}: {}", assessmentId, e.getMessage());
        }

        double own = ownMarks == null ? 0.0 : ownMarks;
        List<Double> all = new ArrayList<>(others);
        all.add(own);
        // Same rule as the rest of the platform (StudentAttemptRepository: DENSE_RANK over marks DESC,
        // completion time ASC, nulls last), so the letter, charts, AI text and app all show one rank.
        double ownT = ownTime == null ? Double.MAX_VALUE : ownTime;
        long better = otherPairs.stream()
                .filter(pr -> pr[0] > own || (pr[0] == own && pr[1] < ownT))
                .map(pr -> pr[0] + "|" + pr[1]).distinct().count();
        Integer rank = (int) better + 1;
        Double percentile = others.isEmpty() ? null : 100.0 * (1 - (double) (rank - 1) / all.size());
        double avg = all.stream().mapToDouble(Double::doubleValue).average().orElse(own);
        double highest = all.stream().mapToDouble(Double::doubleValue).max().orElse(own);
        Long avgTime = times.isEmpty() ? null : Math.round(times.stream().mapToLong(Long::longValue).average().orElse(0));
        return new ClassData(all, rank, percentile, avg, highest, avgTime, qStats, sStats, others);
    }

    // ── Rows ──

    private List<QuestionRow> buildQuestionRows(Structure s, Map<String, StudentAnswer> answers, ClassData klass) {
        Map<String, Integer> sectionIndex = new HashMap<>();
        Map<String, String> sectionName = new HashMap<>();
        for (int i = 0; i < s.sections().size(); i++) {
            sectionIndex.put(s.sections().get(i).id(), i);
            sectionName.put(s.sections().get(i).id(), s.sections().get(i).name());
        }
        Map<String, Integer> numberInSection = new HashMap<>();
        List<QuestionRow> rows = new ArrayList<>();
        for (StructQuestion q : s.questions()) {
            String k = key(q.questionId(), q.sectionId());
            StudentAnswer a = answers.get(k);
            QuestionStat stat = klass.questions().get(k);
            int n = numberInSection.merge(q.sectionId(), 1, Integer::sum);
            rows.add(new QuestionRow(q.questionId(), q.sectionId(), sectionIndex.getOrDefault(q.sectionId(), 0),
                    sectionName.get(q.sectionId()), n, q.max(), a == null ? 0 : a.marks(), outcomeOf(a, q.max()),
                    a == null ? null : a.timeSeconds(),
                    stat == null ? null : stat.correctPercent(), stat == null ? null : stat.avgTimeSeconds(), null));
        }
        return rows;
    }

    private List<SectionRow> buildSectionRows(Structure s, List<QuestionRow> questions, ClassData klass) {
        List<SectionRow> out = new ArrayList<>();
        for (int i = 0; i < s.sections().size(); i++) {
            StructSection sec = s.sections().get(i);
            double max = 0, score = 0;
            long time = 0;
            for (QuestionRow q : questions) {
                if (!q.sectionId().equals(sec.id())) continue;
                max += q.max();
                score += q.marks();
                time += q.timeSeconds() == null ? 0 : q.timeSeconds();
            }
            SectionStat stat = klass.sections().get(sec.id());
            out.add(new SectionRow(sec.id(), sec.name(), i, max, score,
                    stat == null ? null : stat.avgMarks(), time, stat == null ? null : stat.avgTimeSeconds(),
                    stat == null ? null : stat.topMarks()));
        }
        return out;
    }

    /**
     * Short question text for the few rows the report quotes (wrong answers most of the
     * class got right). One query, only for those rows.
     */
    private void attachShortTexts(List<QuestionRow> questions) {
        List<String> ids = questions.stream()
                .filter(q -> q.outcome() == Outcome.WRONG || q.outcome() == Outcome.SKIPPED)
                .map(QuestionRow::questionId).distinct().limit(60).toList();
        if (ids.isEmpty()) return;
        Map<String, String> texts = new HashMap<>();
        try {
            namedJdbc.query("""
                    SELECT q.id, rt.content FROM question q
                    LEFT JOIN assessment_rich_text_data rt ON rt.id = q.text_id
                    WHERE q.id IN (:ids)
                    """, new MapSqlParameterSource("ids", ids), rs -> {
                texts.put(rs.getString("id"), shorten(rs.getString("content"), 70));
            });
        } catch (Exception e) {
            log.warn("[ai-report] question texts unavailable: {}", e.getMessage());
            return;
        }
        questions.replaceAll(q -> texts.containsKey(q.questionId())
                ? new QuestionRow(q.questionId(), q.sectionId(), q.sectionIndex(), q.sectionName(), q.numberInSection(),
                q.max(), q.marks(), q.outcome(), q.timeSeconds(), q.classCorrectPercent(), q.classAverageTimeSeconds(),
                texts.get(q.questionId()))
                : q);
    }

    static String shorten(String html, int max) {
        if (html == null) return null;
        String text = html.replaceAll("(?s)<[^>]*>", " ")
                .replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
                .replaceAll("\\s+", " ").trim();
        if (text.length() <= max) return text;
        int cut = text.lastIndexOf(' ', max);
        return text.substring(0, cut > max / 2 ? cut : max).trim() + "…";
    }

    // ── Question by question ──

    /** The normal report's per-question review, reshaped for the AI report. Option ids become text. */
    Map<String, QuestionDetail> buildDetails(StudentReportOverallDetailDto detail) {
        if (detail == null || detail.getAllSections() == null) return Map.of();
        Map<String, QuestionDetail> out = new HashMap<>();
        for (Map.Entry<String, List<StudentReportAnswerReviewDto>> e : detail.getAllSections().entrySet()) {
            if (e.getValue() == null) continue;
            for (StudentReportAnswerReviewDto row : e.getValue()) {
                if (row == null || row.getQuestionId() == null) continue;
                String feedback = notBlank(row.getEvaluatorFeedback()) ? row.getEvaluatorFeedback() : row.getAiFeedback();
                out.put(key(row.getQuestionId(), e.getKey()), new QuestionDetail(
                        row.getQuestionType(),
                        clean(row.getQuestionName(), 900),
                        answerText(row),
                        correctText(row),
                        clean(feedback, 600),
                        criteria(row.getAiCriteriaBreakdown()),
                        clean(row.getExplanation(), 700)));
            }
        }
        return out;
    }

    private String answerText(StudentReportAnswerReviewDto row) {
        String response = row.getStudentResponseOptions();
        if (response != null && !"CODING".equals(row.getQuestionType())) {
            try {
                List<String> answers = htmlBuilderService.extractResponseContent(response);
                if (answers != null && !answers.isEmpty()) return clean(String.join(", ", answers), 600);
            } catch (Exception ignored) {
                // fall through to the generic labels below
            }
        }
        if (response != null && "CODING".equals(row.getQuestionType())) return "Code submitted (see the app for the full program)";
        if (row.getMark() != 0) return "Marks awarded directly (" + AiReportCharts.num(row.getMark()) + ")";
        return null;
    }

    private String correctText(StudentReportAnswerReviewDto row) {
        if (row.getCorrectOptions() == null) return null;
        try {
            List<String> correct = htmlBuilderService.extractContent(row.getCorrectOptions());
            return correct == null || correct.isEmpty() ? null : clean(String.join(", ", correct), 600);
        } catch (Exception e) {
            return null;
        }
    }

    private List<Criterion> criteria(String raw) {
        if (!StringUtils.hasText(raw)) return List.of();
        try {
            JsonNode arr = objectMapper.readTree(raw);
            if (!arr.isArray()) return List.of();
            List<Criterion> out = new ArrayList<>();
            for (JsonNode c : arr) {
                String marks = c.has("marks") && !c.get("marks").isNull() ? c.get("marks").asText() : "-";
                out.add(new Criterion(c.path("criteria_name").asText("Criterion"), marks, clean(c.path("reason").asText(""), 300)));
            }
            return out;
        } catch (Exception e) {
            return List.of();
        }
    }

    private static String clean(String html, int max) {
        if (!StringUtils.hasText(html)) return null;
        String t = HtmlBuilderService.stripHtmlTags(html).replaceAll("\\s+", " ").trim();
        if (t.isEmpty()) return null;
        return t.length() <= max ? t : t.substring(0, max).trim() + "…";
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }

    // ── Potential ──

    /**
     * Same rule as the normal report (StudentReportAnalyticsService): each skipped question
     * adds its marks times the share of the class that got it right.
     */
    static Potential potential(List<QuestionRow> questions, ClassData klass, double score, double maxScore) {
        double gain = 0;
        int considered = 0;
        for (QuestionRow q : questions) {
            if (q.outcome() != Outcome.SKIPPED || q.classCorrectPercent() == null || q.max() <= 0) continue;
            double fraction = q.classCorrectPercent() / 100.0;
            if (fraction <= 0) continue;
            gain += q.max() * fraction;
            considered++;
        }
        if (considered == 0 || gain < 0.05) return null;
        double projected = Math.min(maxScore > 0 ? maxScore : Double.MAX_VALUE, score + gain);
        projected = Math.round(projected * 10) / 10.0;
        if (projected <= score + 0.05) return null;
        List<Double> others = klass.others();
        Integer rank = null;
        Double percentile = null;
        if (others != null && !others.isEmpty()) {
            final double p = projected;
            rank = 1 + (int) others.stream().filter(v -> v > p).count();
            percentile = 100.0 * others.stream().filter(v -> v < p).count() / (others.size() + 1);
        }
        return new Potential(projected, rank, percentile, considered);
    }

    // ── History ──

    private List<HistoryPoint> loadHistory(String userId, String instituteId, String assessmentId,
                                           Attempt current, double score, double maxScore) {
        List<Map<String, Object>> past = jdbcTemplate.queryForList("""
                SELECT x.assessment_id, x.name, x.total_marks::float8 AS total_marks, x.submit_time FROM (
                    SELECT aur.assessment_id, a.name, sa.total_marks, sa.submit_time, a.result_type, sa.report_release_status,
                           ROW_NUMBER() OVER (PARTITION BY aur.assessment_id ORDER BY sa.created_at DESC) AS rn
                    FROM student_attempt sa
                    JOIN assessment_user_registration aur ON aur.id = sa.registration_id
                    JOIN assessment a ON a.id = aur.assessment_id
                    WHERE aur.user_id = ? AND aur.institute_id = ? AND aur.assessment_id <> ?
                      AND sa.status = 'ENDED' AND sa.submit_time IS NOT NULL
                      AND COALESCE(a.status, '') <> 'DELETED' AND COALESCE(a.assessment_type, '') <> 'SURVEY'
                ) x
                WHERE x.rn = 1
                  AND COALESCE(x.report_release_status, '') <> 'PENDING'
                  AND (COALESCE(x.result_type, '') NOT IN ('MANUAL', 'NO_AUTO_RELEASE') OR x.report_release_status = 'RELEASED')
                ORDER BY x.submit_time DESC
                LIMIT ?
                """, userId, instituteId, assessmentId, HISTORY_LIMIT);
        if (past.isEmpty() || maxScore <= 0) return List.of();

        List<String> ids = past.stream().map(r -> (String) r.get("assessment_id")).toList();
        Map<String, Double> maxByAssessment = new HashMap<>();
        namedJdbc.query("""
                SELECT s.assessment_id, m.marking_json
                FROM section s JOIN question_assessment_section_mapping m ON m.section_id = s.id
                WHERE s.assessment_id IN (:ids) AND COALESCE(s.status, '') <> 'DELETED' AND COALESCE(m.status, '') <> 'DELETED'
                """, new MapSqlParameterSource("ids", ids), rs -> {
            maxByAssessment.merge(rs.getString("assessment_id"), maxMark(rs.getString("marking_json")), Double::sum);
        });

        List<HistoryPoint> points = new ArrayList<>();
        for (Map<String, Object> r : past) {
            Double max = maxByAssessment.get((String) r.get("assessment_id"));
            if (max == null || max <= 0) continue;
            double marks = r.get("total_marks") instanceof Number n ? n.doubleValue() : 0;
            points.add(new HistoryPoint((String) r.get("name"), (Date) r.get("submit_time"), clampPercent(100 * marks / max)));
        }
        if (points.isEmpty()) return List.of();
        Collections.reverse(points); // oldest first
        points.add(new HistoryPoint(null, current.submitTime(), clampPercent(100 * score / maxScore)));
        return points;
    }

    // ── Helpers ──

    static String key(String questionId, String sectionId) {
        return questionId + "|" + sectionId;
    }

    private static double clampPercent(double p) {
        return Math.max(-100, Math.min(100, p));
    }

    static String validHex(String value, String fallback) {
        return value != null && value.trim().matches("#[0-9a-fA-F]{6}") ? value.trim() : fallback;
    }

    /** The institute's secondary colour; the stock purple default counts as "not chosen". */
    static String accentFor(ReportBrandingDto branding) {
        String secondary = branding != null ? branding.getSecondaryColor() : null;
        if (secondary == null || "#6C5CE7".equalsIgnoreCase(secondary.trim())) return "#FFC531";
        return validHex(secondary, "#FFC531");
    }

    private static <T> T safe(java.util.function.Supplier<T> s) {
        try {
            return s.get();
        } catch (Exception e) {
            log.debug("[ai-report] optional lookup failed: {}", e.getMessage());
            return null;
        }
    }

    private static <K, V> Map<K, V> safeMap(java.util.function.Supplier<Map<K, V>> s) {
        try {
            Map<K, V> v = s.get();
            return v == null ? Map.of() : v;
        } catch (Exception e) {
            log.warn("[ai-report] question details unavailable: {}", e.getMessage());
            return Map.of();
        }
    }

    private static <T> List<T> safeList(java.util.function.Supplier<List<T>> s) {
        try {
            List<T> v = s.get();
            return v == null ? List.of() : v;
        } catch (Exception e) {
            log.warn("[ai-report] history unavailable: {}", e.getMessage());
            return List.of();
        }
    }
}
