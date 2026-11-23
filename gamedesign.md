# Vulture: Lunar Mining Mission

## 0. Approved implementation scope

This document is both the game design specification and the implementation plan.

### Gamedev agent skills

Use the router and skill catalog at
<https://github.com/gamedev-skills/awesome-gamedev-agent-skills> throughout implementation.
Select skills based on the current task and engine rather than copying them into unrelated
workflows.

Required skill groups for this project:

- Phaser and 2D web-engine fundamentals
- Top-down movement and collision
- Procedural generation
- Tile and world data
- Game save systems
- UI and accessibility
- 2D animation and audio
- Create-game-assets and art-direction workflow
- Local storage and offline behavior
- Web deployment and itch.io publishing

The selected local skills are installed under `/.agents/skills/` for use during implementation:
`router`, `phaser-core`, `phaser-arcade-physics`, `procedural-gen`, `create-game-assets`,
`save-systems`, `game-ui-ux`, `audio-design`, `survival-crafting`, and `itch-publish`.

When the skill repository provides more specific guidance for a task, follow that guidance
before inventing a project convention. Engine implementation must remain compatible with the
Phaser 3 version chosen for this repository.

### Release target

- Build a complete **offline-capable browser game** for desktop and responsive browser play.
- Publish the static frontend to **Vercel** for development and **itch.io** as the primary player-facing release.
- Use **Phaser 3 + TypeScript + Vite** for the game.
- Use **Java 21 + Spring Boot** for all server-side code.
- Include the backend from the start for:
  - Health checks
  - Daily crater seeds
  - Validated run submissions
  - Leaderboard reads
- Use PostgreSQL in production and H2 for local development and tests.
- Use Flyway for database migrations.
- Keep the game playable if the API or network is unavailable.
- Never claim that a run was submitted unless the backend acknowledges success.

### Asset direction

- Prefer original, fictional assets: flat vector for terrain/UI, stylized-3D bitmap sprites where noted in the asset manifest.
- Licensed web assets may be used when their licenses allow redistribution and their attribution requirements can be satisfied.
- Record the source, author, license, and required attribution for every external asset under `frontend/public/assets/licenses/`.
- Do not copy real aerospace branding or logos.
- Procedural and code-drawn rendering uses flat fills, outlines, solid particles, and hard-edged silhouettes.
- Pre-rendered sprite bitmaps may contain shading.

### Repository implementation structure

```text
backend/
  pom.xml
  src/main/java/com/vulture/mining/
    api/
    model/
    repository/
    service/
    config/
  src/main/resources/application.yml
  src/main/resources/db/migration/
  src/test/java/com/vulture/mining/

frontend/
  package.json
  vite.config.ts
  tsconfig.json
  src/
    main.ts
    style.css
    types.ts
    balance.ts
    client.ts
    localSave.ts
    scenes/
      BootScene.ts
      MenuScene.ts
      PlayScene.ts
      PauseScene.ts
      ResultScene.ts
tests/
  integration.test.ts
  sentinels.test.ts
  simulation.test.ts
  smoke.spec.ts
  world.test.ts
    audio/
    licenses/
```

Keep Phaser rendering and browser input separate from engine-independent gameplay modules.

### Required configuration

All gameplay balance values must be data-driven. This includes:

- Ore values and heat costs
- Heat thresholds and cooling rates
- Hull, repair, and collision-invulnerability values
- Cargo limits and medicine cost
- EMP radius, duration, and cooldown
- Tesla and Mech activation, movement, damage, and warning values
- Cannon timer, launch bonus, and timer cap
- Victory, defeat, and upgrade values
- World size, ore count, respawn delay, and minimum safe spawn distances

## 1. Product vision

**Vulture: Lunar Mining Mission** is a single-player, top-down 2D lunar mining survival game set in 2199. The player explores a large connected crater map and operates a rugged **Vulture-class reusable cargo rocket** for the fictional aerospace company **Vulture Aerospace**.

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

## 3. Open-world crater generation

- Each run generates a large connected crater map from a seed.
- The world is rendered as a top-down 2D map with multiple walkable regions.
- Terrain includes regolith fields, crater walls, ridges, tunnels, ore fields, rover roads, landing zones, and landmarks.
- At least `14` active ore veins must exist across the map.
- The Vulture Rover Base and Launch Zone must have a safe, walkable route between them.
- Generation must validate that the player can reach the base, launch zone, and required objectives.
- High-value ore should be placed farther from the base or near higher-risk terrain.
- Empty or depleted ore locations may respawn after a configurable in-game delay.
- Collision bounds, line-of-sight blockers, interactable objects, and enemy spawn regions must be generated with the map.

### World objects and landmarks

| Object | Visual treatment | Behavior and value |
|---|---|---|
| Regolith | Dusty, uneven lunar terrain | Walkable |
| Crater wall | Raised rock formations and crater rings | Blocks movement and line of sight |
| Quartz vein | Gold glowing crystal cluster | `$30B × drill level` |
| Helium-3 vent | Cyan glowing extraction point | `$80B × drill level` |
| Dark matter deposit | Magenta anomalous formation | `$180B × drill level` |
| Vulture Rover Base | Blue habitat and repair pad | Repairs hull and reduces heat |
| Vulture Launch Zone | Green landing guides and tower lights | Launches cargo with `$60B` minimum |
| Thermal vent | Orange animated fissure | Rapidly reduces heat |
| Abandoned rover | Damaged Vulture equipment | Grants a temporary resource bonus |
| Radiation pocket | Purple particles and warning markers | Increases ore value and heat generation |

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

- `move(dx, dy, grid)`: Move across the top-down map using collision bounds and reject walls.
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

## 7. Controls and camera

- `WASD` or arrow keys: Move.
- `SPACE` or `E`: Interact with a nearby vein, rover, console, or launch control.
- `F`: Load and launch cargo at the Vulture Launch Zone.
- `Q`: EMP shockwave.
- `R`: Restart after victory or game over.
- `ESC`: Pause.
- The camera follows the Miner from a fixed top-down angle and can smoothly pan or zoom.

## 8. Interface and presentation

### Window and layout

- Target viewport: `968×766`.
- HUD: `88px`.
- Game viewport: `616px`, rendering the top-down 2D world.
- Status and controls bar: `62px`.
- Responsive browser mode should scale the game while preserving map visibility and HUD legibility.

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
- Top-down Miner sprite with visible suit lights, backpack, tool, and dust trails.
- Walkable launch complex with service towers, cargo containers, rover garages, floodlights, and safety barriers.
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
- Phaser 3 for 2D rendering, tile maps, camera movement, collision, particles, and scene management.
- Vite.
- CSS for menus and responsive layout.
- Vitest for gameplay-system tests.
- ESLint and Prettier.

Frontend responsibilities:

- Rendering and animation.
- Keyboard input.
- Top-down map generation and collision.
- Camera follow, pan, and zoom.
- Waypoint graphs for Sentinel AI.
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
  package.json
  src/
    main.ts
    style.css
    types.ts
    balance.ts
    client.ts
    localSave.ts
    scenes/
tests/
  *.test.ts
  smoke.spec.ts
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

### Milestone 1: Playable 2D prototype

- Render a small top-down crater test sector.
- Move the Miner around the map.
- Add collision with terrain and structures.
- Add one ore deposit and a basic interaction prompt.
- Display heat, hull, and cargo.

### Milestone 2: Survival loop

- Add base repair and cooling.
- Add launch zone.
- Add a walkable Vulture Launch Zone and Vulture-7 rocket.
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

Build the complete first release as an offline-capable browser game with local saves. Deploy the frontend to Vercel for development and publish the finished game on itch.io. Include the Java backend from the start for health checks, daily crater seeds, validated run submissions, and leaderboards.

## 15. Implementation plan

### Phase 1: Foundation

1. Initialize the Phaser 3, TypeScript, Vite, Vitest, ESLint, and Prettier frontend.
2. Initialize the Java 21, Spring Boot, Maven, JPA, H2, PostgreSQL, Flyway, JUnit, and Mockito backend.
3. Add root scripts for frontend tests, backend tests, and combined verification.
4. Add GitHub Actions for linting, testing, migrations, and both production builds.
5. Add environment templates and explicit frontend/API base URL configuration.

Acceptance:

- The frontend renders a 968x766 smoke scene.
- `GET /api/health` returns a structured healthy response.
- Clean frontend and backend installs and test commands succeed.

### Phase 2: Pure gameplay simulation

Implement and test engine-independent TypeScript modules in this order:

1. Callsign normalization and validation.
2. Cardinal movement with wall and boundary rejection.
3. Ore mining, drill multiplication, cargo limits, depletion, and heat.
4. Hull damage, invulnerability, repair, and clamping.
5. Heat thresholds and cooling in exploration, base, and thermal-vent states.
6. Launch validation, medicine deduction, savings, cannon bonus, shipment count, and upgrades.
7. EMP activation, Manhattan radius, stun ticks, cooldown, and cooldown presentation.
8. Menu, playing, pause, victory, game-over, and restart transitions.

Canonical frontend contracts must include `MinerState`, `OreType`, `SentinelType`, `GameState`, `UpgradeId`, and `RunSummary`.

Acceptance:

- The same seed and input sequence produce the same simulation state.
- Callsign, heat, hull, cargo, launch, EMP, and state edge cases have unit tests.
- Pure modules contain no Phaser or browser globals.

### Phase 3: Seeded crater world

Implement deterministic tile and navigation generation with:

- Multiple connected walkable crater regions
- Crater walls and line-of-sight blockers
- Rover roads, ridges, tunnels, ore fields, and landmarks
- The Rover Base and Launch Zone
- Thermal vents and radiation pockets
- At least 14 active ore veins
- Enemy spawn zones
- Collision and interactable-object metadata

Before accepting a map, validate:

- Reachability from the player to base, launch zone, and objectives
- A safe walkable route between base and launch zone
- Ore placement and at least one active vein of each type
- Enemy spawn distance and reachable routes
- No structure-wall overlap or unreachable reserved tile
- High-value ore is farther from base or in higher-risk terrain

Acceptance:

- 1,000 generated seeds pass reachability validation.
- Depleted locations respawn according to configured delay.
- Navigation and collision use the same tile data.

### Phase 4: Rendering and interface

Implement:

- Fixed top-down camera with follow and constrained pan/zoom
- WASD, arrow-key, interaction, EMP, launch, pause, and restart input
- Blue Vulture base and green Launch Zone landmarks
- Gold, cyan, and magenta ore visuals
- A 88px HUD, 616px game viewport, and 62px status/control bar in the 968x766 reference layout
- Responsive scaling without hiding the world or collapsing HUD information
- Heat and Sentinel warnings using animation, text, and icons rather than hue alone

Asset requirements:

- Miner with suit lights, backpack, tool, and movement directions
- Vulture-7 and launch animation
- Base and repair states
- Three ore types and depleted states
- Thermal vent and radiation pocket
- Abandoned rover
- Tesla and Mech Sentinels
- EMP shockwave and warning effects
- Flat HUD and icon assets

Acceptance:

- No CSS or Canvas gradients appear in source or generated asset code.
- Every warning remains understandable without color.
- Reduced motion disables nonessential camera and particle effects.
- Missing optional assets do not prevent startup.

### Phase 5: Sentinel behavior

Implement:

- Tesla activation at 75% heat
- Mech activation at 100% heat
- Tesla movement, dominant-axis pursuit, and `10` hull damage
- Mech arrival warning, slow pursuit, and `18` hull damage
- Wall-aware graph or tile movement
- 750ms player collision invulnerability
- EMP stun for 35 ticks
- Minimum-safe-distance and reachable-route spawn validation

Acceptance:

- Sentinels cannot spawn beside the player or inside walls.
- Stunned Sentinels cannot move or deal damage.
- Tesla and Mech behavior is deterministic and unit tested.
- No sentinel spawn creates an unavoidable wall trap.

### Phase 6: Progression and release loop

Complete:

- Base repair and cooling
- Thermal-vent cooling
- Ore respawn
- Cargo loading and launch
- Medicine shipment
- Cannon-time bonus and 120-second cap
- All seven upgrade choices
- Victory after `$1T` savings and at least one medical shipment
- Loss by hull or cannon expiration
- Result, seed, and run-statistics screens

Upgrade stacks must be defined by configuration and prevent unsupported duplicate stacking.

Acceptance:

- A test run can complete the victory conditions.
- Hull and cannon loss end in the correct game-over state.
- A launch cannot succeed below $60B cargo.
- A successful launch applies the medicine cost and adds an upgrade choice.

### Phase 7: API and persistence

Implement in Java:

- `GET /api/health`
- `GET /api/daily-crater`
- `GET /api/leaderboard?limit=20`
- `POST /api/runs`

The run-submission DTO must include:

- Callsign
- Seed
- Duration
- Final savings
- Remaining cargo
- Shipment count
- Medicine delivery count
- Peak heat
- Hull
- Completion status
- Victory or loss reason
- Selected upgrades

Validation must reject malformed payloads and impossible combinations, including negative values, impossible shipment and medicine counts, unknown or overstacked upgrades, invalid callsigns, invalid seeds, and inconsistent victory/loss flags.

Use structured problem-detail errors. Add Flyway migrations and integration tests using H2.

Frontend persistence must include:

- Versioned local save
- Safe fallback for missing, corrupt, or old saves
- Local best run
- Current settings
- Submission state
- Retryable API failure state

Acceptance:

- API success, malformed input, impossible summary, and limit tests pass.
- Offline play continues without a backend.
- Submission failure is visible and is never represented as success.
- Daily seed remains usable offline if cached for the current UTC day.

### Phase 8: Audio, accessibility, and polish

Add:

- Low-volume suit and rover ambience
- Ore-specific mining sounds
- Heat beeps and Sentinel alerts
- EMP discharge
- Launch countdown and engine rumble
- Victory and defeat stingers
- Volume and mute controls
- Keyboard-only play
- Pause controls
- Reduced-motion settings
- Text alternatives for visual warnings

Acceptance:

- The complete loop can be played and paused with keyboard only.
- No warning relies on color alone.
- Audio can be muted and has bounded volume.
- The target viewport remains legible in the reference layout.

### Phase 9: Release verification

Run:

- Frontend unit and integration tests
- Java JUnit and Spring integration tests
- 1,000-seed world reachability tests
- Browser smoke tests at desktop and narrow responsive sizes
- Victory, defeat, collision, heat, EMP, and launch edge-case tests
- Asset and license audit
- Accessibility and keyboard-only audit
- Frontend production build
- Java production build and migration check

Release gates:

- The normal flow has no runtime or console errors.
- The frontend code uses no gradient rendering (shading inside sprite bitmaps is allowed).
- The backend has no untested migration.
- Every external asset has a redistributable license record.
- `frontend/dist/` is suitable for itch.io HTML5 upload.
- Vercel is configured for the static frontend.
- The Java API is deployed separately on a Java-compatible host.
