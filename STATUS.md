# Status

Project: Prototype Test (working name), a first-person stealth roguelike dungeon crawler.
Last updated: 2026-11-02

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
- All project files stay in `C:\Users\rsarangaya\Downloads\Test2`.

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
- Follow the alpha build order above. Noise system is done; next is statuses (slow, cripple, bleed, stun, daze), then bow and shield, wands plus Hanahan's Rage, shop plus stage structure, first theme made real, first boss.
- Locked chests, trapped chests and mimics are not in yet (design section 3).
- Play stages 1 and 2, tune the feel, and decide if it is fun. The generator is new code, not yet ported from the Test2 generator (room themes, door tiles, locked vaults still to bring over).
- Then stages 2 to 4 (loot interactions, one enemy with vision cone and states, sneak kill plus simple loud combat). Stages 1 to 4 are the milestone to prove the idea is fun.
- Full build order is in `DESIGN.md` section 9.

## Open issues
- Boss names and designs per theme.
- Shield and off-hand behaviour when swapping to a bow or two-hander.
- Loot drop tuning (drop chance per enemy type, rare drops).
- Whether guards react to found bodies.
- Arrow damage and supply numbers are guesses from thin research, to tune by play.
- All numbers in `DESIGN.md` are untested starting guesses.
