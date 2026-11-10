package vacademy.io.admin_core_service.features.slide.cbe;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.learner_quiz.answerkey.AuthoringAnswerAccess;
import vacademy.io.admin_core_service.features.slide.entity.QuestionSlide;
import vacademy.io.admin_core_service.features.slide.entity.Slide;
import vacademy.io.admin_core_service.features.slide.enums.SlideTypeEnum;
import vacademy.io.admin_core_service.features.slide.repository.QuestionSlideRepository;
import vacademy.io.admin_core_service.features.slide.repository.SlideRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The admin read of a CBE question slide's solution and marking scheme, for the editor.
 *
 * <p>Same rule as every authoring read that carries answers ({@link AuthoringAnswerAccess}):
 * the slide must belong to the institute the clientId header names, and the caller must be
 * staff there or the creator of a course holding it. The root flag is never read, because
 * learners are created as root users.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CbeEvaluationSecretService {

    private final AuthoringAnswerAccess authoringAnswerAccess;
    private final SlideRepository slideRepository;
    private final QuestionSlideRepository questionSlideRepository;

    public Map<String, Object> getEvaluationSecret(String slideId, CustomUserDetails user) {
        if (!StringUtils.hasText(slideId)) {
            throw new InvalidRequestException("slideId is required");
        }
        if (!authoringAnswerAccess.keepsAnswersOnSlide(user, slideId)) {
            log.warn("[cbe-secret] refused user {} on slide {}", user == null ? null : user.getUserId(), slideId);
            throw new ForbiddenException("Only staff of the institute that owns this slide can read its solution");
        }
        Slide slide = slideRepository.findById(slideId)
                .orElseThrow(() -> new ResourceNotFoundException("Slide not found"));
        if (!SlideTypeEnum.QUESTION.name().equalsIgnoreCase(slide.getSourceType())
                || !StringUtils.hasText(slide.getSourceId())) {
            throw new InvalidRequestException("This slide is not a question slide");
        }
        QuestionSlide question = questionSlideRepository.findById(slide.getSourceId())
                .orElseThrow(() -> new ResourceNotFoundException("Question slide not found"));
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("evaluation_secret_json", question.getEvaluationSecretJson());
        return body;
    }
}
