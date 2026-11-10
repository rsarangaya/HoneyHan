# PROJECT.md

## Summary
HoneyHan (working name "Prototype Test"): first-person stealth roguelike dungeon crawler in the browser. Seeded procedural floors, noise/vision stealth, melee combat with hit zones, loot and inventory. Alpha scope: floors 1-5. Full design in `DESIGN.md`; progress log in `STATUS.md`.

## Stack
- Plain JavaScript, no build step, no package manager. Three.js r128 in `lib/three.min.js` (do not upgrade).
- Scripts load as globals in this order (`index.html`): controls, gen, player, loot, props, enemy, combat, main, ui, menu, tune. A new file must be added there; load order matters.
- No dependencies may be added without asking.

## Commands
- Run: open `index.html` in a browser (or serve the folder). No install.
- Useful URLs: `?seed=12345` repeats a run; `?dev=1` (or backtick key) enables dev mode; combine: `?seed=12345&dev=1`.
- Tests: none in the repo. Verify with seeded script checks (e.g. generator reachability over many seeds), the dev panel (`js/tune.js`), and the browser console (no errors). Testers: put any new check scripts in a `tests/` folder and document how to run them here.
- Lint/build: none.

## Architecture map
- `js/gen.js`: seeded room-and-corridor floor generator, room types, locked rooms/keys, prop placement.
- `js/player.js`: fixed 120 Hz movement and wall collision.
- `js/controls.js`: input.
- `js/loot.js`: item/tier/potion tables, `PROP_INFO` search times, inventory logic.
- `js/props.js`: furniture and themed room decor (about 100 pieces per floor).
- `js/enemy.js`: guard AI (vision cone, hearing, awareness states, BFS pathing), guard rig and random gear.
- `js/combat.js`: weapon stats (`WSTATS`), `TUNE` numbers, hit zones, stamina.
- `js/main.js`: renderer, scene, floor build, frame loop, HUD, noise events, searching, doors, floor transitions.
- `js/ui.js`: inventory screen. `js/menu.js`: menus. `js/tune.js`: dev tuning panel (settings in localStorage, key `prototype-test-tune-2`).
- Docs: `DESIGN.md` (sections marked "planned, do not build yet" are off limits unless asked), `STATUS.md`.

## Conventions
- Match existing style: compact vanilla JS, globals, short comments for units (metres, seconds).
- Everything random goes through the seeded RNG (`makeRng`) so seeded runs repeat. Never use `Math.random()` for gameplay or generation.
- Combat/stealth numbers live in `TUNE` / `WSTATS` / `PROP_INFO`; change values there, not inline.
- Keep dev mode and the tuning panel working.
- At the end of each work block, update `STATUS.md` (done / next / open issues) and bump the date (project rule).
- Do not touch reference projects (Test1, Test2) mentioned in the docs.

## Performance budgets (draft, confirm with owner)
- Target: steady 60 FPS on a modest laptop with integrated graphics; no hitches on floor change.
- Renderer already caps pixel ratio at 2. Only 6 torch point lights are active; do not raise it without measuring.
- Hot paths (per frame): `main.js` frame loop, `enemy.js` AI update (vision, hearing, BFS pathing), torch lighting, noise rings/minimap drawing, HUD updates (avoid DOM writes when values are unchanged).
- Per-floor cost: about 100 furniture pieces plus up to 60 torches plus walls. Prefer merged geometry, shared materials and instancing; dispose geometries, materials and textures of the old floor on floor change.
- Avoid per-frame allocations (new vectors, arrays, closures) in the loop and in AI.
- Baseline measured 2026-11-09 (seed 12345, 1280x720, CPU-side `renderer.render` via `game.draw()`, not GPU time): floors 1-5 use 386-1179 draw calls, 10k-26k triangles, 3.9-7.7 ms CPU per frame; AI cost under 0.1 ms/frame. Draw-call bound, not triangle bound. Floor 4 is the worst case.
- Measured problems: every mesh has its own geometry and material (floor 4: 3,133 meshes, 3,127 geometries, 2,055 materials, no sharing or merging); all 3,648 scene objects recompute matrices every frame (`matrixAutoUpdate` on, including static walls/props); about 3 textures leak per floor change (`noiseTexture` in `main.js` is not disposed). Geometries are freed correctly on floor change.
- Next perf tasks, in order: merge static floor geometry (walls, floor, static props) per material; share materials; set `matrixAutoUpdate = false` on static objects; dispose old floor textures. Re-measure after each and compare with the baseline above.
- How to measure: browser DevTools Performance tab, `renderer.info` (calls, triangles, geometries, textures) logged from the console.

## Known gotchas
- Balance and feel have not been play-tested by a real player; numbers are guesses.
- `STATUS.md` and `DESIGN.md` mention Windows paths from another machine (`C:\Users\rsarangaya\...`); ignore them.
- Not under git (downloaded `HoneyHan-main` folder). The reviewer has no `git diff`, so agents should list changed files in their reports.
