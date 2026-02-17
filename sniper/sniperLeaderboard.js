// Global sniper tracking
const sniperHits = new Map();

/**
 * Record sniper activity
 */
export function recordSniper(wallet, chain) {
    if (!wallet) return;

    const key = `${wallet}:${chain}`;

    if (!sniperHits.has(key)) {
        sniperHits.set(key, {
            wallet,
            chain,
            score: 0,
        });
    }

    sniperHits.get(key).score += 1;
}

/**
 * Return top sniper wallets
 */
export function getTopSnipers(limit = 5) {
    return [...sniperHits.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}
