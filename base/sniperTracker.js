import { recordSniper } from "../sniperLeaderboard.js";

const sniperMap = new Map();

export function trackBaseSniper(wallet) {
    const hits = (sniperMap.get(wallet) || 0) + 1;
    sniperMap.set(wallet, hits);

    recordSniper(wallet, "base");

    return hits;
}
