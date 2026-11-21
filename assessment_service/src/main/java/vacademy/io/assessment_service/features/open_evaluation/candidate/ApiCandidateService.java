package vacademy.io.assessment_service.features.open_evaluation.candidate;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.assessment.dto.create_assessment.AssessmentRegistrationsDto;
import vacademy.io.assessment_service.features.assessment.manager.AssessmentParticipantsManager;
import vacademy.io.assessment_service.features.open_evaluation.auth.ApiActorPrincipals;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.assessment_service.features.open_evaluation.exam.ApiExamStore;
import vacademy.io.assessment_service.features.open_evaluation.exam.ExamGuards;
import vacademy.io.assessment_service.features.open_evaluation.exam.ExamValidator;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamInputs;
import vacademy.io.assessment_service.features.open_evaluation.support.Paging;
import vacademy.io.assessment_service.features.open_evaluation.support.PublicStatus;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;
import vacademy.io.common.student.dto.BasicParticipantDTO;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Candidates (spec 7.3, T1.22). A candidate belongs to an institute, is addressed by the
 * partner's {@code external_id} (in bodies only, never in URLs, 6.6) and has no Vacademy
 * login. Registering one on an exam goes through the dashboard's own
 * {@code AssessmentParticipantsManager.saveParticipantsToAssessment} with:
 * {@code user_id = "apic_" + id}, {@code username} = roll number or external id,
 * {@code participant_name} = name (external id when blind or nameless),
 * {@code user_email = ""}, {@code source = ADMIN_PRE_REGISTRATION},
 * {@code source_id = "apikey:{key_id}"} (the synthetic actor's id), so every no-email rule
 * of {@code ApiCandidatePolicy} applies.
 */
@Service
public class ApiCandidateService {

    public static final int MAX_SEARCH = 500;
    static final String EXAM_PLAY_MODE = "EXAM";

    private final ApiCandidateStore store;
    private final ApiExamStore examStore;
    private final AssessmentParticipantsManager participantsManager;
    private final ObjectMapper objectMapper;

    @PersistenceContext
    private EntityManager entityManager;

    public ApiCandidateService(ApiCandidateStore store, ApiExamStore examStore,
            AssessmentParticipantsManager participantsManager, ObjectMapper objectMapper) {
        this.store = store;
        this.examStore = examStore;
        this.participantsManager = participantsManager;
        this.objectMapper = objectMapper;
    }

    // ------------------------------------------------------------------ views

    public Map<String, Object> view(ApiCandidateStore.CandidateRow c) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", c.id());
        out.put("external_id", c.externalId());
        if (c.name() != null) {
            out.put("name", c.name());
        }
        if (c.rollNumber() != null) {
            out.put("roll_number", c.rollNumber());
        }
        if (c.sectionOrClass() != null) {
            out.put("section_or_class", c.sectionOrClass());
        }
        if (c.metadataJson() != null) {
            try {
                out.put("metadata", objectMapper.readTree(c.metadataJson()));
            } catch (Exception ignored) {
                // stored by us as valid JSON; never fails in practice
            }
        }
        out.put("created_at", iso(c.createdAt()));
        out.put("updated_at", iso(c.updatedAt()));
        return out;
    }

    static String iso(Instant at) {
        return at == null ? null : at.toString();
    }

    // ------------------------------------------------------------------ POST /candidates

    @Transactional
    public List<Map<String, Object>> upsert(ApiKeyPrincipal key, List<ExamInputs.CandidateInput> candidates) {
        validateBatch(candidates);
        List<Map<String, Object>> out = new ArrayList<>();
        for (ApiCandidateStore.Upserted u : upsertAll(key, candidates)) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", u.id());
            row.put("external_id", u.externalId());
            row.put("created", u.created());
            out.add(row);
        }
        return out;
    }

    private void validateBatch(List<ExamInputs.CandidateInput> candidates) {
        List<OpenApiException.FieldError> errors = new ArrayList<>();
        if (candidates == null || candidates.isEmpty()) {
            errors.add(new OpenApiException.FieldError("candidates", "required",
                    "Send 1 to " + ExamValidator.MAX_CANDIDATES + " candidates."));
        } else if (candidates.size() > ExamValidator.MAX_CANDIDATES) {
            errors.add(new OpenApiException.FieldError("candidates", "too_many",
                    "At most " + ExamValidator.MAX_CANDIDATES + " candidates per call."));
        } else {
            ExamValidator.validateCandidates(candidates, "candidates", errors);
        }
        if (!errors.isEmpty()) {
            throw OpenApiException.validation(errors);
        }
    }

    List<ApiCandidateStore.Upserted> upsertAll(ApiKeyPrincipal key, List<ExamInputs.CandidateInput> candidates) {
        List<ApiCandidateStore.Upserted> out = new ArrayList<>();
        for (ExamInputs.CandidateInput c : candidates) {
            out.add(store.upsert(key.getInstituteId(), key.getKeyId(), c));
        }
        return out;
    }

    // ------------------------------------------------------------------ search / get

    @Transactional(readOnly = true)
    public List<Map<String, Object>> search(ApiKeyPrincipal key, List<String> externalIds) {
        if (externalIds == null || externalIds.isEmpty() || externalIds.size() > MAX_SEARCH) {
            throw OpenApiException.validation("external_ids", "out_of_range",
                    "Send 1 to " + MAX_SEARCH + " external_ids.");
        }
        Set<String> trimmed = new LinkedHashSet<>();
        externalIds.stream().filter(e -> e != null && !e.isBlank()).forEach(e -> trimmed.add(e.trim()));
        return store.findByExternalIds(key.getInstituteId(), trimmed).stream().map(this::view).toList();
    }

    @Transactional(readOnly = true)
    public Map<String, Object> get(ApiKeyPrincipal key, String candidateId) {
        return view(store.findById(key.getInstituteId(), candidateId).orElseThrow(ApiCandidateService::candidateNotFound));
    }

    static OpenApiException candidateNotFound() {
        return OpenApiException.notFound(ApiErrorCode.CANDIDATE_NOT_FOUND, "No candidate with this id.");
    }

    // ------------------------------------------------------------------ POST /exams/{id}/candidates

    /** Outcome of a registration call. */
    public record Registration(int registered, int alreadyRegistered, List<Map<String, Object>> candidates) {
    }

    @Transactional
    public Registration register(ApiKeyPrincipal key, String examId, List<ExamInputs.CandidateInput> candidates,
            List<String> candidateIds) {
        ApiExamStore.ApiExamRow exam = ExamGuards.requireLive(examStore, key.getInstituteId(), examId, true);
        ExamGuards.requireNotFinalized(exam);
        boolean hasCandidates = candidates != null && !candidates.isEmpty();
        boolean hasIds = candidateIds != null && !candidateIds.isEmpty();
        if (hasCandidates == hasIds) {
            throw OpenApiException.validation("candidates", "required",
                    "Send either candidates (to upsert and register) or candidate_ids.");
        }
        List<ApiCandidateStore.CandidateRow> rows;
        if (hasCandidates) {
            validateBatch(candidates);
            List<String> ids = upsertAll(key, candidates).stream().map(ApiCandidateStore.Upserted::id).toList();
            rows = orderBy(ids, store.findByIds(key.getInstituteId(), ids));
        } else {
            if (candidateIds.size() > ExamValidator.MAX_CANDIDATES) {
                throw OpenApiException.validation("candidate_ids", "too_many",
                        "At most " + ExamValidator.MAX_CANDIDATES + " candidate_ids per call.");
            }
            Set<String> unique = new LinkedHashSet<>(candidateIds);
            rows = orderBy(new ArrayList<>(unique), store.findByIds(key.getInstituteId(), unique));
            if (rows.size() != unique.size()) {
                Set<String> missing = new LinkedHashSet<>(unique);
                rows.forEach(r -> missing.remove(r.id()));
                throw new OpenApiException(org.springframework.http.HttpStatus.NOT_FOUND, ApiErrorCode.CANDIDATE_NOT_FOUND,
                        missing.size() + " candidate id(s) are unknown.", Map.of("candidate_ids", List.copyOf(missing)));
            }
        }
        return registerRows(key, exam, rows);
    }

    /** Registers candidate rows on the exam (also used by {@code POST /exams} with inline candidates). */
    public Registration registerRows(ApiKeyPrincipal key, ApiExamStore.ApiExamRow exam,
            List<ApiCandidateStore.CandidateRow> rows) {
        List<String> userIds = rows.stream().map(ApiCandidateStore.CandidateRow::userId).toList();
        Map<String, String> before = store.registrations(exam.assessmentId(), key.getInstituteId(), userIds);
        List<BasicParticipantDTO> added = new ArrayList<>();
        for (ApiCandidateStore.CandidateRow c : rows) {
            if (!before.containsKey(c.userId())) {
                added.add(participant(c, exam.blind()));
            }
        }
        if (!added.isEmpty()) {
            participantsManager.saveParticipantsToAssessment(ApiActorPrincipals.forKey(key), registrationRequest(added),
                    exam.assessmentId(), key.getInstituteId(), EXAM_PLAY_MODE);
            entityManager.flush();
        }
        Map<String, String> after = added.isEmpty() ? before
                : store.registrations(exam.assessmentId(), key.getInstituteId(), userIds);
        List<Map<String, Object>> out = new ArrayList<>();
        for (ApiCandidateStore.CandidateRow c : rows) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", c.id());
            row.put("external_id", c.externalId());
            row.put("registration_id", after.get(c.userId()));
            out.add(row);
        }
        if (!added.isEmpty()) {
            examStore.touch(exam.assessmentId());
        }
        return new Registration(added.size(), rows.size() - added.size(), out);
    }

    static BasicParticipantDTO participant(ApiCandidateStore.CandidateRow c, boolean blind) {
        BasicParticipantDTO p = new BasicParticipantDTO();
        p.setUserId(c.userId());
        p.setUsername(c.rollNumber() != null ? c.rollNumber() : c.externalId());
        p.setFullName(blind || c.name() == null ? c.externalId() : c.name());
        // No Vacademy login, no email (spec 5): the report sender skips blank addresses.
        p.setEmail("");
        return p;
    }

    /**
     * Closed-test registration with every notification switched off. The notify blocks
     * are sent explicitly: the manager writes assessment_notification_metadata, whose
     * "before goes live" columns are NOT NULL.
     */
    static AssessmentRegistrationsDto registrationRequest(List<BasicParticipantDTO> added) {
        AssessmentRegistrationsDto dto = new AssessmentRegistrationsDto();
        dto.setClosedTest(true);
        dto.setAddedPreRegisterStudentsDetails(new ArrayList<>(added));
        dto.setDeletedPreRegisterStudentsDetails(new ArrayList<>());
        dto.setAddedPreRegisterBatchesDetails(new ArrayList<>());
        dto.setDeletedPreRegisterBatchesDetails(new ArrayList<>());
        dto.setNotifyStudent(new AssessmentRegistrationsDto.NotifyStudent(false, false, 0, false, false));
        dto.setNotifyParent(new AssessmentRegistrationsDto.NotifyParent(false, 0, false, false, false, false, false));
        return dto;
    }

    private static List<ApiCandidateStore.CandidateRow> orderBy(List<String> ids, List<ApiCandidateStore.CandidateRow> rows) {
        Map<String, ApiCandidateStore.CandidateRow> byId = new LinkedHashMap<>();
        rows.forEach(r -> byId.put(r.id(), r));
        List<ApiCandidateStore.CandidateRow> out = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        for (String id : ids) {
            ApiCandidateStore.CandidateRow r = byId.get(id);
            if (r != null && seen.add(id)) {
                out.add(r);
            }
        }
        return out;
    }

    // ------------------------------------------------------------------ GET /exams/{id}/candidates

    @Transactional(readOnly = true)
    public Paging.Page<Map<String, Object>> listForExam(ApiKeyPrincipal key, String examId, Integer limit, String cursor,
            String updatedSince) {
        ExamGuards.requireLive(examStore, key.getInstituteId(), examId, false);
        int size = Paging.limit(limit);
        Paging.Cursor after = Paging.decode(cursor);
        Instant since = Paging.updatedSince(updatedSince);
        List<ApiCandidateStore.ExamCandidateRow> rows = store.examCandidates(examId, key.getInstituteId(), since, after,
                size + 1);
        Paging.Page<ApiCandidateStore.ExamCandidateRow> page = Paging.page(rows, size,
                r -> new Paging.Cursor(r.registrationUpdatedAt(), r.registrationId()));
        List<Map<String, Object>> data = new ArrayList<>();
        for (ApiCandidateStore.ExamCandidateRow r : page.data()) {
            Map<String, Object> row = view(r.candidate());
            row.put("registration_id", r.registrationId());
            row.put("submission_id", r.submissionId());
            row.put("submission_status", r.submissionId() == null ? null
                    : PublicStatus.submission(r.processStatus(), r.anyQuestionFailed()));
            data.add(row);
        }
        return new Paging.Page<>(data, page.nextCursor(), page.hasMore());
    }

    // ------------------------------------------------------------------ DELETE /exams/{id}/candidates/{cid}

    @Transactional
    public void unregister(ApiKeyPrincipal key, String examId, String candidateId) {
        ApiExamStore.ApiExamRow exam = ExamGuards.requireLive(examStore, key.getInstituteId(), examId, true);
        ExamGuards.requireNotFinalized(exam);
        ApiCandidateStore.CandidateRow c = store.findById(key.getInstituteId(), candidateId)
                .orElseThrow(ApiCandidateService::candidateNotFound);
        if (!store.registrations(examId, key.getInstituteId(), List.of(c.userId())).containsKey(c.userId())) {
            throw OpenApiException.notFound(ApiErrorCode.CANDIDATE_NOT_FOUND, "The candidate is not registered on this exam.");
        }
        if (store.hasSubmission(examId, candidateId)) {
            throw OpenApiException.conflict(ApiErrorCode.CANDIDATE_HAS_SUBMISSION,
                    "The candidate has a submission on this exam; delete the submission first.",
                    Map.of("candidate_id", candidateId));
        }
        AssessmentRegistrationsDto dto = registrationRequest(List.of());
        BasicParticipantDTO removed = new BasicParticipantDTO();
        removed.setUserId(c.userId());
        dto.setDeletedPreRegisterStudentsDetails(new ArrayList<>(List.of(removed)));
        participantsManager.saveParticipantsToAssessment(ApiActorPrincipals.forKey(key), dto, examId,
                key.getInstituteId(), EXAM_PLAY_MODE);
        examStore.touch(examId);
    }
}
