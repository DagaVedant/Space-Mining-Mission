package asteroidbreaker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpHeaders;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

/** Runs against a real server on a random port; the database comes from DATABASE_URL. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "ALLOWED_ORIGINS=http://localhost:5173")
class ServerTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final HttpClient HTTP = HttpClient.newHttpClient();

    @LocalServerPort
    int port;

    record Reply(int status, String text, HttpHeaders headers) {
        JsonNode json() throws Exception {
            return JSON.readTree(text);
        }
    }

    record Account(String token, String id, String username) {}

    private Reply call(String method, String path, String token, Object body, String... headers) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
            .header("Content-Type", "application/json");
        if (token != null) request.header("Authorization", "Bearer " + token);
        for (int i = 0; i < headers.length; i += 2) request.header(headers[i], headers[i + 1]);
        request.method(method, body == null
            ? HttpRequest.BodyPublishers.noBody()
            : HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body)));
        HttpResponse<String> response = HTTP.send(request.build(), HttpResponse.BodyHandlers.ofString());
        return new Reply(response.statusCode(), response.body(), response.headers());
    }

    private Account register(String username) throws Exception {
        Reply reply = call("POST", "/api/auth/register", null, Map.of("username", username, "password", "space-rocks-safe-2026"));
        assertEquals(200, reply.status());
        JsonNode body = reply.json();
        return new Account(body.get("token").asText(), body.get("user").get("id").asText(), body.get("user").get("username").asText());
    }

    private static Map<String, Object> with(Map<String, Object> base, String key, Object value) {
        Map<String, Object> copy = new LinkedHashMap<>(base);
        copy.put(key, value);
        return copy;
    }

    /** One WebSocket; messages queue up and await() takes the next one of the wanted type. */
    static final class Socket implements WebSocket.Listener {
        private final BlockingQueue<JsonNode> inbox = new LinkedBlockingQueue<>();
        private final StringBuilder partial = new StringBuilder();
        private volatile WebSocket ws;

        static Socket connect(int port) throws Exception {
            Socket socket = new Socket();
            HTTP.newWebSocketBuilder().buildAsync(URI.create("ws://127.0.0.1:" + port + "/ws"), socket).get(5, TimeUnit.SECONDS);
            return socket;
        }

        @Override
        public void onOpen(WebSocket webSocket) {
            ws = webSocket;
            webSocket.request(1);
        }

        @Override
        public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
            partial.append(data);
            if (last) {
                try {
                    inbox.add(JSON.readTree(partial.toString()));
                } catch (Exception e) {
                    throw new IllegalStateException(e);
                }
                partial.setLength(0);
            }
            webSocket.request(1);
            return null;
        }

        synchronized void send(Map<String, Object> message) throws Exception {
            ws.sendText(JSON.writeValueAsString(message), true).get(5, TimeUnit.SECONDS);
        }

        JsonNode await(String type, long timeoutMs) throws Exception {
            long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs);
            while (true) {
                long left = deadline - System.nanoTime();
                JsonNode message = left <= 0 ? null : inbox.poll(left, TimeUnit.NANOSECONDS);
                if (message == null) throw new AssertionError("Timed out waiting for WebSocket message \"" + type + "\".");
                if (type.equals(message.path("type").asText())) return message;
            }
        }

        JsonNode await(String type) throws Exception {
            return await(type, 7000);
        }

        boolean isOpen() {
            return ws != null && !ws.isOutputClosed();
        }

        void close(int code, String reason) {
            try {
                if (isOpen()) ws.sendClose(code, reason).get(2, TimeUnit.SECONDS);
            } catch (Exception ignored) {
                // already gone
            }
        }

        void authenticate(String token) throws Exception {
            send(Map.of("type", "authenticate", "token", token));
            await("authenticated");
        }
    }

    @Test
    void accountsVersionedCloudSavesAndAuthoritativePvpMatchesWork() throws Exception {
        String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 7);
        Account first = register("pilot_" + suffix);
        Account second = register("rival_" + suffix);

        Map<String, Object> initialSave = new LinkedHashMap<>();
        initialSave.put("v", 4);
        initialSave.put("money", 60);
        initialSave.put("lifetime", 0);
        initialSave.put("sector", 0);
        initialSave.put("sectorEarned", 0);
        initialSave.put("levels", Map.of("cannon", 0));
        initialSave.put("won", false);
        initialSave.put("objectiveProgress", List.of(0, 0, 0, 0, 0, 0));
        initialSave.put("completedObjectives", List.of());
        initialSave.put("selectedWeapon", "miner");
        initialSave.put("discoveries", List.of("kuiper-morrow-wreck"));

        Reply saved = call("PUT", "/api/save", first.token(), Map.of("save", initialSave, "revision", 0));
        assertEquals(200, saved.status());
        assertEquals(1, saved.json().get("revision").asInt());
        Reply loaded = call("GET", "/api/save", first.token(), null);
        assertEquals(200, loaded.status());
        JsonNode loadedSave = loaded.json().get("save");
        assertEquals(4, loadedSave.get("v").asInt());
        assertEquals("kuiper-morrow-wreck", loadedSave.get("discoveries").get(0).asText());
        // unknown fields survive the round trip
        assertEquals("miner", loadedSave.get("selectedWeapon").asText());
        assertEquals(6, loadedSave.get("objectiveProgress").size());

        assertEquals(400, call("PUT", "/api/save", first.token(), Map.of("save", with(initialSave, "discoveries", "invalid"), "revision", 1)).status());
        assertEquals(409, call("PUT", "/api/save", first.token(), Map.of("save", initialSave, "revision", 0)).status());

        Map<String, Object> expeditionSave = with(with(with(initialSave, "v", 5), "company", Map.of("claims", 3)), "run", null);
        assertEquals(400, putSave(first, with(expeditionSave, "company", "invalid"), 1).status());
        assertEquals(400, putSave(first, with(expeditionSave, "run", List.of()), 1).status());
        assertEquals(200, putSave(first, expeditionSave, 1).status());
        assertEquals(200, putSave(first, with(expeditionSave, "run", Map.of("seed", 7, "depth", 2)), 2).status());

        Socket one = Socket.connect(port);
        Socket two = Socket.connect(port);
        ScheduledExecutorService firing = Executors.newSingleThreadScheduledExecutor();
        try {
            one.authenticate(first.token());
            two.authenticate(second.token());
            one.send(Map.of("type", "ping", "sentAt", 123));
            assertEquals(123, one.await("pong").get("sentAt").asInt());

            one.send(Map.of("type", "queue", "ranked", true));
            one.await("queued");
            two.send(Map.of("type", "queue", "ranked", true));
            JsonNode matchOne = one.await("match-found");
            two.await("match-found");

            firing.scheduleAtFixedRate(() -> {
                try {
                    if (one.isOpen()) one.send(Map.of("type", "input", "ax", 0, "ay", 0, "aim", 0, "fire", true));
                } catch (Exception ignored) {
                    // the match is over
                }
            }, 0, 50, TimeUnit.MILLISECONDS);
            JsonNode ending = one.await("match-ended", 9000);
            firing.shutdownNow();
            assertEquals(matchOne.get("playerId").asText(), ending.get("winner").asText());
            assertTrue(ending.get("ranked").asBoolean());
            assertTrue(ending.get("ratingChange").asInt() > 0);
        } finally {
            firing.shutdownNow();
            one.close(1000, "done");
            two.close(1000, "done");
        }

        Reply stats = call("GET", "/api/pvp/stats", first.token(), null);
        assertEquals(200, stats.status());
        assertEquals(1, stats.json().get("wins").asInt());
        assertTrue(stats.json().get("rating").asInt() > 1000);
        assertTrue(stats.json().get("seasonRating").asInt() > 1000);
        Reply leaderboard = call("GET", "/api/pvp/leaderboard", first.token(), null);
        assertEquals(200, leaderboard.status());
        boolean listed = false;
        for (JsonNode player : leaderboard.json().get("players")) listed |= player.get("username").asText().equals(first.username());
        assertTrue(listed);

        Account disconnectedPilot = register("quit_" + suffix);
        Socket reconnect = Socket.connect(port);
        Socket quitter = Socket.connect(port);
        try {
            reconnect.authenticate(first.token());
            quitter.authenticate(disconnectedPilot.token());
            reconnect.send(Map.of("type", "queue"));
            reconnect.await("queued");
            quitter.send(Map.of("type", "queue"));
            quitter.await("match-found");
            quitter.close(1000, "test-disconnect");
            assertEquals("opponent-disconnected", reconnect.await("match-ended").get("reason").asText());
        } finally {
            reconnect.close(1000, "done");
            quitter.close(1000, "done");
        }

        assertEquals(2, call("GET", "/api/pvp/stats", first.token(), null).json().get("wins").asInt());
        assertEquals(1, call("GET", "/api/pvp/stats", disconnectedPilot.token(), null).json().get("losses").asInt());
    }

    private Reply putSave(Account account, Object save, int revision) throws Exception {
        return call("PUT", "/api/save", account.token(), Map.of("save", save, "revision", revision));
    }

    @Test
    void sessionsErrorsCorsAndHeadersBehaveLikeTheNodeBackend() throws Exception {
        String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 7);
        Account account = register("edge_" + suffix);

        Reply login = call("POST", "/api/auth/login", null, Map.of("username", " edge_" + suffix + " ", "password", "space-rocks-safe-2026"));
        assertEquals(200, login.status());
        assertEquals(account.id(), login.json().get("user").get("id").asText());

        Reply wrongPassword = call("POST", "/api/auth/login", null, Map.of("username", "edge_" + suffix, "password", "wrong-password-123"));
        assertEquals(401, wrongPassword.status());
        assertEquals("Invalid username or password.", wrongPassword.json().get("error").asText());

        Reply notAString = call("POST", "/api/auth/register", null, Map.of("username", 12345, "password", "space-rocks-safe-2026"));
        assertEquals(400, notAString.status());
        assertEquals("Username must be 3-24 letters, numbers, or underscores.", notAString.json().get("error").asText());

        Reply anonymous = call("GET", "/api/me", null, null);
        assertEquals(401, anonymous.status());
        assertEquals("Sign in to use this feature.", anonymous.json().get("error").asText());
        assertEquals("edge_" + suffix, call("GET", "/api/me", account.token(), null).json().get("user").get("username").asText());

        assertEquals(204, call("POST", "/api/auth/logout", account.token(), null).status());
        assertEquals(401, call("GET", "/api/me", account.token(), null).status());

        Reply missing = call("GET", "/api/nothing-here", null, null);
        assertEquals(404, missing.status());
        assertNotNull(missing.json().get("error"));

        Reply health = call("GET", "/api/health", null, null);
        assertEquals(200, health.status());
        assertTrue(health.json().get("ok").asBoolean());
        assertEquals("nosniff", health.headers().firstValue("x-content-type-options").orElse(null));
        assertTrue(health.headers().firstValue("content-security-policy").isPresent());
        assertFalse(health.headers().firstValue("x-powered-by").isPresent());
        assertFalse(health.headers().firstValue("access-control-allow-origin").isPresent());

        Reply allowed = call("OPTIONS", "/api/save", null, null, "Origin", "http://localhost:5173");
        assertEquals(204, allowed.status());
        assertEquals("http://localhost:5173", allowed.headers().firstValue("access-control-allow-origin").orElse(null));
        assertEquals("Authorization, Content-Type", allowed.headers().firstValue("access-control-allow-headers").orElse(null));
        assertEquals("GET, POST, PUT, OPTIONS", allowed.headers().firstValue("access-control-allow-methods").orElse(null));
        Reply refused = call("OPTIONS", "/api/save", null, null, "Origin", "http://evil.example");
        assertEquals(403, refused.status());
        assertNull(refused.headers().firstValue("access-control-allow-origin").orElse(null));
        assertEquals(204, call("OPTIONS", "/api/save", null, null).status());
    }
}
