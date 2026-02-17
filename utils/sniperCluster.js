/**
 * Tracks sniper wallets buying many memes
 */

const sniperHits = new Map();

export function recordSniperHit(wallet) {
    if (!sniperHits.has(wallet)) sniperHits.set(wallet, 0);

    sniperHits.set(wallet, sniperHits.get(wallet) + 1);

    return sniperHits.get(wallet);
}

export function getSniperCount(wallet) {
    return sniperHits.get(wallet) || 0;
}
