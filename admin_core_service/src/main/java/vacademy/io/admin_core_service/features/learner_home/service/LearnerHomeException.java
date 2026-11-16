package vacademy.io.admin_core_service.features.learner_home.service;

import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.learner_home.model.Issue;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** A learner-home answer with a stable code the editor can act on (409 STALE_DRAFT, 422 ...). */
public class LearnerHomeException extends RuntimeException {

    private final HttpStatus status;
    private final String code;
    private final Map<String, Object> extra = new LinkedHashMap<>();

    public LearnerHomeException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public LearnerHomeException with(String key, Object value) {
        extra.put(key, value);
        return this;
    }

    public static LearnerHomeException validation(String code, List<Issue> errors, List<Issue> warnings) {
        LearnerHomeException e = new LearnerHomeException(HttpStatus.UNPROCESSABLE_ENTITY, code,
                errors.size() + " problem(s) to fix");
        e.with("errors", errors);
        if (warnings != null) e.with("warnings", warnings);
        return e;
    }

    public HttpStatus getStatus() {
        return status;
    }

    public String getCode() {
        return code;
    }

    /** The response body: code, message and any extra fields. */
    public Map<String, Object> body() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("code", code);
        out.put("message", getMessage());
        out.putAll(extra);
        return out;
    }
}
