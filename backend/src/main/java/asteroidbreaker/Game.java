package asteroidbreaker;

import asteroidbreaker.Store.User;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.ContextClosedEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;

/**
 * Matchmaking and the 20 Hz simulation behind /ws.
 *
 * <p>One thread ({@code game}) owns the queue, the matches and every Client/Combatant field below the
 * "game thread only" marks. Socket events are handed to it, and anything that needs the database runs on
 * {@code db} and comes back to {@code game}, so a slow query never stalls other matches. Writing to a
 * socket can block too, so each socket has its own outbox on {@code sender}.
 */
@Component
class Game extends AbstractWebSocketHandler implements WebSocketConfigurer {
    private static final Logger log = LoggerFactory.getLogger(Game.class);
    private static final String CLIENT = "client";
    private static final int WORLD_WIDTH = 1500;
    private static final int WORLD_HEIGHT = 900;
    private static final double STEP = 1.0 / 20;
    private static final CompletableFuture<Void> DONE = CompletableFuture.completedFuture(null);
    /** Unsent messages at which a client misses snapshots, and at which other messages are dropped too. */
    private static final int SNAPSHOT_BACKLOG = 3;
    private static final int MAX_BACKLOG = 256;

    record Input(double ax, double ay, double aim, boolean fire, boolean boost) {}

    static final class Client {
        final WebSocketSession session;
        volatile ScheduledFuture<?> authTimer;
        /** Messages of one socket run one after another; guarded by this. */
        CompletableFuture<Void> tail = DONE;
        /** Sends and the close, in order; guarded by this. */
        CompletableFuture<Void> outbox = DONE;
        final AtomicInteger unsent = new AtomicInteger();
        // game thread only
        User user;
        boolean queued;
        boolean ranked;
        long queuedAt;
        int rating;
        String matchId;

        Client(WebSocketSession session) {
            this.session = session;
        }
    }

    static final class Combatant {
        final Client client;
        final String id;
        final String name;
        double x;
        double y;
        double vx;
        double vy;
        double rotation;
        double hp = 100;
        double fireCooldown;
        Input input;

        Combatant(Client client, User user, double x, double rotation) {
            this.client = client;
            this.id = user.id();
            this.name = user.username();
            this.x = x;
            this.y = 450;
            this.rotation = rotation;
            this.input = new Input(0, 0, rotation, false, false);
        }
    }

    static final class Projectile {
        final String owner;
        double x;
        double y;
        final double vx;
        final double vy;
        double life;

        Projectile(String owner, double x, double y, double vx, double vy, double life) {
            this.owner = owner;
            this.x = x;
            this.y = y;
            this.vx = vx;
            this.vy = vy;
            this.life = life;
        }
    }

    static final class Match {
        final String id = Crypto.randomHex(12);
        final long startedAt = System.currentTimeMillis();
        final Combatant[] players;
        final List<Projectile> projectiles = new ArrayList<>();
        final boolean ranked;
        boolean ended;

        Match(Combatant first, Combatant second, boolean ranked) {
            this.players = new Combatant[] {first, second};
            this.ranked = ranked;
        }

        long durationSeconds() {
            return Math.max(1, (System.currentTimeMillis() - startedAt) / 1000);
        }
    }

    private final Store store;
    private final Set<Client> clients = ConcurrentHashMap.newKeySet();
    private final ScheduledThreadPoolExecutor game = new ScheduledThreadPoolExecutor(1, threads("game"));
    private final ExecutorService db = Executors.newFixedThreadPool(5, threads("db"));
    private final ExecutorService sender = Executors.newVirtualThreadPerTaskExecutor();
    // game thread only
    private final List<Client> waiting = new ArrayList<>();
    private final Map<String, Match> matches = new HashMap<>();

    Game(Store store) {
        this.store = store;
        game.setExecuteExistingDelayedTasksAfterShutdownPolicy(false);
        game.setRemoveOnCancelPolicy(true);
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        // the frontend lives on another origin and the original never checked it
        registry.addHandler(this, "/ws").setAllowedOrigins("*");
    }

    @PostConstruct
    void start() {
        game.scheduleAtFixedRate(this::tick, 50, 50, TimeUnit.MILLISECONDS);
    }

    @EventListener(ContextClosedEvent.class)
    void closeSockets() {
        List<CompletableFuture<Void>> closing = new ArrayList<>();
        for (Client client : clients) closing.add(close(client, 1001, "server-shutdown"));
        // let the close frames leave before the server stops, without waiting on a stalled client
        CompletableFuture.allOf(closing.toArray(CompletableFuture[]::new))
            .completeOnTimeout(null, 2, TimeUnit.SECONDS)
            .join();
    }

    @PreDestroy
    void stop() throws InterruptedException {
        game.shutdown();
        game.awaitTermination(5, TimeUnit.SECONDS);
        db.shutdown();
        db.awaitTermination(5, TimeUnit.SECONDS);
        sender.shutdownNow();
    }

    // socket events, called on container threads

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        Client client = new Client(session);
        session.getAttributes().put(CLIENT, client);
        clients.add(client);
        try {
            client.authTimer = game.schedule(() -> {
                if (client.user == null) close(client, 4001, "authentication-timeout");
            }, 5, TimeUnit.SECONDS);
        } catch (RejectedExecutionException e) {
            close(client, 1001, "server-shutdown");
        }
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        receive(session, message.getPayload());
    }

    @Override
    protected void handleBinaryMessage(WebSocketSession session, BinaryMessage message) {
        // ws hands binary frames to the same handler as text
        receive(session, StandardCharsets.UTF_8.decode(message.getPayload()).toString());
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        log.warn("WebSocket transport error: {}", exception.toString());
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        Client client = (Client) session.getAttributes().get(CLIENT);
        if (client == null) return;
        clients.remove(client);
        ScheduledFuture<?> timer = client.authTimer;
        if (timer != null) timer.cancel(false);
        enqueue(client, () -> cleanSocket(client));
    }

    private void receive(WebSocketSession session, String raw) {
        Client client = (Client) session.getAttributes().get(CLIENT);
        if (client != null) enqueue(client, () -> handleMessage(client, raw));
    }

    /** Runs the task on the game thread after this socket's earlier tasks have finished, failed or not. */
    private void enqueue(Client client, Supplier<CompletableFuture<Void>> task) {
        synchronized (client) {
            client.tail = client.tail
                .thenCompose(ignored -> CompletableFuture.supplyAsync(task, game).thenCompose(inner -> inner))
                .exceptionally(error -> {
                    report(error);
                    return null;
                });
        }
    }

    // everything below runs on the game thread

    private CompletableFuture<Void> handleMessage(Client c, String raw) {
        JsonNode message = parse(raw);
        if (message == null) {
            send(c, Json.obj("type", "error", "message", "Invalid message."));
            return DONE;
        }
        String type = message.path("type").isTextual() ? message.get("type").textValue() : null;

        if (c.user == null) {
            JsonNode token = message.get("token");
            if (!"authenticate".equals(type) || token == null || !token.isTextual()) {
                send(c, Json.obj("type", "error", "message", "Authenticate before joining a match."));
                close(c, 4001, "authentication-required");
                return DONE;
            }
            String tokenText = token.textValue();
            return CompletableFuture.supplyAsync(() -> store.userForToken(tokenText), db).thenAcceptAsync(user -> {
                if (user == null) {
                    send(c, Json.obj("type", "error", "message", "Session expired. Sign in again."));
                    close(c, 4001, "invalid-session");
                    return;
                }
                c.user = user;
                ScheduledFuture<?> timer = c.authTimer;
                if (timer != null) timer.cancel(false);
                send(c, Json.obj("type", "authenticated", "username", user.username()));
            }, game);
        }

        if ("ping".equals(type)) {
            JsonNode sentAt = message.get("sentAt");
            if (sentAt != null && sentAt.isNumber() && Double.isFinite(sentAt.asDouble())) {
                send(c, Json.obj("type", "pong", "sentAt", sentAt.asDouble()));
            }
            return DONE;
        }

        if ("queue".equals(type)) {
            if (c.matchId != null || c.queued) return DONE;
            boolean ranked = flag(message, "ranked");
            if (!ranked) {
                queueUp(c, false, 0);
                return DONE;
            }
            String userId = c.user.id();
            // the rating is looked up first: the search and enqueue in queueUp must not be split by a wait
            return CompletableFuture.supplyAsync(() -> store.rating(userId).seasonRating(), db)
                .thenAcceptAsync(rating -> queueUp(c, true, rating), game);
        }

        if ("leave-queue".equals(type)) {
            return cleanSocket(c).thenRunAsync(() -> send(c, Json.obj("type", "queue-left")), game);
        }

        if ("input".equals(type) && c.matchId != null) {
            Match match = matches.get(c.matchId);
            Combatant player = null;
            if (match != null) {
                for (Combatant candidate : match.players) if (candidate.client == c) player = candidate;
            }
            if (player == null) return DONE;
            double ax = finite(message.get("ax")) ? Math.max(-1, Math.min(1, message.get("ax").asDouble())) : 0;
            double ay = finite(message.get("ay")) ? Math.max(-1, Math.min(1, message.get("ay").asDouble())) : 0;
            double aim = finite(message.get("aim")) ? message.get("aim").asDouble() : player.rotation;
            player.input = new Input(ax, ay, Math.atan2(Math.sin(aim), Math.cos(aim)), flag(message, "fire"), flag(message, "boost"));
        }
        return DONE;
    }

    private void queueUp(Client c, boolean ranked, int rating) {
        c.rating = rating;
        long now = System.currentTimeMillis();
        Client opponent = null;
        for (Client entry : waiting) {
            if (entry == c || entry.user.id().equals(c.user.id()) || !entry.session.isOpen() || entry.ranked != ranked) continue;
            if (ranked) {
                double waitSeconds = Math.max(0L, now - entry.queuedAt) / 1000.0;
                double allowedGap = Math.min(800, 150 + Math.floor(waitSeconds / 10) * 100);
                if (Math.abs(rating - entry.rating) > allowedGap) continue;
            }
            opponent = entry;
            break;
        }
        if (opponent != null) {
            waiting.remove(opponent);
            startMatch(opponent, c, ranked);
            return;
        }
        c.queued = true;
        c.ranked = ranked;
        c.queuedAt = now;
        waiting.add(c);
        send(c, Json.obj("type", "queued", "ranked", ranked, "rating", ranked ? (Integer) rating : null, "season", ranked ? Store.currentSeason() : null));
    }

    private void startMatch(Client first, Client second, boolean ranked) {
        User one = first.user;
        User two = second.user;
        if (one == null || two == null) return;
        Match match = new Match(new Combatant(first, one, 310, 0), new Combatant(second, two, 1190, Math.PI), ranked);
        matches.put(match.id, match);
        first.matchId = match.id;
        second.matchId = match.id;
        first.queued = false;
        second.queued = false;
        Integer firstRating = ranked ? (Integer) first.rating : null;
        Integer secondRating = ranked ? (Integer) second.rating : null;
        Map<String, Object> world = Json.obj("width", WORLD_WIDTH, "height", WORLD_HEIGHT);
        send(first, Json.obj("type", "match-found", "matchId", match.id, "playerId", one.id(), "opponent", two.username(),
            "world", world, "ranked", ranked, "rating", firstRating, "opponentRating", secondRating));
        send(second, Json.obj("type", "match-found", "matchId", match.id, "playerId", two.id(), "opponent", one.username(),
            "world", world, "ranked", ranked, "rating", secondRating, "opponentRating", firstRating));
    }

    private CompletableFuture<Void> finishMatch(Match match, Combatant winner, String reason) {
        if (match.ended) return DONE;
        match.ended = true;
        matches.remove(match.id);
        Combatant loser = match.players[0] == winner ? match.players[1] : match.players[0];
        for (Combatant player : match.players) player.client.matchId = null;
        long duration = match.durationSeconds();
        return CompletableFuture.supplyAsync(() -> store.recordMatch(match.id, match.ranked, winner.id, loser.id, duration), db)
            .thenAcceptAsync(change -> {
                for (Combatant player : match.players) {
                    int shown = match.ranked ? (player == winner ? change : -change) : 0;
                    send(player.client, Json.obj("type", "match-ended", "reason", reason, "winner", winner.id,
                        "duration", duration, "ranked", match.ranked, "ratingChange", shown));
                }
            }, game);
    }

    /** Removes the socket from the queue and forfeits its match, if any. */
    private CompletableFuture<Void> cleanSocket(Client c) {
        waiting.remove(c);
        c.queued = false;
        if (c.matchId == null) return DONE;
        Match match = matches.get(c.matchId);
        if (match == null || match.ended) return DONE;
        Combatant quitter = match.players[0].client == c ? match.players[0] : match.players[1];
        Combatant other = match.players[0] == quitter ? match.players[1] : match.players[0];
        // close the match before waiting for the database, so nothing else can finish it twice
        match.ended = true;
        matches.remove(match.id);
        c.matchId = null;
        other.client.matchId = null;
        long duration = match.durationSeconds();
        return CompletableFuture.supplyAsync(() -> store.recordMatch(match.id, match.ranked, other.id, quitter.id, duration), db)
            .thenAcceptAsync(change -> send(other.client, Json.obj("type", "match-ended", "reason", "opponent-disconnected",
                "winner", other.id, "duration", duration, "ranked", match.ranked, "ratingChange", change)), game);
    }

    private void tick() {
        try {
            for (Match match : List.copyOf(matches.values())) {
                try {
                    updateMatch(match);
                } catch (RuntimeException e) {
                    report(e);
                }
            }
        } catch (RuntimeException e) {
            // an exception would cancel every later tick
            report(e);
        }
    }

    private void updateMatch(Match match) {
        if (match.ended) return;
        Combatant a = match.players[0];
        Combatant b = match.players[1];
        for (Combatant player : match.players) {
            Input input = player.input;
            double acceleration = input.boost() ? 860 : 560;
            player.vx = (player.vx + input.ax() * acceleration * STEP) * 0.985;
            player.vy = (player.vy + input.ay() * acceleration * STEP) * 0.985;
            double speed = Math.hypot(player.vx, player.vy);
            double maxSpeed = input.boost() ? 430 : 330;
            if (speed > maxSpeed) {
                player.vx = (player.vx / speed) * maxSpeed;
                player.vy = (player.vy / speed) * maxSpeed;
            }
            player.x = Math.max(35, Math.min(WORLD_WIDTH - 35, player.x + player.vx * STEP));
            player.y = Math.max(35, Math.min(WORLD_HEIGHT - 35, player.y + player.vy * STEP));
            player.rotation = input.aim();
            player.fireCooldown = Math.max(0, player.fireCooldown - STEP);
            if (input.fire() && player.fireCooldown == 0) {
                player.fireCooldown = 0.28;
                match.projectiles.add(new Projectile(
                    player.id,
                    player.x + Math.cos(player.rotation) * 26,
                    player.y + Math.sin(player.rotation) * 26,
                    Math.cos(player.rotation) * 720 + player.vx * 0.3,
                    Math.sin(player.rotation) * 720 + player.vy * 0.3,
                    2));
            }
        }
        for (Projectile shot : match.projectiles) {
            shot.x += shot.vx * STEP;
            shot.y += shot.vy * STEP;
            shot.life -= STEP;
            Combatant target = shot.owner.equals(a.id) ? b : a;
            if (Math.hypot(target.x - shot.x, target.y - shot.y) < 24) {
                target.hp -= 18;
                shot.life = 0;
                if (target.hp <= 0) {
                    finishMatch(match, shot.owner.equals(a.id) ? a : b, "destroyed").exceptionally(error -> {
                        report(error);
                        return null;
                    });
                    return;
                }
            }
        }
        match.projectiles.removeIf(shot -> shot.life <= 0);

        List<Object> players = new ArrayList<>();
        for (Combatant p : match.players) {
            players.add(Json.obj("id", p.id, "name", p.name, "x", p.x, "y", p.y, "vx", p.vx, "vy", p.vy, "rotation", p.rotation, "hp", p.hp));
        }
        List<Object> shots = new ArrayList<>();
        for (Projectile s : match.projectiles) {
            shots.add(Json.obj("owner", s.owner, "x", s.x, "y", s.y, "vx", s.vx, "vy", s.vy, "life", s.life));
        }
        String snapshot = Json.write(Json.obj("type", "snapshot", "players", players, "projectiles", shots));
        // the next snapshot replaces this one, so a client that is behind can miss it
        for (Combatant player : match.players) sendText(player.client, snapshot, SNAPSHOT_BACKLOG);
    }

    // helpers

    private static JsonNode parse(String raw) {
        try {
            JsonNode node = Json.READER.readTree(raw);
            return node != null && node.isObject() ? node : null;
        } catch (JsonProcessingException e) {
            return null;
        }
    }

    private static boolean finite(JsonNode node) {
        return node != null && node.isNumber() && Double.isFinite(node.asDouble());
    }

    private static boolean flag(JsonNode message, String field) {
        JsonNode value = message.get(field);
        return value != null && value.isBoolean() && value.booleanValue();
    }

    private void send(Client c, Map<String, Object> message) {
        sendText(c, Json.write(message), MAX_BACKLOG);
    }

    private void sendText(Client c, String json, int backlogLimit) {
        if (!c.session.isOpen() || c.unsent.get() >= backlogLimit) return;
        c.unsent.incrementAndGet();
        write(c, () -> {
            try {
                if (c.session.isOpen()) c.session.sendMessage(new TextMessage(json));
            } catch (IOException | RuntimeException e) {
                // the socket went away; its close event cleans up
                log.debug("WebSocket send failed: {}", e.toString());
            } finally {
                c.unsent.decrementAndGet();
            }
        });
    }

    private CompletableFuture<Void> close(Client c, int code, String reason) {
        return write(c, () -> {
            try {
                c.session.close(new CloseStatus(code, reason));
            } catch (IOException | RuntimeException e) {
                log.debug("WebSocket close failed: {}", e.toString());
            }
        });
    }

    private CompletableFuture<Void> write(Client c, Runnable task) {
        synchronized (c) {
            c.outbox = c.outbox.thenRunAsync(task, sender).exceptionally(error -> {
                report(error);
                return null;
            });
            return c.outbox;
        }
    }

    private static void report(Throwable error) {
        Throwable cause = error instanceof CompletionException && error.getCause() != null ? error.getCause() : error;
        // work submitted while shutting down is dropped on purpose
        if (!(cause instanceof RejectedExecutionException)) log.error("Backend task failed.", cause);
    }

    private static ThreadFactory threads(String name) {
        AtomicInteger count = new AtomicInteger();
        return task -> {
            Thread thread = new Thread(task, name + "-" + count.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        };
    }
}
