package asteroidbreaker;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/** All SQL. Statements inside a TransactionTemplate callback share its connection. */
@Component
class Store {
    record User(String id, String username) {}

    record Credentials(User user, String salt, String passwordHash) {}

    record Rating(int rating, String seasonKey, int seasonRating) {}

    record SaveRow(String payload, int revision, long updatedAt) {}

    record Stats(int wins, int losses) {}

    record LeaderboardRow(String username, int rating) {}

    private static final List<String> SCHEMA = List.of(
        """
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          salt TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          created_at BIGINT NOT NULL
        )""",
        """
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at BIGINT NOT NULL
        )""",
        """
        CREATE TABLE IF NOT EXISTS saves (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          payload TEXT NOT NULL,
          revision INTEGER NOT NULL,
          updated_at BIGINT NOT NULL
        )""",
        """
        CREATE TABLE IF NOT EXISTS player_stats (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          wins INTEGER NOT NULL DEFAULT 0,
          losses INTEGER NOT NULL DEFAULT 0
        )""",
        """
        CREATE TABLE IF NOT EXISTS matches (
          id TEXT PRIMARY KEY,
          winner_id TEXT NOT NULL REFERENCES users(id),
          loser_id TEXT NOT NULL REFERENCES users(id),
          duration_seconds INTEGER NOT NULL,
          created_at BIGINT NOT NULL,
          ranked INTEGER NOT NULL DEFAULT 0,
          winner_rating_delta INTEGER NOT NULL DEFAULT 0,
          loser_rating_delta INTEGER NOT NULL DEFAULT 0
        )""",
        """
        CREATE TABLE IF NOT EXISTS pvp_ratings (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          rating INTEGER NOT NULL DEFAULT 1000,
          season_key TEXT NOT NULL,
          season_rating INTEGER NOT NULL DEFAULT 1000,
          updated_at BIGINT NOT NULL
        )""");

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final long sessionTtlMillis;

    Store(JdbcTemplate jdbc, TransactionTemplate tx, Settings settings) {
        this.jdbc = jdbc;
        this.tx = tx;
        this.sessionTtlMillis = settings.sessionTtlMillis();
        tx.executeWithoutResult(status -> {
            // serialises concurrent cold starts
            jdbc.execute("SELECT pg_advisory_xact_lock(727274)");
            for (String statement : SCHEMA) jdbc.execute(statement);
        });
    }

    static String currentSeason() {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        return now.getYear() + "-S" + ((now.getMonthValue() - 1) / 3 + 1);
    }

    void ping() {
        jdbc.queryForObject("SELECT 1", Integer.class);
    }

    // accounts and sessions

    /** Throws DuplicateKeyException when the username exists. */
    void register(User user, String salt, String passwordHash) {
        tx.executeWithoutResult(status -> {
            jdbc.update(
                "INSERT INTO users (id, username, salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
                user.id(), user.username(), salt, passwordHash, System.currentTimeMillis());
            jdbc.update("INSERT INTO player_stats (user_id) VALUES (?)", user.id());
            rating(user.id());
        });
    }

    Credentials findCredentials(String username) {
        List<Credentials> rows = jdbc.query(
            "SELECT id, username, salt, password_hash FROM users WHERE username = ?",
            (rs, i) -> new Credentials(new User(rs.getString(1), rs.getString(2)), rs.getString(3), rs.getString(4)),
            username);
        return rows.isEmpty() ? null : rows.get(0);
    }

    String createSession(User user) {
        String token = Crypto.randomToken();
        jdbc.update(
            "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
            Crypto.sha256Hex(token), user.id(), System.currentTimeMillis() + sessionTtlMillis);
        return token;
    }

    User userForToken(String token) {
        List<User> rows = jdbc.query(
            """
            SELECT users.id, users.username
            FROM sessions JOIN users ON sessions.user_id = users.id
            WHERE sessions.token_hash = ? AND sessions.expires_at > ?""",
            (rs, i) -> new User(rs.getString(1), rs.getString(2)),
            Crypto.sha256Hex(token), System.currentTimeMillis());
        return rows.isEmpty() ? null : rows.get(0);
    }

    void deleteSession(String token) {
        jdbc.update("DELETE FROM sessions WHERE token_hash = ?", Crypto.sha256Hex(token));
    }

    // cloud saves: each write is one statement, so two devices saving at once cannot both win

    SaveRow findSave(String userId) {
        List<SaveRow> rows = jdbc.query(
            "SELECT payload, revision, updated_at FROM saves WHERE user_id = ?",
            (rs, i) -> new SaveRow(rs.getString(1), rs.getInt(2), rs.getLong(3)),
            userId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /** The new revision, or null when the write lost against another device. */
    Integer writeSave(String userId, String payload, int revision, long now) {
        List<Integer> written = revision == 0
            ? jdbc.query(
                "INSERT INTO saves (user_id, payload, revision, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(user_id) DO NOTHING RETURNING revision",
                (rs, i) -> rs.getInt(1), userId, payload, now)
            : jdbc.query(
                "UPDATE saves SET payload = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ? RETURNING revision",
                (rs, i) -> rs.getInt(1), payload, now, userId, revision);
        return written.isEmpty() ? null : written.get(0);
    }

    int currentRevision(String userId) {
        SaveRow row = findSave(userId);
        return row == null ? 0 : row.revision();
    }

    // PvP

    Stats stats(String userId) {
        List<Stats> rows = jdbc.query(
            "SELECT wins, losses FROM player_stats WHERE user_id = ?",
            (rs, i) -> new Stats(rs.getInt(1), rs.getInt(2)),
            userId);
        return rows.isEmpty() ? new Stats(0, 0) : rows.get(0);
    }

    /** The player's rating row, created on first use and rolled over when the season changed. */
    Rating rating(String userId) {
        String season = currentSeason();
        long now = System.currentTimeMillis();
        jdbc.update(
            "INSERT INTO pvp_ratings (user_id, rating, season_key, season_rating, updated_at) VALUES (?, 1000, ?, 1000, ?) ON CONFLICT(user_id) DO NOTHING",
            userId, season, now);
        Rating row = jdbc.queryForObject(
            "SELECT rating, season_key, season_rating FROM pvp_ratings WHERE user_id = ?",
            (rs, i) -> new Rating(rs.getInt(1), rs.getString(2), rs.getInt(3)),
            userId);
        if (row.seasonKey().equals(season)) return row;
        jdbc.update("UPDATE pvp_ratings SET season_key = ?, season_rating = 1000, updated_at = ? WHERE user_id = ?", season, now, userId);
        return new Rating(row.rating(), season, 1000);
    }

    List<LeaderboardRow> leaderboard(String season) {
        return jdbc.query(
            """
            SELECT users.username, pvp_ratings.season_rating AS rating
            FROM pvp_ratings JOIN users ON users.id = pvp_ratings.user_id
            WHERE pvp_ratings.season_key = ?
            ORDER BY pvp_ratings.season_rating DESC, pvp_ratings.updated_at ASC
            LIMIT 20""",
            (rs, i) -> new LeaderboardRow(rs.getString(1), rs.getInt(2)),
            season);
    }

    /** Stores a finished match and, when ranked, moves both ratings. Returns the winner's rating gain. */
    int recordMatch(String matchId, boolean ranked, String winnerId, String loserId, long durationSeconds) {
        Integer change = tx.execute(status -> {
            int ratingChange = 0;
            if (ranked) {
                Rating winner = rating(winnerId);
                Rating loser = rating(loserId);
                double expected = 1 / (1 + Math.pow(10, (loser.seasonRating() - winner.seasonRating()) / 400.0));
                ratingChange = (int) Math.max(1, Math.round(32 * (1 - expected)));
                String update = "UPDATE pvp_ratings SET rating = ?, season_rating = ?, updated_at = ? WHERE user_id = ?";
                jdbc.update(update,
                    Math.max(100, winner.rating() + ratingChange),
                    Math.max(100, winner.seasonRating() + ratingChange),
                    System.currentTimeMillis(), winnerId);
                jdbc.update(update,
                    Math.max(100, loser.rating() - ratingChange),
                    Math.max(100, loser.seasonRating() - ratingChange),
                    System.currentTimeMillis(), loserId);
            }
            jdbc.update(
                """
                INSERT INTO matches (id, winner_id, loser_id, duration_seconds, created_at, ranked, winner_rating_delta, loser_rating_delta)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                matchId, winnerId, loserId, durationSeconds, System.currentTimeMillis(), ranked ? 1 : 0, ratingChange, -ratingChange);
            jdbc.update("UPDATE player_stats SET wins = wins + 1 WHERE user_id = ?", winnerId);
            jdbc.update("UPDATE player_stats SET losses = losses + 1 WHERE user_id = ?", loserId);
            return ratingChange;
        });
        return change == null ? 0 : change;
    }
}
