# Rockbreaker - spec

Replaces the previous game (Vulture) in this repo. Same Phaser 3 + TypeScript + Vite stack, same GitHub Pages deploy.

## Concept
A tycoon / space-shooter hybrid. Fly a mining ship around a large scrolling asteroid sector, shoot rocks apart, collect ore, sell it at your home station at fluctuating market prices, and reinvest in ship upgrades, auto-mining drones and station defenses. Clear four sectors; the last has a boss.

## Platform and controls
Desktop browser. WASD thrust with inertia (drift physics), mouse aims, hold left mouse to fire the mining cannon. E docks at the station / enters the warp gate. Esc pauses. M mutes.

## Core loop
1. Leave the station, shoot asteroids (large -> medium -> small, splitting), collect ore chunks (magnet range, limited cargo).
2. Return to the station and dock: ore is sold at current market price (or held), ship is repaired and refueled for a cost, shop and contracts open.
3. Spend money on upgrades; hit the sector's earnings goal to open the warp gate to the next sector.

## Tycoon systems (all four)
- Market: four ores (Ferrite, Cobalt, Platinum, Voidstone) with random-walk prices that mean-revert, plus timed events (shortage, glut, boom) shown in a ticker.
- Drones and station: buy up to N auto-mining drones that mine and earn passive income; drones cost upkeep per minute; pirates may attack them; station has a turret that can be upgraded.
- Upgrade tree: cannon damage, fire rate, hull, cargo, thrusters, fuel tank, magnet range, drone count, drone yield, station turret (levels 1-5, scaling cost).
- Contracts and costs: up to 2 active delivery contracts (ore type, quantity, deadline, bonus payout). Fuel burns when thrusting; repairs cost credits. Empty fuel = weak thrust.

## Threats (three types)
- Asteroid collisions: damage scales with impact speed; rocks split when shot.
- Pirates: chase the player, fire, and steal a share of cargo on contact then flee; killing them drops the loot. They also harass drones.
- Environmental hazards: solar flares (warned, damage unless docked or inside the station safe zone), debris storms (fast rock swarms crossing the map), gravity wells (sector 2+, pull ships).

## Campaign
Four sectors, each one large map with a home station. Each has an earnings goal; reaching it opens a warp gate. Sectors raise asteroid density, pirate frequency and hazards. Sector 4 spawns a Dreadnought boss after its goal; defeating it wins the game (then free play continues).

## Persistence
localStorage autosave on dock: money, upgrades, drones, sector, lifetime stats. Title screen offers Continue / New Game.

## Art and audio
Fully procedural: asteroids drawn in code as flat-faceted polygons lit from upper-left with ore veins, vector ship / pirates / drones / station, particle effects, parallax starfield. WebAudio synthesized sound effects. Gritty industrial palette: near-black space, warm ore glows, bright readable shapes. No external assets, no gradients in rendering.

## Non-goals
Mobile/touch, multiplayer, backend. The old Java backend and Vulture assets are removed.

## Verification
Pure game logic (market, upgrades, contracts, save, sector progress) is unit-tested with Vitest. `npm run build` and tests must pass; the game is playtested in the browser; GitHub Pages deploys from main.
