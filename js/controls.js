// Key bindings (rebindable from the pause menu), the glossary's discovery list, and a session flag.
// Loaded before everything else that reads KEYS, so nothing sees it undefined.
const DEFAULT_KEYS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  sprint: 'ShiftLeft', crouch: 'KeyC', interact: 'KeyE', inventory: 'Tab',
  attack: 'Mouse0', block: 'Mouse2',
  slot1: 'Digit1', slot2: 'Digit2', slot3: 'Digit3', slot4: 'Digit4',
};
const CONTROL_LABELS = [
  ['forward', 'Move forward'], ['back', 'Move back'], ['left', 'Move left'], ['right', 'Move right'],
  ['sprint', 'Sprint (hold)'], ['crouch', 'Crouch (hold)'], ['interact', 'Interact, search, open (hold)'],
  ['attack', 'Attack'], ['block', 'Block and parry (hold)'], ['inventory', 'Inventory'],
  ['slot1', 'Quickslot 1'], ['slot2', 'Quickslot 2'], ['slot3', 'Quickslot 3'], ['slot4', 'Quickslot 4'],
];
const KEYS_STORE = 'honeyhan-controls-1';
const KEYS = { ...DEFAULT_KEYS };
try { Object.assign(KEYS, JSON.parse(localStorage.getItem(KEYS_STORE)) || {}); } catch (e) {}
function saveKeys() { try { localStorage.setItem(KEYS_STORE, JSON.stringify(KEYS)); } catch (e) {} }

// A readable name for a key code or a mouse button ('Mouse0' is the left button).
function keyName(code) {
  if (!code) return 'Unbound';
  const mouse = { Mouse0: 'Left Mouse', Mouse1: 'Middle Mouse', Mouse2: 'Right Mouse', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5' };
  if (mouse[code]) return mouse[code];
  let m;
  if ((m = /^Key(.)$/.exec(code))) return m[1];
  if ((m = /^Digit(\d)$/.exec(code))) return m[1];
  if ((m = /^Numpad(.+)$/.exec(code))) return 'Num ' + m[1];
  return { ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Left Alt', AltRight: 'Right Alt',
    Space: 'Space', Tab: 'Tab', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Backquote: '`' }[code] || code;
}

// ---- glossary discovery: remembered between runs ----
const DISC_STORE = 'honeyhan-discovered-1';
const discovered = new Set();
try { (JSON.parse(localStorage.getItem(DISC_STORE)) || []).forEach(k => discovered.add(k)); } catch (e) {}
// name: shown in a "Glossary updated" message. Leave it out to record silently.
function discover(key, name) {
  if (discovered.has(key)) return false;
  discovered.add(key);
  try { localStorage.setItem(DISC_STORE, JSON.stringify([...discovered])); } catch (e) {}
  if (name && typeof flash === 'function') flash(`Glossary updated: ${name}`);
  return true;
}
// d is an item or a drop descriptor (same fields).
function discoverItem(d, silent) {
  const nm = s => silent ? undefined : s;
  if (d.type === 'gold') discover('item:gold', nm('Gold'));
  else if (d.type === 'arrows') discover('item:arrows', nm('Arrows'));
  else if (d.type === 'key') discover('item:key', nm('Keys'));
  else if (d.type === 'potion') discover('potion:' + d.kind, nm(POTIONS[d.kind].name));
  else if (d.type === 'food') discover('food:' + d.kind, nm(FOOD[d.kind].name));
  else if (d.type === 'weapon') { discover('weapon:' + d.base, nm(WEAPON_NAMES[d.base])); discover('tier:' + d.tier, nm(TIERS[d.tier].name + ' tier')); }
  else if (d.type === 'wand') discover('wand:' + d.kind, nm(WANDS[d.kind].name));
  else if (d.type === 'rechargewand') discover('item:recharge', nm('Recharge Wand'));
  else if (d.type === 'rage') discover('item:rage', nm("Hanahan's Rage"));
  else if (d.type === 'shield') { discover('equip:shield', nm('Shield')); discover('tier:' + d.tier, nm(TIERS[d.tier].name + ' tier')); }
  else if (d.type === 'armor') { discover(`armor:${d.slot}:${d.cls}`, nm(ARMOR_NAMES[d.slot][d.cls])); discover('tier:' + d.tier, nm(TIERS[d.tier].name + ' tier')); }
}
// Called every few frames: an enemy in front of you with a clear line of sight gets recorded.
function discoverEnemiesInView() {
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  for (const e of enemies) {
    const dx = e.x - player.x, dz = e.z - player.z, d = Math.hypot(dx, dz);
    if (d > 16 || (dx * fx + dz * fz) / (d || 1) < 0.5 || !hasLOS(floor, player.x, player.z, e.x, e.z)) continue;
    discover(e.boss ? 'enemy:boss' : 'enemy:' + e.type, e.boss ? 'Cave Warlord' : e.T.name);
  }
}

const session = { started: false };   // true once the player has clicked past the welcome screen
