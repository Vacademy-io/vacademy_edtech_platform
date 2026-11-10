package vacademy.io.assessment_service.features.assessment.manager;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.question_core.util.CbeConfigRedactor;
import vacademy.io.assessment_service.features.assessment.dto.AssessmentQuestionPreviewDto;
import vacademy.io.assessment_service.features.assessment.dto.survey_dto.*;
import vacademy.io.assessment_service.features.assessment.dto.survey_dto.request.IndividualResponseRequestFilter;
import vacademy.io.assessment_service.features.assessment.dto.survey_dto.request.RespondentAllResponseFilter;
import vacademy.io.assessment_service.features.assessment.dto.survey_dto.response.IndividualAllResponse;
import vacademy.io.assessment_service.features.assessment.dto.survey_dto.response.IndividualResponseDto;
import vacademy.io.assessment_service.features.assessment.dto.survey_dto.response.RespondentAllResponse;
import vacademy.io.assessment_service.features.assessment.dto.survey_dto.response.RespondentResponseDto;
import vacademy.io.assessment_service.features.assessment.dto.survey_dto.response.StudentSurveyReportResponse;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.service.AssessmentSurveyService;
import vacademy.io.assessment_service.features.assessment.service.assessment_get.AssessmentService;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.assessment.repository.SectionRepository;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.rich_text.dto.AssessmentRichTextDataDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.*;
import java.util.stream.Collectors;

@Component
public class AssessmentSurveyManager {
        @Autowired
        AssessmentLinkQuestionsManager assessmentLinkQuestionsManager;

        @Autowired
        AssessmentService assessmentService;

        @Autowired
        AssessmentSurveyService assessmentSurveyService;

        @Autowired
        QuestionWiseMarksRepository questionWiseMarksRepository;

        @Autowired
        SectionRepository sectionRepository;

        public ResponseEntity<SurveyOverviewDetailDto> getOverViewDetailsForInstitute(
                        CustomUserDetails userDetails,
                        String instituteId,
                        String commaSeparatedSectionIds,
                        String assessmentId) {
                Optional<Assessment> assessment = assessmentService.getAssessmentFromId(assessmentId);
                if (assessment.isEmpty())
                        throw new VacademyException("Assessment Not Found");
                // Fetch all questions mapped by section
                Map<String, List<AssessmentQuestionPreviewDto>> questionMapping = assessmentLinkQuestionsManager
                                .getQuestionsOfSection(
                                                userDetails, assessmentId, commaSeparatedSectionIds);

                List<SurveyDto> surveys = assessmentSurveyService.getSurveyListFromQuestionMapping(assessment.get(),
                                questionMapping);

                // Build SurveyOverviewDetailDto
                SurveyOverviewDetailDto overview = SurveyOverviewDetailDto.builder()
                                .surveyId(assessmentId)
                                .totalParticipants(assessmentSurveyService.getTotalParticipants(assessmentId)) // implement
                                                                                                               // as per
                                                                                                               // your
                                                                                                               // participant
                                                                                                               // logic
                                .participantsResponded(assessmentSurveyService.getParticipantsResponded(assessmentId)) // implement
                                                                                                                       // as
                                                                                                                       // per
                                                                                                                       // your
                                                                                                                       // logic
                                .allSurveys(surveys)
                                .build();

                return ResponseEntity.ok(overview);
        }

        public ResponseEntity<IndividualAllResponse> getIndividualPaginatedResponse(CustomUserDetails userDetails,
                        IndividualResponseRequestFilter filter, String instituteId, int pageNo, int pageSize) {
                Sort sort = createSortObject(filter.getSortColumns());

                Pageable pageable = PageRequest.of(pageNo, pageSize, sort);

                Page<QuestionWiseMarks> paginatedResponse = questionWiseMarksRepository
                                .findSurveyResponseWithFilterAndSearch(
                                                filter.getName(), instituteId, filter.getQuestionIds(),
                                                filter.getAssessmentIds(),
                                                filter.getSectionIds(), filter.getStatus(), pageable);
                return ResponseEntity.ok(createResponseForAllRespondent(paginatedResponse));
        }

        private IndividualAllResponse createResponseForAllRespondent(Page<QuestionWiseMarks> paginatedResponse) {
                if (paginatedResponse == null)
                        return IndividualAllResponse.builder()
                                        .content(new ArrayList<>())
                                        .last(true)
                                        .totalPages(0)
                                        .totalElements(0)
                                        .pageNo(0)
                                        .pageSize(0)
                                        .build();

                return IndividualAllResponse.builder()
                                .content(createContent(paginatedResponse.getContent()))
                                .totalPages(paginatedResponse.getTotalPages())
                                .totalElements(paginatedResponse.getTotalElements())
                                .last(paginatedResponse.isLast())
                                .pageSize(paginatedResponse.getSize())
                                .pageNo(paginatedResponse.getNumber()).build();
        }

        private List<IndividualResponseDto> createContent(List<QuestionWiseMarks> questionWiseResponse) {
                List<IndividualResponseDto> response = new ArrayList<>();

                questionWiseResponse.forEach(questionWise -> {
                        response.add(IndividualResponseDto.builder()
                                        .email(questionWise.getStudentAttempt().getRegistration().getUserEmail())
                                        .name(questionWise.getStudentAttempt().getRegistration().getParticipantName())
                                        .response(questionWise.getResponseJson())
                                        .attemptId(questionWise.getStudentAttempt().getId())
                                        .sourceId(questionWise.getStudentAttempt().getRegistration().getSourceId())
                                        .source(questionWise.getStudentAttempt().getRegistration().getSource())
                                        .build());
                });

                return response;
        }

        public static Sort createSortObject(Map<String, String> sortMap) {
                // Todo: Testing for sorting
                if (sortMap == null)
                        return Sort.unsorted();

                List<Sort.Order> orders = new ArrayList<>();
                for (Map.Entry<String, String> entry : sortMap.entrySet()) {
                        Sort.Direction direction = "DESC".equalsIgnoreCase(entry.getValue()) ? Sort.Direction.DESC
                                        : Sort.Direction.ASC;
                        orders.add(new Sort.Order(direction, entry.getKey()));
                }

                return Sort.by(orders);
        }

        public ResponseEntity<RespondentAllResponse> getRespondentResponseForEachQuestion(CustomUserDetails userDetails,
                        RespondentAllResponseFilter filter, String instituteId, int pageNo, int pageSize) {
                Sort sort = createSortObject(filter.getSortColumns());

                Pageable pageable = PageRequest.of(pageNo, pageSize, sort);

                Page<QuestionWiseMarks> paginatedResponse = questionWiseMarksRepository
                                .findResponseForRespondentWithFilterAndSearch(filter.getName(), instituteId,
                                                filter.getAttemptIds(),
                                                filter.getAssessmentIds(), filter.getStatus(), pageable);
                return ResponseEntity.ok(createRespondentAllResponse(paginatedResponse));
        }

        private RespondentAllResponse createRespondentAllResponse(Page<QuestionWiseMarks> paginatedResponse) {
                if (paginatedResponse == null)
                        return RespondentAllResponse.builder()
                                        .content(new ArrayList<>())
                                        .last(true)
                                        .totalPages(0)
                                        .totalElements(0)
                                        .pageNo(0)
                                        .pageSize(0)
                                        .build();

                return RespondentAllResponse.builder()
                                .content(createContentForRespondentResponse(paginatedResponse.getContent()))
                                .totalPages(paginatedResponse.getTotalPages())
                                .totalElements(paginatedResponse.getTotalElements())
                                .last(paginatedResponse.isLast())
                                .pageSize(paginatedResponse.getSize())
                                .pageNo(paginatedResponse.getNumber()).build();
        }

        private List<RespondentResponseDto> createContentForRespondentResponse(List<QuestionWiseMarks> content) {
                List<RespondentResponseDto> response = new ArrayList<>();

                content.forEach(questionWise -> {
                        response.add(RespondentResponseDto.builder()
                                        .email(questionWise.getStudentAttempt().getRegistration().getUserEmail())
                                        .name(questionWise.getStudentAttempt().getRegistration().getParticipantName())
                                        .response(questionWise.getResponseJson())
                                        .question(questionWise.getQuestion().getTextData().getContent())
                                        .questionType(questionWise.getQuestion().getQuestionType()).build());
                });

                return response;
        }

        public ResponseEntity<List<String>> createSetupForSurvey(CustomUserDetails userDetails, String instituteId,
                        String assessmentId) {
                List<String> allAttemptsIds = questionWiseMarksRepository
                                .findDistinctAttemptIdsForAssessment(assessmentId);
                return ResponseEntity.ok(allAttemptsIds);
        }

        public ResponseEntity<StudentSurveyReportResponse> getStudentSurveyReport(CustomUserDetails userDetails,
                        String assessmentId, String userId, String instituteId) {
                try {
                        // Get assessment details
                        Optional<Assessment> assessmentOpt = assessmentService.getAssessmentFromId(assessmentId);
                        if (assessmentOpt.isEmpty()) {
                                throw new VacademyException("Assessment not found with ID: " + assessmentId);
                        }
                        Assessment assessment = assessmentOpt.get();

                        // Get student's latest attempt for this assessment
                        List<QuestionWiseMarks> studentResponses = questionWiseMarksRepository
                                        .findStudentSurveyResponsesByAssessmentAndUser(assessmentId, userId,
                                                        instituteId);

                        if (studentResponses.isEmpty()) {
                                throw new VacademyException(
                                                "No survey responses found for user: " + userId + " in assessment: "
                                                                + assessmentId);
                        }

                        // Build the comprehensive response
                        StudentSurveyReportResponse response = buildStudentSurveyReportResponse(assessment,
                                        studentResponses);

                        return ResponseEntity.ok(response);
                } catch (Exception e) {
                        throw new VacademyException("Error fetching student survey report: " + e.getMessage());
                }
        }

        private StudentSurveyReportResponse buildStudentSurveyReportResponse(Assessment assessment,
                        List<QuestionWiseMarks> questionWiseMarks) {
                // Get the first response to extract common data
                QuestionWiseMarks firstResponse = questionWiseMarks.get(0);
                StudentAttempt studentAttempt = firstResponse.getStudentAttempt();

                // Build attempt info
                StudentSurveyReportResponse.AttemptInfo attemptInfo = StudentSurveyReportResponse.AttemptInfo.builder()
                                .attemptId(studentAttempt.getId())
                                .attemptNumber(studentAttempt.getAttemptNumber())
                                .startTime(studentAttempt.getStartTime())
                                .submitTime(studentAttempt.getSubmitTime())
                                .previewStartTime(studentAttempt.getPreviewStartTime())
                                .maxTime(studentAttempt.getMaxTime())
                                .attemptStatus(studentAttempt.getStatus())
                                .totalMarks(studentAttempt.getTotalMarks())
                                .resultMarks(studentAttempt.getResultMarks())
                                .resultStatus(studentAttempt.getResultStatus())
                                .reportReleaseStatus(studentAttempt.getReportReleaseStatus())
                                .reportLastReleaseDate(studentAttempt.getReportLastReleaseDate())
                                .totalTimeInSeconds(studentAttempt.getTotalTimeInSeconds())
                                .build();

                // Group responses by section
                Map<String, List<QuestionWiseMarks>> responsesBySection = questionWiseMarks.stream()
                                .filter(qwm -> qwm.getSectionId() != null) // Filter out null section IDs
                                .collect(Collectors.groupingBy(QuestionWiseMarks::getSectionId));

                // Build sections with questions
                List<StudentSurveyReportResponse.SectionResponse> sections = responsesBySection.entrySet().stream()
                                .map(entry -> buildSectionResponse(entry.getKey(), entry.getValue()))
                                .sorted(Comparator.comparing(
                                                StudentSurveyReportResponse.SectionResponse::getSectionOrder))
                                .toList();

                return StudentSurveyReportResponse.builder()
                                .sections(sections)
                                .attemptInfo(attemptInfo)
                                .build();
        }

        private StudentSurveyReportResponse.SectionResponse buildSectionResponse(String sectionId,
                        List<QuestionWiseMarks> sectionResponses) {
                // Fetch section data by ID
                Optional<Section> sectionOpt = sectionRepository.findById(sectionId);
                if (sectionOpt.isEmpty()) {
                        throw new VacademyException("Section not found with ID: " + sectionId);
                }
                Section section = sectionOpt.get();

                List<StudentSurveyReportResponse.QuestionResponse> questions = sectionResponses.stream()
                                .map(qwm -> buildQuestionResponse(qwm, section))
                                .sorted(Comparator
                                                .comparing(qr -> qr.getQuestionText() != null
                                                                ? qr.getQuestionText().getContent()
                                                                : ""))
                                .toList();

                return StudentSurveyReportResponse.SectionResponse.builder()
                                .sectionId(section.getId())
                                .sectionName(section.getName())
                                .description(section.getDescription() != null
                                                ? new AssessmentRichTextDataDTO(section.getDescription())
                                                : null)
                                .sectionType(section.getSectionType())
                                .status(section.getStatus())
                                .cutOffMarks(section.getCutOffMarks())
                                .problemRandomType(section.getProblemRandomType())
                                .duration(section.getDuration())
                                .marksPerQuestion(section.getMarksPerQuestion())
                                .totalMarks(section.getTotalMarks())
                                .sectionOrder(section.getSectionOrder())
                                .questions(questions)
                                .build();
        }

        private StudentSurveyReportResponse.QuestionResponse buildQuestionResponse(QuestionWiseMarks questionWiseMarks,
                        Section section) {
                Question question = questionWiseMarks.getQuestion();

                // Build student answer
                StudentSurveyReportResponse.StudentAnswer studentAnswer = StudentSurveyReportResponse.StudentAnswer
                                .builder()
                                .responseJson(questionWiseMarks.getResponseJson())
                                .answerStatus(questionWiseMarks.getStatus())
                                .timeTakenInSeconds(questionWiseMarks.getTimeTakenInSeconds())
                                .answeredAt(questionWiseMarks.getCreatedAt())
                                .build();

                // Build question marks
                StudentSurveyReportResponse.QuestionMarks questionMarks = StudentSurveyReportResponse.QuestionMarks
                                .builder()
                                .marksObtained(questionWiseMarks.getMarks())
                                .totalMarks(section.getMarksPerQuestion())
                                .markingStatus(questionWiseMarks.getStatus())
                                .evaluationType(question.getEvaluationType())
                                .build();

                return StudentSurveyReportResponse.QuestionResponse.builder()
                                .questionId(question.getId())
                                .questionText(
                                                question.getTextData() != null
                                                                ? new AssessmentRichTextDataDTO(question.getTextData())
                                                                : null)
                                .explanationText(question.getExplanationTextData() != null
                                                ? new AssessmentRichTextDataDTO(question.getExplanationTextData())
                                                : null)
                                .parentRichText(question.getParentRichText() != null
                                                ? new AssessmentRichTextDataDTO(question.getParentRichText())
                                                : null)
                                .questionType(question.getQuestionType())
                                .questionResponseType(question.getQuestionResponseType())
                                .accessLevel(question.getAccessLevel())
                                .evaluationType(question.getEvaluationType())
                                .status(question.getStatus())
                                .difficulty(question.getDifficulty())
                                .problemType(question.getProblemType())
                                .defaultQuestionTimeMins(question.getDefaultQuestionTimeMins())
                                .mediaId(question.getMediaId())
                                .optionsJson(question.getOptionsJson())
                                // Learner-facing (the caller's own survey report): no CBE solution.
                                .autoEvaluationJson(CbeConfigRedactor.redact(question.getAutoEvaluationJson(),
                                                question.getQuestionType()))
                                .studentAnswer(studentAnswer)
                                .questionMarks(questionMarks)
                                .build();
        }
}
