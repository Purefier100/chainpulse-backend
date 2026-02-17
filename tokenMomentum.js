import { getTokenMeta } from "./base/tokenCache.js";
import { CONFIG } from "./config.js";
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider(CONFIG.BASE_RPC);

/**
 * token => { buyers:Set, firstSeen:number }
 */
const tokenBuyers = new Map();

/**
 * Record buyer for a token
 */
export async function recordBuyer(token, wallet) {
    token = token.toLowerCase();

    if (!tokenBuyers.has(token)) {
        tokenBuyers.set(token, {
            buyers: new Set(),
            firstSeen: Date.now(),
        });
    }

    tokenBuyers.get(token).buyers.add(wallet);
}

/**
 * Return top trending tokens (unique buyers)
 */
export async function getHotTokens() {
    const results = [];

    for (const [token, data] of tokenBuyers.entries()) {
        const meta = await getTokenMeta(provider, token);

        results.push({
            token,
            symbol: meta?.symbol || "???",
            name: meta?.name || "Unknown",
            buyers: data.buyers.size,
            age: Date.now() - data.firstSeen,
        });
    }

    return results
        .filter((t) => t.age < 10 * 60 * 1000) // only last 10 mins
        .sort((a, b) => b.buyers - a.buyers)
        .slice(0, 5);
}

/**
 * Reset momentum every 10 minutes
 */
export function resetMomentum() {
    tokenBuyers.clear();
    console.log("♻️ Token momentum reset");
}
