# Status

Project: Prototype Test (working name), a first-person stealth roguelike dungeon crawler.
Last updated: 2026-11-09 (branch `impatience`: steps 2 to 8 of the build order, each tested)

Read `DESIGN.md` for the full design. At the end of each work block, update this file (done / next / open issues) and bump the date.

## Done
- Design doc written: `DESIGN.md` (concept, floors and themes, stealth and noise, combat, weapons, statuses, wands, architecture, build order, risks).
- Reference projects reviewed (read only, not changed), both in `C:\Users\rsarangaya\OneDrive - JSSI\Documents\ClaudeCodeCloudTest`:
  - `Test1`: Muay Thai FPS (Three.js, no build step). Source for movement, viewmodel, Fighter rig, `combat.js` tables, stamina.
  - `Test2`: zombie roguelike (2D, turn-based). Source for the room-and-corridor generator, room themes, loot and monster data, seeded runs, stage structure.
- Build stage 1 (first iteration) built, 2026-11-02: open `index.html` (or run the `game` preview; `?seed=N` repeats a run). Seeded room-and-corridor generator (`js/gen.js`), fixed 120 Hz player with wall collision (`js/player.js`), 3D extruded floor, minimap, stairs to the next floor, floors 1 to 5, one random theme per run (colour-only placeholder look). Floor 5 stairs end the run (no boss yet). Three.js r128 copied to `lib/`.
- Build stage 2 (loot), 2026-11-02: chests, barrels and rubble placed on room edges (`js/gen.js`), hold E to search with a per-type search time, seeded drops (gold, arrows, potions, weapons) from tables in `js/loot.js`, inventory with 4 quickslots (press a weapon slot to swap it with the equipped one, press a potion slot to drink), quiver cap 25, HP bar, minimap markers for unopened props. Stairs are now a stairwell going down. No combat yet, so the equipped weapon is only a name in the HUD.
- Dev mode (2026-11-02): press the backtick key (or open with `?dev=1`). 5x move speed, god mode (no damage), vision cones drawn on the floor, enemy dots on the minimap, N skips to the next floor, M reveals the whole map. Handy for playtesting without a real run. Seed plus dev: `?seed=12345&dev=1`.
- Build stage 3 (first enemy), 2026-11-02: `js/enemy.js`. Goblin guard with a 110 degree, 12 m vision cone (shorter when you crouch, longer when you sprint), line of sight, hearing (crouch 1.5 m, walk 6 m, sprint 13 m, halved through walls), an awareness meter, and unaware / suspicious / alerted / searching states with a ? or ! icon over the head. Patrols between two rooms, chases by BFS pathing, and hits for 10 damage on contact once alerted (placeholder until stage 4 and 7). Floor N spawns N+1 guards. Dying ends the run. You cannot fight back yet, so evade or use dev mode.
- Search sped up 40% (2026-11-02): chest 0.9 s, barrel 1.5 s, rubble 1.8 s, body 1.0 s (`PROP_INFO` in `js/loot.js`).
- Build stage 4 (sneak kill and simple combat), 2026-11-02: `js/combat.js` plus parts of `js/main.js` and `js/enemy.js`.
  - LMB attacks, RMB blocks. Sword, dagger and mace have their own damage, speed, reach, stamina cost, noise, parry window and block cost. The bow is equippable but cannot attack until stage 6. First-person weapon models are placeholders.
  - Hit zones follow the crosshair height at the target's range: head x1.75, body x1, legs x0.65 (zone multiplier capped at x2). Crouching lowers your eye so level aim lands body hits.
  - Sneak attack: any enemy that is not alerted and not currently seeing you. Dagger kills outright, sword x3, mace x2.5. A clean sneak kill is nearly silent and gives better drop odds.
  - Guards have 40 HP, wind up for 0.7 s with an arm pose showing the zone (arm high = head, out to the side = body, low = legs), then hit for 10 times the zone multiplier. Block stops head and body hits (leg sweeps go under). A parry (first 0.2 s with the sword) staggers the guard for 1 s. A normal block costs stamina, and with none left the guard breaks and you take half damage.
  - Stamina 100, regen 28/s after 0.8 s, sprint drains 14/s and stops below 1 until it recovers past 25. Dev mode keeps it full.
  - Combat makes noise that nearby guards hear (swing 2 to 8 m depending on weapon, hit 3 to 8 m, a clean sneak kill 2 m), so a loud fight pulls guards in as suspicious. Real noise-wakes-others logic is stage 5.
  - Dead guards fall over and leave a lootable body (hold E) only when their drop roll gave something.
- Inventory, gear, locked rooms and more (2026-11-02). Details in `DESIGN.md` section 12.
  - Inventory screen (`js/ui.js`, Tab or I, pauses). Pickups go to the backpack only, no auto quickslot. Equip, unequip, drink, drop and assign quickslots from the screen, with a compare line against what you wear.
  - Tiers (Common to Legendary), weapons and armor (helmet, chest, boots, light/medium/heavy), six potions with timed buffs (`js/loot.js`). Armor cuts damage by hit zone and heavy armor is louder.
  - Locked rooms with keys (`js/gen.js`): armory (one random floor per run), vault, brewery. Keys sit in chests, doors need E held with the key, the door slides up.
  - Themed rooms and about 100 pieces of furniture per floor (`js/props.js`): beds, bookshelves, tables with plates, hearths and cauldrons that glow, rugs, bones, sacks, banners, candles, altars, statues. Room types: barracks, mess hall, brewery, library, storeroom, shrine.
  - Guards (`js/enemy.js`): each rolls its own look (ears, tusks, brow, helmet or hood, vest, shoulder pads, sack, club or cleaver, size). A helmet cuts head damage, a vest cuts body damage.
  - Guard count is now 1 + 2 per floor (3 to 11). Floors 3 and deeper respawn a guard every 35 to 70 s out of sight, up to 1.5x the starting count.
  - Dev panel has new buttons: Give gear, Give potions, Give keys, Spawn guard now.
  - Checked: 300 generated floors (armory present when required, every door has exactly one key in a reachable chest, locked-room contents reachable only through the door, all props reachable), inventory and gear logic script, key to door to rack flow script, guard counts and respawn script, screenshots of racks, barracks, guards and the inventory screen. Not checked: real mouse play, balance of tiers and drops, how the inventory feels, performance with about 100 furniture pieces on weak machines.
  - Planned, not built: Hanahan's Rage (Legendary recorder, makes enemies fight each other). See `DESIGN.md` section 13.
- Map fleshed out and guard attack animation fixed (2026-11-02):
  - Floors are 56 x 56 (was 44 x 44) with about 16 rooms. About a third of rooms are L or T shaped (two overlapping rectangles), about a third of corridors are two tiles wide, big rooms get pillars (movement and sight blockers, so cover), and rooms get tables and crate stacks that guards path around. Wall torches (about 34 per floor) glow, and the 4 nearest to you cast flickering light. Every object placement is checked so the floor stays connected (1,000 floors verified). Floor N now has N+2 guards.
  - The old swing was backwards because the arm rotation signs were flipped. The guard rig now has a hip pivot so the torso leans and twists, and a club. An attack is wind-up (the zone is readable: overhead chop = head, cocked sideways swing = body, crouched low sweep = legs), a fast 0.14 s strike, then recovery. The hit lands at the end of the strike, so total time from wind-up start to hit is the wind-up setting plus 0.14 s. Staggered guards rock back.
  - Checked: connectivity and guard path script over 1,000 floors, screenshots of the torch-lit room view and each zone's wind-up, a 5 s live fight with no errors. Not checked: how the strike frames look in motion, room variety by eye across many seeds, performance on weak machines.
- Combat tuning panel (2026-11-02, `js/tune.js`): shown on the left while dev mode is on. Every combat number is editable live (enemy HP, damage, wind-up, cooldown, zone multipliers, damage cap, stamina numbers, and per weapon damage, speed, hit point, reach, stamina cost, sneak multiplier, parry window, block cost). Buttons spawn a guard ahead (back turned, facing you, or alerted), clear guards, refill HP and stamina, reset, and copy all values. Edits persist in the browser (localStorage). Esc frees the mouse and pauses the game so the panel can be clicked. Defaults in `js/combat.js` are unchanged until values are agreed. Global numbers moved into a `TUNE` object.
- Checked (stage 4): script tests for sneak kill, frontal sword hit damage, parry, block cost, leg sweep, stamina drain, one screenshot, no console errors. Not checked in real play: swing feel and timing, aim and zone feel, balance of every number.
- Checked (stage 3): script tests of the state flow, crouch range, behind-the-back blindness, hearing, damage and god mode, no console errors. Not checked in real play: how detection feels, whether the cone and meter are readable, guard counts.
- Checked (stage 2): script test of searching a chest, loot rolls, weapon swap and potion use, one screenshot, no console errors. Not checked: real play with keyboard and mouse, drop balance.
- Checked: generator gives a reachable stairs room for 1000 seed/floor combos, no console errors, movement and collision tested by script, one scene screenshot. Not checked: real mouse look and pointer lock, stairs transition in play, feel and tuning.

- Balance and polish pass (2026-11-02), not play-tested by a real player:
  - Map is now 45 x 45 with 9 to 12 rooms (was 56 x 56). Torches: up to 60 per floor, 6 nearest cast light. Guard count is now 4 + 2 per floor (6 on floor 1).
  - Guard attacks 2x faster: wind-up 0.35 s, cooldown 0.6 s, strike 0.07 s. Tuning panel storage key bumped to `prototype-test-tune-2` so old saved values do not override.
  - Guards roll random gear (weapon dagger, sword or mace, plus optional helmet, chest, boots, in the same classes and tiers as player items). It shows on the model, cuts damage in that zone, and a body drops at most one item (a carried piece is the likeliest).
  - Brewery rooms hold 1 to 3 potion shelves (one potion each, no ordinary chests or barrels there). Armory has 1 to 3 racks (weapon or armor, Uncommon or better).
  - Guards no longer get stuck: small clutter (candles) is not a guard obstacle, a blocked path target falls back to an open neighbour tile, and a stuck guard re-paths then snaps to its tile centre.
  - Dev panel has a "Spawn item" section (item, tier, count). A message log sits bottom left.
- Shop planned (2026-11-02): `DESIGN.md` section 14 (one random floor per stage, randomized stock, price formula and table). Not built.

- Build stage 5 (noise system), 2026-11-02: noise is now a list of events with a position and radius, not just a radius around the player (`js/main.js` frame loop, `js/enemy.js`). Sources: player movement, combat (as before), finishing a search (chest and vault chest 3 m, barrel and rubble 4 m, door 5 m), a guard that turns alerted shouts (11 m), and every swing of an alerted guard (5 m). Guards that hear an event, through walls at half range, go suspicious and walk to where the noise was. Alerted guards ignore noise and a guard ignores its own. So a loud fight pulls in nearby guards, and a long one becomes a swarm. Dev mode draws the noise as fading blue rings on the minimap. `game.enemies` is now on the debug hook.
  - Checked: script test with two guards 6 m apart (the alerted one shouts once, the other turns suspicious toward it, a guard 82 m away is unaffected), no new console errors. Not checked: real play feel, whether 11 m and 5 m are the right radii, performance with many rings.

- Anti hit-and-run pass (2026-11-03), not play-tested by a real player:
  - Player slower: walk 3.0 (was 3.6), sprint 4.6 (was 6.0), crouch 1.4 (was 1.6). Alerted guards now run at 5.0 (was 4.4), faster than a sprint. Guard reach to start a swing 1.7 (was 1.4).
  - Attack speed stat (`spd` in `WSTATS`, `TUNE.playerAtkSpd`, `TUNE.enemyAtkSpd`): swing time = dur / (weapon spd x player attack speed). Sword 1.0, dagger 1.35, mace 0.8. Shown on the item screen. Each guard has its own stat: its weapon's spd x a 0.9 to 1.1 roll x `TUNE.enemyAtkSpd` (1.4). Cooldown divides by the stat, wind-up by its square root so the zone stays readable. Typical guard now: cooldown 0.31 to 0.59 s, wind-up 0.25 to 0.35 s (was 0.6 and 0.35).
  - Sword and other weapons no longer pass through walls or solid furniture: the first-person weapon pulls back toward the camera when something is close ahead (`freeAhead` in `js/main.js`).
  - Guards stuck on obstacles: statues and sacks had collision but were not marked blocked in the generator, so guards pathed into them. Both are now blocking decor (`js/gen.js`). Checked: 292 random trips by every guard on floors 1 to 5 of seed 7, none stuck.
  - Tuning panel: new Player section and the enemy attack speed, reach and chase speed, and weapon spd fields. Storage key is now `prototype-test-tune-3`.

- Boss floor and vision (2026-11-03), not play-tested by a real player:
  - Guard vision cut: range 10 m (was 12), cone 100 degrees (was 110). Crouch and sprint multipliers are unchanged, so crouch sees about 5.5 m.
  - Floor 5 is now a boss arena (`layoutBoss` in `js/gen.js`), no rooms: one lumpy cave about 33 tiles across, rock pillars for cover, start at the south end, stairs at the north end, candles ringing the middle, statues, banners and bones. Loot along the walls: 3 chests, 2 barrels, 2 rubble, and exactly 1 guaranteed Healing Potion far from the start. Up to 7 guards patrol the rim (about 5 after skipping any near the start). No respawns on this floor. The armory can no longer land on floor 5.
  - Boss ("Cave Warlord", `boss: true` on `Enemy`): 1.6x size, full Rare plate, Epic mace, 220 HP, hits 1.8x harder, 1.4x reach, slower and longer wind-up, speed 4.2 (a sprint of 4.6 outruns it), not staggered by hits (a parry still staggers it), no sneak kills. It sleeps in the middle and ignores sights and sounds until you are within 12 m, then wakes and roars (guards in 11 m hear it). Boss HP bar at the top. Stairs are sealed until it dies.
  - Boss drop (`bossDefeated` in `js/main.js`): its body always holds one Epic equipment piece (10% chance it is Legendary instead), one more rolled piece (Rare or better) and 120 to 200 gold. All boss numbers are in the tuning panel's new Boss section (storage key now `prototype-test-tune-4`).
  - Checked: 300 arenas (all props, the boss, the stairs and every guard route reachable, one potion each, no orphan floor), script test that the boss sleeps through noise, wakes at 10 m, is not staggered, aim zones scale, drop tiers (215 of 2,000 Legendary), no console errors. Not checked: how the fight feels, boss HP and damage balance, whether the arena is too dark or too big, whether guards plus boss is too much.
  - Tiers (unchanged): Common x1.0, Uncommon x1.15, Rare x1.3, Epic x1.5, Legendary x1.75 (damage or protection). General floor-5 drop odds are 25 / 38 / 24 / 10.5 / 2.9 percent.

- Taller ceilings and more decor (2026-11-03), not play-tested by a real player:
  - Ceiling height is per floor (`WALL_H` in `js/player.js`, set in `startFloor`): 3.6 m on normal floors (was 3.0), 10 m in the boss arena. Locked doors fill the taller doorway, wall torches sit higher on the arena walls.
  - New decor (`js/props.js`, placed in `js/gen.js`): candle chandeliers on chains (a lit ring of 8 candles; also a light source), wooden ceiling beams across rooms 6+ tiles wide, and clay urns along walls. Chandeliers hang over the centre of most rooms (always in barracks, mess halls, libraries, shrines, armory and vault) and over a few spots in big rooms. All ceiling decor has no collision.
  - Boss arena: 9 giant chandeliers (3x scale, one over the boss), statues at 2x and banners at 2.4x so they fit the 10 m walls. Decor can now carry a `scale`.
  - Checked: floors 1 to 5 build with no console errors, screenshots of a chandelier in a room and the arena with the giant chandelier over the boss. Not checked: how the room lighting and beams read at a normal play distance, performance with the extra lights and meshes on a weak machine, whether the arena still feels too dark.

- Hit feedback, dev floor buttons, player collision (2026-11-03), not play-tested by a real player:
  - Getting hit now shows a red screen flash plus a quick camera shake, both scaled by the damage (`hitReaction` in `js/main.js`). It also plays in dev mode, where no HP is lost.
  - Dev panel: new Floor down, Floor up and Test hit buttons (the N key still skips down too).
  - Player no longer catches on small objects: props are circles and walking into one now slides you round it instead of stopping you dead (`slideOffProps` in `js/player.js`). Candle-sized props (collision radius 0.25 or less) never block you. Checked: 76 head-on and off-centre walks into props, no penetration; the only walks that stayed put were furniture flush against a wall on the side being slid toward (nowhere to slide).
  - Theme-specific enemies are planned too (2026-11-03, `DESIGN.md` section 17, subsection "Theme-specific enemies"): each theme has common natives, a signature native, an elite and its boss pool, a goblin-to-native mix that shifts toward natives by floor 4, and a draft roster for all six themes. The Sunken Tavern roster (cook, drunk bandit, rats, bouncer) is built first.
  - Decided 2026-11-03: signature and elite natives get their own models (commons may be recolours), at most 3 native types per floor, native loot is thematic (cook drops food). Because of that, a hunger and food system is planned in `DESIGN.md` section 18 (meter, Fed / Hungry / Weak / Starving stages, stomach growl as noise, food items and sources, starvation never kills). Not built.
  - Enemy variety is planned in `DESIGN.md` section 17: tamed wolves first (smell tracking, fast, linked to a goblin handler), then archer, shaman, brute, skeleton, mimic, bomb goblin, thief, and one signature enemy per theme.

- Welcome screen, pause menu, rebindable controls and glossary (2026-11-03), not play-tested by a real player:
  - The top-left controls help is gone. The start screen now reads "Welcome to HoneyHan! This is still a Work in Progress." with the notes (no shop so gold is useless, no bow so arrows are useless, potions on potion shelves, equipment in armories and loot, monsters may drop loot) and a feedback request. The page title is HoneyHan.
  - Esc in game opens the pause menu (`js/menu.js`) with a Controls tab and a Glossary tab. The start screen has buttons for both too.
  - Controls: click an action, press a key or mouse button. Attack and block can be keys or mouse buttons. A key already in use is swapped. Reserved keys are refused and Ctrl gives a warning. Saved in the browser (`honeyhan-controls-1`). Bindings live in `KEYS` (`js/controls.js`); `player.js`, `main.js` and `ui.js` read them. Tab always opens the inventory.
  - Glossary tabs: Items (gold, arrows, keys, 6 potions), Equipment (weapons, armor pieces, tiers), Enemies (Goblin Guard, Cave Warlord). Undiscovered entries show ???. An entry unlocks when you pick the item up or an enemy is in front of you with a clear line of sight, and a "Glossary updated" message shows. Saved between runs (`honeyhan-discovered-1`).
  - Dev mode is not mentioned anywhere the player can see; the backtick toggle still works.
  - Checked: welcome screen screenshot, rebinding by key and mouse, swap, reserved key, Ctrl warning, Esc cancel, reset, movement after rebinding, discovery of items and an enemy, glossary screenshot, no console errors. Not checked: real Esc and pointer lock behaviour in a normal browser (the preview cannot lock the pointer), mouse-button rebinding with a real mouse, glossary text and layout on small screens.

- Guard collision, saved tests and a cleanup pass (2026-11-09):
  - Guards were walking into each other and into the player: a swarm of 8 alerted guards all stood on the player's exact spot, stacked inside one another, and hit from inside you, so you could not see or block them. Guards now have a body radius (0.4 m, boss 0.65 m). After the guards move each frame, overlapping guards are pushed apart and guards are pushed out of the player (`separateBodies` in `js/enemy.js`). The player slides round living guards the same way as round furniture (`Player.mobs` in `js/player.js`), so you cannot walk through a guard or shove it.
  - A guard's strike no longer lands through a wall corner: the hit needs line of sight when it lands, not only when the wind-up starts.
  - Changing floors now frees the old floor's materials and textures too (only geometry was freed before).
  - The debug hook `window.game` also exposes `inv`, `cb` and `state`, for the tests.
  - Tests are now saved in `tests/` (they were throwaway scripts before):
    - `node tests/gen.test.js`: plain Node, about 10 s. 1,500 floors (300 seeds x floors 1 to 5): stairs reachable without keys, every prop reachable, every guard waypoint on open reachable floor (tile-based, as guards path), every locked door has exactly one key outside the locked rooms, locked rooms reachable only through their door, the armory floor has the armory, the boss arena has one boss and one healing potion. Pass a number to change the seed count.
    - `node tests/game.test.js`: headless Chromium through Playwright (`npm i -D playwright`, then `npx playwright install chromium`), about 30 s. Floors 1 to 5 build on 3 seeds, the stairs lead down, a swarm keeps apart and out of the player, the player cannot walk through a guard, dagger sneak kill, sword parry, death screen, no page errors. With the collision fix switched off it fails the three collision checks, so it does catch that bug.
    - Run both after every change.
  - Checked: both test files pass. Not checked: how guard spacing feels in a real fight (a ring of guards round you may now be easier to read and block, or may box you in), boss spacing in the arena.

## Branch `impatience` (2026-11-09): build order steps 2 to 8, built in one go, none of it play-tested by a real player
Run `node tests/run-all.js` after every change (gen test, status test, game test).

- Step 2, statuses (`js/status.js`, `tests/status.test.js`): slow, cripple, bleed, stun, daze for the player (`pst`) and every enemy (`e.st`). Strongest movement effect wins, no stacking, a refresh keeps the longer time, cripple recovers gradually and cannot be chained (4 s immunity), stun has a 3 s immunity. Weapon passives (`proc` in `WSTATS`): dagger bleeds on body hits, mace stuns on head hits (1.6 s), sword cripples on 25% of leg hits. Guards: leg hits slow you (the boss cripples), head hits daze (blur, sway, stamina drain), a dagger guard's body hit bleeds. Bleed never takes the player below 1 HP and a Healing Potion stops it. An enemy that bleeds to death leaves a body. The boss cannot be stunned. Enemies tint by status. The HUD shows active statuses and the glossary has a Statuses tab. All numbers are in the tuning panel (storage key `prototype-test-tune-5`).

- Step 3, enemy types (`js/enemytypes.js`, `tests/enemytypes.test.js`): a type table (`ENEMY_TYPES`, every number a multiplier on the goblin's) with goblin, cook, drunk bandit, giant rat, tamed wolf and bouncer. Each changes play: the bandit sees and hears badly, sways and bellows (15 m) but carries a dagger (bleed) and gold; the cook has a cleaver and no armor; rats come in packs of 3, attack the legs, die in one hit and need a low aim; wolves are faster than a sprint, smell a moving player through walls and while crouching (not a still one, 7 m), attack legs and body with a short warning, follow a goblin handler and are let off the leash when it is alerted (a dead handler leaves the wolf idle); the bouncer (floors 3 and 4, exactly one) has 2.2x HP, hits 1.5x, cannot be staggered or stunned, a sneak attack is capped at x2.5 (no dagger instakill) and always drops equipment plus gold. Spawn rules: native share of guards 30/45/60/70% on floors 1 to 4 (about half in the arena, where handlers take half the rim), at most 3 native types per floor, wolves from floor 2 (up to 3). Only the Sunken Tavern has natives so far (`THEME_NATIVES`); other themes get goblins and wolves. Loot per type is in `rollLoot`. Quadrupeds have their own model and pose (`buildQuad`, `poseQuad`). Glossary cards for each. Cook food drops wait for step 4.
## Decisions made
- Name: Prototype Test (placeholder).
- Scope for now: floors 1 to 5, first boss on floor 5. Run length is up to the player.
- Tone: fantasy dungeon, not super grim. Dungeons can look like anything (inn, manor, library, cellar, outdoor ruins).
- Combat: LMB attack, RMB block (depends on equipment), quickslots for items. Block is Option B (head and body blocked, leg sweeps go under).
- Hit zones: head, body, legs, same rules for player and enemies. Enemy telegraphs must show the zone early in the wind-up.
- Statuses are weapon-driven: slow (moderate, long, instant return), cripple (massive, short, gradual recovery, light bleed), bleed, stun, daze.
- Wands: one effect each, limited charges, break at 0. Recharge wands recharge another wand, break after one use, rarer.
- Arrows are found, do less damage than melee (starting guess about 55 to 65% of a same-tier melee hit). Bow and melee swap through quickslots (swap with the equipped weapon).
- Enemies have a chance to drop loot.
- Six starter themes drafted: Sunken Tavern, Moonlit Orchard, Clockwork Library, Mushroom Cellar, Goblin Market, Frozen Chapel.
- The project lives in the GitHub repo `rsarangaya/HoneyHan` (it started in `C:\Users\rsarangaya\Downloads\Test2`).

## Planned items (do not implement yet)
- **Hanahan's Rage**: Legendary recorder with speakers. Plays a recording of Hanahan talking mad smack, and enemies get angry and are ragebaited into attacking each other instead of the player. Build after stage 5 (needs noise and enemy target selection). Full notes in `DESIGN.md` section 13.

- **Shop**: one random floor per stage, goblin merchant, randomized seeded stock, buy and sell prices calculated. Full plan in `DESIGN.md` section 14. Depends on the stage structure decision below.

## Decided 2026-11-02: run structure and alpha goal (`DESIGN.md` section 15)
- Full game: 5 stages. Stages 1 to 4 each get one random theme (no repeats, random order). Stage 5 is the boss stage with one fixed final boss. One shop floor per stage.
- Alpha goal: a "complete" game with only stage 1: floors 1 to 5 up to the first boss fight, statuses and ailments, all equipment and items, and the shop.
- Revised alpha build order: noise system, statuses, remaining weapons (bow, shield), wands plus Hanahan's Rage, shop plus stage structure in the generator, first theme made real, first boss.

- Second round (2026-11-02): every stage has one boss on its last floor. Mini-bosses and quests are a separate optional system (`DESIGN.md` section 16: locked mini-boss room, wanted guard, prisoner rescue, shrine bargain, sneak thief chase, ally recruit). Stage 1's theme is fixed for now, randomized later. After the boss dies a hidden door opens in the boss room to a safe room with the stairs down: no attacks, inventory usable, no free healing.

## Undecided
- Final stage (stage 5) look and final boss design (later, finish floors 1 to 5 first). Floors per stage (5 assumed). Whether the pack carries over between stages (assumed yes) and whether the player can go back up from the safe room.

## Next
- Follow the alpha build order above. Noise system and the first boss are done. Next: (1) a real play and tuning pass on combat, stealth and the boss (guard spacing is new, check it too); (2) statuses (slow, cripple, bleed, stun, daze); (3) enemy type table, then the Sunken Tavern natives (cook, drunk bandit, rat pack, bouncer) and the tamed wolf (`DESIGN.md` section 17); (4) hunger and food, starting with the meter, one food item and eating (`DESIGN.md` section 18), before the cook drops food; (5) bow and shield; (6) wands plus Hanahan's Rage; (7) shop plus stage structure (the shop can sell food); (8) first theme made real, then archer, shaman and brute.
- Locked chests, trapped chests and mimics are not in yet (design section 3).
- Add a test to `tests/` with each new system (statuses, new enemies, shop).
- Full build order is in `DESIGN.md` section 9 (stages 1 to 5 of it are built).

## Open issues
- Guard blocking time (`cb.blockT`) runs on real frame time, but guards run on time capped at 0.05 s per frame, so below about 20 fps the parry window gets harder to hit. Only matters on very slow machines.
- Boss names and designs per theme.
- Shield and off-hand behaviour when swapping to a bow or two-hander.
- Loot drop tuning (drop chance per enemy type, rare drops).
- Whether guards react to found bodies.
- Arrow damage and supply numbers are guesses from thin research, to tune by play.
- All numbers in `DESIGN.md` are untested starting guesses.
