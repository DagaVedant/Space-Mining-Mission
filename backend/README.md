# Asteroid Breaker backend (Java)

The game server, in Java 21 and Spring Boot 3. It is a port of the Node backend kept on the `node-backend` branch: it
speaks the same HTTP and WebSocket protocol and uses the same Postgres tables, so an existing database works as it is.

## Run

With Docker (Postgres and the app):

    docker compose up --build

The API and `/ws` are then on `http://localhost:3001`. Compose also publishes Postgres on `127.0.0.1:5432`.

Without Docker, against any Postgres (Java 21 and Maven):

    export DATABASE_URL=postgres://asteroid:asteroid@localhost:5432/asteroid
    mvn spring-boot:run

## Test

    docker compose up -d db
    export DATABASE_URL=postgres://asteroid:asteroid@localhost:5432/asteroid
    mvn test

`ServerTest` starts the whole service on a random port and plays the scenario of the Node backend's test
(accounts, versioned saves, a ranked match to the end, a disconnect) plus a few checks of errors, CORS and headers.
It writes accounts with random names to the database it is given. `CryptoTest` needs no database; it checks scrypt
against the RFC 7914 vectors.

Without Java installed, run the tests in the Maven image (PowerShell, from this folder, after `docker compose up -d db`):

    docker run --rm -v "${PWD}:/work" -w /work -e DATABASE_URL=postgres://asteroid:asteroid@host.docker.internal:5432/asteroid maven:3.9-eclipse-temurin-21 mvn -B test

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `DATABASE_URL` | none, required | `postgres://user:pass@host:port/db?params`, converted to a JDBC URL with the query kept |
| `PORT` | `3001` | |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | comma separated, used for CORS |
| `SESSION_TTL_DAYS` | `30` | clamped to 1 to 90 |
| `RENDER` | unset | when set, the client address for the auth rate limit is the last `X-Forwarded-For` entry |

The connection pool holds 5 connections. Credentials are never logged.

## How it is built

- `Edge` (helmet headers, CORS, JSON body limit), `Api` (routes), `Errors` (JSON error bodies).
- `Store` holds all SQL, `Crypto` the scrypt, token and id code that has to match the stored data.
- `Game` is the WebSocket handler. One scheduled thread owns the queue, the matches and the combatants and runs the
  20 Hz tick. Socket events are handed to it, per socket one after another. Database work for a finished match runs
  on a small pool and returns to the game thread, so it never stalls other matches. A match is marked ended before
  its result is written, so it is finished only once.
- Writing to a socket can block, so it happens off the game thread, in order for each socket. A client that falls
  behind misses snapshots; one that stops reading is dropped when Tomcat's send times out (about 20 seconds).
- A socket that sends more than 60 messages a second (after a burst of 200), or has 256 waiting, is closed with 1008.

## Differences from the Node backend

- `DATABASE_URL` is always required. There is no embedded database, so `DATABASE_PATH` does nothing.
- Malformed JSON bodies answer 400 and oversized ones 413, as JSON `{"error": ...}` (Express sends an HTML page).
  Unknown routes and wrong methods answer 404 `{"error":"Not found."}`. Unhandled failures answer 500
  `{"error":"Internal server error."}`.
- A save is stored as it was sent, so `5.0` stays `5.0` and whitespace is dropped (JavaScript would write `5`).
  The 96000 character limit is measured on that text.
- A cloud revision above 2147483647 answers 400. Node sent it to Postgres and answered 500.
- At most two password hashes run at the same time, to keep memory in bounds on a small instance.
- Trailing slashes (`/api/me/`) are not routed, and `/ws?x=1` is accepted.
- The 4096 byte WebSocket limit is enforced by Tomcat (close code 1009), not by the `ws` library.
