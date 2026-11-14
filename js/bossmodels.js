// Boss models (BOSS2 to BOSS5 fill this in): BOSS_MODELS[id] = { build(e, m, lam), pose(e, dt) } for the non-biped bosses.
// build adds the parts to the boss's mesh group m (baked per animated group, at most 25 meshes) and pose eases its channels each frame.
// A def points at its entry with `model: id`. Empty for now: the current boss is a dressed biped (Enemy.build).
const BOSS_MODELS = {};
