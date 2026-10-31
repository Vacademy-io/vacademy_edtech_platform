package vacademy.io.assessment_service.features.open_evaluation.exam;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.HttpStatus;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamInputs;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamViews;
import vacademy.io.assessment_service.features.open_evaluation.rubric.RubricRules;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Field rules of the exam, question, choice-group and candidate bodies (spec 7.1-7.4).
 * Pure: no database. Shape problems are collected and returned together as 422
 * {@code validation_failed} with {@code details.errors[]}; rule-specific refusals
 * ({@code unknown_option_label}, {@code rubric_*}, {@code language_not_supported}) are
 * checked afterwards and thrown one at a time with their own code.
 */
public final class ExamValidator {

    public static final String MODE_HANDWRITTEN = "handwritten";
    public static final String MODE_TYPED = "typed";
    public static final Set<String> MODES = Set.of(MODE_HANDWRITTEN, MODE_TYPED);
    public static final Set<String> LEVELS = Set.of("school", "ug", "pg", "upsc");
    public static final String DEFAULT_LEVEL = "school";
    public static final String DEFAULT_LANGUAGE = "en";
    public static final Set<String> SUPPORTED_LANGUAGES = Set.of("en");
    /** Declared but refused until the Hindi evaluation set passes (Phase 3). */
    public static final Set<String> KNOWN_UNSUPPORTED_LANGUAGES = Set.of("hi");

    public static final int MAX_TITLE = 255;
    public static final int MAX_EXTERNAL_REF = 128;
    public static final int MAX_INSTRUCTIONS = 4_000;
    public static final int MAX_QUESTIONS = 200;
    public static final int MAX_CANDIDATES = 2_000;
    public static final int MAX_LABEL = 16;
    public static final int MAX_TEXT = 20_000;
    public static final int MAX_MODEL_ANSWER = 20_000;
    public static final int MAX_OPTION_TEXT = 2_000;
    public static final int MAX_OPTIONS = 26;
    public static final int MAX_SECTION_NAME = 64;
    public static final int MAX_SECTIONS = 20;
    public static final int MAX_SHORT = 120;
    public static final int MAX_EXTERNAL_ID = 128;
    public static final int MAX_CANDIDATE_NAME = 255;
    public static final int MAX_ROLL = 64;
    public static final int MAX_METADATA_BYTES = 2_048;
    public static final int MAX_TAGS_BYTES = 2_048;
    public static final int MAX_CHOICE_GROUPS = 100;

    /** Default section when the partner declares none (spec 7.1). */
    public static final String DEFAULT_SECTION = "A";

    private static final BigDecimal HALF = new BigDecimal("0.5");
    private static final BigDecimal MAX_MARKS_CAP = new BigDecimal("1000");

    /** Public question type → internal {@code question.question_type}. */
    public static final Map<String, String> TYPE_TO_INTERNAL;
    /** Internal {@code question.question_type} → public question type. */
    public static final Map<String, String> INTERNAL_TO_TYPE;

    static {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("mcq_single", "MCQS");
        m.put("mcq_multi", "MCQM");
        m.put("true_false", "TRUE_FALSE");
        m.put("numeric", "NUMERIC");
        m.put("one_word", "ONE_WORD");
        m.put("long_answer", "LONG_ANSWER");
        TYPE_TO_INTERNAL = Map.copyOf(m);
        Map<String, String> r = new HashMap<>();
        m.forEach((k, v) -> r.put(v, k));
        INTERNAL_TO_TYPE = Map.copyOf(r);
    }

    private ExamValidator() {
    }

    /** One validated question, ready to be mapped onto the question tables. */
    public record ValidatedQuestion(
            String label,
            String parentLabel,
            String section,
            String type,
            String internalType,
            String text,
            BigDecimal maxMarks,
            BigDecimal negativeMarks,
            List<ExamInputs.OptionInput> options,
            List<String> correctLabels,
            List<Double> numericAnswers,
            String oneWordAnswer,
            String modelAnswer,
            ExamInputs.RubricInput rubric,
            Integer wordLimit,
            Boolean expectsDiagram,
            Boolean assessLanguage,
            Map<String, Object> tags,
            String externalId) {

        public boolean isChoice() {
            return "MCQS".equals(internalType) || "MCQM".equals(internalType) || "TRUE_FALSE".equals(internalType);
        }

        public boolean isLongAnswer() {
            return "LONG_ANSWER".equals(internalType);
        }
    }

    /** Validated {@code POST /exams} body. */
    public record ValidatedExam(
            String title,
            String mode,
            String externalRef,
            LocalDate conductedOn,
            String subject,
            String level,
            String board,
            String className,
            String answerLanguage,
            String feedbackLanguage,
            String instructions,
            boolean blind,
            boolean open,
            List<ExamInputs.SectionInput> sections,
            List<ValidatedQuestion> questions,
            List<ExamInputs.ChoiceGroupInput> choiceGroups,
            List<ExamInputs.CandidateInput> candidates,
            List<ExamViews.Warning> warnings) {
    }

    // ------------------------------------------------------------------ exam

    public static ValidatedExam validateCreate(ExamInputs.CreateExam req, LocalDate today) {
        if (req == null) {
            throw OpenApiException.validation(null, "required", "A JSON body is required.");
        }
        List<OpenApiException.FieldError> errors = new ArrayList<>();
        List<ExamViews.Warning> warnings = new ArrayList<>();

        String title = requiredText(req.getTitle(), "title", MAX_TITLE, errors);
        noAngles(title, "title", errors);
        String mode = lower(req.getMode());
        if (mode == null) {
            errors.add(err("mode", "required", "mode is required: handwritten or typed."));
        } else if (!MODES.contains(mode)) {
            errors.add(err("mode", "invalid", "mode must be handwritten or typed."));
        }
        String externalRef = optionalText(req.getExternalRef(), "external_ref", MAX_EXTERNAL_REF, errors);
        LocalDate conductedOn = parseDate(req.getConductedOn(), "conducted_on", errors);
        String level = lower(req.getLevel());
        if (level == null) {
            level = DEFAULT_LEVEL;
        } else if (!LEVELS.contains(level)) {
            errors.add(err("level", "invalid", "level must be one of school, ug, pg, upsc."));
        }
        String subject = optionalText(req.getSubject(), "subject", MAX_SHORT, errors);
        String board = optionalText(req.getBoard(), "board", 64, errors);
        String className = optionalText(req.getClassName(), "class", 32, errors);
        String answerLanguage = language(req.getAnswerLanguage(), "answer_language", errors);
        String feedbackLanguage = language(req.getFeedbackLanguage(), "feedback_language", errors);
        String instructions = optionalText(req.getInstructions(), "instructions", MAX_INSTRUCTIONS, errors);

        List<ExamInputs.QuestionInput> rawQuestions = req.getQuestions() == null ? List.of() : req.getQuestions();
        if (rawQuestions.size() > MAX_QUESTIONS) {
            errors.add(err("questions", "too_many", "An exam has at most " + MAX_QUESTIONS + " questions."));
        }
        List<ExamInputs.CandidateInput> candidates = req.getCandidates() == null ? List.of() : req.getCandidates();
        if (candidates.size() > MAX_CANDIDATES) {
            errors.add(err("candidates", "too_many", "At most " + MAX_CANDIDATES + " candidates per call."));
        }

        List<ExamInputs.SectionInput> sections = sections(req.getSections(), rawQuestions, errors);
        Set<String> sectionNames = new LinkedHashSet<>();
        sections.forEach(s -> sectionNames.add(s.getName()));

        List<ValidatedQuestion> questions = validateQuestions(rawQuestions, mode, Set.of(), sectionNames,
                "questions", errors, warnings);
        validateCandidates(candidates, "candidates", errors);
        if (!errors.isEmpty()) {
            throw OpenApiException.validation(errors);
        }
        checkLanguage(req.getAnswerLanguage(), "answer_language");
        checkLanguage(req.getFeedbackLanguage(), "feedback_language");
        checkQuestionRules(questions, "questions", warnings);

        List<ExamInputs.ChoiceGroupInput> groups = req.getChoiceGroups() == null ? List.of() : req.getChoiceGroups();
        if (!groups.isEmpty()) {
            validateChoiceGroups(groups, questions.stream().map(ValidatedQuestion::label).toList(), "choice_groups");
        }
        autoRubricWarning(questions, warnings);

        return new ValidatedExam(title, mode, externalRef, conductedOn == null ? today : conductedOn, subject, level,
                board, className, answerLanguage, feedbackLanguage, instructions, Boolean.TRUE.equals(req.getBlind()),
                Boolean.TRUE.equals(req.getOpen()), sections, questions, groups, candidates, warnings);
    }

    /**
     * Sections: the declared list, or (when none is declared) the questions' section names
     * in first-seen order, or a single section "A".
     */
    static List<ExamInputs.SectionInput> sections(List<ExamInputs.SectionInput> declared,
            List<ExamInputs.QuestionInput> questions, List<OpenApiException.FieldError> errors) {
        List<ExamInputs.SectionInput> out = new ArrayList<>();
        if (declared != null && !declared.isEmpty()) {
            if (declared.size() > MAX_SECTIONS) {
                errors.add(err("sections", "too_many", "An exam has at most " + MAX_SECTIONS + " sections."));
            }
            Set<String> seen = new HashSet<>();
            for (int i = 0; i < declared.size(); i++) {
                ExamInputs.SectionInput s = declared.get(i);
                String name = s == null ? null : requiredText(s.getName(), "sections[" + i + "].name", MAX_SECTION_NAME, errors);
                noAngles(name, "sections[" + i + "].name", errors);
                if (name == null) {
                    continue;
                }
                if (!seen.add(name.toLowerCase(Locale.ROOT))) {
                    errors.add(err("sections[" + i + "].name", "duplicate", "Section names must be unique."));
                    continue;
                }
                out.add(new ExamInputs.SectionInput(name, s.getOrder() == null ? i + 1 : s.getOrder()));
            }
            out.sort((a, b) -> Integer.compare(a.getOrder(), b.getOrder()));
            return out;
        }
        Set<String> seen = new LinkedHashSet<>();
        for (ExamInputs.QuestionInput q : questions) {
            String name = q == null || q.getSection() == null || q.getSection().isBlank() ? null : q.getSection().trim();
            if (name != null && name.length() <= MAX_SECTION_NAME) {
                seen.add(name);
            }
        }
        if (seen.isEmpty()) {
            seen.add(DEFAULT_SECTION);
        }
        int order = 1;
        for (String name : seen) {
            out.add(new ExamInputs.SectionInput(name, order++));
        }
        return out;
    }

    // ------------------------------------------------------------------ questions

    /**
     * Validates questions for an exam.
     *
     * @param existingLabels labels already in the exam (unique across both)
     * @param sectionNames   known section names; a question naming another section is refused
     *                       unless the set is empty (then any name is accepted)
     */
    public static List<ValidatedQuestion> validateQuestions(List<ExamInputs.QuestionInput> raw, String mode,
            Collection<String> existingLabels, Set<String> sectionNames, String prefix,
            List<OpenApiException.FieldError> errors, List<ExamViews.Warning> warnings) {
        List<ValidatedQuestion> out = new ArrayList<>();
        Set<String> labels = new HashSet<>();
        existingLabels.forEach(l -> labels.add(l.toLowerCase(Locale.ROOT)));
        String defaultSection = sectionNames.isEmpty() ? DEFAULT_SECTION : sectionNames.iterator().next();
        for (int i = 0; i < raw.size(); i++) {
            String f = prefix + "[" + i + "]";
            ExamInputs.QuestionInput q = raw.get(i);
            if (q == null) {
                errors.add(err(f, "required", "Question is empty."));
                continue;
            }
            int before = errors.size();
            String label = requiredText(q.getLabel(), f + ".label", MAX_LABEL, errors);
            noAngles(label, f + ".label", errors);
            if (label != null && !labels.add(label.toLowerCase(Locale.ROOT))) {
                errors.add(err(f + ".label", "duplicate", "Question label " + label + " is used twice in this exam."));
            }
            String parentLabel = optionalText(q.getParentLabel(), f + ".parent_label", MAX_LABEL, errors);
            noAngles(parentLabel, f + ".parent_label", errors);
            String section = q.getSection() == null || q.getSection().isBlank() ? defaultSection : q.getSection().trim();
            if (!sectionNames.isEmpty() && sectionNames.stream().noneMatch(s -> s.equalsIgnoreCase(section))) {
                errors.add(err(f + ".section", "unknown", "Section " + section + " is not declared in sections[]."));
            }
            String resolvedSection = sectionNames.stream().filter(s -> s.equalsIgnoreCase(section)).findFirst().orElse(section);
            String type = lower(q.getType());
            String internal = type == null ? null : TYPE_TO_INTERNAL.get(type);
            if (type == null) {
                errors.add(err(f + ".type", "required", "type is required."));
            } else if (internal == null) {
                errors.add(err(f + ".type", "invalid",
                        "type must be one of mcq_single, mcq_multi, true_false, numeric, one_word, long_answer."));
            }
            String text = requiredText(q.getText(), f + ".text", MAX_TEXT, errors);
            BigDecimal maxMarks = q.getMaxMarks();
            if (maxMarks == null) {
                errors.add(err(f + ".max_marks", "required", "max_marks is required."));
            } else if (maxMarks.signum() <= 0) {
                errors.add(err(f + ".max_marks", "out_of_range", "max_marks must be greater than 0."));
            } else if (maxMarks.remainder(HALF).signum() != 0) {
                errors.add(err(f + ".max_marks", "invalid_step", "max_marks must be a multiple of 0.5."));
            } else if (maxMarks.compareTo(MAX_MARKS_CAP) > 0) {
                errors.add(err(f + ".max_marks", "out_of_range", "max_marks is at most 1000."));
            }
            BigDecimal negative = q.getNegativeMarks() == null ? BigDecimal.ZERO : q.getNegativeMarks();
            if (negative.signum() < 0) {
                errors.add(err(f + ".negative_marks", "out_of_range", "negative_marks must be 0 or more."));
            }
            List<ExamInputs.OptionInput> options = q.getOptions() == null ? List.of() : q.getOptions();
            List<String> correct = q.getCorrectOptions() == null ? List.of() : q.getCorrectOptions();
            List<Double> numeric = null;
            String oneWord = null;
            boolean choice = "MCQS".equals(internal) || "MCQM".equals(internal) || "TRUE_FALSE".equals(internal);
            if (choice) {
                checkOptions(options, correct, internal, f, errors);
            } else if (!options.isEmpty() || !correct.isEmpty()) {
                errors.add(err(f + ".options", "not_allowed", "options and correct_options are only for MCQ and true/false."));
            }
            if ("NUMERIC".equals(internal)) {
                numeric = numericAnswers(q.getAnswer(), f + ".answer", errors);
            } else if ("ONE_WORD".equals(internal)) {
                oneWord = q.getAnswer() == null || !q.getAnswer().isValueNode() ? null : q.getAnswer().asText().trim();
                if (oneWord == null || oneWord.isEmpty()) {
                    errors.add(err(f + ".answer", "required", "answer is required for one_word questions."));
                } else if (oneWord.length() > 255) {
                    errors.add(err(f + ".answer", "too_long", "answer is at most 255 characters."));
                } else {
                    noAngles(oneWord, f + ".answer", errors);
                }
            } else if (q.getAnswer() != null && !q.getAnswer().isNull() && internal != null) {
                errors.add(err(f + ".answer", "not_allowed", "answer is only for numeric and one_word questions."));
            }
            String modelAnswer = optionalText(q.getModelAnswer(), f + ".model_answer", MAX_MODEL_ANSWER, errors);
            if (modelAnswer != null && internal != null && !"LONG_ANSWER".equals(internal)) {
                errors.add(err(f + ".model_answer", "not_allowed", "model_answer is only for long_answer questions."));
            }
            if (q.getRubric() != null && internal != null && !"LONG_ANSWER".equals(internal)) {
                errors.add(err(f + ".rubric", "not_allowed", "rubric is only for long_answer questions."));
            }
            RubricRules.checkShape(q.getRubric(), f + ".rubric", errors);
            if (q.getWordLimit() != null && q.getWordLimit() <= 0) {
                errors.add(err(f + ".word_limit", "out_of_range", "word_limit must be greater than 0."));
            }
            String externalId = optionalText(q.getExternalId(), f + ".external_id", MAX_EXTERNAL_ID, errors);
            if (q.getTags() != null && jsonLength(q.getTags()) > MAX_TAGS_BYTES) {
                errors.add(err(f + ".tags", "too_large", "tags are at most 2 KB."));
            }
            if (errors.size() > before) {
                continue;
            }
            if (MODE_HANDWRITTEN.equals(mode) && negative.signum() > 0) {
                warnings.add(new ExamViews.Warning("negative_marks_ignored",
                        "Negative marks are not applied to handwritten copies; question " + label + " is marked from 0.",
                        f + ".negative_marks"));
                negative = BigDecimal.ZERO;
            }
            out.add(new ValidatedQuestion(label, parentLabel, resolvedSection, type, internal, text, maxMarks, negative,
                    options.stream().map(o -> new ExamInputs.OptionInput(o.getLabel().trim(), o.getText())).toList(),
                    correct.stream().map(String::trim).toList(), numeric, oneWord, modelAnswer, q.getRubric(),
                    q.getWordLimit(), q.getExpectsDiagram(), q.getAssessLanguage(), q.getTags(), externalId));
        }
        return out;
    }

    private static void checkOptions(List<ExamInputs.OptionInput> options, List<String> correct, String internal,
            String f, List<OpenApiException.FieldError> errors) {
        if (options.size() < 2) {
            errors.add(err(f + ".options", "required", "MCQ and true/false questions need at least two options."));
        } else if (options.size() > MAX_OPTIONS) {
            errors.add(err(f + ".options", "too_many", "At most " + MAX_OPTIONS + " options."));
        }
        Set<String> seen = new HashSet<>();
        for (int j = 0; j < options.size(); j++) {
            ExamInputs.OptionInput o = options.get(j);
            String of = f + ".options[" + j + "]";
            if (o == null) {
                errors.add(err(of, "required", "Option is empty."));
                continue;
            }
            String label = requiredText(o.getLabel(), of + ".label", MAX_LABEL, errors);
            noAngles(label, of + ".label", errors);
            if (label != null && !seen.add(label)) {
                errors.add(err(of + ".label", "duplicate", "Option labels must be unique."));
            }
            requiredText(o.getText(), of + ".text", MAX_OPTION_TEXT, errors);
        }
        if (correct.isEmpty()) {
            errors.add(err(f + ".correct_options", "required", "correct_options is required for MCQ and true/false."));
        } else if (("MCQS".equals(internal) || "TRUE_FALSE".equals(internal)) && correct.size() != 1) {
            errors.add(err(f + ".correct_options", "invalid", "mcq_single and true_false take exactly one correct option."));
        } else if (new HashSet<>(correct).size() != correct.size()) {
            errors.add(err(f + ".correct_options", "duplicate", "correct_options lists a label twice."));
        }
    }

    private static List<Double> numericAnswers(JsonNode answer, String f, List<OpenApiException.FieldError> errors) {
        List<Double> out = new ArrayList<>();
        if (answer == null || answer.isNull()) {
            errors.add(err(f, "required", "answer is required for numeric questions."));
            return out;
        }
        List<JsonNode> values = new ArrayList<>();
        if (answer.isArray()) {
            answer.forEach(values::add);
        } else {
            values.add(answer);
        }
        for (JsonNode v : values) {
            try {
                if (v.isNumber()) {
                    out.add(v.asDouble());
                } else if (v.isTextual()) {
                    out.add(Double.parseDouble(v.asText().trim()));
                } else {
                    throw new NumberFormatException();
                }
            } catch (NumberFormatException e) {
                errors.add(err(f, "invalid", "answer must be a number (or a list of accepted numbers)."));
                return out;
            }
        }
        if (out.isEmpty()) {
            errors.add(err(f, "required", "answer is required for numeric questions."));
        }
        return out;
    }

    /**
     * Rules after shape: correct options name declared options, rubric marks and names.
     * Throws the first one broken; appends warnings.
     */
    public static void checkQuestionRules(List<ValidatedQuestion> questions, String prefix, List<ExamViews.Warning> warnings) {
        for (int i = 0; i < questions.size(); i++) {
            ValidatedQuestion q = questions.get(i);
            if (q.isChoice()) {
                Set<String> labels = new HashSet<>();
                q.options().forEach(o -> labels.add(o.getLabel()));
                for (String c : q.correctLabels()) {
                    if (!labels.contains(c)) {
                        Map<String, Object> details = new LinkedHashMap<>();
                        details.put("question_label", q.label());
                        details.put("option_label", c);
                        throw new OpenApiException(HttpStatus.UNPROCESSABLE_ENTITY, ApiErrorCode.UNKNOWN_OPTION_LABEL,
                                "Question " + q.label() + " marks option " + c + " correct, but has no option " + c + ".",
                                details);
                    }
                }
            }
            RubricRules.checkAgainstQuestion(q.rubric(), q.maxMarks(), q.label(), prefix + "[" + i + "].rubric", warnings);
        }
    }

    /** Warning {@code auto_rubric} for long answers with neither a rubric nor a model answer (spec 7.2). */
    public static void autoRubricWarning(List<ValidatedQuestion> questions, List<ExamViews.Warning> warnings) {
        long bare = questions.stream().filter(q -> q.isLongAnswer() && q.rubric() == null && q.modelAnswer() == null).count();
        if (bare > 0) {
            warnings.add(new ExamViews.Warning("auto_rubric", bare + (bare == 1 ? " long-answer question has" : " long-answer questions have")
                    + " no rubric or model answer; a rubric will be generated from the question text on the first copy.",
                    "questions"));
        }
    }

    // ------------------------------------------------------------------ choice groups

    /**
     * Shape and rules of {@code choice_groups[]}: labels exist and are unique across groups,
     * {@code attempt} is at least 1 and smaller than the group, policy is first or best.
     */
    public static void validateChoiceGroups(List<ExamInputs.ChoiceGroupInput> groups, Collection<String> examLabels,
            String prefix) {
        List<OpenApiException.FieldError> errors = new ArrayList<>();
        if (groups.size() > MAX_CHOICE_GROUPS) {
            errors.add(err(prefix, "too_many", "At most " + MAX_CHOICE_GROUPS + " choice groups."));
        }
        // Question labels are unique ignoring case, so groups match them ignoring case too.
        Set<String> known = new HashSet<>();
        examLabels.forEach(l -> known.add(l.trim().toLowerCase(Locale.ROOT)));
        Set<String> used = new HashSet<>();
        for (int i = 0; i < groups.size(); i++) {
            String f = prefix + "[" + i + "]";
            ExamInputs.ChoiceGroupInput g = groups.get(i);
            if (g == null) {
                errors.add(err(f, "required", "Choice group is empty."));
                continue;
            }
            optionalText(g.getLabel(), f + ".label", 255, errors);
            List<String> labels = g.getQuestionLabels() == null ? List.of() : g.getQuestionLabels();
            if (labels.size() < 2) {
                errors.add(err(f + ".question_labels", "required", "A choice group needs at least two questions."));
            }
            for (String l : labels) {
                String label = l == null ? null : l.trim();
                String key = label == null ? null : label.toLowerCase(Locale.ROOT);
                if (key == null || !known.contains(key)) {
                    errors.add(err(f + ".question_labels", "unknown", "No question labelled " + l + " in this exam."));
                } else if (!used.add(key)) {
                    errors.add(err(f + ".question_labels", "duplicate",
                            "Question " + label + " is in more than one choice group (or listed twice)."));
                }
            }
            Integer attempt = g.getAttempt();
            if (attempt == null) {
                errors.add(err(f + ".attempt", "required", "attempt is required."));
            } else if (attempt < 1 || (labels.size() >= 2 && attempt >= labels.size())) {
                errors.add(err(f + ".attempt", "out_of_range",
                        "attempt must be at least 1 and smaller than the number of questions in the group."));
            }
            String policy = lower(g.getPolicy());
            if (policy == null) {
                errors.add(err(f + ".policy", "required", "policy is required: first or best."));
            } else if (!policy.equals("first") && !policy.equals("best")) {
                errors.add(err(f + ".policy", "invalid", "policy must be first or best."));
            }
        }
        if (!errors.isEmpty()) {
            throw OpenApiException.validation(errors);
        }
    }

    /**
     * {@code paper_max} = sum of the max marks of questions in no group + for each group the
     * sum of its top {@code attempt} maxima (spec 7.2).
     */
    public static BigDecimal paperMax(Map<String, BigDecimal> maxByLabel, List<ExamInputs.ChoiceGroupInput> groups) {
        Set<String> grouped = new HashSet<>();
        BigDecimal total = BigDecimal.ZERO;
        if (groups != null) {
            for (ExamInputs.ChoiceGroupInput g : groups) {
                List<BigDecimal> maxima = new ArrayList<>();
                for (String l : g.getQuestionLabels()) {
                    String label = l.trim();
                    grouped.add(label);
                    maxima.add(maxByLabel.getOrDefault(label, BigDecimal.ZERO));
                }
                maxima.sort((a, b) -> b.compareTo(a));
                for (int i = 0; i < Math.min(g.getAttempt(), maxima.size()); i++) {
                    total = total.add(maxima.get(i));
                }
            }
        }
        for (Map.Entry<String, BigDecimal> e : maxByLabel.entrySet()) {
            if (!grouped.contains(e.getKey())) {
                total = total.add(e.getValue());
            }
        }
        return total;
    }

    // ------------------------------------------------------------------ candidates

    public static void validateCandidates(List<ExamInputs.CandidateInput> candidates, String prefix,
            List<OpenApiException.FieldError> errors) {
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < candidates.size(); i++) {
            String f = prefix + "[" + i + "]";
            ExamInputs.CandidateInput c = candidates.get(i);
            if (c == null) {
                errors.add(err(f, "required", "Candidate is empty."));
                continue;
            }
            String externalId = requiredText(c.getExternalId(), f + ".external_id", MAX_EXTERNAL_ID, errors);
            if (externalId != null && !seen.add(externalId)) {
                errors.add(err(f + ".external_id", "duplicate", "external_id appears twice in this request."));
            }
            String name = optionalText(c.getName(), f + ".name", MAX_CANDIDATE_NAME, errors);
            noAngles(name, f + ".name", errors);
            String roll = optionalText(c.getRollNumber(), f + ".roll_number", MAX_ROLL, errors);
            noAngles(roll, f + ".roll_number", errors);
            String cls = optionalText(c.getSectionOrClass(), f + ".section_or_class", MAX_ROLL, errors);
            noAngles(cls, f + ".section_or_class", errors);
            if (c.getMetadata() != null && !c.getMetadata().isNull()) {
                if (!c.getMetadata().isObject()) {
                    errors.add(err(f + ".metadata", "invalid", "metadata must be a JSON object."));
                } else if (c.getMetadata().toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length > MAX_METADATA_BYTES) {
                    errors.add(err(f + ".metadata", "too_large", "metadata is at most 2 KB."));
                }
            }
        }
    }

    // ------------------------------------------------------------------ helpers

    static OpenApiException.FieldError err(String field, String code, String message) {
        return new OpenApiException.FieldError(field, code, message);
    }

    static String lower(String s) {
        return s == null || s.isBlank() ? null : s.trim().toLowerCase(Locale.ROOT);
    }

    public static String requiredText(String value, String field, int max, List<OpenApiException.FieldError> errors) {
        if (value == null || value.isBlank()) {
            errors.add(err(field, "required", field + " is required."));
            return null;
        }
        String v = value.trim();
        if (v.length() > max) {
            errors.add(err(field, "too_long", field + " is at most " + max + " characters."));
            return null;
        }
        return v;
    }

    public static String optionalText(String value, String field, int max, List<OpenApiException.FieldError> errors) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String v = value.trim();
        if (v.length() > max) {
            errors.add(err(field, "too_long", field + " is at most " + max + " characters."));
            return null;
        }
        return v;
    }

    /**
     * Short identifiers and names (title, labels, section and candidate names) are shown as
     * plain text in many dashboard places; angle brackets are refused there instead of
     * being stored escaped and shown as entities.
     */
    public static void noAngles(String value, String field, List<OpenApiException.FieldError> errors) {
        if (value != null && (value.indexOf('<') >= 0 || value.indexOf('>') >= 0)) {
            errors.add(err(field, "invalid_characters", field + " cannot contain < or >."));
        }
    }

    public static LocalDate parseDate(String value, String field, List<OpenApiException.FieldError> errors) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return LocalDate.parse(value.trim());
        } catch (DateTimeParseException e) {
            errors.add(err(field, "invalid", field + " must be a date like 2026-10-14."));
            return null;
        }
    }

    /** Normalised language; null input means the default. Unknown values are field errors. */
    public static String language(String value, String field, List<OpenApiException.FieldError> errors) {
        String v = lower(value);
        if (v == null) {
            return DEFAULT_LANGUAGE;
        }
        if (!SUPPORTED_LANGUAGES.contains(v) && !KNOWN_UNSUPPORTED_LANGUAGES.contains(v)) {
            errors.add(err(field, "invalid", field + " must be en or hi."));
        }
        return v;
    }

    /** 422 {@code language_not_supported} for a declared language the engine cannot grade yet. */
    public static void checkLanguage(String value, String field) {
        String v = lower(value);
        if (v != null && KNOWN_UNSUPPORTED_LANGUAGES.contains(v)) {
            throw new OpenApiException(HttpStatus.UNPROCESSABLE_ENTITY, ApiErrorCode.LANGUAGE_NOT_SUPPORTED,
                    "Only English (en) is supported for now; " + field + " " + v + " is not available yet.",
                    Map.of("field", field, "language", v));
        }
    }

    private static int jsonLength(Object value) {
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsBytes(value).length;
        } catch (Exception e) {
            return Integer.MAX_VALUE;
        }
    }
}
