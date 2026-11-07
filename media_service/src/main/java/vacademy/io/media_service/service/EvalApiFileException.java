package vacademy.io.media_service.service;

import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * A refusal from {@link EvalApiFileService} with a stable machine code. The
 * eval-api controller turns it into {@code {"error": code, "message": ...}};
 * it is deliberately NOT a VacademyException so the service-wide advice never
 * rewrites its status.
 */
@Getter
public class EvalApiFileException extends RuntimeException {

    private final HttpStatus status;
    private final String code;

    public EvalApiFileException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}
