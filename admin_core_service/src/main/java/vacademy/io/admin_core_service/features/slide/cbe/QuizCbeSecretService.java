package vacademy.io.admin_core_service.features.slide.cbe;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.learner_quiz.answerkey.AuthoringAnswerAccess;
import vacademy.io.admin_core_service.features.slide.entity.QuizSlideQuestion;
import vacademy.io.admin_core_service.features.slide.entity.Slide;
import vacademy.io.admin_core_service.features.slide.enums.SlideTypeEnum;
import vacademy.io.admin_core_service.features.slide.repository.QuizSlideQuestionRepository;
import vacademy.io.admin_core_service.features.slide.repository.SlideRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The admin read of the solutions and marking schemes of the Spreadsheet &amp; Written Response
 * questions in a quiz slide, for the quiz editor. Same rule as the question-slide read
 * ({@link CbeEvaluationSecretService}): the slide must belong to the institute the clientId
 * header names, and the caller must be staff there or the creator of a course holding it.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class QuizCbeSecretService {

    private final AuthoringAnswerAccess authoringAnswerAccess;
    private final SlideRepository slideRepository;
    private final QuizSlideQuestionRepository quizSlideQuestionRepository;

    /** {@code {"evaluation_secrets": {"<questionId>": "<evaluation_secret_json or null>"}}}, CBE questions only. */
    public Map<String, Object> getEvaluationSecrets(String slideId, CustomUserDetails user) {
        if (!StringUtils.hasText(slideId)) {
            throw new InvalidRequestException("slideId is required");
        }
        if (!authoringAnswerAccess.keepsAnswersOnSlide(user, slideId)) {
            log.warn("[quiz-cbe-secret] refused user {} on slide {}", user == null ? null : user.getUserId(), slideId);
            throw new ForbiddenException("Only staff of the institute that owns this slide can read its solutions");
        }
        Slide slide = slideRepository.findById(slideId)
                .orElseThrow(() -> new ResourceNotFoundException("Slide not found"));
        if (!SlideTypeEnum.QUIZ.name().equalsIgnoreCase(slide.getSourceType())
                || !StringUtils.hasText(slide.getSourceId())) {
            throw new InvalidRequestException("This slide is not a quiz slide");
        }
        Map<String, String> secrets = new LinkedHashMap<>();
        for (QuizSlideQuestion question : quizSlideQuestionRepository.findByQuizSlideId(slide.getSourceId())) {
            if (CbeConfigSecrets.isCbe(question.getQuestionType(), question.getAutoEvaluationJson())) {
                secrets.put(question.getId(), question.getEvaluationSecretJson());
            }
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("evaluation_secrets", secrets);
        return body;
    }
}
