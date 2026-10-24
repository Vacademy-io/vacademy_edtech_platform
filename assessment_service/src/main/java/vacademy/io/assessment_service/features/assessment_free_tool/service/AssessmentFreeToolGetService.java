package vacademy.io.assessment_service.features.assessment_free_tool.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.repository.QuestionRepository;
import vacademy.io.assessment_service.features.rich_text.entity.AssessmentRichTextData;
import vacademy.io.common.ai.dto.AiEvaluationMetadata;
import vacademy.io.common.ai.dto.AiEvaluationQuestionDTO;
import vacademy.io.common.ai.dto.AiEvaluationSectionDTO;
import vacademy.io.common.ai.dto.RichTextDataDTO;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.List;

@Service
public class AssessmentFreeToolGetService {

    @Autowired
    private AssessmentRepository assessmentRepository;

    @Autowired
    private QuestionRepository questionRepository;

    @Autowired
    private QuestionAssessmentSectionMappingRepository mappingRepo;

    public AiEvaluationMetadata getEvaluationMetadata(String assessmentId) {
        // 1. Load assessment (or fail)
        Assessment assessment = assessmentRepository.findById(assessmentId)
                .orElseThrow(() -> new VacademyException("Assessment not found"));

        // 2. Build top‐level metadata
        AiEvaluationMetadata metadata = new AiEvaluationMetadata();
        metadata.setAssessmentId(assessment.getId());
        metadata.setAssessmentName(assessment.getName());
        metadata.setInstruction(toRichTextDTO(assessment.getInstructions()));

        // 3. Sections → DTOs
        List<AiEvaluationSectionDTO> sections = new ArrayList<>();
        for (Section section : assessment.getSections()) {
            AiEvaluationSectionDTO secDto = new AiEvaluationSectionDTO();
            secDto.setName(section.getName());
            secDto.setCutoffMarks(section.getCutOffMarks());
            secDto.setId(section.getId());
            // 3a. Fetch mappings for this section
            List<QuestionAssessmentSectionMapping> mappings =
                    mappingRepo.findBySectionId(section.getId());

            // 3b. Questions → DTOs
            List<AiEvaluationQuestionDTO> qDtos = new ArrayList<>();
            for (QuestionAssessmentSectionMapping map : mappings) {
                // ensure question is loaded
                Question q = questionRepository.findById(map.getQuestion().getId())
                        .orElseThrow(() -> new VacademyException("Question not found"));

                AiEvaluationQuestionDTO qDto = new AiEvaluationQuestionDTO();
                qDto.setReachText(toRichTextDTO(q.getTextData()));
                qDto.setExplanationText(toRichTextDTO(q.getExplanationTextData()));
                qDto.setQuestionOrder(map.getQuestionOrder());
                qDto.setMarkingJson(map.getMarkingJson());

                qDtos.add(qDto);
            }

            secDto.setQuestions(qDtos);
            sections.add(secDto);
        }

        metadata.setSections(sections);
        return metadata;
    }

    private RichTextDataDTO toRichTextDTO(AssessmentRichTextData rtd) {
        if (rtd == null) return null;
        return new RichTextDataDTO(rtd.getId(), rtd.getType(), rtd.getContent());
    }


}
