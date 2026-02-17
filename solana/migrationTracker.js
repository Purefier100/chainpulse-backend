const pumpTokens = new Map();

/**
 * Store Pump.fun mint + creator
 */
export function registerPumpToken(mint, creator) {
    if (!mint) return;

    pumpTokens.set(mint, {
        creator,
        time: Date.now(),
        migrated: false,
    });
}

/**
 * Check if token is Pump token
 */
export function isPumpToken(mint) {
    return pumpTokens.has(mint);
}

/**
 * Mark token as migrated
 */
export function markMigrated(mint, pool) {
    if (!pumpTokens.has(mint)) return;

    const data = pumpTokens.get(mint);
    data.migrated = true;
    data.pool = pool;

    pumpTokens.set(mint, data);
}

/**
 * Has token migrated already?
 */
export function hasMigrated(mint) {
    return pumpTokens.get(mint)?.migrated === true;
}

