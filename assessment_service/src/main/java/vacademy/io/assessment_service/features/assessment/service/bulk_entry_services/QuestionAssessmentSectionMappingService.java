package vacademy.io.assessment_service.features.assessment.service.bulk_entry_services;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;

import java.util.List;

@Service
public class QuestionAssessmentSectionMappingService {

    @Autowired
    private QuestionAssessmentSectionMappingRepository repository;

    public QuestionAssessmentSectionMapping getMappingById(String questionId, String sectionId) {
        return repository.findByQuestionIdAndSectionId(questionId, sectionId).orElse(null);
    }

    public void addMultipleMappings(List<QuestionAssessmentSectionMapping> mappings) {
        repository.saveAll(mappings);
    }

    public void softDeleteMappingsByQuestionIdsAndSectionId(List<String> questionIds, String sectionId) {
        repository.hardDeleteByQuestionIdsAndSectionId(questionIds, sectionId);
    }

    public List<QuestionAssessmentSectionMapping> getQuestionAssessmentSectionMappingBySectionIds(List<String> sectionIds) {
        return repository.getQuestionAssessmentSectionMappingBySectionIds(sectionIds);
    }

    /** Flat marking rows (no Question/Section hydration); duplicates of a pair are not merged. */
    public List<QuestionAssessmentSectionMappingRepository.MarkingSchemeRow> getMarkingSchemeRowsBySectionIds(
            List<String> sectionIds) {
        return repository.findMarkingSchemeRowsBySectionIds(sectionIds);
    }
}
