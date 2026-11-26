package vacademy.io.assessment_service.features.assessment.service.creation;

import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.SectionDto;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.assessment.enums.DurationDistributionEnum;
import vacademy.io.assessment_service.features.assessment.enums.StepStatus;
import vacademy.io.assessment_service.features.assessment.enums.creationSteps.QuestionCreationEnum;
import vacademy.io.assessment_service.features.assessment.service.IStep;
import vacademy.io.assessment_service.features.assessment.service.StepOption;

import java.util.*;
import java.util.stream.Collectors;

@Component
public class AssessmentAddQuestionDetail extends IStep {


    private List<Map<String, String>> getStepsForManualUploadExam() {
        return List.of(
                Map.of(QuestionCreationEnum.MARKS_PER_QUESTION.name().toLowerCase(), "REQUIRED"),
                Map.of(QuestionCreationEnum.PROBLEM_RANDOMIZATION.name().toLowerCase(), "REQUIRED"));
    }

    @Override
    public void checkStatusAndFetchData(Optional<Assessment> assessment) {
        setStatus(StepStatus.INCOMPLETE.name());
        if (assessment.isEmpty()) return;
        setAssessmentType(assessment.get().getAssessmentType());

        Map<String, Object> savedData = new HashMap<>();
        // In section_order: the wizard shows them in this order and saves each section's
        // on-screen position back as its section_order, so an unordered set reordered the
        // paper whenever Step 2 was saved.
        List<Section> sections = assessment.get().getSections().stream()
                .filter((s) -> !"DELETED".equals(s.getStatus()))
                .sorted(Comparator.comparing(Section::getSectionOrder, Comparator.nullsLast(Comparator.naturalOrder())))
                .toList();
        List<SectionDto> sectionDTOs = new ArrayList<>();
        for (Section section : sections) {
            sectionDTOs.add(new SectionDto(section));
        }
        savedData.put(QuestionCreationEnum.DURATION.name().toLowerCase(), assessment.get().getDuration());
        savedData.put(QuestionCreationEnum.DURATION_DISTRIBUTION.name().toLowerCase(), assessment.get().getDurationDistribution());

        if (!sectionDTOs.isEmpty()) setStatus(StepStatus.COMPLETED.name());
        savedData.put(QuestionCreationEnum.SECTIONS.name().toLowerCase(), sectionDTOs);
        setSavedData(savedData);
    }

    @Override
    public void fillStepKeysBasedOnAssessmentType(String type, String instituteId) {
        setStepName("Add Questions");
        setInstituteId(instituteId);
        setStatus(StepStatus.INCOMPLETE.name());
        setType(type);
        switch (type) {
            case "EXAM":
                setStepKeys(getStepsForExam());
                break;
            case "MOCK":
                setStepKeys(getStepsForMock());
                break;
            case "PRACTICE":
                setStepKeys(getStepsForPractice());
                break;
            case "SURVEY":
                setStepKeys(getStepsForSurvey());
                break;
            case "MANUAL_UPLOAD_EXAM":
                setStepKeys(getStepsForManualUploadExam());
                break;
        }

        this.getFieldOptions().put(QuestionCreationEnum.DURATION_DISTRIBUTION.name().toLowerCase(), Arrays.stream(DurationDistributionEnum.values()).map((option) ->
                new StepOption(QuestionCreationEnum.DURATION_DISTRIBUTION.name().toLowerCase(), option.name(), null, false)
        ).toList());
    }

    private List<Map<String, String>> getStepsForExam() {
        // Todo: get steps based on saved assessment
        return List.of(Map.of(QuestionCreationEnum.SECTION_DURATION.name().toLowerCase(), "REQUIRED"),
                Map.of(QuestionCreationEnum.MARKS_PER_QUESTION.name().toLowerCase(), "REQUIRED"),
                Map.of(QuestionCreationEnum.DURATION.name().toLowerCase(), "REQUIRED"),
                Map.of(QuestionCreationEnum.DURATION_DISTRIBUTION.name().toLowerCase(), "REQUIRED"),
                Map.of(QuestionCreationEnum.NEGATIVE_MARKING.name().toLowerCase(), "OPTIONAL"),
                Map.of(QuestionCreationEnum.PARTIAL_MARKING.name().toLowerCase(), "OPTIONAL"),
                Map.of(QuestionCreationEnum.PROBLEM_RANDOMIZATION.name().toLowerCase(), "REQUIRED"));
    }

    private List<Map<String, String>> getStepsForMock() {
        // Todo: get steps based on saved assessment
        return List.of(Map.of(QuestionCreationEnum.SECTION_DURATION.name().toLowerCase(), "REQUIRED"),
                Map.of(QuestionCreationEnum.MARKS_PER_QUESTION.name().toLowerCase(), "REQUIRED"),
                Map.of(QuestionCreationEnum.NEGATIVE_MARKING.name().toLowerCase(), "OPTIONAL"),
                Map.of(QuestionCreationEnum.DURATION.name().toLowerCase(), "REQUIRED"),
                Map.of(QuestionCreationEnum.DURATION_DISTRIBUTION.name().toLowerCase(), "REQUIRED"),
                Map.of(QuestionCreationEnum.PARTIAL_MARKING.name().toLowerCase(), "OPTIONAL"),
                Map.of(QuestionCreationEnum.PROBLEM_RANDOMIZATION.name().toLowerCase(), "REQUIRED"));
    }

    private List<Map<String, String>> getStepsForSurvey() {
        // Todo: get steps based on saved assessment
        return List.of(Map.of(QuestionCreationEnum.PROBLEM_RANDOMIZATION.name().toLowerCase(), "REQUIRED"));
    }

    private List<Map<String, String>> getStepsForPractice() {
        return List.of(Map.of(QuestionCreationEnum.MARKS_PER_QUESTION.name().toLowerCase(), "REQUIRED"),
                Map.of(QuestionCreationEnum.NEGATIVE_MARKING.name().toLowerCase(), "OPTIONAL"),
                Map.of(QuestionCreationEnum.PARTIAL_MARKING.name().toLowerCase(), "OPTIONAL"),
                Map.of(QuestionCreationEnum.PROBLEM_RANDOMIZATION.name().toLowerCase(), "REQUIRED"));
    }

}