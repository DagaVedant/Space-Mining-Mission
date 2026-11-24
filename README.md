# Rockbreaker

An asteroid mining tycoon and space shooter, playable in the browser.

Play: https://dagavedant.github.io/Space-Mining-Mission/

## How to play

- WASD to thrust (you drift, so plan your stops), mouse to aim, hold left click to fire.
- Break rocks. Large rocks split into smaller ones, and every rock drops ore.
- Fly over ore to collect it (the magnet upgrade widens the pickup range).
- Press E at the home station to dock: sell ore, repair, refuel, buy upgrades, take contracts.
- Ore prices move with the market, so watch for shortages and booms.
- Pirates steal cargo and flee. Shoot them to get it back. Solar flares, debris storms and gravity wells are the environmental hazards.
- Earn each sector's goal to open the warp gate. Four sectors, ending with a boss in The Maw.
- Esc pauses, M mutes. Progress saves automatically in your browser.

## Development

```
cd frontend
npm install
npm run dev
npm test
npm run build
```

Stack: Phaser 3, TypeScript, Vite, Vitest. All art is drawn procedurally and all sound is synthesized, so there are no external assets. Pushing to `main` deploys to GitHub Pages.
