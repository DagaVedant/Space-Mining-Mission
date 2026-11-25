# Asteroid Breaker

An asteroid mining tycoon and space shooter, playable in the browser. Choose **PvP** for a live dogfight or **Play against AI** for the mining campaign.

Play: https://dagavedant.github.io/Space-Mining-Mission/

## How to play

- WASD to thrust (you drift, so plan your stops), mouse to aim, hold left click to fire.
- Break rocks. Large rocks split into smaller ones, and every rock drops ore.
- Fly over ore to collect it (the magnet upgrade widens the pickup range).
- Press E at the home station to dock: sell ore, repair, refuel, buy upgrades, take contracts.
- Ore prices move with the market, so watch for shortages and booms.
- Pirates steal cargo and flee. Shoot them to get it back. Faster, denser asteroid traffic, stronger black holes and gravity-pulling planets add hazards; being pulled into a planet destroys your ship.
- Earn each sector's goal to open the warp gate. Six sectors include new pirate classes and a final Dreadnought encounter.
- Each sector also has a required objective; meet both it and the earnings quota to unlock the gate. Objective completion grants a credit bonus.
- Upgrade hull capacity and regeneration, sprint fuel recharge, shields, ore scanning and refining. Mining drones target valuable ore faster. Select unlocked pilots and ship skins, and complete rotating daily quests.
- Esc pauses, M mutes. The settings menu supports key rebinding, aim sensitivity, volume, screen shake, reduced motion, HUD scaling and an optional launch tutorial. Settings and AI progress save locally; campaign progress syncs to your account when signed in.
- Touch controls support movement, aiming/firing and boosting on mobile layouts. Landscape orientation is recommended.
- The minimap marks gravity wells, planets, pirates and the warp gate. Pirates and the Dreadnought show visual attack warnings; sector debriefs recap mining, combat, damage and hazard alerts.
- Find two fixed salvage sites in every sector. Recover wrecks, caches and relics for one-time credits; six discoveries unlock the Voidglass skin. Open the map's Log button to review your collection. Sites are optional and never block sector progression.
- PvP requires an account and an available backend service. Choose casual or seasonal ranked matchmaking, see live connection quality, review your rating and the top three pilots, and rematch after each match.

## Development

```
cd frontend
npm install
npm run dev
npm test
npm run build
```

Stack: Phaser 3, TypeScript, Vite, Vitest. Asteroids, hazards, effects and environments are drawn procedurally; the four original player-ship skins are crisp-edged SVG assets. All sound is synthesized. Pushing to `main` deploys to GitHub Pages.

## Backend

The backend provides account authentication, versioned cloud saves, casual and ranked PvP matchmaking, authoritative 1v1 combat, seasonal ratings, a leaderboard, and persistent PvP records. The frontend keeps localStorage saves for offline play and migrates existing v1-v3 saves; signed-in saves sync with the backend.

```sh
cd backend
npm ci
cp .env.example .env
npm run check
npm test
npm run dev
```

For a persistent deployment, configure `backend/.env` and run `docker compose -f backend/compose.yaml up --build` from the repository root. Set `ALLOWED_ORIGINS` to the exact frontend origin(s). The backend must be hosted separately from GitHub Pages and exposed over HTTPS/WSS in production.

To connect the GitHub Pages frontend, set the repository Actions variables `VITE_API_URL` and `VITE_WS_URL` to the backend HTTPS and WSS base URLs. The Pages workflow injects these at build time; without them, AI play remains available and online features report that the backend is unavailable.
