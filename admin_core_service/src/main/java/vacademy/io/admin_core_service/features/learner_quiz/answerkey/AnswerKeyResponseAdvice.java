package vacademy.io.admin_core_service.features.learner_quiz.answerkey;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.core.MethodParameter;
import org.springframework.http.MediaType;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyAdvice;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Map;

/** Applies {@link WithoutAnswerKeys} when the switch for that surface is on. */
@RestControllerAdvice
@RequiredArgsConstructor
public class AnswerKeyResponseAdvice implements ResponseBodyAdvice<Object> {

    private final AnswerKeyAccess access;
    private final AnswerKeyStripper stripper;
    private final AuthoringAnswerAccess authoringAccess;

    @Override
    public boolean supports(MethodParameter returnType, Class<? extends HttpMessageConverter<?>> converterType) {
        return returnType.hasMethodAnnotation(WithoutAnswerKeys.class);
    }

    @Override
    public Object beforeBodyWrite(Object body, MethodParameter returnType, MediaType selectedContentType,
            Class<? extends HttpMessageConverter<?>> selectedConverterType, ServerHttpRequest request,
            ServerHttpResponse response) {
        WithoutAnswerKeys annotation = returnType.getMethodAnnotation(WithoutAnswerKeys.class);
        if (body == null || annotation == null || !access.isOn(annotation.value())) {
            return body;
        }
        if (annotation.value() == AnswerKeySurface.AUTHORING && keepsAnswers(request)) {
            return body;
        }
        return stripper.strip(body);
    }

    /** Judged on what is being read: a slide, a chapter, or a batch, as each endpoint names it. */
    private boolean keepsAnswers(ServerHttpRequest request) {
        if (!(request instanceof ServletServerHttpRequest servlet)) {
            return false;
        }
        HttpServletRequest http = servlet.getServletRequest();
        if (!(http.getAttribute("user") instanceof CustomUserDetails user)) {
            return false;
        }
        if (http.getParameter("slideId") != null) {
            return authoringAccess.keepsAnswersOnSlide(user, http.getParameter("slideId"));
        }
        if (http.getParameter("packageSessionId") != null) {
            return authoringAccess.keepsAnswersOnBatch(user, http.getParameter("packageSessionId"));
        }
        String chapterId = http.getParameter("chapterId");
        if (chapterId == null && http.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE) instanceof Map<?, ?> path) {
            chapterId = (String) path.get("chapterId");
        }
        return authoringAccess.keepsAnswersOnChapter(user, chapterId);
    }
}
