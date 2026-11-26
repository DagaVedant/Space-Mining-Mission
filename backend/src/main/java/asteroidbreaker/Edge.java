package asteroidbreaker;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Map;
import java.util.Set;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** What the Express middleware did before any route: helmet, CORS and the JSON body parser. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class Edge extends OncePerRequestFilter {
    /** Request attribute holding the parsed JSON body (an object or array), if there was one. */
    static final String BODY = "asteroidbreaker.body";
    private static final int BODY_LIMIT = 128 * 1024;

    // helmet() defaults
    private static final Map<String, String> SECURITY_HEADERS = Map.ofEntries(
        Map.entry("Content-Security-Policy",
            "default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';"
                + "frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';"
                + "script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests"),
        Map.entry("Cross-Origin-Opener-Policy", "same-origin"),
        Map.entry("Cross-Origin-Resource-Policy", "same-origin"),
        Map.entry("Origin-Agent-Cluster", "?1"),
        Map.entry("Referrer-Policy", "no-referrer"),
        Map.entry("Strict-Transport-Security", "max-age=31536000; includeSubDomains"),
        Map.entry("X-Content-Type-Options", "nosniff"),
        Map.entry("X-DNS-Prefetch-Control", "off"),
        Map.entry("X-Download-Options", "noopen"),
        Map.entry("X-Frame-Options", "SAMEORIGIN"),
        Map.entry("X-Permitted-Cross-Domain-Policies", "none"),
        Map.entry("X-XSS-Protection", "0"));

    private final Set<String> allowedOrigins;

    Edge(Settings settings) {
        this.allowedOrigins = settings.allowedOrigins();
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
        throws ServletException, IOException {
        SECURITY_HEADERS.forEach(response::setHeader);

        String origin = request.getHeader("Origin");
        boolean hasOrigin = origin != null && !origin.isEmpty();
        boolean allowed = hasOrigin && allowedOrigins.contains(origin);
        if (allowed) {
            response.setHeader("Access-Control-Allow-Origin", origin);
            response.setHeader("Vary", "Origin");
            response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
            response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
        }
        if (request.getMethod().equals("OPTIONS")) {
            if (hasOrigin && !allowed) {
                response.setStatus(403);
                response.setContentType("text/plain; charset=utf-8");
                response.getWriter().write("Forbidden");
            } else {
                response.setStatus(204);
            }
            return;
        }

        if (!readBody(request, response)) return;
        chain.doFilter(request, response);
    }

    /** Parses an application/json body like express.json(); returns false once it has answered with an error. */
    private boolean readBody(HttpServletRequest request, HttpServletResponse response) throws IOException {
        String contentType = request.getContentType();
        if (contentType == null || !contentType.split(";", 2)[0].trim().equalsIgnoreCase("application/json")) return true;
        long length = request.getContentLengthLong();
        if (length <= 0 && request.getHeader("Transfer-Encoding") == null) return true;
        if (length > BODY_LIMIT) return tooLarge(response);
        byte[] bytes = request.getInputStream().readNBytes(BODY_LIMIT + 1);
        if (bytes.length > BODY_LIMIT) return tooLarge(response);
        if (bytes.length == 0) return true;

        JsonNode body = null;
        try {
            body = Json.READER.readTree(bytes);
        } catch (IOException e) {
            // answered below
        }
        // like express.json() in strict mode, only objects and arrays are accepted
        if (body == null || !body.isContainerNode()) {
            Json.respond(response, 400, Json.obj("error", "Request body is not valid JSON."));
            return false;
        }
        request.setAttribute(BODY, body);
        return true;
    }

    private static boolean tooLarge(HttpServletResponse response) throws IOException {
        Json.respond(response, 413, Json.obj("error", "Request body is too large."));
        return false;
    }
}
