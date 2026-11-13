// Enemy type table (DESIGN.md section 17) and the rules that choose which types spawn where.
// Every number is a multiplier on the goblin guard's (TUNE) values, so the tuning panel's Enemy
// section still scales everything and each type has its own small section too.
//   model: 'biped' (the goblin rig) or 'quad' (rats, wolves).
//   hpMul, dmgMul, speed (chase speed), reach, windMul (wind-up), cdMul (cooldown): x the goblin's.
//   vis, hear: sense multipliers. smell: metres at which it notices a moving player through walls.
//   zones: attack zone odds [head, body, legs]. shout: x the alert shout radius.
//   sneakCap: the most a sneak attack can multiply damage (so a dagger cannot instakill it).
//   noStagger: ordinary hits do not interrupt it (only a parry does). r: body radius. scale: model size.
//   elite: Aj's Bust and other "not elites" effects skip it (bosses count as elite too).
//   height: quad only, how tall it is for aiming.
//   mimic: a chest that bites (model 'mimic', see MIMIC). bomb: a goblin carrying a lit bomb (see BOMB).
//   fleer: never fights, runs from the player (see Enemy.updateFleer).
const ENEMY_TYPES = {
  goblin:  { name: 'Goblin Guard', zones: [0.3, 0.5, 0.2] },
  cook:    { name: 'Goblin Cook',  zones: [0.3, 0.5, 0.2], weapon: 'sword', noGear: true, hpMul: 1.1, dmgMul: 0.9 },
  bandit:  { name: 'Drunk Bandit', zones: [0.2, 0.5, 0.3], weapon: 'dagger', hpMul: 0.9, dmgMul: 0.9, vis: 0.65, hear: 0.5, shout: 1.4, sway: true },
  rat:     { name: 'Giant Rat',    zones: [0, 0.2, 0.8], model: 'quad', pack: 3, hpMul: 0.2, dmgMul: 0.35, speed: 1.1, reach: 0.6, windMul: 0.6, r: 0.25, scale: 0.5, height: 0.45, vis: 0.8, hear: 1.4, fur: 0x6a5a48 },
  wolf:    { name: 'Tamed Wolf',   zones: [0, 0.5, 0.5], model: 'quad', hpMul: 0.7, dmgMul: 0.8, speed: 1.3, reach: 1.3, windMul: 0.6, cdMul: 0.85, r: 0.4, scale: 1, height: 0.95, vis: 0.6, smell: 7, shout: 1.4, sneakCap: 2, fur: 0x7a7e86 },
  // Generic specials, used in every theme. ranged: { kind, min, max (metres it likes to shoot from), wind (s), cd (s), speed (m/s) }.
  archer:  { name: 'Goblin Archer', zones: [0.3, 0.7, 0], weapon: 'mace', look: 'bow', hpMul: 0.8, dmgMul: 0.8, speed: 1.1, vis: 1.15, hear: 0.9,
             ranged: { kind: 'arrow', min: 5, max: 13, wind: 0.85, cd: 2.0, speed: 24 } },
  shaman:  { name: 'Goblin Shaman', zones: [0.3, 0.5, 0.2], weapon: 'sword', look: 'staff', noGear: true, hpMul: 0.7, dmgMul: 0.6, vis: 0.6, hear: 1.5, shout: 1.2,
             ranged: { kind: 'hex', min: 5, max: 11, wind: 0.9, cd: 3.0, speed: 12, healAt: 0.6, healAmt: 18, healR: 10, healCd: 6, healWind: 1.0 } },
  brute:   { name: 'Brute', elite: true,        zones: [0.4, 0.5, 0.1], weapon: 'mace', hpMul: 3, dmgMul: 2, speed: 0.8, reach: 1.25, windMul: 1.7, cdMul: 1.3, r: 0.6, scale: 1.5, noStagger: true, sneakCap: 2, skin: 0x8a7a5a },
  bouncer: { name: 'Bouncer', elite: true,      zones: [0.3, 0.5, 0.2], weapon: 'mace', hpMul: 2.2, dmgMul: 1.5, speed: 0.9, reach: 1.15, windMul: 1.3, r: 0.55, scale: 1.3, noStagger: true, sneakCap: 2.5, skin: 0x7d8672 },

  // ---- the other themes' natives (DESIGN.md section 17). Extra fields:
  //   pack: spawns in packs of this size.   ambush: sleeps as scenery until you come this close (metres).
  //   blockFront: damage multiplier for hits from the front while it is not staggered.   resistBleed: immune to bleed.
  //   onDeath: 'spores' bursts into a cloud.   onHit: a status its hits add.   charge: a straight-line rush.
  //   thief: steals gold and runs.   callAll: its shout turns every enemy in earshot alerted.   heavy: wears plate.
  //   robe, orb: colours of a caster's robe and staff orb.   hover: a floating creature's height.   info: glossary text.
  scarecrow: { name: 'Scarecrow', zones: [0.3, 0.5, 0.2], skin: 0xc8b060, noGear: true, weapon: 'mace', hpMul: 1.2, dmgMul: 1.1, ambush: 4,
    info: ['Stands in the orchard like scenery, with its arms out, until you come within about 4 m. Then it wakes and swings.', 'Creep up crouched and it only wakes at about 1.6 m, close enough for a dagger sneak kill. Or go round.'] },
  warden:  { name: 'Orchard Warden', elite: true, zones: [0.3, 0.5, 0.2], skin: 0x4a7a3a, robe: 0x2f5a2a, orb: 0x4ac84a, look: 'staff', noGear: true, weapon: 'sword', hpMul: 1.6, dmgMul: 0.8, vis: 0.8, hear: 1.2, shout: 1.3,
    ranged: { kind: 'thorn', min: 5, max: 11, wind: 0.9, cd: 2.6, speed: 13 },
    info: ['An elite caster. It keeps its distance and hurls thorns that make you Bleed for 4 s. A shield does not stop them, but they are slow enough to dodge.', 'Sees poorly and hears well: a quiet approach from behind works. Does not heal others.'] },
  book:    { name: 'Animated Book', model: 'float', pack: 3, hover: 1.1, zones: [0, 0.7, 0.3], fur: 0x7a4a2a, hpMul: 0.3, dmgMul: 0.5, speed: 1.3, reach: 0.7, windMul: 0.6, cdMul: 0.9, r: 0.3, scale: 0.7, height: 1.8, vis: 0.5, hear: 2.5,
    info: ['A flying book, in packs of three. It barely sees, but it hears everything: footsteps carry 2.5 times as far to it, so creep or fight it.', 'Dies in one hit and flutters at about head height, so aim level with your eyes rather than down.'] },
  scholar: { name: 'Robed Scholar', zones: [0.3, 0.5, 0.2], skin: 0x6a8a5a, robe: 0x3a4a7a, orb: 0x60a0ff, look: 'staff', noGear: true, weapon: 'sword', hpMul: 0.7, dmgMul: 0.6, vis: 0.6, hear: 1.5,
    ranged: { kind: 'hex', min: 5, max: 11, wind: 0.9, cd: 3.0, speed: 12 },
    info: ['A weak caster that hurls a hex (Slow or Daze). Hears well and sees poorly, so it is a silent-kill target.', 'It cannot heal others.'] },
  golem:   { name: 'Stone Golem', zones: [0.4, 0.5, 0.1], skin: 0x8a8a90, noGear: true, weapon: 'mace', hpMul: 2.5, dmgMul: 1.8, speed: 0.6, reach: 1.45, windMul: 1.6, cdMul: 1.4, r: 0.6, scale: 1.45, noStagger: true, sneakCap: 1.5, hear: 0.6,
    info: ['Slow, huge and with a long reach and a long warning. Ordinary hits do not stagger it (a parry does) and a sneak attack is capped.', 'You can simply outwalk it.'] },
  librarian: { name: 'Head Librarian', elite: true, zones: [0.3, 0.5, 0.2], skin: 0x6a8a5a, robe: 0x7a3a2a, orb: 0xffc060, look: 'staff', noGear: true, weapon: 'sword', hpMul: 2, dmgMul: 0.8, vis: 0.8, hear: 2, shout: 1.5, scale: 1.1,
    ranged: { kind: 'hex', min: 5, max: 12, wind: 0.7, cd: 2.0, speed: 14, healAt: 0.5, healAmt: 20, healR: 10, healCd: 5, healWind: 0.9 },
    info: ['An elite caster: hexes you quickly, heals hurt allies and hears almost everything. Kill it first, from behind if you can.'] },
  skeleton: { name: 'Skeleton', zones: [0.3, 0.5, 0.2], skin: 0xe6e0c8, hear: 0, vis: 1.1, resistBleed: true,
    info: ['Sees but is deaf: noise does not wake it, so footsteps and fights are safe. Light and line of sight are what matter, so go round its view.', 'Immune to bleed. Hits from a dagger do not make it bleed.'] },
  puffer:  { name: 'Spore Puffer', model: 'quad', zones: [0, 0.5, 0.5], fur: 0x7a6a9a, hpMul: 0.6, dmgMul: 0.5, speed: 0.9, reach: 0.9, windMul: 0.8, r: 0.35, scale: 0.9, height: 0.8, onDeath: 'spores',
    info: ['A bloated fungus creature. When it dies it bursts into spores that Slow and Daze anything within 3 m, you included.', 'Kill it from range (a bow or a wand), or from the side and then step back.'] },
  fungbrute: { name: 'Fungal Brute', elite: true, zones: [0.4, 0.5, 0.1], skin: 0x6a5a8a, weapon: 'mace', hpMul: 2.6, dmgMul: 1.7, speed: 0.85, reach: 1.2, windMul: 1.5, cdMul: 1.2, r: 0.58, scale: 1.4, noStagger: true, sneakCap: 2, resistBleed: true,
    info: ['An elite brute covered in mushrooms. Tough, slow and hard-hitting, never staggered by ordinary hits, and immune to bleed.'] },
  mguard:  { name: 'Market Guard', zones: [0.3, 0.5, 0.2], hpMul: 1.3, speed: 0.95, blockFront: 0.25, shield: true,
    info: ['Carries a big shield: hits to the front only do a quarter of the damage. Hit it from the side or behind, or stun it, or sneak up on it.'] },
  boar:    { name: 'Trained Boar', model: 'quad', zones: [0, 0.3, 0.7], fur: 0x6a4a3a, hpMul: 1.1, windMul: 0.8, r: 0.45, scale: 1.1, height: 0.95, vis: 0.8,
    charge: { min: 4, max: 11, speed: 10, wind: 0.6, dmgMul: 1.6 },
    info: ['Paws the ground for half a second, then charges in a straight line at about twice sprinting speed. Step aside at the last moment and it runs past.', 'Goes for your legs.'] },
  thief:   { name: 'Thief Goblin', zones: [0, 1, 0], skin: 0x3a5a3a, noGear: true, weapon: 'dagger', hpMul: 0.7, dmgMul: 0.3, speed: 1.15, vis: 1.1, thief: true,
    info: ['Does not fight: it steals up to 25 gold and runs away. Kill it and the gold drops with its body.', 'Fast, so shoot it or trap it. Keep your gold low near one.'] },
  captain: { name: 'Market Captain', elite: true, zones: [0.3, 0.5, 0.2], weapon: 'sword', heavy: true, hpMul: 2, dmgMul: 1.3, reach: 1.1, scale: 1.15, shout: 3, callAll: true, sneakCap: 3,
    info: ['An elite in plate. When it spots you it bellows so loudly that every enemy in about 33 m (11 m x 3) turns alerted. Take it out quietly, or not at all.'] },
  cultist: { name: 'Cultist', zones: [0.3, 0.5, 0.2], skin: 0x8aa0a0, robe: 0xd8d8e8, orb: 0x9adaff, look: 'staff', noGear: true, weapon: 'sword', hpMul: 0.8, dmgMul: 0.6, vis: 0.7, hear: 1.2,
    ranged: { kind: 'curse', min: 5, max: 11, wind: 0.9, cd: 2.8, speed: 12 },
    info: ['A robed caster that curses you with a Slow for 5 s. The bolt is slow enough to dodge.'] },
  wisp:    { name: 'Frost Wisp', model: 'float', hover: 1.0, zones: [0.3, 0.7, 0], fur: 0x9adaff, hpMul: 0.5, dmgMul: 0.6, speed: 1.3, reach: 1.0, windMul: 0.7, r: 0.3, scale: 0.8, height: 1.7, vis: 1.2, onHit: 'slow',
    info: ['A floating ball of cold that drifts at head height. Its touch Slows you, and it is quick, so do not turn your back.', 'Fragile: one good hit.'] },
  // The Overgrown Ruin's natives (the Jungle). Reused rigs, new tints: the jaguar is a quad, the rest are goblins.
  jaguar:  { name: 'Jaguar', model: 'quad', zones: [0, 0.5, 0.5], fur: 0xc89a3a, hpMul: 0.8, dmgMul: 1.1, speed: 1.3, reach: 1.3, windMul: 0.6, cdMul: 0.85, r: 0.4, scale: 1.05, height: 0.9, vis: 0.9, hear: 1.2, sneakCap: 2, ambush: 5,
    info: ['A big cat that lies in wait as scenery until you come within about 5 m (about 2 m if you creep up crouched). Then it pounces, faster than a sprint, and goes for your body and legs.', 'Creep past it, or catch it asleep with a dagger. It is fragile for its speed: it has 80% of a guard\'s health.'] },
  dartgoblin: { name: 'Poison-Dart Goblin', zones: [0.3, 0.7, 0], skin: 0x3f8a6a, noGear: true, weapon: 'dagger', look: 'bow', hpMul: 0.7, dmgMul: 0.5, speed: 1.1, vis: 1.1, hear: 1.0,
    ranged: { kind: 'dart', min: 4, max: 11, wind: 0.7, cd: 1.8, speed: 26 },
    info: ['A leaf-hooded blowpipe goblin. It keeps its distance and spits poison darts that make you Bleed for 5 s. A shield does not stop them, but a dart is quick, so break line of sight.', 'Fragile: close in behind cover, or use the brush to creep up on it.'] },
  strangler: { name: 'Vine Strangler', zones: [0.3, 0.5, 0.2], skin: 0x3a6a2a, noGear: true, weapon: 'mace', hpMul: 1.6, dmgMul: 1.1, speed: 0.7, reach: 1.6, windMul: 1.3, cdMul: 1.1, r: 0.5, scale: 1.3, ambush: 3.5, onHit: 'slow', sneakCap: 2,
    info: ['A tangle of vines that hangs in the undergrowth with its arms out until you come within about 3.5 m (about 1.4 m crouched). Then it lashes out with a long reach and its vines Slow you.', 'Slow on its feet: walk away from it, or stay out of its reach and strike first.'] },
  tribal:  { name: 'Tribal Guard', elite: true, zones: [0.3, 0.5, 0.2], skin: 0x9a6a3a, weapon: 'mace', shield: true, hpMul: 2, dmgMul: 1.3, speed: 0.95, reach: 1.2, windMul: 1.2, r: 0.5, scale: 1.2, blockFront: 0.4, sneakCap: 2.5, shout: 1.3,
    info: ['An elite guard in feathers and face paint with a big shield: hits from the front only do 40% damage. Flank it, stun it or sneak up on it. A dagger cannot kill it in one stab.'] },
  // Generic ambushers. The mimic is never placed by the spawn mix: js/gen.js turns about 8% of ordinary chests from floor 2 on
  // into one (the prop's `mimic` flag) and main.js builds it. The bomb goblin comes from the mix in assignEnemyTypes.
  mimic:   { name: 'Mimic', model: 'mimic', mimic: true, zones: [0.3, 0.7, 0], weapon: 'mace', noGear: true, hpMul: 2.5, dmgMul: 2, speed: 0.15, reach: 0.7, windMul: 1.1, cdMul: 1.3, r: 0.55, scale: 1, height: 0.75, noStagger: true, sneakCap: 2, resistBleed: true, hear: 0, shout: 0.5,
    info: ['A chest that bites. Searching it springs it: a very short warning as the lid yawns open, then a bite for about twice a guard\'s damage. Back off the moment the lid lifts.', 'Spot it first: the lid sits a hair ajar and slowly breathes, and a pink tongue edge shows at the seam. Hit it before you search it and it wakes without the free bite.', 'Sturdy and slow, it barely leaves its spot and cannot be staggered or made to bleed. It drops loot one chest grade better than itself, with gear guaranteed.'] },
  bomber:  { name: 'Bomb Goblin', zones: [0.3, 0.5, 0.2], skin: 0x9aa83a, noGear: true, weapon: 'dagger', hpMul: 0.3, dmgMul: 0.2, speed: 1.4, scale: 0.8, r: 0.35, vis: 1.1, hear: 1.2, shout: 1.2, bomb: true,
    info: ['A small, quick goblin hugging a lit bomb. When it notices you it sprints straight at you and blows up at about 1.5 m, or when the fuse runs out (about 2.5 s). The last 0.8 s it flashes red and the spark goes wild.', 'The blast reaches about 3.5 m, hurts everything in range (other enemies too) and is heard 14 m away. Damage is highest at the centre.', 'Fragile: kill it at range and it drops the bomb, which goes off a moment later where it lies. Lure it into a crowd, or play Hanahan\'s Rage and it rushes the other enemies instead.'] },
  // The locked-room mini-boss (js/quests.js): a named, recoloured, 1.3x guard. Never from the spawn mix; ~3x a guard's HP and 1.5x its damage.
  miniboss: { name: 'Mini-Boss', elite: true, zones: [0.3, 0.5, 0.2], weapon: 'mace', skin: 0x9a3a32, hpMul: 3, dmgMul: 1.5, speed: 0.95, reach: 1.15, windMul: 1.2, r: 0.5, scale: 1.3, noStagger: true, sneakCap: 2, shout: 1.5,
    info: ['A named brute that waits in a locked room (the key is in a chest on the same floor). Optional: nobody makes you open the door.', 'About three times the health of a guard and one and a half times its damage, with a long reach. It is an elite: ordinary hits do not stagger it, a sneak attack is capped (a dagger cannot instakill it) and it shrugs off glue. A parry still staggers it.', 'Always leaves a Rare or better piece of equipment and a purse of gold, more of both on deeper floors.'] },
  // The wanted-guard quest's target (js/quests.js): a named elite guard in plate, ~2x a guard's HP and 1.3x its damage.
  wanted:  { name: 'Wanted Guard', elite: true, zones: [0.3, 0.5, 0.2], weapon: 'sword', heavy: true, skin: 0x8a5a3a, hpMul: 2, dmgMul: 1.3, speed: 1, reach: 1.1, windMul: 1.1, r: 0.46, scale: 1.2, sneakCap: 3, shout: 1.5,
    info: ['A named elite guard, wanted by a goblin defector (a quest on floors 2 to 4). It patrols one room, wears plate and carries a floating name.', 'About twice the health of a guard and 1.3 times its damage. A sneak attack is capped, so a dagger cannot instakill it, but any way of killing it counts.', 'Report back to the defector near the start room for the reward: a good potion or a Rare or better piece of gear.'] },
  // The quest-giver's body: never in the enemy list, so it cannot be hit and nothing reacts to it.
  defector: { name: 'Goblin Defector', skin: 0x7a9a4a, noGear: true, weapon: 'dagger', scale: 0.9 },
  // The prisoner rescue's captive (js/quests.js): a shackled goblin built like the defector, never in the enemy list.
  prisoner: { name: 'Prisoner', skin: 0x8a9a5a, noGear: true, weapon: 'dagger', scale: 0.86 },
  // The ally recruit (js/quests.js): a wounded adventurer or goblin defector in a random guard kit, ~1.5x a guard's HP. Never in the enemy list; quests.js drives it
  // and Enemy.fightOther does its melee. Its look (skin) is picked from its seed.
  ally: { name: 'Ally', hpMul: 1.5, zones: [0.3, 0.5, 0.2] },
  // The sneak thief chase (js/quests.js): carries a loot sack, never fights, runs from you (fleer, see Enemy.updateFleer) at 1.1 x the alerted guard
  // speed (about 1.2 x your sprint), cowers when cornered and escapes down the stairs if it gets there. Its shout is silent (shout 0).
  sackthief: { name: 'Sack Thief', zones: [0, 1, 0], skin: 0x4a6a3a, noGear: true, weapon: 'dagger', hpMul: 0.5, dmgMul: 0, speed: 1.1, vis: 1.1, hear: 1.2, shout: 0, scale: 0.88, r: 0.36, fleer: true,
    info: ['A thief goblin with a fat loot sack on its back (gold and one Uncommon or better item). It never fights: when it spots you it runs, about 20% faster than you sprint, and it will not steal from you.', 'Sneak up and stab it, or shoot it. Dead ends corner it and it cowers. If it reaches the stairs while running it escapes and the sack is gone.'] },
  iceknight: { name: 'Ice Knight', elite: true, zones: [0.3, 0.5, 0.2], skin: 0x9ac4e0, weapon: 'sword', heavy: true, hpMul: 2.2, dmgMul: 1.4, speed: 0.95, reach: 1.1, windMul: 1.2, r: 0.5, scale: 1.2, blockFront: 0.3,
    info: ['An elite knight in frozen plate with a raised guard: hits from the front only do 30% damage. Flank it, stun it, or wait for it to swing and strike back.'] },
};
for (const t of Object.values(ENEMY_TYPES)) {   // fill the defaults so the rest of the code never checks for undefined
  Object.assign(t, { model: 'biped', look: null, ranged: null, pack: 0, ambush: 0, blockFront: 1, resistBleed: false, onDeath: null, onHit: null, charge: null, thief: false, fleer: false, callAll: false, heavy: false, shield: false, robe: null, orb: null, hover: 0, info: null, mimic: false, bomb: false, hpMul: 1, dmgMul: 1, speed: 1, reach: 1, windMul: 1, cdMul: 1, vis: 1, hear: 1, smell: 0, shout: 1, sneakCap: 99, r: 0.4, scale: 0, ...t });
}

// Mimic chest numbers (the rest are in the table row above and TUNE). springWind: the lid-open warning, in seconds, before the free bite
// when you search it (later bites use the type's normal wind-up).
const MIMIC = { springWind: 0.45, springReach: 2.6 };   // springReach: metres the first bite covers (you search from up to 2.4 m)
// Bomb goblin numbers. fuse: seconds from being alerted to the blast. warn: the last seconds, when it flashes and beeps.
// trigger: it blows up at this distance from its target. radius and dmg: the blast (damage falls off to (1 - falloff) x dmg at the edge).
// noise: how far the bang is heard. dropDelay: a dropped bomb (from a killed goblin) goes off after this long. chain: a lit goblin caught in a blast has at most this long left.
const BOMB = { fuse: 2.5, warn: 0.8, trigger: 1.5, radius: 3.5, dmg: 55, falloff: 0.75, noise: 14, dropDelay: 1.5, chain: 0.3, fx: 0.4 };

// Natives per theme. commons fill most of the population (types with a `pack` size spawn in packs), `signature` is
// the theme's own oddity (from floor 2, two from floor 4), `elite` shows up on floors 3 and 4, and `bonus` adds
// extra wolves, archers or (the Market) signature thieves. `prefer` maps a type to the room theme it likes. Every theme keeps plain goblins.
// (THEME_NATIVES is a view of the theme schema in js/gen.js, THEME_DEFS.)
// Share of a floor's guards that are natives: low on floor 1 so the basics are learned on plain goblins.
const NATIVE_SHARE = [0.3, 0.45, 0.6, 0.7, 0.7];
const MAX_NATIVE_TYPES = 3;                      // commons + signature + elite on one floor

const roomOf = (f, x, y) => f.rooms.find(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) || null;
const nearPoint = (f, x, y, k) => {   // an open tile beside (x, y)
  for (let j = 0; j < 8; j++) {
    const [dx, dy] = NEIGH8[(k + j) % 8], i = (y + dy) * f.w + x + dx;
    if (f.tiles[i] === T_FLOOR && !f.blocked[i]) return { x: x + dx, y: y + dy };
  }
  return { x, y };
};

// Turns some of a generated floor's plain guard specs into natives, adds rat packs and wolves with
// handlers. Works on the floor's `enemies` list in place and never touches the layout, so floors stay
// identical for a seed apart from who lives on them. Deterministic from the seed.
function assignEnemyTypes(f, seed, floorNum, themeName) {
  const rng = makeRng(((seed ^ 0x9e3779b9) >>> 0) + floorNum * 40503);
  const roster = THEME_NATIVES[themeName];
  const guards = f.enemies.filter(e => !e.boss);
  const seedOf = () => (rng() * 4294967296) >>> 0;
  // Wolves keep a goblin handler (from floor 2, up to 3). Reserve the handlers first so natives never take them.
  const wolves = floorNum >= 2 ? (floorNum === 5 ? 2 : Math.min(3, floorNum - 1)) + (roster && roster.bonus && floorNum < 5 ? roster.bonus.wolf || 0 : 0) : 0;   // fewer in the arena, where the rim has few guards
  const handlers = rng.shuffle(f.enemies.map((e, i) => i).filter(i => !f.enemies[i].boss)).slice(0, wolves);
  const reserved = new Set(handlers.map(i => f.enemies[i]));

  // Generic specials in every theme (assigned first, from the guards that are not wolf handlers): archers from floor 2,
  // a shaman from floor 3, one brute on floor 4 and in the arena. At least one plain goblin always remains.
  const keep = roster && floorNum < 5 ? 2 : 1;
  const plain = () => guards.filter(g => !g.type && !reserved.has(g));
  const special = (type, n) => { for (let i = 0; i < n; i++) { const p = plain(); if (p.length <= keep) return; rng.pick(p).type = type; } };   // keep a couple of plain guards for the natives
  special('brute', floorNum === 4 || floorNum === 5 ? 1 : 0);
  special('shaman', floorNum >= 3 ? 1 : 0);
  special('bomber', floorNum === 4 ? 1 + (rng() < 0.5 ? 1 : 0) : floorNum >= 2 && floorNum < 5 ? (rng() < 0.5 ? 1 : 0) : 0);   // bomb goblins: 0-1 on floors 2 and 3, 1-2 on floor 4, out of the guards' budget
  special('archer', (floorNum >= 4 ? 2 : floorNum >= 2 ? 1 : 0) + (floorNum >= 2 && floorNum < 5 && roster && roster.bonus ? roster.bonus.archer || 0 : 0));

  if (roster) {
    const eliteOn = roster.elite && floorNum >= 3 && floorNum <= 4, sigN = roster.signature && floorNum >= 2 ? (floorNum >= 4 ? 2 : 1) + (roster.bonus && floorNum < 5 ? roster.bonus.thief || 0 : 0) : 0;   // (the Market: bonus.thief makes its signature thieves more common)
    const commons = rng.shuffle(roster.commons.slice()).slice(0, Math.max(1, MAX_NATIVE_TYPES - (eliteOn ? 1 : 0) - (roster.signature ? 1 : 0)));
    const solo = commons.filter(t => !ENEMY_TYPES[t].pack), packTypes = commons.filter(t => ENEMY_TYPES[t].pack);
    // the signature native first, from the free guards
    for (let i = 0; i < sigN; i++) { const p = plain(); if (p.length <= keep) break; rng.pick(p).type = roster.signature; }
    const free = guards.filter(g => !reserved.has(g) && !g.type);
    const share = Math.min(1, NATIVE_SHARE[Math.min(floorNum, 5) - 1] * guards.length / Math.max(1, free.length));   // reserved handlers stay goblins, so the rest carry the share
    let eliteLeft = eliteOn ? 1 : 0;
    for (const g of rng.shuffle(free.slice())) {
      if (eliteLeft && rng() < 0.35) { g.type = roster.elite; eliteLeft--; continue; }
      if (!solo.length || rng() > share) continue;
      const room = roomOf(f, g.x, g.y), weights = solo.map(t => roster.prefer[t] && room && room.theme === roster.prefer[t] ? 4 : 1);
      g.type = solo[weightedIndex(rng, weights)];
    }
    if (eliteLeft) { const g = free.find(e => e.type !== roster.elite); if (g) g.type = roster.elite; }   // the elite always turns up on floors 3 and 4
    if (!guards.some(g => !g.type)) { const g = guards.find(g => roster.commons.includes(g.type)); if (g) delete g.type; }   // always leave at least one plain goblin
    for (const pt of packTypes) {                                                           // packs (rats, books), in their favourite room if there is one
      const size = ENEMY_TYPES[pt].pack, packs = floorNum >= 3 ? 2 : 1, homes = f.rooms.filter((r, i) => i > 0 && !r.locked && r.theme !== 'shop');
      for (let p = 0; p < packs && homes.length; p++) {
        const fav = homes.filter(r => r.theme === roster.prefer[pt]), home = rng.pick(fav.length ? fav : homes);
        for (let k = 0; k < size; k++) {
          const a = roomPoint(f, home, k * 3 + p), b = roomPoint(f, home, k * 3 + p + 4);
          f.enemies.push({ x: a.x, y: a.y, route: [a, b], seed: seedOf(), type: pt });
        }
      }
    }
  }
  // The wolves: same route as the handler, and they follow it around.
  handlers.forEach((hi, w) => {
    const h = f.enemies[hi], a = nearPoint(f, h.x, h.y, w * 3);
    f.enemies.push({ x: a.x, y: a.y, route: h.route.map(p => ({ ...p })), seed: seedOf(), type: 'wolf', handler: hi });
  });
  return f;
}
function weightedIndex(rng, w) { let r = rng() * w.reduce((a, b) => a + b, 0); for (let i = 0; i < w.length; i++) { r -= w[i]; if (r < 0) return i; } return w.length - 1; }

// The type for a guard that turns up later (the floor 3+ respawns): mostly plain goblins, natives per the floor's share.
function respawnType(themeName, floorNum, rnd) {
  const roster = THEME_NATIVES[themeName];
  if (!roster || rnd() > NATIVE_SHARE[Math.min(floorNum, 5) - 1]) return 'goblin';
  const solo = roster.commons.filter(t => !ENEMY_TYPES[t].pack);
  return solo[Math.floor(rnd() * solo.length)];
}

// After the floor's enemies are built: point each wolf at its handler.
function linkHandlers(list) {
  list.forEach(e => { if (e.spec.handler !== undefined) e.handlerRef = list[e.spec.handler] || null; });
}

// Each theme has its own boss: a name, a look (dress), and a skin colour. It is the same fight (the Cave Warlord's
// numbers), so only the presentation changes.
// (THEME_BOSS is a view of the theme schema in js/gen.js.)
// The placeholder final boss (stage 5): the Cave Warlord's fight with a darker tint, 1.25x bigger, a name tag that says so (js/main.js).
const FINAL_BOSS = { name: 'The Final Boss', tag: '??? (final boss, placeholder)', dress: 'warlord', skin: 0x4a2a5a };
const bossNameFor = themeName => themeName === FINAL_THEME.name ? FINAL_BOSS.name : (THEME_BOSS[themeName] || { name: 'Cave Warlord' }).name;
