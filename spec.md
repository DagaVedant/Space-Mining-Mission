# Asteroid Breaker - spec

Replaces the previous game (Vulture) in this repo. Phaser 3 + TypeScript + Vite browser client deployed to GitHub Pages, with a separately hosted Java backend for cloud saves and online PvP.

## Concept
A tycoon / space-shooter hybrid. Fly a mining ship around a large scrolling asteroid sector, shoot rocks apart, collect ore, sell it at your home station at fluctuating market prices, and reinvest in ship upgrades, auto-mining drones and station defenses. The home screen offers PvP dogfights or the solo AI campaign.

## Platform and controls
Desktop and mobile browser. Keyboard thrust with inertia (drift physics), mouse aims, hold left mouse to fire. E docks at the station / enters the warp gate. Esc pauses. M mutes. Settings support key rebinding, aim sensitivity, volume, screen shake, reduced motion, HUD scale and an optional first-run tutorial; mobile layouts provide virtual move/aim/fire and boost controls.

## Core loop
1. Leave the station, shoot asteroids (large -> medium -> small, splitting), collect ore chunks (magnet range, limited cargo).
2. Return to the station and dock: ore is sold at current market price (or held), ship is repaired and refueled for a cost, shop and contracts open.
3. Spend money on upgrades; hit the sector's earnings goal to open the warp gate to the next sector.

## Tycoon systems (all four)
- Market: four ores (Ferrite, Cobalt, Platinum, Voidstone) with random-walk prices that mean-revert, plus timed events (shortage, glut, boom) shown in a ticker.
- Drones and station: buy up to N auto-mining drones that mine and earn passive income; drones cost upkeep per minute; pirates may attack them; station has a turret that can be upgraded.
- Upgrade tree: cannon damage, fire rate, hull, cargo, thrusters, fuel tank, magnet range, drone count, drone yield, station turret, shields, scanner and refinery (levels 1-5, scaling cost).
- Contracts and costs: up to 2 active delivery contracts (ore type, quantity, deadline, bonus payout). Fuel burns when thrusting; repairs cost credits. Empty fuel = weak thrust.

## Threats
- Asteroid collisions: damage scales with impact speed; rocks split when shot.
- Pirate raiders, interceptors and bombers: chase the player, fire, and steal a share of cargo on contact then flee; killing them drops the loot. They also harass drones.
- Environmental hazards: solar flares (warned, damage unless docked or inside the station safe zone), debris storms (fast rock swarms crossing the map), gravity wells (sector 2+, pull ships).

## Campaign
Six sectors, each one large map with a home station. Each has an earnings goal and a required sector objective; completing both opens a warp gate, and objective completion grants a credit bonus. Each sector also has two fixed optional discovery sites (wrecks, caches, or relics), marked on the minimap and recovered with the configured interact control. Discoveries award one-time credits; six sites unlock the Voidglass skin. The discovery log tracks the collection, and sites never gate campaign progression. The minimap includes hazard, planet, pirate, discovery, and gate markers. Sectors raise asteroid density, pirate frequency and hazards. The final sector spawns a Dreadnought boss after its requirements; enemies telegraph attacks, and sector debriefs summarize mining, combat, damage and hazard warnings. Defeating the boss wins the campaign (then free play continues). Existing delivery contracts and rotating daily objectives provide additional missions and rewards.

## Persistence
Versioned localStorage autosave on dock supports offline AI play and migrates existing v1-v3 saves. Signed-in accounts sync campaign saves with the backend using revision checks. Pilots, ship skins, daily quest progress, upgrades, selected weapon, campaign objective progress, and discovered site IDs are included in progression. Settings save separately in localStorage.

## Backend and multiplayer
The Java (Spring Boot) service uses Postgres for accounts, sessions, cloud saves and PvP records. Passwords are stored as scrypt hashes; bearer sessions are hashed at rest. WebSocket PvP matchmaking pairs two signed-in players in a server-authoritative dogfight. Casual matches do not affect rating; ranked matches update seasonal and career ratings and appear on the leaderboard. Players can cancel queueing, retry after a timeout, or rematch. The backend is separate from the static GitHub Pages frontend and must be configured/deployed independently.

## Art and audio
Hybrid art pipeline: asteroids, pirates, drones, stations, hazards, particles and the parallax starfield are drawn procedurally; four original crisp-edged SVG player-ship skins provide distinct silhouettes and palettes. WebAudio synthesized sound effects. Gritty industrial palette: near-black space, warm ore glows, bright readable shapes. No third-party art assets.

## Non-goals
Monetization and social/clan systems. The old game's Java backend and Vulture assets are removed.

## Verification
Pure game logic (market, upgrades, contracts, save migration, daily quests, sector progress) is unit-tested with Vitest. Backend account/save/PvP flows are tested with JUnit against Postgres. Frontend lint/build and backend tests must pass; playtest in the browser; GitHub Pages deploys from main and the backend is deployed separately.
