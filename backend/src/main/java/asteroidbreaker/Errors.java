package asteroidbreaker;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.ErrorResponse;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** Every error leaves as {"error": "..."}; Spring's own error body never reaches the client. */
@RestControllerAdvice
class Errors {
    private static final Logger log = LoggerFactory.getLogger(Errors.class);

    /** An error the routes report on purpose. */
    static final class Failure extends RuntimeException {
        final int status;

        Failure(int status, String message) {
            super(message, null, false, false);
            this.status = status;
        }
    }

    @ExceptionHandler(Failure.class)
    ResponseEntity<String> failure(Failure e) {
        return Json.entity(e.status, Json.obj("error", e.getMessage()));
    }

    /** Express answers a known path with the wrong method as an unknown route. */
    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<String> wrongMethod() {
        return Json.entity(404, Json.obj("error", "Not found."));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<String> other(Exception e) {
        if (e instanceof ErrorResponse response) {
            int status = response.getStatusCode().value();
            HttpStatus known = HttpStatus.resolve(status);
            return Json.entity(status, Json.obj("error", status == 404 ? "Not found." : known == null ? "Request failed." : known.getReasonPhrase()));
        }
        log.error("Request failed.", e);
        return Json.entity(500, Json.obj("error", "Internal server error."));
    }
}
