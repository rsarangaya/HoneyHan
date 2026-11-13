# Prototype Test: First-Person Stealth Dungeon Crawler (design doc)

"Prototype Test" is the working name for now.

Status: most of this design is built on branch `impatience` (see STATUS.md for what is built and when). All numbers are starting guesses until play-tested.
Written 2026-11-02, updated with the first round of decisions.

## 0. Decisions so far
- Name: Prototype Test (placeholder).
- Scope for now: floors 1 to 5, ending at the first boss on floor 5. Run length otherwise depends on the player, so no timing target.
- Tone: fantasy dungeon, not super grim or gritty. Dungeons can look like anything (see section 1).
- Arrows can be found, the player switches between bow and melee, and arrows do less damage than melee.
- Empty wands break.
- Block is Option B (simple block, leg sweeps go under).
- **Run structure (decided 2026-11-02, replaces "one theme per run"):** the full game is 5 stages. Stages 1 to 4 each get one random theme (no repeats, random order). Stage 5 is the boss stage and always ends in the same final boss fight. Alpha scope is stage 1 only, see section 15.
- (Superseded by section 15) One theme per run for floors 1 to 5, boss tied to that theme.
- Enemies have a chance to drop loot.
- Weapon swap is done through quickslots: using a weapon from a quickslot swaps it with the equipped one, and the old weapon goes into that slot (section 5.4).
- All files stay in `C:\Users\rsarangaya\Downloads\Test2`, no new folder.
- Pickups go to a backpack only. No auto quickslot. The player equips, drinks and assigns quickslots from an inventory screen (section 12).
- Equipment has five tiers (Common to Legendary) and armor exists in three slots (section 12).
- Some rooms are locked and need a key found elsewhere on the floor. One random floor per run has a locked armory (section 12).
- Floors have themed rooms (barracks, mess hall, brewery, library, storeroom, shrine) furnished so they look lived in (section 12).
- Guard count rises with depth (1 + 2 per floor). From floor 3 on, guards respawn at random.

## 1. Concept
A first-person, procedurally generated roguelike dungeon crawler with sneak elements. Each floor: arrive, scout and loot, find the stairs, decide whether to descend or push for more loot. You can fight head-on, but loud fights draw more enemies, so sneaking and sneak attacks are the efficient way to play.

Setting: fantasy, tone not super grim or gritty. In fantasy stories and games a "dungeon" can take the appearance of almost anything, so floors are not limited to stone corridors. Floor themes can look like an inn or tavern, a manor's rooms and halls, a library, a cellar or crypt, or an outdoor-looking space (forest, ruins, cave with a sky, a garden). The generator stays the same, only the look, props, lighting and enemy mix change. Enemies can be goblins, bandits, skeletons, beasts, cultists, animated furniture and so on.

Core tension: every room you loot costs time and noise, and time and noise bring enemies.

## 2. Reference projects
Both live in `C:\Users\rsarangaya\OneDrive - JSSI\Documents\ClaudeCodeCloudTest`.

**Test1 (Muay Thai FPS)**: Three.js r128, no build step. Reuse: fixed 120 Hz movement and collision (`player.js`), first-person arms (`viewmodel.js`), `Fighter` rig and `Bot` AI (`bot.js`), `defend()` / `strikeMods()` damage tables (`combat.js`), stamina. Drop: ring, ropes, bags, PeerJS versus, pivot, most of the strike list. Missing: any perception (vision, hearing, patrol, alert levels).

**Test2 (zombie roguelike)**: 2D turn-based tile game. Reuse: room-and-corridor generator (`gen()` / `genLevel()` in `level.js`), room themes, loot tables, 20 floors in four stages, mini-bosses, seeded runs, perks, meta-progression. Does not carry over directly: turn-based grid logic (`monAt`, `computeFOV`), graft and body-part system.

Plan: start from the Test1 engine, extrude Test2's tile grid into 3D (walls to boxes, floor to floor, door tiles to doors), and write the missing systems new.

## 3. Floors and loot
- Procedural rooms and corridors from the Test2 generator, with a guaranteed path from start to stairs. Stairs far from the start.
- Room types: loot room (library, armory, crypt), guard room, empty hallway, locked vault (key elsewhere), secret room behind a breakable wall.
- Chests: some locked, some trapped, some mimics. Built 2026-11-12 (see STATUS.md).
- Scavenge spots (barrels, shelves, corpses, rubble): hold E to search. The search time is the risk.
- Stairs may be guarded by a patrol or trap. Some floors hide a shortcut.
- Floor modifiers: Flooded, Pitch black, Heavily patrolled.
- **Prototype depth: floors 1 to 5, with the first boss on floor 5.** Later stages are out of scope for now (Test2 uses 20 floors in four stages of five, which is the model for expanding later).
- **Floor themes:** each run picks one look for all its floors. A theme sets wall and floor textures, props, light sources (candles, hearths, moonlight, sunlight), ambient sound, the enemy and loot mix, and one stealth gimmick. Outdoor-looking themes need open, lit areas, so the light and shadow stealth rules apply there too (hide in tall grass, under trees, behind furniture).
- **(Superseded by section 15: themes are now per stage, 4 themed stages in random order.) One theme per run:** at the start of a run the game picks one theme from the pool at random, and floors 1 to 5 all use it, including the boss floor. The player never knows whether a run is an inn or a ruin, but within a run the setting is consistent. The run seed can drive the pick so seeded runs repeat.
- Variety within a run comes from the generator (different layouts, room types, loot and enemy placement), floor modifiers, and the theme's enemy mix scaling up with depth, not from changing the look.

### Starter theme pool (surprise picks, all easy to extend)
| Theme | Look | Stealth gimmick | Enemy mix |
|---|---|---|---|
| The Sunken Tavern | A flooded inn: tables, a bar, kegs, a hearth | Creaky floorboards are loud, shallow water splashes. Barrels are hiding spots. | Goblin cooks, drunk bandits, mimic chairs |
| The Moonlit Orchard | Open night garden, ruined walls, fruit trees | Tall grass and tree shadow hide you, moonlight beams reveal you | Wolves (smell), scarecrow constructs, bandit archers |
| The Clockwork Library | Endless shelves, ladders, reading rooms | Dead silent so every noise carries far, bookcases block sight | Animated books, stone golems, robed scholars (mages) |
| The Mushroom Cellar | Wine racks, fungus caves, glowing spores | Spore light reveals you, dark patches hide you, damp floors dull footsteps | Giant rats, spore-puffers, skeleton wardens |
| The Goblin Market | A crowded bazaar: market squares full of stall clusters under striped awnings, canvas-and-timber walls, a patchwork cloth ceiling, lantern light. Locked rooms are shuttered stalls (Stall Key) | Crowd patches muffle your steps (x0.6) and hide you (x0.8 sight), but a guard in sight when you rifle a chest is put on notice; tripwire bells; more thief goblins | Goblins, merchants-turned-guards, a trained boar, thieves |
| The Frozen Chapel | Snow-dusted nave, broken windows, ice | Snow shows footprints, wind noise masks your steps | Skeletons (see, do not hear), frost wisps, cultists |

**Theme framework (built 2026-11-13, all seven themes plus the Final Chamber).** Each theme is its own place, not a recolour: a layout style (clearings, halls, caves, aisles, warren, orchard, bazaar; `rooms` is the legacy generator), its own walls, floor and ceiling textures, a locked-door style with a themed key name (cave mouth, ice seal, spore seal, clockwork gate, barred hatch, garden gate, shuttered stall), furniture, natives and a mechanic whose numbers live in `theme.mechanic.TUNE`. See the Themes section of `STATUS.md` for the table and how to add one. The Final Chamber (stage 5, a single boss arena outside the theme pool) keeps the usual arena and adds dark purple stone, rune pillars, a dais under the boss and a rune circle that flares every 9 s (inside it guards see you 40% farther). Its boss is still the placeholder; the final boss design is decided later.

More ideas for later: a drowned bathhouse, a manor of mirrors with doubles, a hedge maze, a cliffside pass, a collapsed mine.

### Enemy loot drops
- Every enemy type has a drop chance and a drop table. Humanoids (goblins, bandits, cultists) drop gear, arrows, coins and potions. Beasts and constructs drop little or crafting scraps. Undead drop old gear and bones. Elites and mini-bosses always drop something.
- Drops appear on the body and are taken with E. A short hold-to-loot timer applies, so looting in the open is a stealth risk.
- Sneak kills could give a slightly better drop chance (clean kill, intact gear), rewarding stealth.
- Optional rule to consider: guards who find a body go suspicious and investigate, so hiding bodies matters.

### Floor 5 boss (picked from the run's theme)
Since the theme is fixed for the run, the boss belongs to that theme and the arena is the theme's biggest room.
- Each theme has its own boss, or a small pool of two to pick from at random, so repeat runs of the same theme can still differ.
- The arena uses the run's theme, so the boss fight feels like the end of that setting.
- Minions come from the theme's enemy mix, scaled up for floor 5.
- The theme's stealth gimmick carries into the fight, for example tall grass patches in the arena, creaky floors, or dark patches, so the boss can also be approached with stealth.
- Examples: Sunken Tavern gives a giant Innkeeper, Clockwork Library gives a Librarian Golem, Mushroom Cellar gives a Fungal Warden.
- Prototype scope: one boss for the first theme you build, then add a boss per new theme. Because each run has only one theme, you can build and test one full theme (floors 1 to 5 plus boss) before adding others.
- Roguelike layer: permadeath, light meta-progression (unlock starting kits), limited inventory, heavy armor is louder.

## 4. Stealth, noise and detection
- **Noise meter / events.** Sprinting, combat, opening chests, breaking doors make noise with a radius. Crouch-walking is near silent. Each weapon and wand has its own noise level.
- **Light and shadow.** Torches and braziers make you visible. Dark corridors hide you. A held torch lights the room and gets you spotted.
- **Enemy states:** unaware, suspicious (investigates a sound), alerted (hunting), searching (lost you). Show an icon over the head.
- **Vision cone** in front of each enemy. Approaching from behind is the sneak attack.
- **Loud fight rule:** if an enemy sees you first (not a sneak attack), the fight makes noise and every enemy in range goes to investigate the spot. A long fight becomes a swarm.
- **Escape:** break line of sight, close doors, hide in the dark, to drop alerted enemies back to searching.
- **Enemy senses vary:** skeletons see but do not hear, goblins hear well and call friends, beasts track by smell (crouching does not help), mages are priority silent kills.

### Sneak attacks
- Unaware enemy from behind: dagger is an instant kill. Heavier weapons do large multiplied damage, scaling down with weapon weight.
- Optional silent takedown (F): about 1.5 s grab. If interrupted it becomes a loud fight.
- Tough enemies (armored knights, ogres) resist the instakill, forcing avoid, trap or loud fight.
- Ranged sneak: a bow shot at an unaware enemy is a headshot. It makes noise on impact unless using a silent arrow (rare item).
- Arrows are a found resource (see 5.4 and 6). Because they deal less damage than melee, ranged is a tool for opening, kiting and softening, not the main way to kill.

## 5. Combat

### 5.1 Controls
- LMB: attack (hold to draw or charge on some weapons).
- RMB: block, behaviour depends on equipment.
- Number keys: quickslots (potions, bombs, throwables, wands).
- Shift: sprint (loud). C: crouch (not Ctrl, since Ctrl+W closes the tab). E: interact / hold to search. F: silent takedown.

### 5.2 Hit zones
| Zone | Damage | Notes |
|---|---|---|
| Head | x1.5-2.0 | Smallest hitbox, helmets reduce it, instant kill when sneaking. Stun on head-hit weapons. |
| Body | x1.0 | Reliable, armor mostly applies here. |
| Legs | x0.6-0.7 | Where slow and cripple apply. Kiting tool. |

The zone is where the swing or arrow actually lands (crosshair position; melee uses a cone with vertical bias). Start with the simple cone, not directional swings. Total damage cap of about x2 including all bonuses (as in Test1).

### 5.3 Blocking (Option B, decided)
- RMB blocks head and body attacks. Leg sweeps go under the block; answer by backing off or stepping over.
- Early window (about 0.2 s) is a parry that staggers the attacker. Later it is a normal block that costs stamina.
- Shields widen coverage (partial cover vs low sweeps) and allow a bash.
- Block cost scales with the enemy weapon.

### 5.4 Equipment decides RMB
| Right hand | Left hand | LMB | RMB |
|---|---|---|---|
| Sword | empty | slash | normal block with parry window |
| Sword | shield | slash | shield block (more cover, stamina cost), bash |
| Two-hander | n/a | slow heavy swing | weak block |
| Dagger | empty | fast stab | parry only, tight window, free counter |
| Dagger | dagger | alternating stabs | weak block |
| Bow | n/a | hold to draw, release to fire | weak bow block |

### Weapon swap through quickslots (decided)
- A weapon can sit in a quickslot. Pressing that slot equips it and puts the previously equipped weapon into the same slot. Press again to swap back.
- Typical setup: sword equipped, bow in slot 1. Press 1 for the bow, press 1 again for the sword.
- Swap takes a short time (about 0.4 to 0.6 s) and cannot start mid-attack or mid-draw. Swapping itself is nearly silent.
- Edge cases to decide when building: swapping to a two-handed weapon or a bow while holding a shield (shield stows and returns on swap back, probably), and swapping while stunned (not allowed).
- Arrows are a found resource: floors, chests and enemy drops. They live in an ammo count, not in quickslots. Spent arrows that hit a wall or floor can be picked back up, ones that hit enemies break some of the time.

### Arrow damage and supply (researched recommendation)
Web research on other games was thin (mostly forum threads, no formal studies), but the common points were consistent:
- Ammo scarcity is the usual brake on ranged dominance, but too little ammo makes it a chore, and fully infinite ammo lets players kite forever.
- Melee is normally balanced by higher damage, no ammo and extra effects, while ranged is balanced by safety.
- Players dislike ranged that is strictly weaker and also expensive, so the bow needs its own strengths.

Recommended starting values for Prototype Test (to tune by play):
- **Arrow body hit: about 55 to 65% of a same-tier melee hit.** Headshot bonus (x1.5 to 2.0) brings a headshot near or slightly above a melee body hit, so skill is rewarded but spamming body shots is worse than meleeing.
- **Supply: about 8 to 12 arrows found per floor** on floors 1 to 2, a bit less later, with enemy drops adding a few. Recover roughly 60 to 70% of shots that miss or hit the world.
- **Draw time and stamina cost** are the second brake: a full draw takes about 0.8 s, costs stamina and roots you, so kiting must be done in bursts.
- **Bow strengths:** safe opening damage, leg slows for kiting, and stealth headshots at range. Quiver capacity caps at about 20 to 25.
- Weak enemies can be shot from afar, tougher or armored ones still need melee, wands or tactics.
| Wand | any | fire | block with off-hand if any |
| Torch | sword | slash | block, torch is light source |

### 5.5 Enemy and player symmetry
The player is hit in head, body and legs by the same rules as enemies.
- Armor by slot (helmet, chest, boots) protects its own zone.
- Leg hits slow or cripple the player. Head hits can daze (short blur and stamina drain, kept mild). A dazed enemy (trap gas, spore clouds and seals, a hex) sees half as far while it lasts (js/enemy.js); it used to be only a tint.
- Give the player slightly more health or armor than same-tier enemies since the player takes more attacks per run.

### 5.6 Readable telegraphs
The zone must be obvious in the first third of the wind-up.
- Overhead chop = head, weapon goes high.
- Horizontal swing = body, weapon pulled out to the side at mid height.
- Low sweep = legs, enemy crouches or drops the weapon low.
- Secondary cues: short sound per type, optional weapon flash on lower difficulties.
- Wind-up about 0.5-0.8 s for standard enemies, longer for heavy hitters (bigger parry payoff).
- A commit point after which the attack cannot change zone. Feints only on rare elites.
- Content cost: share three attack arcs across humanoids, vary by weapon and speed. Use procedural poses like Test1's pose vector.

### 5.7 Stamina
Pays for attacks, blocks, sprinting and drawing a bow. Keeps spam in check without extra buttons. Reuse Test1's stamina logic, drop the cardio layer unless needed.

## 6. Weapons and status effects
Statuses are weapon-driven passives, not global rules. Effects apply best in the matching zone. Enemies can resist (undead ignore bleed and slow-from-pain, golems ignore stun, etc.). Every status has a duration and diminishing returns.

| Weapon | Passive | Notes |
|---|---|---|
| Dagger | Bleed on body hits | Pairs with sneak kill |
| Sword | none, small cripple chance on leg hits | Generalist |
| Axe | Cripple on leg hits | |
| Mace / hammer | Stun on head hits | Slow, big payoff |
| Spear | Reach, small slow | Spacing |
| Bow | Headshot bonus, slow on leg hits | Kiting |
| Shield bash | Short stun | Needs shield |

Rare affixed weapons can add an extra proc (for example a bleeding mace).

| Status | Strength | Duration | Ending | Extra |
|---|---|---|---|---|
| Slow | about -25 to -35% speed | about 5-8 s | instant return | none |
| Cripple | about -70 to -80% speed | about 2-3 s | gradual recovery | light bleed while active |
| Bleed | damage over time | short | ends | cannot kill a full-health player alone for light bleed |
| Stun | lockout | brief | ends | |
| Daze (player) | blur, stamina drain | brief | ends | |

Rules: take the strongest active movement effect, do not multiply stacks. Short immunity after cripple so axes cannot chain it. Same rules for the player and enemies.

## 7. Wands
No mana or spell system. A wand is an item with one fixed effect and limited charges, fired with LMB.
- One effect per wand: fire bolt, frost (slow), lightning (stun), force blast (knockback), sleep or freeze (silent setup for a sneak kill), and so on.
- Magic damage ignores armor (mostly). Wands ignore hit zones to stay the simple, limited easy button.
- Each wand has its own noise level (frost near silent, lightning very loud).
- **At 0 charges the wand breaks** (decided). A recharge wand must be used before it hits 0 to save it, which makes timing a real choice.

### Recharge wands
- A wand type with no attack. Its only purpose is to recharge another wand, then it breaks after one use.
- Rarer than attack wands.
- Restores a set number of charges (for example +3), a rare version refills fully.
- Use: select it, then pick the target wand. Allowed on an empty wand. Cannot target recharge wands.

## 8. Architecture and what to port
1. Engine: Test1 (Three.js, no build step, classic scripts).
2. Port from Test2: generator, room themes, loot and monster data structure, seeded runs, stage and floor structure.
3. Port from Test1: movement, viewmodel, Fighter rig, `combat.js` tables, stamina.
4. New systems: 3D extrusion of the tile map, perception (vision cone, light level, noise events), enemy state machine, sneak-attack check, hold-to-search loot interaction, zone hitboxes, status effect system, wand system, equipment and RMB mapping.

## 9. Build order (stages)
Each stage is playable by itself. Do not move on until the previous one is fun.
1. Walk a generated 3D floor, reach the stairs. New project folder, Test1 and Test2 stay untouched.
2. Loot interactions: chests, scavenge spots, inventory, quickslots.
3. One enemy type with vision cone and unaware / suspicious / alerted states.
4. Sneak kill, plus simple loud combat (sword, block, parry, stamina, zones).
5. Noise system that wakes other enemies.
6. More weapons (dagger, shield, bow), statuses (bleed and slow first).
7. Enemy telegraphs per zone, cripple and stun.
8. Wands and recharge wands.
9. Floors 1 to 5 in one complete theme, with enemy variety growing by depth, and that theme's floor 5 boss. Then add more themes (each with its own boss) and the random per-run theme pick. Meta-progression and later stages come after this.

Milestone to prove the idea: stages 1 to 4.
Prototype target: stages 1 to 9, which is five floors ending at the first boss.

## 10. Risks
- Stealth needs readable AI and clear feedback (noise rings, awareness icons, footstep sounds) or it feels unfair.
- Animation and telegraph content cost per enemy.
- Stacking multipliers (headshot, sneak, weapon passive) can trivialize combat. Keep the x2 cap.
- Scope. Wands, stuns, many weapons and many enemies come last.

## 12. Items, gear, rooms and spawns (built 2026-11-02, numbers untested)
- **Inventory:** backpack of 16 stacks (potions stack, gold and arrows are counters). Tab or I opens it and pauses. Equipped slots: weapon, helmet, chest, boots. Quickslots 1 to 4 hold weapons or potions that the player assigns by hand. A weapon quickslot swaps with the equipped weapon and the old weapon takes the slot.
- **Tiers:** Common, Uncommon, Rare, Epic, Legendary, with damage or protection multipliers of x1, 1.15, 1.3, 1.5, 1.75. Deeper floors shift drop odds upward. Vault chests and armory racks add a tier and never drop below Uncommon.
- **Armor:** helmet (head), chest (body), boots (legs), each in three weight classes (light, medium, heavy: 10, 20, 30 percent cut at Common). Heavier armor adds movement noise (0, 1, 2 m per piece). Visible enemy armor works the same way (a helmet cuts head damage).
- **Potions:** Healing, Vigor (refill stamina, faster regen), Swiftness, Might, Stoneskin, Shadow (guards see half as far and notice slower). Timed buffs show on the HUD. Not yet: potions that harm, unknown or unidentified potions.
- **Locked rooms and keys:** locked rooms are carved into solid rock and joined to the map by a short corridor ending in a locked door. Each key sits in a chest on the open part of the floor (a minimap hint is not given). Types: armory, vault (gold and better gear), brewery (3 to 4 guaranteed potions).
- **Armory:** locked, on one random floor of the run (picked from the run seed). 4 to 6 racks, each giving one random weapon or armor piece at Uncommon or better.
- **Themed rooms:** barracks (beds, weapon rack, banners, extra guards), mess hall (hearth, long tables, scraps), brewery (cauldron, shelves, guaranteed potion shelves), library (bookshelves, reading tables), storeroom (crates, barrels, extra loot), shrine (altar, statues, candles), generic. Furniture includes beds, bookshelves, tables with plates and stools, hearths and cauldrons that give light, rugs, bones, sacks, banners, candles.
- **Guards:** 1 + 2 per floor (3, 5, 7, 9, 11 on floors 1 to 5). From floor 3, a new guard appears every 35 to 70 s in a room you cannot see, up to 1.5x the floor's starting count.

## 15. Run structure and alpha scope (decided 2026-11-02)
- **Full game:** 5 stages. Stages 1 to 4 are themed stages (about 5 floors each), each with one theme picked at random from the pool without repeats, so theme order changes every run. Stage 5 is the boss stage and always ends in the same final boss fight. Each stage has one shop floor (section 14). Section 3's "one theme for the whole run" text is superseded by this.
- **Alpha goal: a "complete" game, but only the first stage,** so a whole run can be played and judged. The alpha contains:
  1. Stage 1: floors 1 to 5 in one random theme, ending at the first boss fight.
  2. Statuses and ailments (section 6): bleed, slow, cripple, stun, daze, for player and enemies.
  3. All equipment and items: every weapon (dagger, sword, mace, bow, shield, plus the planned others), armor, potions, wands and recharge wands, keys, and Hanahan's Rage.
  4. The shop (section 14).
  Everything else (stages 2 to 5, the final boss, meta-progression) stays out until the alpha run is fun.
- **Systems the alpha still needs:** noise that wakes other guards (old stage 5), bow and shield, statuses, enemy telegraph polish, wands, the shop and gold readout, themes beyond the placeholder colours (at least the first theme looks and plays as its own setting, and the generator takes a theme so the other three can be added later), and one boss.
- **Revised build order for the alpha:**
  1. Noise system (guards call each other to a fight).
  2. Status system (bleed, slow, cripple, stun, daze) with weapon passives, shown on HUD and enemy.
  3. Remaining weapons and off-hand: bow with arrows, shield, any extra melee (axe, spear). Arrow rules in section 5.4.
  4. Wands and recharge wands, Hanahan's Rage (needs 1 and the enemy target selection).
  5. Shop (section 14) and the stage structure in the generator: stage and floor numbers, theme as a generator input, shop floor chosen per stage.
  6. First theme made real (look, props, one stealth gimmick, enemy mix), floors 1 to 5 balanced.
  7. First boss and arena, then play the whole run and tune.
- **Decided 2026-11-02 (second round):**
  - Every stage has exactly one boss, on its last floor (floor 5 of the stage). Mini-bosses are a separate optional system (section 16).
  - Stage 1's theme is fixed during development and randomized later. Only the first theme needs designing now.
  - **Safe room:** after the boss dies, the boss room reveals a hidden door. Behind it is the safe room with the stairs to the next stage. Rules: guards and enemies cannot enter and the player cannot be attacked, the inventory is usable, and there is no free healing (healing only comes from an item the player holds, or from a purchase or reward if added later). It is a calm place to sort the pack before descending. No shop is implied there (the shop stays on a random floor), and the shop can be revisited later if that is wanted.
  - The final stage (stage 5) is still undecided. Finish floors 1 to 5 of stage 1 first.
- **Built 2026-11-12 (see STATUS.md). Decided 2026-11-12:**
  - Floors per stage: 5. The pack carries over fully between stages.
  - Safe room one-way rules: enemies cannot enter, the open door stays open, and from inside you can only go up to the boss floor or down to the next stage.
  - The safe room replaces the stairs on the boss floor only. You can go back up from it to the boss floor, and no further.
- **Open points:**
  - Does any hunger or time pressure exist in the safe room (assumed none)?
  - Final stage look and final boss design (later).

## 16. Mini-bosses and quests (planned 2026-11-02, built 2026-11-12, see STATUS.md)
Goal: optional, random encounters on regular floors that give a reason to explore, a risk and a reward. Loosely inspired by Pixel Dungeon's quest givers, but each type here plays differently. Not part of the alpha boss, and the alpha only needs one or two of these to prove the idea.
- **Rolling:** each stage rolls 0 to 2 quest or mini-boss encounters on floors 2 to 4 from the run seed, never on the boss floor and never on the shop floor. A floor holds at most one.
- **Types (first ideas):**
  1. **Locked mini-boss room:** a locked room (the existing key system) whose door key sits in a chest on the floor. Inside is one named mini-boss: a tougher guard with a guaranteed good drop (Rare or better, plus gold). Optional, no penalty for skipping it.
  2. **Wanted guard (ghost-style quest):** an NPC asks you to kill a named elite guard that patrols a specific room. Reward: a good potion or a piece of gear. Reuses the guard system with a bigger kit.
  3. **Prisoner rescue:** a captive sits in a locked cell room, watched by an extra patrol. The cell key is carried by a guard (kill or sneak-kill to get it) or sits in a chest. Free the prisoner and they run to the stairs. They reappear in the safe room after the boss and hand over a reward (gear, a potion or gold). Tests stealth and route planning, not combat.
  4. **Shrine bargain (risk and reward):** an altar in a shrine room offers a deal: give up some max HP, a piece of equipped gear, or a stack of potions in exchange for a boon (a Rare or better item, a permanent small buff such as +stamina regen, or full unknown loot). The player can decline. Reuses the shrine room and the inventory screen.
  5. **Sneak thief chase:** a thief goblin carrying a bag of gold and one good item scurries away when it spots you, instead of fighting. Catch it (it is fast but cornered by dead ends) or hit it with a thrown or ranged attack to take the bag. Sneak-killing it while unaware is the clean way. Only goes bad if it escapes down the stairs.
  6. **Ally recruit (new):** a friendly NPC (a wounded adventurer, a goblin defector, a hired sword) can join the player for the rest of the stage after a small task: free them from a cell or trap, heal them with a potion from the pack, or pay gold. The ally follows the player and fights guards. Rules to settle when built:
     - **Behaviour:** follows a few metres behind, stays out of the way in corridors, fights guards that are alerted to the player, and does not attack unaware guards on its own (no ruining stealth), unless the player is spotted. Crouching makes it hold back too.
     - **Noise and detection:** the ally makes noise and can be seen, so a loud ally is a real cost. A sneaky build may prefer to refuse the recruit.
     - **Health and death:** it has its own HP and gear (random kit like guards). It does not regenerate, but a Healing potion used near it heals it. If it dies, it is gone and drops its gear. It can be told to wait (hold E on it).
     - **Stage end:** it follows through the stairs and rests in the safe room. It does not carry over to the next stage by default, and after the boss it gives a thank-you reward and leaves (open point: whether it can stay).
     - **Rewards:** helps in fights and distracts guards, and a living ally at the safe room gives a bonus item.
     - **Difference from the prisoner:** the prisoner runs away and pays you later, while the ally travels with you and fights. A floor never holds both.
     - **Needs:** the noise system (so allies and guards can react to each other) and the enemy target-selection work that Hanahan's Rage also needs, so build it right after that.
- **Shared rules:** quest NPCs are neutral and never attack the player. The encounter is shown in the inventory screen as one short line. Failing or skipping costs nothing, but the reward is lost. Encounters are seeded, so seeded runs repeat.
- **Build order:** after the shop. Start with type 1 (it only needs a stronger guard and the existing locked rooms), then 4 (altar plus a small deal screen), then 2, then 5, then 3 (needs the safe room and cell logic), then 6 (needs the noise system and target selection). The bow helps type 5.
- **Open points:** whether quest NPCs can be killed for loot, whether mini-bosses need their own models, whether the shrine bargain should show its boon before you accept, and how rewards scale by floor.
- **Decided 2026-11-12:** quest NPCs cannot be killed. Mini-bosses reuse the guard models, scaled and recoloured. The shrine shows the boon category only before you accept. Rewards scale by floor. One prisoner and one ally per stage.

## 17. Enemy variety (planned 2026-11-03, not implemented, do not build yet)
Goal: more than one kind of guard, so each floor asks for a different answer (sneak, block, flee, ranged, kill the handler first). Today there is one goblin guard with random gear, plus the floor 5 boss. Each new type should change how you play, not just add HP.
- **Tamed wolves (first new type):** goblins keep wolves as pets. A wolf patrols with or near a goblin handler.
  - **Senses:** tracks by smell, so crouching does not shrink how far it notices you, and walls do not help much. It sees poorly and hears normally. It cannot be sneak-killed by a dagger instakill alone unless it is asleep (open point).
  - **Combat:** fast (faster than a sprint), low HP, bites quickly with a short telegraph. Always attacks the legs or body, never the head, and lunges from a distance. Blocking works but the dodge window is short. Leg hits slow it and a crippled wolf limps (uses the statuses system).
  - **Handler link:** if the handler goblin is killed quietly, the wolf is left unaware and idle. If the handler is alerted, the wolf is let off the leash. A howl is a loud noise, like a goblin shout, and calls other wolves.
  - **Where:** barracks, kennel rooms (new room type) and the boss arena rim. Spawns in pairs on later floors.
- **Other ideas, in rough build order:**
  1. **Goblin archer:** shoots from a distance with arrows and keeps range. Needs enemy projectiles and the bow work. Punished by closing in or breaking line of sight.
  2. **Shaman (mage):** priority silent kill. Weak in melee, casts a slow or a daze at range and heals other goblins. Hears well, sees poorly.
  3. **Brute (ogre):** large, slow, big damage, resists the dagger instakill and shrugs off stagger like the boss. Forces avoid, trap or loud fight.
  4. **Skeleton:** sees but does not hear, so noise is safe and light and line of sight are what matter. Resists bleed. Fits cellar and chapel themes.
  5. **Mimic chest:** a chest that bites when searched (design section 3 already lists it). Punishes greedy looting. Needs the noise and stun logic first. Built 2026-11-12 (see STATUS.md).
  6. **Bomb goblin:** rushes you and explodes. Deadly in a pack, can be baited into hurting other enemies (works with Hanahan's Rage). Built 2026-11-12 (see STATUS.md).
  7. **Thief goblin:** the quest enemy from section 16, runs from you instead of fighting.
  8. **Theme natives:** see the next subsection. Every theme has its own enemies, built on the same type table.
### Theme-specific enemies
Each theme has its own roster, so the setting changes who you fight and not only the colours. The theme table in section 3 has the first ideas for the mix. A roster is: 1 to 2 **common natives** (most of the floor's population), 1 **signature native** (rarer, uses the theme's stealth gimmick), 1 **elite** (floors 3 and 4, a mini-boss-lite), and the **boss** with its minions (section 3, floor 5).
- **Mix rule (first guess):** floor 1 is mostly generic goblins (about 70%) with a few natives, so the player learns the basics. Native share rises each floor to about 70% natives by floor 4, and the boss arena rim uses the roster scaled up. Goblins always remain in the mix, since they are the setting's default guards.
- **Placement:** natives are tied to room types. A cook sits in the mess hall, a rat nest in the storeroom, books in the library, and so on. This also makes rooms feel different.
- **Each native must change play:** a different sense profile, a different answer, or a different drop. A reskinned goblin does not count.
- **Draft rosters (all numbers and names open):**
  | Theme | Common natives | Signature native | Elite | Boss pool |
  |---|---|---|---|---|
  | Sunken Tavern (stage 1, built first) | Goblin cook (carries a cleaver, drops food potions), drunk bandit (loud, sways, easy sneak but yells when hurt), giant rat (small, fast, in packs, drops little) | Mimic chair or chest (springs when you get close), water splashes give away your position | Bouncer (brute type, resists the dagger kill) | Giant Innkeeper |
  | Moonlit Orchard | Tamed wolf (section 17 first type), bandit archer | Scarecrow construct (stands still like scenery until you pass, then wakes) | Orchard warden (shaman type, casts thorns) | Harvest king or alpha wolf |
  | Clockwork Library | Animated book (flies, hears everything in the dead silence, weak), robed scholar (shaman type) | Stone golem (slow, huge reach, ignores stagger) | Head librarian (casts, silences your steps) | Librarian Golem |
  | Mushroom Cellar | Giant rat, skeleton warden (sees, does not hear) | Spore-puffer (bursts into a slowing or dazing cloud when killed) | Fungal brute | Fungal Warden |
  | Goblin Market | Goblins, merchant guard (shield, blocks head and body), trained boar (charges in a straight line) | Thief goblin (steals and runs, section 16) | Market captain (calls for friends, loud) | Goblin Warlord |
  | Frozen Chapel | Skeleton, cultist (robed, casts a slow) | Frost wisp (floats, hits by cold, slows) | Ice knight (armored, blocks) | Bell-ringer lich or frost giant |
- **Spawn data per theme:** each theme lists its natives with a weight per floor, the rooms they prefer, and a pack size. The generator draws from it, and the theme's gimmick (water splashes, snow footprints, spore light) is a rule on the floor, not an enemy.
- **Build order:** make the Sunken Tavern roster first, since stage 1 uses it. Start with the cook and the drunk bandit (they only need new gear rules, a sense tweak and a loud hurt shout), then the rat pack, then the bouncer. The mimic comes with the mimic chest item. Other themes follow when each theme is made real.
- **Decided 2026-11-03:** signature and elite natives get their own models, commons may be recolours of the goblin or beast rig. At most 3 native types share one floor. Native loot is thematic (a cook drops food, a scholar drops scrolls, and so on). Food needs the hunger system in section 18.

- **Shared systems needed:** an enemy type table (stats, senses, speed, reach, attack tells, gear rules, loot), a sense profile per type (vision range, hearing multiplier, smell), per-type models built from the same rig, and spawn rules per room type and floor (which types appear, how many, with which handler).
- **Build order:** after statuses. Do the type table first (move today's goblin into it, no visible change), then the wolf as the proof. Then archer and shaman once the bow and wands exist, then the brute, then theme natives with the first real theme.
- **Open points:** can wolves be tamed or distracted by the player (thrown food)? Do wolves drop loot (pelt, no gear)? Should a wolf follow the player's scent trail after losing sight? How many types may share one floor?

## 18. Hunger and food (planned 2026-11-03, not implemented, do not build yet)
Goal: food is a real resource, not a second healing potion. Hunger adds a slow pressure to the run (do not dawdle, do not rest forever) without becoming a chore. It should never kill a player who is playing at a normal pace.
- **Hunger meter:** 0 to 100, shown as a small bar under stamina. It drains with time while playing (not while a menu is open), faster when you sprint or fight and slower when you stand still or crouch. Balance pass 1 (2026-11-10) set it to about 100 to 0 in 11 minutes of normal play (was a 15 minute first guess), so a full 5 floor run needs roughly 1 to 2 meals.
- **Stages of hunger** (each is a clear message and a HUD colour):
  | Meter | State | Effect |
  |---|---|---|
  | 100 to 50 | Fed | No effect. |
  | 50 to 25 | Hungry | Stamina regen -20%. A stomach growl is a faint noise (about 2 m). |
  | 25 to 1 | Weak | Stamina regen -40%, max stamina -15%, growl noise 4 m. |
  | 0 | Starving | Lose 1 HP every 4 s until you eat, never below 1 HP, so it cannot finish you. Sprint is limited. |
  The growl makes hunger a stealth cost too, which fits the noise system.
- **Food items:** a new item type, stackable like potions. Each gives hunger points and sometimes a small bonus.
  - Bread (+25), cheese (+20, light), dried meat (+30), apple (+10, can be eaten fast), stew or a hot meal (+45 plus a short regen or buff, found only at hearths or dropped by cooks), mushrooms in the cellar (+15, a small risk of a bad effect, open point).
  - Eating takes a short hold (about 1.2 s, bigger meals longer), is interrupted by damage, and makes a little noise.
  - Quickslots take food like potions.
- **Sources:** barrels and chests (small chance), mess halls and storerooms (a food shelf prop, like the potion shelf), thematic native drops (cook, boar, scholar and so on), the shop, and rarely the boss arena. A floor should hold enough food for the expected time, so tune supply against the drain, not by feel.
- **Hearths:** eating at a lit hearth in a mess hall gives a better meal for the same item. Optional, a cheap way to make mess halls worth visiting.
- **Healing stays separate:** potions heal HP and food only feeds. Starving cannot kill, and a full belly gives no HP back, so the two systems do not overlap. Open point: whether being Fed gives a slow HP regen (there is no natural regen today).
- **Safe room:** the safe room after a boss does not restore hunger. It is a place to eat from your pack.
- **Dev mode:** hunger is frozen and a button gives food.
- **Build order:** after the inventory work is steady. Add the meter, the food item type and eating first (one food item, no hunger penalties), then the penalties and growl noise, then food placement in the generator, then thematic natives that drop food. Needs: item types in `js/loot.js`, a HUD bar, noise events (already built).
- **Open points:** exact drain and food supply (tune by play), whether mushrooms can be bad, whether Fed gives a slow regen, whether hunger pauses on the stairs between floors.

## 14. Shop (planned 2026-11-02, not implemented, do not build yet)
- **Availability:** each stage has exactly one floor with a shop, picked at random from the run seed (with today's single 5-floor stage, one of floors 1 to 5; if stages become 5 floors each, one per block of 5). The player does not know which floor in advance. A shop floor is never the start room or stairs room, and the shop room is never locked.
- **Shop room:** an ordinary mid-size room made into a stall: counter, shelves, lanterns, rugs, and a neutral goblin merchant who stands behind the counter. No guards spawn or patrol into it. Hold E at the counter opens a shop screen (pauses, like the inventory). Fits the Goblin Market theme best but any theme can have one.
- **Randomized stock (seeded per floor, so it repeats for the same seed):** 7 to 9 slots.
  - 2 weapons (dagger, sword or mace), 2 to 3 armor pieces, 2 to 3 potions (1 to 3 of each), and one pack of 5 arrows.
  - Tiers use the normal `rollTier` odds for the floor. The shop never stocks Legendary. One slot is "featured": one tier higher (max Epic) at +25% price.
  - Each weapon or armor piece is one-of-a-kind. Stock does not refresh. Bought items leave a gap.
- **Selling:** the merchant buys backpack items back at 35% of the buy price (rounded down). Keys are not buyable or sellable. Gold and arrows are not sold from the pack.
- **Price formula:** price = base x tier multiplier, rounded to the nearest 5 gold.
  - Tier multiplier (price rises faster than power): Common x1, Uncommon x2, Rare x3.5, Epic x6, Legendary x12 (Legendary only matters for selling).
  - Weapon base (Common): Dagger 30, Sword 45, Mace 50.
  - Armor base (Common) = class base x slot factor. Class base: light 20, medium 45, heavy 80. Slot factor: helmet 0.8, chest 1.4, boots 0.8.
  - Potion price (flat, no tier), current values from `js/shop.js`: Healing 45, Vigor (stamina) 40, Swiftness 50, Might 65, Stoneskin 65, Shadow 70. Food (flat): Bread 12, Cheese 15, Jerky 20, Apple 8, Stew 45. Arrows: 2 gold each, sold in packs of 5 for 10.
- **Price table (buy price in gold; potion and food prices above are the current ones, see `js/shop.js`):**

| Item | Common | Uncommon | Rare | Epic | Legendary (sell only) |
|---|---|---|---|---|---|
| Dagger | 30 | 60 | 105 | 180 | 360 |
| Sword | 45 | 90 | 160 | 270 | 540 |
| Mace | 50 | 100 | 175 | 300 | 600 |
| Leather Cap / Boots | 15 | 30 | 55 | 95 | 190 |
| Iron Helm / Greaves | 35 | 70 | 125 | 215 | 430 |
| Great Helm / Sabatons | 65 | 130 | 225 | 385 | 770 |
| Leather Jerkin | 30 | 55 | 100 | 170 | 340 |
| Chainmail | 65 | 125 | 220 | 380 | 760 |
| Plate Cuirass | 110 | 225 | 390 | 670 | 1345 |

- **Economy check:** a floor gives roughly 100 to 150 gold from chests, barrels and bodies, and a vault adds 40 to 90 plus floor x 10. Gold is about 500 to 700 by floor 5, so a shop on floor 2 or 3 affords a Rare piece or a few potions, and a Common or Uncommon swap is an easy buy. Epic is a real saving goal. Gold has no other use right now, so the shop is the gold sink. Tune after play.
- **Open points:** is the merchant killable (loot his stock, but the floor turns hostile), do guards react if you fight in the shop, does a shop floor have fewer guards, does the minimap show the shop once seen, and whether stock should hold a rare "unknown potion".
- **Build order:** after the stage structure is decided (this plan depends on what a "stage" is) and after the inventory screen has a gold readout. The shop screen can reuse the inventory screen code.

## 13. Planned items (not implemented, do not build yet)
- **Hanahan's Rage** (Legendary tier). A recorder with speakers attached. When used it plays a recording of Hanahan talking mad smack. Enemies in earshot get angry and are ragebaited into attacking each other instead of the player.
  - Description text: "Plays a recording of Hanahan talking mad smack. Enemies get angry and ragebaited into attacking each other."
  - Open design points for later: radius and duration, whether it is single use or has charges (wands break at 0 charges, which is the precedent), how much noise it makes (it should be loud and draw guards in), whether it works on all enemy types (golems and skeletons do not hear, so probably not), how enemies pick targets (nearest other enemy), and whether the player becomes a target again afterward.
  - Needs: the enemy target-selection and noise systems from build stage 5, so build it after those.

## 11. Open questions
Resolved: tone (fantasy, not super grim), run length (player-driven, prototype is floors 1 to 5), arrows (found, weaker than melee, values in 5.4), empty wands (break), name (Prototype Test), starter theme pool (section 3), one random theme per run for all five floors (section 3), boss belongs to the run's theme, weapon swap (quickslot swap), files stay in Test2.

Still open:
- Names and designs of the boss for each theme (one per theme to start).
- Shield and off-hand behaviour when swapping to a bow or two-hander.
- How loot drops are tuned (drop chance per enemy type, rare drops).
- Whether guards react to found bodies.
- Whether any theme should be excluded from being picked until the player has beaten another (for unlock pacing).
- How to keep a single theme from feeling repetitive over five floors (more room variety, floor modifiers, new enemy types introduced per floor).
