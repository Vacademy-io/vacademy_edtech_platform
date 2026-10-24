package vacademy.io.assessment_service.features.open_evaluation.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.assessment_service.features.open_evaluation.OpenApiPaths;
import vacademy.io.assessment_service.features.open_evaluation.auth.OpenApiCaller;
import vacademy.io.assessment_service.features.open_evaluation.choice.ChoiceGroupService;
import vacademy.io.assessment_service.features.open_evaluation.credits.OpenCreditsService;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.assessment_service.features.open_evaluation.exam.ExamValidator;
import vacademy.io.assessment_service.features.open_evaluation.exam.OpenExamService;
import vacademy.io.assessment_service.features.open_evaluation.exam.OpenQuestionService;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamInputs;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamViews;
import vacademy.io.assessment_service.features.open_evaluation.idempotency.IdempotencyService;
import vacademy.io.assessment_service.features.open_evaluation.rubric.OpenRubricService;
import vacademy.io.assessment_service.features.open_evaluation.rubric.RubricSyncService;
import vacademy.io.assessment_service.features.open_evaluation.support.Paging;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Exams, questions, rubrics and choice groups of the partner API
 * (docs/AI_EVALUATION_PUBLIC_API.md 7.1, 7.2, 7.4). The tenant is always the calling key's
 * institute; ids of other institutes answer 404. Writes that touch the rubric store are
 * committed first and pushed to ai_service after commit (never inside the transaction).
 */
@Slf4j
@RestController
@RequestMapping(OpenApiPaths.BASE)
@Tag(name = "Exams", description = "Exams, questions, rubrics and choice groups")
public class OpenExamController {

    private final OpenExamService exams;
    private final OpenQuestionService questions;
    private final OpenRubricService rubrics;
    private final ChoiceGroupService choiceGroups;
    private final RubricSyncService rubricSync;
    private final IdempotencyService idempotency;
    private final OpenCreditsService credits;

    public OpenExamController(OpenExamService exams, OpenQuestionService questions, OpenRubricService rubrics,
            ChoiceGroupService choiceGroups, RubricSyncService rubricSync, IdempotencyService idempotency,
            OpenCreditsService credits) {
        this.exams = exams;
        this.questions = questions;
        this.rubrics = rubrics;
        this.choiceGroups = choiceGroups;
        this.rubricSync = rubricSync;
        this.idempotency = idempotency;
        this.credits = credits;
    }

    // ------------------------------------------------------------------ exams

    @Operation(summary = "Create an exam (questions, choice groups and candidates may be inline; open:true opens it)")
    @PostMapping("/exams")
    @PreAuthorize("@apiScopes.has('evaluation:write')")
    public ResponseEntity<?> createExam(@RequestBody ExamInputs.CreateExam body,
            @RequestHeader(value = IdempotencyService.HEADER, required = false) String idemKey,
            HttpServletRequest request) {
        ApiKeyPrincipal key = OpenApiCaller.require();
        return idempotency.execute(key, idemKey, "POST", request.getRequestURI(), body, false, OpenExamController::idOf,
                null, () -> {
                    OpenExamService.CreateResult created = exams.createExam(key, body);
                    ExamViews.RubricSummary rubric = ExamViews.RubricSummary.builder()
                            .locked(false)
                            .questionsWithRubric(created.questionsWithRubric())
                            .build();
                    List<ExamViews.Warning> warnings = new ArrayList<>(created.warnings());
                    if (created.rubricStaged()) {
                        applyFlush(rubricSync.flush(created.examId(), null), rubric, warnings);
                    }
                    ExamViews.Exam view = exams.render(key, created.examId(),
                            new OpenExamService.Include(true, false, true, false, false));
                    rubric.setQuestionsWithoutRubric(view.getQuestionCount() - created.questionsWithRubric());
                    view.setRubric(rubric);
                    if (!created.candidates().isEmpty()) {
                        view.setCandidates(created.candidates());
                    }
                    // After commit, outside the transaction; best effort with a short timeout.
                    view.setQuote(credits.examRate(key, ExamValidator.MODE_TYPED.equalsIgnoreCase(view.getMode())));
                    view.setWarnings(warnings.isEmpty() ? null : warnings);
                    return ResponseEntity.status(HttpStatus.CREATED).cacheControl(CacheControl.noStore()).body(view);
                });
    }

    /** Create never fails after commit: a rubric push problem becomes {@code sync} / a warning. */
    static void applyFlush(RubricSyncService.FlushResult result, ExamViews.RubricSummary rubric,
            List<ExamViews.Warning> warnings) {
        switch (result.outcome()) {
            case SYNCED -> rubric.setVersion(result.version());
            case PENDING -> rubric.setSync(OpenRubricService.SYNC_PENDING);
            case REJECTED -> warnings.add(new ExamViews.Warning("rubric_not_saved",
                    "The rubric store refused the rubrics of this exam; set them again with PUT …/rubric.", "rubric"));
            default -> {
            }
        }
    }

    static String idOf(ResponseEntity<?> response) {
        return response.getBody() instanceof ExamViews.Exam exam ? exam.getId() : null;
    }

    @Operation(summary = "Get an exam; include=questions,candidates,choice_groups,stats,rubric")
    @GetMapping("/exams/{examId}")
    @PreAuthorize("@apiScopes.has('evaluation:read')")
    public ExamViews.Exam getExam(@PathVariable String examId,
            @RequestParam(value = "include", required = false) String include) {
        return exams.get(OpenApiCaller.require(), examId, OpenExamService.Include.parse(include));
    }

    @Operation(summary = "List this institute's API exams")
    @GetMapping("/exams")
    @PreAuthorize("@apiScopes.has('evaluation:read')")
    public Paging.Page<ExamViews.Exam> listExams(@RequestParam(value = "status", required = false) String status,
            @RequestParam(value = "updated_since", required = false) String updatedSince,
            @RequestParam(value = "cursor", required = false) String cursor,
            @RequestParam(value = "limit", required = false) Integer limit) {
        return exams.list(OpenApiCaller.require(), status, updatedSince, cursor, limit);
    }

    @Operation(summary = "Find exams by external_ref")
    @PostMapping("/exams/search")
    @PreAuthorize("@apiScopes.has('evaluation:read')")
    public Map<String, Object> searchExams(@RequestBody ExamInputs.SearchExams body) {
        return Map.of("data", exams.search(OpenApiCaller.require(), body == null ? null : body.getExternalRefs()));
    }

    @Operation(summary = "Edit an exam")
    @PatchMapping("/exams/{examId}")
    @PreAuthorize("@apiScopes.has('evaluation:write')")
    public ExamViews.Exam patchExam(@PathVariable String examId, @RequestBody ObjectNode body) {
        ApiKeyPrincipal key = OpenApiCaller.require();
        List<ExamViews.Warning> warnings = exams.patch(key, examId, body);
        ExamViews.Exam view = exams.render(key, examId, new OpenExamService.Include(false, false, false, false, false));
        view.setWarnings(warnings.isEmpty() ? null : warnings);
        return view;
    }

    @Operation(summary = "Open a draft exam for submissions")
    @PostMapping("/exams/{examId}/open")
    @PreAuthorize("@apiScopes.has('evaluation:write')")
    public ResponseEntity<?> openExam(@PathVariable String examId,
            @RequestHeader(value = IdempotencyService.HEADER, required = false) String idemKey,
            HttpServletRequest request) {
        ApiKeyPrincipal key = OpenApiCaller.require();
        return idempotency.execute(key, idemKey, "POST", request.getRequestURI(), null, false, OpenExamController::idOf,
                null, () -> {
                    List<ExamViews.Warning> warnings = exams.open(key, examId);
                    ExamViews.Exam view = exams.render(key, examId,
                            new OpenExamService.Include(false, false, false, false, false));
                    view.setWarnings(warnings.isEmpty() ? null : warnings);
                    return ResponseEntity.ok(view);
                });
    }

    @Operation(summary = "Delete a draft exam (or one without submissions)")
    @DeleteMapping("/exams/{examId}")
    @PreAuthorize("@apiScopes.has('evaluation:write')")
    public Map<String, Object> deleteExam(@PathVariable String examId,
            @RequestParam(value = "purge", required = false) Boolean purge) {
        if (Boolean.TRUE.equals(purge)) {
            throw new OpenApiException(HttpStatus.UNPROCESSABLE_ENTITY,
                    vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode.FEATURE_NOT_AVAILABLE,
                    "purge=true is not available yet.");
        }
        exams.delete(OpenApiCaller.require(), examId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", examId);
        out.put("status", "deleted");
        return out;
    }

    // ------------------------------------------------------------------ questions

    @Operation(summary = "Add questions to a draft exam")
    @PostMapping("/exams/{examId}/questions")
    @PreAuthorize("@apiScopes.has('evaluation:write')")
    public ResponseEntity<?> addQuestions(@PathVariable String examId, @RequestBody ExamInputs.AddQuestions body,
            @RequestHeader(value = IdempotencyService.HEADER, required = false) String idemKey,
            HttpServletRequest request) {
        ApiKeyPrincipal key = OpenApiCaller.require();
        return idempotency.execute(key, idemKey, "POST", request.getRequestURI(), body, false, r -> examId, null, () -> {
            OpenQuestionService.Written written = questions.addQuestions(key, examId, body);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("questions", written.questions());
            if (written.rubricStaged()) {
                out.put("rubric", syncFields(examId));
            }
            if (!written.warnings().isEmpty()) {
                out.put("warnings", written.warnings());
            }
            return ResponseEntity.status(HttpStatus.CREATED).body(out);
        });
    }

    /** Rubric push after a question write: version or sync pending; a refusal becomes a warning field. */
    private Map<String, Object> syncFields(String examId) {
        RubricSyncService.FlushResult result = rubricSync.flush(examId, null);
        Map<String, Object> out = new LinkedHashMap<>();
        switch (result.outcome()) {
            case SYNCED -> out.put("version", result.version());
            case PENDING -> out.put("sync", OpenRubricService.SYNC_PENDING);
            case REJECTED -> out.put("sync", RubricSyncService.SYNC_FAILED);
            default -> {
            }
        }
        return out;
    }

    @Operation(summary = "List an exam's questions; include=rubric,model_answer")
    @GetMapping("/exams/{examId}/questions")
    @PreAuthorize("@apiScopes.has('evaluation:read')")
    public Map<String, Object> listQuestions(@PathVariable String examId,
            @RequestParam(value = "include", required = false) String include) {
        ApiKeyPrincipal key = OpenApiCaller.require();
        String inc = include == null ? "" : include.toLowerCase();
        boolean withRubric = inc.contains("rubric");
        boolean withModelAnswer = inc.contains("model_answer");
        List<ExamViews.Question> list = questions.listQuestions(key, examId, withModelAnswer);
        if (withRubric) {
            Map<String, Object> stored = rubrics.list(key, examId);
            Map<String, Object> rubricById = new LinkedHashMap<>();
            Object rows = stored.get("questions");
            if (rows instanceof List<?> l) {
                for (Object o : l) {
                    if (o instanceof Map<?, ?> m && m.get("rubric") != null) {
                        rubricById.put(String.valueOf(m.get("question_id")), m.get("rubric"));
                    }
                }
            }
            for (ExamViews.Question q : list) {
                Object r = rubricById.get(q.getId());
                if (r instanceof Map<?, ?> map) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> typed = (Map<String, Object>) map;
                    q.setRubric(typed);
                }
            }
        }
        return Map.of("questions", list);
    }

    @Operation(summary = "Edit a question (draft: anything; open: text, model_answer, rubric, tags, word_limit, expects_diagram)")
    @PatchMapping("/exams/{examId}/questions/{questionId}")
    @PreAuthorize("@apiScopes.has('evaluation:write')")
    public ExamViews.Question patchQuestion(@PathVariable String examId, @PathVariable String questionId,
            @RequestBody ObjectNode body) {
        ApiKeyPrincipal key = OpenApiCaller.require();
        OpenQuestionService.Patched patched = questions.patchQuestion(key, examId, questionId, body);
        ExamViews.Question view = patched.question();
        if (patched.rubricStaged()) {
            Map<String, Object> sync = syncFields(examId);
            if (sync.get("version") instanceof Integer v) {
                view.setRubricVersion(v);
            }
            if (sync.get("sync") != null) {
                view.setRubricSync(String.valueOf(sync.get("sync")));
            }
        }
        view.setWarnings(patched.warnings().isEmpty() ? null : patched.warnings());
        return view;
    }

    @Operation(summary = "Remove a question from a draft exam")
    @DeleteMapping("/exams/{examId}/questions/{questionId}")
    @PreAuthorize("@apiScopes.has('evaluation:write')")
    public Map<String, Object> deleteQuestion(@PathVariable String examId, @PathVariable String questionId) {
        ApiKeyPrincipal key = OpenApiCaller.require();
        questions.deleteQuestion(key, examId, questionId);
        rubricSync.flush(examId, null);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", questionId);
        out.put("deleted", true);
        return out;
    }

    // ------------------------------------------------------------------ rubrics

    @Operation(summary = "Rubrics and model answers of an exam")
    @GetMapping("/exams/{examId}/rubrics")
    @PreAuthorize("@apiScopes.has('evaluation:read')")
    public Map<String, Object> getRubrics(@PathVariable String examId) {
        return rubrics.list(OpenApiCaller.require(), examId);
    }

    @Operation(summary = "Set or clear one question's rubric and/or model answer (If-Match: rubric version)")
    @PutMapping("/exams/{examId}/questions/{questionId}/rubric")
    @PreAuthorize("@apiScopes.has('evaluation:write')")
    public Map<String, Object> putRubric(@PathVariable String examId, @PathVariable String questionId,
            @RequestBody JsonNode body, @RequestHeader(value = "If-Match", required = false) String ifMatchHeader) {
        ApiKeyPrincipal key = OpenApiCaller.require();
        Integer ifMatch = OpenRubricService.ifMatch(ifMatchHeader);
        Map<String, JsonNode> changes = new LinkedHashMap<>();
        changes.put(questionId, body);
        OpenRubricService.Staged staged = rubrics.stage(key, examId, changes, ifMatch);
        Map<String, Object> out = rubrics.flushForResponse(examId, ifMatch);
        out.put("question", staged.views().get(questionId));
        if (!staged.warnings().isEmpty()) {
            out.put("warnings", staged.warnings());
        }
        return out;
    }

    @Operation(summary = "Set or clear rubrics / model answers of several questions in one version bump")
    @PatchMapping("/exams/{examId}/rubrics")
    @PreAuthorize("@apiScopes.has('evaluation:write')")
    public Map<String, Object> patchRubrics(@PathVariable String examId, @RequestBody JsonNode body,
            @RequestHeader(value = "If-Match", required = false) String ifMatchHeader) {
        ApiKeyPrincipal key = OpenApiCaller.require();
        Integer ifMatch = OpenRubricService.ifMatch(ifMatchHeader);
        OpenRubricService.Staged staged = rubrics.stage(key, examId, OpenRubricService.changesOf(body), ifMatch);
        Map<String, Object> out = rubrics.flushForResponse(examId, ifMatch);
        out.put("questions", new ArrayList<>(staged.views().values()));
        if (!staged.warnings().isEmpty()) {
            out.put("warnings", staged.warnings());
        }
        return out;
    }

    // ------------------------------------------------------------------ choice groups

    @Operation(summary = "Replace the exam's choice groups (internal choice)")
    @PutMapping("/exams/{examId}/choice-groups")
    @PreAuthorize("@apiScopes.has('evaluation:write')")
    public Map<String, Object> putChoiceGroups(@PathVariable String examId,
            @RequestBody ExamInputs.ReplaceChoiceGroups body) {
        ChoiceGroupService.Replaced replaced = choiceGroups.replace(OpenApiCaller.require(), examId, body);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("choice_groups", replaced.choiceGroups());
        out.put("total_marks", replaced.totalMarks());
        out.put("paper_max", replaced.paperMax());
        return out;
    }
}
