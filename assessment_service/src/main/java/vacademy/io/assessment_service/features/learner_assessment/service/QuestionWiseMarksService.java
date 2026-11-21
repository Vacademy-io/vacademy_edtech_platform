package vacademy.io.assessment_service.features.learner_assessment.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.Top3CorrectResponseDto;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.enums.QuestionResponseEnum;
import vacademy.io.assessment_service.features.assessment.repository.SectionRepository;
import vacademy.io.assessment_service.features.learner_assessment.constants.AttemptJsonConstants;
import vacademy.io.assessment_service.features.learner_assessment.dto.QuestionStatusDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.status_json.manual.LearnerManualAttemptDataDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.status_json.manual.ManualQuestionAttemptDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.status_json.manual.ManualSectionAttemptDto;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.repository.QuestionRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

@Service
public class QuestionWiseMarksService {

    @Autowired
    QuestionWiseMarksRepository questionWiseMarksRepository;

    @Autowired
    SectionRepository sectionRepository;

    @Autowired
    QuestionRepository questionRepository;


    public QuestionWiseMarks updateQuestionWiseMarksForEveryQuestion(Assessment assessment,
                                                                     StudentAttempt attempt,
                                                                     Question question,
                                                                     String responseJson,
                                                                     Long timeTakenInSecs,
                                                                     String answerStatus,
                                                                     Section section,
                                                                     double marks,
                                                                     String marksSource) {

        Optional<QuestionWiseMarks> questionWiseMarksOpt = questionWiseMarksRepository.findByAssessmentIdAndStudentAttemptIdAndQuestionIdAndSectionId(assessment.getId(), attempt.getId(), question.getId(), section.getId());

        if (questionWiseMarksOpt.isPresent()) {
            QuestionWiseMarks questionWiseMarks = questionWiseMarksOpt.get();
            if (!Objects.isNull(timeTakenInSecs)) {
                questionWiseMarks.setTimeTakenInSeconds(timeTakenInSecs);
            }
            if (!Objects.isNull(responseJson)) {
                questionWiseMarks.setResponseJson(responseJson);
            }

            if (Math.abs(questionWiseMarks.getMarks() - marks) > 0.0001
                    || !Objects.equals(questionWiseMarks.getStatus(), answerStatus)
                    || !Objects.equals(questionWiseMarks.getMarksSource(), marksSource)) {
                // Submission review: the mark changed - an open edit form must notice.
                questionWiseMarks.setRevision(questionWiseMarks.getRevision() + 1);
            }
            questionWiseMarks.setMarks(marks);

            questionWiseMarks.setSection(section);
            questionWiseMarks.setStatus(answerStatus);
            // The caller's (re)scored source: KEYWORD for a keyword-matched long answer.
            questionWiseMarks.setMarksSource(marksSource);

            return questionWiseMarksRepository.save(questionWiseMarks);
        }

        QuestionWiseMarks questionWiseMarks = QuestionWiseMarks.builder()
                .assessment(assessment)
                .studentAttempt(attempt)
                .question(question)
                .timeTakenInSeconds(timeTakenInSecs)
                .responseJson(responseJson)
                .section(section)
                .status(answerStatus)
                .marksSource(marksSource)
                .marks(marks).build();


        return questionWiseMarksRepository.save(questionWiseMarks);


    }

    public QuestionStatusDto getQuestionStatusForAssessmentAndQuestion(String assessmentId, String questionId, String sectionId) {
        return questionWiseMarksRepository.findQuestionStatusAssessmentIdAndQuestionId(assessmentId, questionId, sectionId);
    }

    public List<Top3CorrectResponseDto> getTop3ParticipantsForCorrectResponse(String assessmentId, String questionId, String sectionId) {
        return questionWiseMarksRepository.findTop3ParticipantsForCorrectResponse(assessmentId, questionId, sectionId);
    }

    public List<QuestionWiseMarks> getAllQuestionWiseMarksForQuestionIdsAndAttemptId(String attemptId, List<String> questionIds, String sectionId) {
        return questionWiseMarksRepository.findAllQuestionWiseMarksForQuestionIdAndAttemptId(questionIds, attemptId, sectionId);
    }

    public List<QuestionWiseMarks> getAllQuestionWiseMarksForAttemptId(String attemptId, String assessmentId) {
        return questionWiseMarksRepository.findByStudentAttemptIdAndAssessmentId(attemptId, assessmentId);
    }

    public List<QuestionWiseMarks> createQuestionWiseMarks(List<QuestionWiseMarks> questionWiseMarks) {
        return questionWiseMarksRepository.saveAll(questionWiseMarks);
    }

    public Optional<QuestionWiseMarks> getQuestionWiseMarkForAssessmentIdAndSectionIdAndQuestionIdAndAttemptId(String assessmentId, String attemptId, String sectionId, String questionId) {
        return questionWiseMarksRepository.findByAssessmentIdAndStudentAttemptIdAndQuestionIdAndSectionId(assessmentId, attemptId, questionId, sectionId);
    }

    public QuestionWiseMarks createQuestionWiseMark(QuestionWiseMarks questionWiseMark) {
        return questionWiseMarksRepository.save(questionWiseMark);
    }

    public List<QuestionWiseMarks> createOrUpdateQuestionWiseMarksDataForManualAssessment(Assessment assessment, StudentAttempt studentAttempt, String jsonContent, LearnerManualAttemptDataDto attemptData) {
        List<ManualSectionAttemptDto> sections = attemptData.getSections();
        List<QuestionWiseMarks> allQuestionAttempts = new ArrayList<>();

        sections.forEach(section -> {
            String sectionId = section.getSectionId();
            List<ManualQuestionAttemptDto> questions = section.getQuestions();

            Optional<Section> currentSection = sectionRepository.findById(sectionId); // Finding section (replace Object with actual return type)
            if (currentSection.isEmpty()) throw new VacademyException("Section Not Found");

            for (ManualQuestionAttemptDto questionAttemptDto : questions) {

                String questionResponse = getQuestionDetails(questionAttemptDto.getQuestionId(), jsonContent);

                Optional<QuestionWiseMarks> existingEntry = getQuestionWiseMarkForAssessmentIdAndSectionIdAndQuestionIdAndAttemptId(
                        assessment.getId(), studentAttempt.getId(), sectionId, questionAttemptDto.getQuestionId()
                );

                if (existingEntry.isEmpty()) {
                    Optional<Question> questionOptional = questionRepository.findById(questionAttemptDto.getQuestionId());
                    if (questionOptional.isEmpty()) throw new VacademyException("Question Not Found");

                    allQuestionAttempts.add(QuestionWiseMarks.builder()
                            .assessment(assessment)
                            .section(currentSection.get())
                            .question(questionOptional.get())
                            .status(QuestionResponseEnum.PENDING.name())
                            .studentAttempt(studentAttempt)
                            .responseJson(questionResponse)
                            .build());
                } else {
                    // Update existing entry
                    QuestionWiseMarks existingMarks = existingEntry.get();
                    existingMarks.setStatus(QuestionResponseEnum.PENDING.name());
                    existingMarks.setResponseJson(questionResponse);
                    allQuestionAttempts.add(existingMarks);
                }
            }
        });

        return questionWiseMarksRepository.saveAll(allQuestionAttempts);

    }

    public String getQuestionDetails(String questionId, String attemptDataJson) {
        try {
            ObjectMapper objectMapper = new ObjectMapper();
            JsonNode rootNode = objectMapper.readTree(attemptDataJson);

            // Iterate over the sections array
            JsonNode sections = rootNode.path(AttemptJsonConstants.sections);
            for (JsonNode section : sections) {
                JsonNode questions = section.path(AttemptJsonConstants.questions);

                // Iterate over the questions in the current section
                for (JsonNode question : questions) {
                    // Compare question_id to find the correct question
                    if (question.path(AttemptJsonConstants.questionId).asText().equals(questionId)) {
                        return objectMapper.writeValueAsString(question); // Return question as JSON string
                    }
                }
            }
            return "{}"; // Return empty JSON if questionId not found
        } catch (Exception e) {
            return "{}"; // Return empty JSON in case of error
        }
    }

    public List<QuestionWiseMarks> getAllQuestionWiseAttemptsForAssessmentIdAndQuestionIdAndSectionId(String assessmentId, String questionId, String sectionId){
        return questionWiseMarksRepository.findByAssessmentIdAndQuestionIdAndSectionId(questionId,assessmentId,sectionId);
    }

    public Long countUniqueRespondentForAssessment(String assessmentId) {
        return questionWiseMarksRepository.countUniqueRespondentForAssessment(assessmentId);
    }
}
