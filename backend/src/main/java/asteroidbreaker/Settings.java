package asteroidbreaker;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.core.env.Environment;

/** Everything the service reads from its environment. */
record Settings(boolean render, DbUrl database, Set<String> allowedOrigins, long sessionTtlMillis) {

    record DbUrl(String jdbcUrl, String user, String password) {}

    static Settings from(Environment env) {
        boolean render = !env.getProperty("RENDER", "").isEmpty();
        // read raw: Environment would try to resolve a "${" inside a password
        String url = System.getenv("DATABASE_URL");
        if (url == null || url.isBlank()) {
            throw new IllegalStateException(render
                ? "DATABASE_URL must be set on Render."
                : "DATABASE_URL must be set, for example postgres://user:pass@localhost:5432/db.");
        }
        Set<String> origins = Arrays.stream(env.getProperty("ALLOWED_ORIGINS", "http://localhost:5173").split(","))
            .map(String::trim)
            .filter(origin -> !origin.isEmpty())
            .collect(Collectors.toUnmodifiableSet());

        // same fallbacks as Number(value) || 30 clamped to 1..90
        double days = 30;
        try {
            double parsed = Double.parseDouble(env.getProperty("SESSION_TTL_DAYS", "").trim());
            if (parsed != 0 && !Double.isNaN(parsed)) days = parsed;
        } catch (NumberFormatException ignored) {
            // keep the default
        }
        days = Math.min(90, Math.max(1, days));
        return new Settings(render, parseDatabaseUrl(url), origins, (long) (days * 86_400_000));
    }

    /** postgres://user:pass@host:port/db?params becomes a JDBC URL; credentials stay out of it. */
    static DbUrl parseDatabaseUrl(String url) {
        int scheme = url.indexOf("://");
        if (scheme < 0 || !url.startsWith("postgres")) {
            // the value is never echoed, it contains a password
            throw new IllegalStateException("DATABASE_URL must look like postgres://user:pass@host:port/db");
        }
        String rest = url.substring(scheme + 3);
        int slash = rest.indexOf('/');
        String authority = slash < 0 ? rest : rest.substring(0, slash);
        String path = slash < 0 ? "" : rest.substring(slash + 1);
        int at = authority.lastIndexOf('@');
        String userInfo = at < 0 ? "" : authority.substring(0, at);
        String hostAndPort = authority.substring(at + 1);
        int colon = userInfo.indexOf(':');
        String user = decode(colon < 0 ? userInfo : userInfo.substring(0, colon));
        String password = colon < 0 ? "" : decode(userInfo.substring(colon + 1));
        return new DbUrl(
            "jdbc:postgresql://" + hostAndPort + "/" + path,
            user.isEmpty() ? null : user,
            password.isEmpty() ? null : password);
    }

    private static String decode(String value) {
        try {
            // a plain '+' is a plus sign here, not a space
            return URLDecoder.decode(value.replace("+", "%2B"), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException e) {
            return value;
        }
    }
}
