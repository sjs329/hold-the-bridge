Canvas Shooter

A minimal HTML5 canvas shooter. Open `index.html` in your browser to play.

Play Online:
https://sjs329.github.io/hold-the-bridge/

Controls:
- Move: Arrow keys or A/D
- Move (mobile): Drag/hold on the game area
- Shoot: Auto-fire
- Start/Restart: Any key or tap
- Pause/Resume: Space

Balancing and Level Scaffold:
- Main tuning is in `src/game.js` under `GAME_TUNING`.
- Change `GAME_TUNING.intensity` to scale overall pressure up/down.
- Authored levels live in `LEVEL_DEFS` in `src/game.js`.
- Each level defines enemy pacing, power-up lock difficulty, and wall health.
- Level progression uses fixed per-level enemy quotas via each level's `enemyQuota`.
- Level transitions now pause gameplay briefly, show a level card, and restore a portion of wall health.
- After the last authored level, the game uses endless fallback scaling rules in `GAME_TUNING.endless`.
- Left lane events now mix rarer gun crates with EMP crates that temporarily slow the horde.
- Multi-shot can upgrade at most once per level; additional gun crates in that level focus on fire-rate improvements.
- Runtime debug handles:
  - `window._game.tuning`
  - `window._game.levels`

To run locally:
1. Open `index.html` in a browser (Chrome/Edge/Firefox).
2. Or run a simple HTTP server from the project folder, e.g.:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

GitHub Pages deployment:
1. Commit and push this repo to GitHub.
2. In GitHub, open `Settings` -> `Pages`.
3. Under `Build and deployment`, set `Source` to `GitHub Actions`.
4. Push to `main` (or run the `Deploy GitHub Pages` workflow manually).
5. Wait for the workflow to finish; your game will be published at:
  - `https://<your-username>.github.io/<repo-name>/`

Next steps:
- Add sounds and sprites
- Add enemy variety and boss waves