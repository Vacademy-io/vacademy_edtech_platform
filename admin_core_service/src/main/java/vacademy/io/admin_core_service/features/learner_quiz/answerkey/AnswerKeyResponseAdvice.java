package vacademy.io.admin_core_service.features.learner_quiz.answerkey;

import lombok.RequiredArgsConstructor;
import org.springframework.core.MethodParameter;
import org.springframework.http.MediaType;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyAdvice;
import vacademy.io.common.auth.model.CustomUserDetails;

/** Applies {@link WithoutAnswerKeys} when the switch for that surface is on. */
@RestControllerAdvice
@RequiredArgsConstructor
public class AnswerKeyResponseAdvice implements ResponseBodyAdvice<Object> {

    private final AnswerKeyAccess access;
    private final AnswerKeyStripper stripper;

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
        if (annotation.value() == AnswerKeySurface.AUTHORING
                && access.keepsAnswersOnAuthoringRead(userOf(request))) {
            return body;
        }
        return stripper.strip(body);
    }

    private static CustomUserDetails userOf(ServerHttpRequest request) {
        if (request instanceof ServletServerHttpRequest servlet
                && servlet.getServletRequest().getAttribute("user") instanceof CustomUserDetails user) {
            return user;
        }
        return null;
    }
}
