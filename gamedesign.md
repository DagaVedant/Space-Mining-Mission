# Grand Theft Astro 7: Moon Miner 2199

## Overview

A Java Swing, 2D top-down grid survival game. The player mines restricted lunar craters, evades Elon's security forces, and ships ore to fund Adriana's medicine.

- **Win:** Bank `$1,000B` (`$1T`) while Adriana is funded.
- **Lose:** Orbital Cannon reaches `0s`, or Suit Hull reaches `0%`.
- **Loop:** Explore and mine → evade or EMP bots → cool and repair at base → launch cargo.

## World

- Grid: `14 rows × 22 columns`; tiles are `44px`; regenerated each run.
- Nested loops use `Math.random()`: `11%` walls, `17%` mixed ore, `72%` dust.
- A `while` loop guarantees at least `14` active veins and respawns one on an empty tile after mining.
- Clear a `3×4` safe zone around `(2,2)` so the player, base, and launchpad cannot be trapped.

| ID | Tile | Visuals | Behavior / value |
|---:|---|---|---|
| 0 | Regolith | Alternating dark slate | Walkable |
| 1 | Crater wall | Raised metallic rock with crater ring | Blocks player and bots |
| 2 | Quartz | Glowing gold diamond | `$30B × drill level` |
| 3 | Helium-3 | Glowing cyan diamond | `$80B × drill level` |
| 4 | Dark matter | Glowing magenta diamond | `$180B × drill level` |
| 5 | Rover Base | Blue rounded `BASE` pad | Heat `-3%`, hull `+1%` per tick |
| 6 | SpaceX Launchpad | Green rocket zone | Launches cargo at `$60B` minimum |

## Classes

### `Miner`

Fields: `callsign`, `x`, `y`, `health`, `heat`, `peakHeat`, `drillLevel`, `pillsDelivered`, `cargoBillions`, `savedBillions`, and `adrianaSafe`.

The constructor trims and uppercases input, validates a hyphen using `length()`, `indexOf()`, and `substring()`, and defaults invalid or missing names to `ASTRO-07`.

- `move(dx, dy, grid)`: clamp coordinates to map boundaries and reject `tile == 1`.
- `mineOre(oreType)`: calculate the tier value, add `base value × drill level`, increase heat `+15%` capped at `100%`, and update peak heat.
- `launchSpaceXCargo()`: subtract `$40B` for medicine, bank the remainder, empty cargo, increment drill and shipments, set `adrianaSafe`, and vent `30%` heat.
- `updateSuit(atBase)`: rapidly cool and heal at base; gradually cool while exploring.
- `takeDamage(amount)`: subtract from health with a floor of `0`.

### `SecurityBot`

Fields: `type` (`TESLA` or `MECH`), `x`, `y`, `stunTicks`, and `active`. The constructor initializes the type, spawn corner, and inactive state.

- Activate at heat `75%` (Tesla) or `100%` (Mech).
- Active, unstunned bots pursue the player along the dominant axis at controlled tick probability while respecting walls.
- `stun(ticks)` freezes a bot; `isTouching(player)` detects collisions.

### `GrandTheftAstro7`

Extends `JPanel`, implements `ActionListener` and `KeyListener`, and owns the grid, input, collisions, timers, rendering, and game states. A `100ms` Swing timer drives updates.

## Mechanics

- Heat: `0–49` stealth; `50–74` warning with periodic audio beeps; `75–99` Tesla patrol; `100` Heavy Mechs.
- Three Tesla-Bots deal `10` hull damage; two Heavy Mechs deal `18`.
- Orbital Cannon starts at `95s`; each launch adds `30s`, capped at `120s`.
- Press `Q` for an expanding cyan shockwave with 5-tile Manhattan radius: stun bots for `35` ticks (`3.5s`); cooldown `70` ticks (`7s`).
- Base repairs and cools; walls block movement; hull and heat are clamped.

## UI and Controls

Window: `968×766`: `88px` HUD, `616px` viewport, `62px` status/control bar.

- HUD: green savings bar, yellow cargo/drill readout, color-shifting heat bar (cyan → yellow → orange → crimson), hull, shipments, cannon timer, callsign, and Adriana status.
- Viewport: dark lunar grid, glowing polygon gems, rover visor details, stun-tinted bots, animated rocket thrusters, vertical crimson orbital beam on expiration, and centered start/victory/game-over cards.
- Status bar: live event messages such as mined value, launch warnings, EMP counts, and damage alerts.
- Controls: `WASD`/arrows move; `SPACE`/`E` mine; `F` launch; `Q` EMP; `R` restart.
