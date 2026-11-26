package asteroidbreaker;

import asteroidbreaker.Errors.Failure;
import asteroidbreaker.Store.Credentials;
import asteroidbreaker.Store.LeaderboardRow;
import asteroidbreaker.Store.Rating;
import asteroidbreaker.Store.SaveRow;
import asteroidbreaker.Store.Stats;
import asteroidbreaker.Store.User;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.RequestDispatcher;
import jakarta.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.boot.web.servlet.error.ErrorController;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
class Api implements ErrorController {
    private static final Pattern USERNAME = Pattern.compile("[A-Za-z0-9_]{3,24}");
    private static final Pattern BEARER = Pattern.compile("Bearer ([A-Za-z0-9_-]+)");
    private static final Pattern DISCOVERY = Pattern.compile("[a-z0-9-]{1,48}");
    private static final int MAX_SAVE_CHARS = 96_000;

    private final Store store;
    private final Settings settings;
    private final AuthLimiter limiter = new AuthLimiter();

    Api(Store store, Settings settings) {
        this.store = store;
        this.settings = settings;
    }

    @GetMapping("/api/health")
    ResponseEntity<String> health() {
        store.ping();
        return Json.entity(200, Json.obj("ok", true));
    }

    @PostMapping("/api/auth/register")
    ResponseEntity<String> register(HttpServletRequest request) {
        limit(request);
        JsonNode body = body(request);
        String username = trim(text(body, "username"));
        String password = text(body, "password");
        if (!USERNAME.matcher(username).matches()) {
            throw new Failure(400, "Username must be 3-24 letters, numbers, or underscores.");
        }
        if (password.length() < 10 || password.length() > 128) {
            throw new Failure(400, "Password must be between 10 and 128 characters.");
        }
        String salt = Crypto.randomHex(16);
        User user = new User(Crypto.randomHex(16), username);
        String hash = Crypto.hashPassword(password, salt);
        try {
            store.register(user, salt, hash);
        } catch (DuplicateKeyException e) {
            throw new Failure(409, "That username is already taken.");
        }
        return signedIn(user);
    }

    @PostMapping("/api/auth/login")
    ResponseEntity<String> login(HttpServletRequest request) {
        limit(request);
        JsonNode body = body(request);
        String username = trim(text(body, "username"));
        String password = text(body, "password");
        Credentials row = store.findCredentials(username);
        if (row == null || password.length() > 128 || !Crypto.verifyPassword(password, row.salt(), row.passwordHash())) {
            throw new Failure(401, "Invalid username or password.");
        }
        return signedIn(row.user());
    }

    @PostMapping("/api/auth/logout")
    ResponseEntity<String> logout(HttpServletRequest request) {
        requireUser(request);
        store.deleteSession(bearerToken(request));
        return ResponseEntity.status(204).build();
    }

    @GetMapping("/api/me")
    ResponseEntity<String> me(HttpServletRequest request) {
        User user = requireUser(request);
        return Json.entity(200, Json.obj("user", Json.obj("id", user.id(), "username", user.username())));
    }

    @GetMapping("/api/save")
    ResponseEntity<String> loadSave(HttpServletRequest request) {
        User user = requireUser(request);
        SaveRow row = store.findSave(user.id());
        if (row == null) throw new Failure(404, "No cloud save exists for this account.");
        // the stored payload is already JSON, so it is embedded as it is
        return Json.raw(200, "{\"save\":" + row.payload() + ",\"revision\":" + row.revision() + ",\"updatedAt\":" + row.updatedAt() + "}");
    }

    @PutMapping("/api/save")
    ResponseEntity<String> putSave(HttpServletRequest request) {
        User user = requireUser(request);
        JsonNode body = body(request);
        JsonNode save = body == null ? null : body.get("save");
        JsonNode revisionNode = body == null ? null : body.get("revision");
        String payload = isSavePayload(save) ? stringify(save) : null;
        if (payload == null || payload.length() > MAX_SAVE_CHARS) {
            throw new Failure(400, "Save data is invalid or too large.");
        }
        double revisionValue = number(revisionNode);
        // the column is a 32-bit integer
        if (!(revisionValue >= 0 && revisionValue <= Integer.MAX_VALUE && revisionValue == Math.rint(revisionValue))) {
            throw new Failure(400, "A valid cloud revision is required.");
        }
        int revision = (int) revisionValue;
        long now = System.currentTimeMillis();
        Integer written = store.writeSave(user.id(), payload, revision, now);
        if (written == null) {
            return Json.entity(409, Json.obj("error", "Cloud save changed on another device.", "revision", store.currentRevision(user.id())));
        }
        return Json.entity(200, Json.obj("revision", written, "updatedAt", now));
    }

    @GetMapping("/api/pvp/stats")
    ResponseEntity<String> pvpStats(HttpServletRequest request) {
        User user = requireUser(request);
        Stats stats = store.stats(user.id());
        Rating rating = store.rating(user.id());
        return Json.entity(200, Json.obj(
            "wins", stats.wins(),
            "losses", stats.losses(),
            "rating", rating.rating(),
            "seasonRating", rating.seasonRating(),
            "season", rating.seasonKey()));
    }

    @GetMapping("/api/pvp/leaderboard")
    ResponseEntity<String> leaderboard(HttpServletRequest request) {
        requireUser(request);
        String season = Store.currentSeason();
        List<Object> players = new ArrayList<>();
        for (LeaderboardRow row : store.leaderboard(season)) {
            players.add(Json.obj("rank", players.size() + 1, "username", row.username(), "rating", row.rating()));
        }
        return Json.entity(200, Json.obj("season", season, "players", players));
    }

    /** Where the servlet container sends errors it raised itself, such as a malformed request line. */
    @RequestMapping("/error")
    ResponseEntity<String> error(HttpServletRequest request) {
        if (!(request.getAttribute(RequestDispatcher.ERROR_STATUS_CODE) instanceof Integer status)) {
            return Json.entity(404, Json.obj("error", "Not found."));
        }
        HttpStatus known = HttpStatus.resolve(status);
        return Json.entity(status, Json.obj("error", known == null ? "Request failed." : known.getReasonPhrase()));
    }

    // helpers

    private ResponseEntity<String> signedIn(User user) {
        String token = store.createSession(user);
        return Json.entity(200, Json.obj("token", token, "user", Json.obj("id", user.id(), "username", user.username())));
    }

    private User requireUser(HttpServletRequest request) {
        String token = bearerToken(request);
        User user = token == null ? null : store.userForToken(token);
        if (user == null) throw new Failure(401, "Sign in to use this feature.");
        return user;
    }

    private static String bearerToken(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (header == null) return null;
        var matcher = BEARER.matcher(header);
        return matcher.matches() ? matcher.group(1) : null;
    }

    private void limit(HttpServletRequest request) {
        if (!limiter.allow(clientAddress(request))) {
            throw new Failure(429, "Too many authentication attempts. Try again shortly.");
        }
    }

    /** On Render exactly one proxy sits in front, so the last X-Forwarded-For entry is the real client. */
    private String clientAddress(HttpServletRequest request) {
        if (settings.render()) {
            String forwarded = String.join(",", Collections.list(request.getHeaders("X-Forwarded-For")));
            String last = forwarded.substring(forwarded.lastIndexOf(',') + 1).trim();
            if (!last.isEmpty()) return last;
        }
        return request.getRemoteAddr();
    }

    private static JsonNode body(HttpServletRequest request) {
        return (JsonNode) request.getAttribute(Edge.BODY);
    }

    /** A string field, or "" when it is missing or not a string. */
    private static String text(JsonNode body, String field) {
        JsonNode value = body == null ? null : body.get(field);
        return value != null && value.isTextual() ? value.textValue() : "";
    }

    /** String.prototype.trim: Unicode space separators and line terminators, not just ASCII blanks. */
    private static String trim(String value) {
        int start = 0;
        int end = value.length();
        while (start < end && isJsWhitespace(value.charAt(start))) start++;
        while (end > start && isJsWhitespace(value.charAt(end - 1))) end--;
        return value.substring(start, end);
    }

    private static boolean isJsWhitespace(char c) {
        return Character.getType(c) == Character.SPACE_SEPARATOR
            || (c >= '\t' && c <= '\r')
            || c == '\u2028' || c == '\u2029' || c == '\uFEFF';
    }

    /** NaN for anything that is not a JSON number. */
    private static double number(JsonNode node) {
        return node != null && node.isNumber() ? node.asDouble() : Double.NaN;
    }

    private static boolean nonNegative(JsonNode node) {
        double value = number(node);
        return Double.isFinite(value) && value >= 0;
    }

    private static String stringify(JsonNode node) {
        try {
            return Json.READER.writeValueAsString(node);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    private static boolean isSavePayload(JsonNode save) {
        if (save == null || !save.isObject()) return false;
        double version = number(save.get("v"));
        if (!(version == 1 || version == 2 || version == 3 || version == 4 || version == 5)) return false;
        if (!nonNegative(save.get("money")) || !nonNegative(save.get("lifetime")) || !nonNegative(save.get("sectorEarned"))) {
            return false;
        }
        // whole numbers such as 5.0 count as integers
        double sector = number(save.get("sector"));
        if (!(sector >= 0 && sector < 100 && sector == Math.rint(sector))) return false;
        JsonNode levels = save.get("levels");
        JsonNode won = save.get("won");
        if (levels == null || !levels.isObject() || won == null || !won.isBoolean()) return false;
        if (version == 4 || version == 5) {
            JsonNode discoveries = save.get("discoveries");
            if (discoveries == null || !discoveries.isArray() || discoveries.size() > 100) return false;
            for (JsonNode id : discoveries) {
                if (!id.isTextual() || !DISCOVERY.matcher(id.textValue()).matches()) return false;
            }
        }
        // the client repairs the contents, so only the shapes are checked here
        if (version == 5) {
            JsonNode company = save.get("company");
            JsonNode run = save.get("run");
            if (company == null || !company.isObject()) return false;
            return run != null && (run.isNull() || run.isObject());
        }
        return true;
    }

    /** 12 attempts per minute per client address. */
    private static final class AuthLimiter {
        private final Map<String, long[]> windows = new HashMap<>();

        synchronized boolean allow(String key) {
            long now = System.currentTimeMillis();
            if (windows.size() > 10_000) windows.values().removeIf(window -> window[1] <= now);
            long[] window = windows.get(key);
            if (window == null || window[1] <= now) {
                windows.put(key, new long[] {1, now + 60_000});
                return true;
            }
            if (window[0] >= 12) return false;
            window[0]++;
            return true;
        }
    }
}
