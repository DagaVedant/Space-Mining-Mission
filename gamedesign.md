# Vulture: Lunar Mining Mission

## 1. Product vision

**Vulture: Lunar Mining Mission** is a single-player, top-down lunar mining survival game set in 2199. The player is an independent contractor operating a rugged **Vulture-class reusable cargo rocket** for the fictional aerospace company **Vulture Aerospace**.

The visual language is inspired by modern reusable orbital launch systems: stainless-steel spacecraft, modular cargo operations, autonomous landing systems, mission-control telemetry, and aggressive launch countdowns. The game must use fictional names, logos, and visual assets rather than copying real company branding.

### Player fantasy

The player is a skilled lunar prospector who takes calculated risks in hostile craters, turns rare minerals into launch revenue, and keeps a remote medical colony alive.

### Core loop

> Explore and mine → manage heat → evade or disable sentinels → repair at base → launch cargo → upgrade equipment → reach deeper craters

### Win and loss conditions

The player wins when:

- Savings reach **$1 trillion**; and
- At least one medical shipment has been delivered.

The player loses when:

- The orbital cannon timer reaches `0`; or
- Suit hull reaches `0%`.

## 2. World and setting

Lunar mining is restricted by the **Lunar Resource Authority**. Vulture Aerospace has a contract to extract minerals, but its security network treats unauthorized miners as threats. The player must mine enough ore to pay for medicine for the settlement of **Adriana Station**.

### Factions

- **Vulture Aerospace:** Provides the reusable Vulture launch vehicle and mining contracts.
- **Lunar Resource Authority:** Controls legal mining zones and the orbital cannon.
- **Sentinel Network:** Autonomous Tesla-class patrol drones and heavy Mech units.
- **Adriana Station:** A remote settlement dependent on successful medical shipments.

### Terminology

| Generic concept | In-game name |
|---|---|
| Player rocket | Vulture-class reusable cargo rocket |
| Starting vehicle | Vulture-7 |
| Mining base | Vulture Rover Base |
| Launch area | Vulture Launch Zone |
| Enemy patrol | Sentinel drones |
| Fast enemy | Tesla-class Sentinel |
| Heavy enemy | Mech Sentinel |
| Orbital cannon | Authority orbital cannon |
| Medical objective | Adriana Station medicine contract |

## 3. World generation

- Grid size: `14 rows × 22 columns`.
- Tile size: `44px`.
- Each run generates a new crater layout from a seed.
- Generation uses weighted terrain:
  - `11%` crater walls.
  - `17%` ore-bearing terrain.
  - `72%` regolith.
- At least `14` active ore veins must exist.
- A `3×4` safe zone around `(2,2)` is reserved for the player, Rover Base, and launch zone.
- The generator must validate that the player can reach the base, launch zone, and all required objectives.
- If an empty tile remains after mining, a replacement vein can respawn after a configurable delay.

### Tile types

| ID | Tile | Visual treatment | Behavior and value |
|---:|---|---|---|
| 0 | Regolith | Alternating dark slate | Walkable |
| 1 | Crater wall | Raised metal rock and crater ring | Blocks player and sentinels |
| 2 | Quartz | Gold glowing diamond | `$30B × drill level` |
| 3 | Helium-3 | Cyan glowing diamond | `$80B × drill level` |
| 4 | Dark matter | Magenta glowing diamond | `$180B × drill level` |
| 5 | Vulture Rover Base | Blue rounded `BASE` pad | Repairs hull and reduces heat |
| 6 | Vulture Launch Zone | Green rocket-pad markings | Launches cargo with `$60B` minimum |
| 7 | Thermal vent | Orange animated fissure | Rapidly reduces heat |
| 8 | Abandoned rover | Damaged Vulture equipment | Grants a temporary resource bonus |
| 9 | Radiation pocket | Purple warning particles | Increases ore value and heat generation |

## 4. Player character

### `Miner`

Fields:

- `callsign`
- `x`, `y`
- `health`
- `heat`
- `peakHeat`
- `drillLevel`
- `cargoCapacity`
- `cargoBillions`
- `savedBillions`
- `pillsDelivered`
- `shipmentsLaunched`
- `adrianaSafe`
- `empCharges` or `empEnergy`
- `activeUpgrades`

The constructor trims and uppercases the callsign. A valid callsign contains a hyphen and uses `length()`, `indexOf()`, and `substring()` for validation. Invalid or missing input defaults to `VULTURE-07`.

Methods:

- `move(dx, dy, grid)`: Clamp coordinates to map boundaries and reject walls.
- `mineOre(oreType)`: Add `base value × drill level`, increase heat by the configured amount, and update peak heat.
- `launchVultureCargo()`: Deduct the `$40B` medicine cost, bank the remaining cargo value, clear cargo, increment drill and shipment progress, set `adrianaSafe`, and add cannon time.
- `updateSuit(atBase)`: Cool and repair rapidly at base; cool gradually while exploring.
- `takeDamage(amount)`: Reduce health with a floor of `0`.
- `activateEmp()`: Trigger the EMP shockwave if its cooldown or energy requirement is satisfied.
- `applyUpgrade(upgrade)`: Apply a post-shipment equipment upgrade.

## 5. Game systems

### Heat system

| Heat | State | Effect |
|---:|---|---|
| `0–49%` | Stealth | No sentinels activate |
| `50–74%` | Warning | Periodic audio beeps and HUD warning |
| `75–99%` | Patrol alert | Tesla-class Sentinels activate |
| `100%` | Critical | Heavy Mechs activate |

- Mining increases heat by `15%` by default.
- Heat is capped at `100%`.
- Heat decreases more quickly at the Rover Base.
- Heat decreases gradually while exploring.
- Thermal vents provide a faster emergency cooling route.
- Heat generation and cooling rates are configurable in a balance file.

### Hull system

- Base repairs hull by `1%` per update tick.
- Tesla-class Sentinel collision deals `10` damage.
- Mech Sentinel collision deals `18` damage.
- Damage grants approximately `750ms` of collision invulnerability.
- Hull is clamped between `0%` and `100%`.

### Economy and cargo

- Cargo has a maximum capacity.
- Ore values are multiplied by drill level.
- Launching cargo costs `$40B` for medicine.
- A launch requires at least `$60B` of cargo value.
- The remaining value is added to savings.
- Each launch adds `30s` to the orbital cannon timer, capped at `120s`.
- Each successful launch unlocks one upgrade choice.

### Sentinel AI

#### Tesla-class Sentinel

- Activates at `75%` heat.
- Moves quickly and pursues along the dominant axis.
- Uses controlled movement probability per update.
- Deals `10` hull damage.
- Respects crater walls.

#### Mech Sentinel

- Activates at `100%` heat.
- Moves slowly but deals heavy damage.
- Deals `18` hull damage.
- Displays an arrival warning before entering the map.
- Respects crater walls and can be stunned by EMP.

Sentinels must not spawn directly beside the player or create an unavoidable wall trap. Spawn points require a minimum distance from the player and a reachable route.

### EMP system

Press `Q` to activate an expanding cyan shockwave.

- Radius: `5` tiles using Manhattan distance.
- Stun duration: `35` ticks (`3.5s`).
- Default cooldown: `70` ticks (`7s`).
- Sentinels cannot move or damage the player while stunned.
- The player receives a visible cooldown indicator.
- The ability is defensive and temporary; enemies recover normally.

## 6. Progression and upgrades

Every successful launch unlocks one upgrade choice:

| Upgrade | Effect |
|---|---|
| Vulture drill core | Increases ore value |
| Thermal regulator | Reduces heat generated while mining |
| Reinforced suit | Increases maximum hull |
| Cargo module | Increases cargo capacity |
| EMP capacitor | Reduces EMP cooldown |
| Navigation module | Reveals nearby ore and Sentinels |
| Landing thrusters | Improves movement speed |

The first release should use a small, readable upgrade tree rather than a large inventory system. Upgrade values should be data-driven so difficulty can be tuned without changing gameplay code.

## 7. Controls

- `WASD` or arrow keys: Move.
- `SPACE` or `E`: Mine an adjacent vein.
- `F`: Load and launch cargo at the Vulture Launch Zone.
- `Q`: EMP shockwave.
- `R`: Restart after victory or game over.
- `ESC`: Pause.

## 8. Interface and presentation

### Window and layout

- Target viewport: `968×766`.
- HUD: `88px`.
- Game viewport: `616px`.
- Status and controls bar: `62px`.
- Responsive browser mode should scale the game while preserving the grid aspect ratio.

### HUD

Display:

- Savings progress toward `$1T`.
- Cargo value and capacity.
- Drill level.
- Heat bar.
- Hull bar.
- Shipments completed.
- Orbital cannon timer.
- Callsign.
- Adriana Station medical status.
- EMP cooldown.
- Current objective.

Heat colors transition from cyan to yellow, orange, and crimson. Important warnings should use animation, sound, and text rather than color alone.

### Visual style

- Dark lunar regolith and metallic crater walls.
- Gold, cyan, and magenta glowing ore.
- Blue Vulture Rover Base with industrial markings.
- Green Vulture Launch Zone with reusable-rocket landing guides.
- Vulture rocket with black, white, and metallic-silver materials.
- Animated engine exhaust and landing lights.
- Sentinel drones with a distinct warning color.
- EMP shockwave with expanding cyan rings.
- Crimson orbital beam when the cannon timer expires.

### Audio

- Low-volume suit and rover ambience.
- Mining impact sounds differentiated by ore type.
- Heat-warning beeps.
- Sentinel alert tone.
- EMP discharge sound.
- Vulture launch countdown and engine rumble.
- Victory and game-over stingers.

## 9. Game states

- `MENU`: Callsign entry and start controls.
- `PLAYING`: Main mining and survival state.
- `PAUSED`: Freezes updates and displays controls.
- `VICTORY`: Displays savings, shipments, peak heat, and run seed.
- `GAME_OVER`: Displays loss reason, run statistics, and restart option.

## 10. Technical architecture

### Backend: Java

Use **Java 21** with **Spring Boot** for the backend.

Backend responsibilities:

- Serve REST endpoints for leaderboard submissions.
- Validate score and run-summary payloads.
- Store player profiles and best results if accounts are added later.
- Provide daily crater seeds.
- Store configuration and balance values.
- Expose health checks and structured error responses.

Recommended backend components:

- Java 21.
- Spring Boot.
- Spring Web.
- Spring Validation.
- Spring Data JPA.
- PostgreSQL for production.
- H2 for local development and tests.
- Flyway for database migrations.
- JUnit 5 and Mockito.
- Maven or Gradle; Maven is recommended for a simpler initial build.

The game should remain playable without the backend. If the API is unavailable, the frontend falls back to local progress and does not silently report a score as submitted.

### Frontend: Phaser and TypeScript

Use:

- TypeScript.
- Phaser 3.
- Vite.
- CSS for menus and responsive layout.
- Vitest for gameplay-system tests.
- ESLint and Prettier.

Frontend responsibilities:

- Rendering and animation.
- Keyboard input.
- Map generation and collision.
- Miner, ore, and Sentinel behavior.
- Heat, hull, cargo, EMP, and timer systems.
- Local save data.
- Optional API integration for leaderboards and daily seeds.

The gameplay simulation should be written in testable TypeScript modules and kept separate from Phaser scene code where practical.

### Suggested project structure

```text
backend/
  src/main/java/com/vulture/mining/
    controller/
    service/
    model/
    repository/
    config/
  src/test/

frontend/
  src/
    main.ts
    game/
      scenes/
      entities/
      systems/
      ui/
      config/
    api/
    storage/
  tests/
```

### API outline

```text
GET  /api/health
GET  /api/daily-crater
GET  /api/leaderboard?limit=20
POST /api/runs
```

`POST /api/runs` should accept a validated run summary containing the seed, score, shipments, completion status, duration, and selected upgrades. The server must validate limits and reject malformed or impossible values.

## 11. Hosting and deployment

### Recommended production setup

- **itch.io:** Primary public game distribution.
- **Vercel:** Host the browser frontend and preview deployments.
- **Render, Railway, or Fly.io:** Host the Java Spring Boot API.
- **Managed PostgreSQL:** Store leaderboard and daily-seed data.
- **GitHub:** Source code, issue tracking, and CI.

### Why itch.io is primary

itch.io is the best player-facing destination because it supports HTML5 games, downloadable builds, screenshots, ratings, comments, devlogs, and optional payments. Upload the Vite `dist/` output as an HTML5 game.

### Why Vercel is useful

Vercel is ideal for:

- Automatic frontend deployments from GitHub.
- Preview URLs for branches and pull requests.
- A landing page and documentation.
- A fast browser-playable demo.

Vercel should not be used to host the Java backend unless the backend is separately deployed as a compatible service.

### GitHub Pages

GitHub Pages is a good free alternative for the static frontend, but it does not run the Java backend. It is suitable for a project showcase, not the primary game community page.

## 12. Development milestones

### Milestone 1: Playable prototype

- Render the grid.
- Move the Miner.
- Generate walls and ore.
- Mine ore.
- Display heat, hull, and cargo.

### Milestone 2: Survival loop

- Add base repair and cooling.
- Add launch zone.
- Add cannon timer.
- Add Tesla Sentinels.
- Add collision damage.

### Milestone 3: Complete gameplay

- Add Mech Sentinels.
- Add EMP.
- Add procedural-generation validation.
- Add victory and game-over states.
- Add upgrades.

### Milestone 4: Presentation

- Add Vulture rocket animations.
- Add sound and music.
- Add responsive HUD.
- Add tutorial prompts and accessibility settings.

### Milestone 5: Online services

- Add Java API.
- Add daily crater seeds.
- Add validated leaderboard submissions.
- Add deployment pipeline.

## 13. Quality and accessibility requirements

- Gameplay must be possible with keyboard only.
- Do not communicate warnings through color alone.
- Add reduced-motion support.
- Add volume controls and mute options.
- Keep all balance values configurable.
- Test map generation across many seeds.
- Test that important areas are always reachable.
- Test victory, defeat, collision, heat, EMP, and launch edge cases.

## 14. Release recommendation

Build the first release as an offline-capable browser game with local saves. Deploy the frontend to Vercel for development and publish the finished game on itch.io. Add the Java backend only for daily challenges and leaderboards after the core game is fun and stable.
