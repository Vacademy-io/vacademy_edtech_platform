package vacademy.io.assessment_service.features.assessment.manager;


import org.springframework.beans.factory.annotation.Autowired;
import java.util.Set;
import java.util.HashSet;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import vacademy.io.assessment_service.features.question_core.util.CbeConfigRedactor;
import vacademy.io.assessment_service.features.assessment.enums.AssessmentStatus;
import vacademy.io.assessment_service.features.open_evaluation.policy.ApiCandidatePolicy;
import vacademy.io.assessment_service.features.question_core.dto.QuestionDTO;
import vacademy.io.assessment_service.features.question_bank.manager.AddQuestionPaperFromImportManager;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.ObjectUtils;
import vacademy.io.assessment_service.features.assessment.dto.AssessmentQuestionPreviewDto;
import vacademy.io.assessment_service.features.assessment.dto.AssessmentSaveResponseDto;
import vacademy.io.assessment_service.features.assessment.dto.SectionAddEditRequestDto;
import vacademy.io.assessment_service.features.assessment.dto.create_assessment.AddQuestionsAssessmentDetailsDTO;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.assessment.enums.ProblemRandomType;
import vacademy.io.assessment_service.features.assessment.repository.SectionRepository;
import vacademy.io.assessment_service.features.assessment.service.assessment_get.AssessmentService;
import vacademy.io.assessment_service.features.assessment.service.bulk_entry_services.QuestionAssessmentSectionMappingService;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_library.service.QuestionLibraryCopyService;
import vacademy.io.assessment_service.features.rich_text.entity.AssessmentRichTextData;
import vacademy.io.assessment_service.features.rich_text.enums.TextType;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.*;

import static org.hibernate.event.internal.EntityState.DELETED;
import static org.hibernate.resource.transaction.spi.TransactionStatus.ACTIVE;

@Component
public class AssessmentLinkQuestionsManager {

    @Autowired
    private vacademy.io.assessment_service.features.assessment.service.aireport.ReportProfileService reportProfileService;

    @Autowired
    SectionRepository sectionRepository;

    @Autowired
    AssessmentService assessmentService;

    @Autowired
    QuestionAssessmentSectionMappingService questionAssessmentSectionMappingService;

    @Autowired
    AddQuestionPaperFromImportManager addQuestionPaperFromImportManager;

    @Transactional
    public ResponseEntity<AssessmentSaveResponseDto> saveQuestionsToAssessment(CustomUserDetails user, AddQuestionsAssessmentDetailsDTO addQuestionsAssessmentDetailsDTO, String assessmentId, String instituteId, String type) {

        Optional<Assessment> assessmentOptional = assessmentService.getAssessmentWithActiveSections(assessmentId, instituteId);

        if (assessmentOptional.isEmpty()) {
            throw new VacademyException("Assessment not found");
        }
        requireApiStructureUnlocked(assessmentOptional.get(), addQuestionsAssessmentDetailsDTO);

        for (SectionAddEditRequestDto sectionAddEditRequestDto : addQuestionsAssessmentDetailsDTO.getAddedSections()) {
            addSectionToAssessment(user, sectionAddEditRequestDto, assessmentOptional.get(), instituteId, type);
        }

        for (SectionAddEditRequestDto sectionAddEditRequestDto : addQuestionsAssessmentDetailsDTO.getUpdatedSections()) {
            Optional<Section> thisSection = assessmentOptional.get().getSections().stream().filter((s) -> s.getId().equals(sectionAddEditRequestDto.getSectionId())).findFirst();
            if (thisSection.isEmpty()) continue;
            updateSectionForAssessment(thisSection.get(), sectionAddEditRequestDto, assessmentOptional.get(), instituteId, type);
        }

        for (SectionAddEditRequestDto sectionAddEditRequestDto : addQuestionsAssessmentDetailsDTO.getDeletedSections()) {
            Optional<Section> thisSection = assessmentOptional.get().getSections().stream().filter((s) -> s.getId().equals(sectionAddEditRequestDto.getSectionId())).findFirst();
            if (thisSection.isEmpty()) continue;
            deleteSectionForAssessment(thisSection.get(), sectionAddEditRequestDto, assessmentId, instituteId, type);
        }

        addOrUpdateTestDurationData(assessmentOptional.get(), addQuestionsAssessmentDetailsDTO.getTestDuration());


        AssessmentSaveResponseDto assessmentSaveResponseDto = new AssessmentSaveResponseDto(assessmentId, assessmentOptional.get().getStatus());
        return ResponseEntity.ok(assessmentSaveResponseDto);
    }

    /**
     * Exams created through the partner API freeze their structure once open (spec 7.1):
     * submitted attempts are marked against the linked scheme, so questions cannot be added
     * or removed and max marks cannot change. Enforced here, server-side, for every caller
     * (the dashboard dialog included), only for {@code source = 'API'} exams that are
     * PUBLISHED. Dashboard exams and API drafts are untouched. Section renames, order and
     * duration edits, and re-sending unchanged marks stay allowed.
     */
    void requireApiStructureUnlocked(Assessment assessment, AddQuestionsAssessmentDetailsDTO dto) {
        if (!ApiCandidatePolicy.isApiExam(assessment)
                || !AssessmentStatus.PUBLISHED.name().equals(assessment.getStatus())) {
            return;
        }
        if (!isEmpty(dto.getAddedSections()) || !isEmpty(dto.getDeletedSections())) {
            throw apiStructureLocked();
        }
        for (SectionAddEditRequestDto section : dto.getUpdatedSections()) {
            if (section.getQuestionAndMarking() == null) continue;
            for (SectionAddEditRequestDto.QuestionAndMarking qm : section.getQuestionAndMarking()) {
                if (Boolean.TRUE.equals(qm.getIsAdded()) || Boolean.TRUE.equals(qm.getIsDeleted())) {
                    throw apiStructureLocked();
                }
                if (Boolean.TRUE.equals(qm.getIsUpdated())) {
                    QuestionAssessmentSectionMapping existing = questionAssessmentSectionMappingService
                            .getMappingById(qm.getQuestionId(), section.getSectionId());
                    if (existing == null || !Objects.equals(totalMark(existing.getMarkingJson()), totalMark(qm.getMarkingJson()))) {
                        throw apiStructureLocked();
                    }
                }
            }
        }
    }

    private static boolean isEmpty(List<?> list) {
        return list == null || list.isEmpty();
    }

    private static VacademyException apiStructureLocked() {
        return new VacademyException(HttpStatus.CONFLICT,
                "This exam is managed by the API and is open: questions cannot be added or removed and max marks cannot change.");
    }

    /** {@code data.totalMark} of a marking JSON, null when absent or unreadable. */
    static Double totalMark(String markingJson) {
        if (markingJson == null || markingJson.isBlank()) return null;
        try {
            JsonNode value = MARKING_READER.readTree(markingJson).path("data").path("totalMark");
            return value.isNumber() ? value.asDouble() : null;
        } catch (JsonProcessingException e) {
            return null;
        }
    }

    private static final ObjectMapper MARKING_READER = new ObjectMapper();

    void validateMarkingScheme(SectionAddEditRequestDto.QuestionAndMarking questionAndMarkings) {
        //Todo: validate marking scheme
    }

    void addSectionToAssessment(CustomUserDetails user, SectionAddEditRequestDto sectionAddEditRequestDto, Assessment
            assessment, String instituteId, String type) {
        Section newSection = createUpdateSection(new Section(), sectionAddEditRequestDto, assessment, ACTIVE.name());
        List<QuestionAssessmentSectionMapping> mappings = new ArrayList<>();
        for (int i = 0; i < sectionAddEditRequestDto.getQuestionAndMarking().size(); i++) {
            mappings.add(createFromQuestionSectionAddEditRequestDto(sectionAddEditRequestDto.getQuestionAndMarking().get(i), newSection, assessment));
        }
        questionAssessmentSectionMappingService.addMultipleMappings(mappings);
    }

    QuestionAssessmentSectionMapping createFromQuestionSectionAddEditRequestDto
            (SectionAddEditRequestDto.QuestionAndMarking questionAndMarking, Section section, Assessment assessment) {
        validateMarkingScheme(questionAndMarking);

        QuestionAssessmentSectionMapping mapping = new QuestionAssessmentSectionMapping();
        mapping.setId(UUID.randomUUID().toString());
        mapping.setSection(section);
        mapping.setStatus(ACTIVE.name());
        mapping.setQuestion(new Question(questionAndMarking.getQuestionId()));
        mapping.setQuestionOrder(questionAndMarking.getQuestionOrder());
        mapping.setQuestionDurationInMin(questionAndMarking.getQuestionDurationInMin());
        mapping.setMarkingJson(questionAndMarking.getMarkingJson());
        return mapping;
    }

    QuestionAssessmentSectionMapping updateFromQuestionSectionAddEditRequestDto
            (SectionAddEditRequestDto.QuestionAndMarking questionAndMarking, Section section, Assessment assessment) {
        validateMarkingScheme(questionAndMarking);
        QuestionAssessmentSectionMapping mapping = questionAssessmentSectionMappingService.getMappingById(questionAndMarking.getQuestionId(), section.getId());
        if (mapping == null) return null;
        mapping.setSection(section);
        mapping.setStatus(ACTIVE.name());
        mapping.setQuestion(new Question(questionAndMarking.getQuestionId()));
        mapping.setQuestionOrder(questionAndMarking.getQuestionOrder());
        mapping.setQuestionDurationInMin(questionAndMarking.getQuestionDurationInMin());
        mapping.setMarkingJson(questionAndMarking.getMarkingJson());
        return mapping;
    }

    void updateSectionForAssessment(Section section, SectionAddEditRequestDto sectionAddEditRequestDto, Assessment
            assessment, String instituteId, String type) {
        Section updatedSection = createUpdateSection(section, sectionAddEditRequestDto, assessment, ACTIVE.name());
        List<String> deletedQuestionIds = new ArrayList<>();
        List<QuestionAssessmentSectionMapping> addedQuestions = new ArrayList<>();
        for (int i = 0; i < sectionAddEditRequestDto.getQuestionAndMarking().size(); i++) {
            if (sectionAddEditRequestDto.getQuestionAndMarking().get(i).getIsDeleted()) {
                deletedQuestionIds.add(sectionAddEditRequestDto.getQuestionAndMarking().get(i).getQuestionId());
            }
            if (sectionAddEditRequestDto.getQuestionAndMarking().get(i).getIsAdded()) {
                addedQuestions.add(createFromQuestionSectionAddEditRequestDto(sectionAddEditRequestDto.getQuestionAndMarking().get(i), updatedSection, assessment));
            }
            if (sectionAddEditRequestDto.getQuestionAndMarking().get(i).getIsUpdated()) {
                var updatedMapping = updateFromQuestionSectionAddEditRequestDto(sectionAddEditRequestDto.getQuestionAndMarking().get(i), updatedSection, assessment);
                if (updatedMapping != null)
                    addedQuestions.add(updatedMapping);
            }
        }
        questionAssessmentSectionMappingService.softDeleteMappingsByQuestionIdsAndSectionId(deletedQuestionIds, section.getId());
        questionAssessmentSectionMappingService.addMultipleMappings(addedQuestions);
    }

    void deleteSectionForAssessment(Section section, SectionAddEditRequestDto sectionAddEditRequestDto, String
            assessmentId, String instituteId, String type) {
        section.setStatus(DELETED.name());
        sectionRepository.save(section);
    }

    private void addOrUpdateTestDurationData(Assessment assessment, AddQuestionsAssessmentDetailsDTO.TestDuration testDuration) {
        if (!ObjectUtils.isEmpty(testDuration)) {
            Optional.ofNullable(testDuration.getEntireTestDuration()).ifPresent(assessment::setDuration);
            Optional.ofNullable(testDuration.getDistributionDuration()).ifPresent(assessment::setDurationDistribution);
        }
    }

    public Section createUpdateSection(Section section, SectionAddEditRequestDto
            sectionAddEditRequestDto, Assessment assessment, String status) {
        section.setAssessment(assessment);

        Optional.ofNullable(sectionAddEditRequestDto.getSectionName()).ifPresent(section::setName);
        Optional.ofNullable(sectionAddEditRequestDto.getSectionOrder()).ifPresent(section::setSectionOrder);
        Optional.ofNullable(status).ifPresent(section::setStatus);
        Optional.ofNullable(sectionAddEditRequestDto.getSectionDuration()).ifPresent(section::setDuration);
        Optional.ofNullable(sectionAddEditRequestDto.getTotalMarks()).ifPresent(section::setTotalMarks);
        Optional.ofNullable(sectionAddEditRequestDto.getCutoffMarks()).ifPresent(section::setCutOffMarks);
        if (!ObjectUtils.isEmpty(sectionAddEditRequestDto.getProblemRandomization()) && sectionAddEditRequestDto.getProblemRandomization())
            section.setProblemRandomType(ProblemRandomType.RANDOM.name());
        if (!ObjectUtils.isEmpty(sectionAddEditRequestDto.getSectionDescriptionHtml()))
            section.setDescription(new AssessmentRichTextData(null, TextType.HTML.name(), sectionAddEditRequestDto.getSectionDescriptionHtml()));
        return sectionRepository.save(section);
    }

    private static final Set<String> LEARNER_AUTHORITIES = Set.of("STUDENT", "PARENT", "GUARDIAN");

    /**
     * Staff of the institute in the request's clientId: at least one role outside the
     * learner roles (STUDENT / PARENT / GUARDIAN), even when STUDENT is held as well -
     * institutes enrol staff as learners to test courses, and a custom staff role must
     * keep the full config because the assessment editor loads and re-saves it from here
     * (same rule as admin_core AuthoringAnswerAccess). Deliberately no root-user bypass:
     * on prod nearly every learner is a "root" user.
     */
    static boolean hasStaffAuthority(CustomUserDetails user) {
        if (user == null || user.getAuthorities() == null) return false;
        Set<String> authorities = new HashSet<>();
        user.getAuthorities().forEach(a -> authorities.add(a.getAuthority() == null ? "" : a.getAuthority().trim().toUpperCase()));
        authorities.remove("");
        return authorities.stream().anyMatch(a -> !LEARNER_AUTHORITIES.contains(a));
    }

    /**
     * Internal callers (question insights, survey overview) compute from the full answer
     * key, so they never get the learner report-options filter: unchanged behaviour.
     */
    public Map<String, List<AssessmentQuestionPreviewDto>> getQuestionsOfSection(CustomUserDetails user, String assessmentId, String sectionIds) {
        return getQuestionsOfSection(user, assessmentId, sectionIds, null, false);
    }

    /**
     * The questions-of-sections endpoint. A learner (non-staff) also gets only what the
     * assessment's report options allow.
     *
     * @param instituteId the caller's institute (the learner app sends it), so a learner gets
     *                    that institute's report settings; null = the assessment's own institute
     */
    public Map<String, List<AssessmentQuestionPreviewDto>> getQuestionsOfSectionForCaller(CustomUserDetails user, String assessmentId,
                                                                                          String sectionIds, String instituteId) {
        return getQuestionsOfSection(user, assessmentId, sectionIds, instituteId, true);
    }

    private Map<String, List<AssessmentQuestionPreviewDto>> getQuestionsOfSection(CustomUserDetails user, String assessmentId,
                                                                                  String sectionIds, String instituteId,
                                                                                  boolean applyReportOptions) {
        Map<String, List<AssessmentQuestionPreviewDto>> response = new HashMap<>();
        List<String> sectionIdList = Arrays.asList(sectionIds.split(","));
        List<QuestionAssessmentSectionMapping> mappings = questionAssessmentSectionMappingService.getQuestionAssessmentSectionMappingBySectionIds(sectionIdList);
        // The learner app calls this endpoint too (test report, comparison): a CBE
        // solution / marking scheme goes to staff only.
        boolean staff = hasStaffAuthority(user);
        // A learner also gets only what the assessment's report options allow: this
        // payload carries the answer key (evaluation_json) and option explanations,
        // which the report screens would otherwise hide only visually.
        Map<String, vacademy.io.assessment_service.features.assessment.service.aireport.ReportOptions> optionsByAssessment = new HashMap<>();

        for (QuestionAssessmentSectionMapping mapping : mappings) {
            String sectionId = mapping.getSection().getId();
            vacademy.io.assessment_service.features.assessment.service.aireport.ReportOptions options = null;
            if (!staff && applyReportOptions) {
                String ownerId = mapping.getSection().getAssessment() != null
                        ? mapping.getSection().getAssessment().getId() : assessmentId;
                options = optionsByAssessment.computeIfAbsent(String.valueOf(ownerId),
                        id -> instituteId != null && !instituteId.isBlank()
                                ? reportProfileService.reportOptions(ownerId, instituteId)
                                : reportProfileService.reportOptions(ownerId));
                if (!options.showQuestionWise()) continue;
            }
            if (!response.containsKey(sectionId)) {
                response.put(sectionId, new ArrayList<>());
            }

            AssessmentQuestionPreviewDto fillOptionsExplanationsOfQuestion = new AssessmentQuestionPreviewDto(mapping.getQuestion(), mapping);
            fillOptionsExplanationsOfQuestion.fillOptionsExplanationsOfQuestion(mapping.getQuestion());
            if (!staff) {
                fillOptionsExplanationsOfQuestion.setEvaluationJson(CbeConfigRedactor.redact(
                        fillOptionsExplanationsOfQuestion.getEvaluationJson(),
                        fillOptionsExplanationsOfQuestion.getQuestionType()));
                applyLearnerReportOptions(fillOptionsExplanationsOfQuestion, options);
            }
            response.get(sectionId).add(fillOptionsExplanationsOfQuestion);
        }
        return response;
    }

    /** Drops the answer key and/or the option explanations a learner's report may not show. */
    static void applyLearnerReportOptions(AssessmentQuestionPreviewDto dto,
                                          vacademy.io.assessment_service.features.assessment.service.aireport.ReportOptions options) {
        if (options == null) return;
        if (!options.showCorrectAnswer()) dto.setEvaluationJson(null);
        if (!options.showExplanation() && dto.getOptionsWithExplanation() != null) {
            dto.getOptionsWithExplanation().forEach(o -> o.setExplanationText(null));
        }
    }

    /**
     * The same questions as {@link #getQuestionsOfSection}, but as the full
     * {@link QuestionDTO} the question-paper editor already understands
     * (options with explanations, answer key, explanation text), so an
     * assessment's questions can be edited with the same screen as a paper's.
     */
    public Map<String, List<QuestionDTO>> getFullQuestionsOfSection(CustomUserDetails user, String assessmentId, String sectionIds) {
        Map<String, List<QuestionDTO>> response = new HashMap<>();
        if (sectionIds == null || sectionIds.isBlank()) return response;
        List<String> sectionIdList = Arrays.asList(sectionIds.split(","));
        List<QuestionAssessmentSectionMapping> mappings = questionAssessmentSectionMappingService.getQuestionAssessmentSectionMappingBySectionIds(sectionIdList);
        boolean staff = hasStaffAuthority(user);
        for (QuestionAssessmentSectionMapping mapping : mappings) {
            String sectionId = mapping.getSection().getId();
            QuestionDTO dto = new QuestionDTO(mapping.getQuestion(), true);
            if (!staff) {
                dto.setAutoEvaluationJson(CbeConfigRedactor.redact(dto.getAutoEvaluationJson(), dto.getQuestionType()));
            }
            dto.setSectionId(sectionId);
            dto.setQuestionOrderInSection(mapping.getQuestionOrder());
            response.computeIfAbsent(sectionId, k -> new ArrayList<>()).add(dto);
        }
        return response;
    }

    /**
     * Edit the text/options/answer key of questions that belong to this
     * assessment, in place. Only ids actually mapped to one of the
     * assessment's sections are touched, so a stray id cannot rewrite a
     * question in someone else's paper.
     */
    @Transactional
    public Boolean editQuestionsOfAssessment(CustomUserDetails user, String assessmentId, String instituteId, List<QuestionDTO> updatedQuestions) {
        Optional<Assessment> assessmentOptional = assessmentService.getAssessmentWithActiveSections(assessmentId, instituteId);
        if (assessmentOptional.isEmpty()) {
            throw new VacademyException("Assessment not found");
        }
        List<String> sectionIds = assessmentOptional.get().getSections().stream().map(Section::getId).toList();
        if (sectionIds.isEmpty() || updatedQuestions == null || updatedQuestions.isEmpty()) return false;
        Map<String, Question> allowed = new HashMap<>();
        for (QuestionAssessmentSectionMapping mapping : questionAssessmentSectionMappingService.getQuestionAssessmentSectionMappingBySectionIds(sectionIds)) {
            allowed.put(mapping.getQuestion().getId(), mapping.getQuestion());
        }
        List<QuestionDTO> permitted = updatedQuestions.stream()
                .filter(q -> q.getId() != null && allowed.containsKey(q.getId()))
                .toList();
        // A question copied from the Question Library: its edit must stay on its own rows.
        for (QuestionDTO edit : permitted) {
            Question own = allowed.get(edit.getId());
            if (QuestionLibraryCopyService.SOURCE_TYPE.equals(own.getSourceType())) {
                QuestionLibraryCopyService.pinToOwnRows(own, edit);
                edit.setSourceType(null);
                edit.setSourceMeta(null);
            }
        }
        if (permitted.isEmpty()) return false;
        try {
            addQuestionPaperFromImportManager.updateQuestionsInPlace(permitted, instituteId);
        } catch (JsonProcessingException e) {
            throw new VacademyException(e.getMessage());
        }
        return true;
    }
}
