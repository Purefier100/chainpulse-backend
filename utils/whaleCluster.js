/**
 * ========================================
 * 🐋 WHALE CLUSTER TRACKER
 * ========================================
 * Tracks unique whale buyers per token
 */

const whaleActivity = new Map(); // mint -> Set of whale addresses
const whaleHistory = new Map(); // whale address -> array of buys

// Whale threshold: wallets that buy $500+ worth
const WHALE_THRESHOLD_USD = 500;

/**
 * Record a whale purchase
 * @param {string} mint - Token mint address
 * @param {string} wallet - Buyer wallet address
 * @param {number} buyUsd - Purchase amount in USD (optional)
 * @returns {number} Total unique whales for this token
 */
export function recordWhale(mint, wallet, buyUsd = 0) {
    // Initialize token tracking if needed
    if (!whaleActivity.has(mint)) {
        whaleActivity.set(mint, new Set());
    }

    // Add whale to this token's set
    const whales = whaleActivity.get(mint);
    whales.add(wallet);

    // Track whale history
    if (!whaleHistory.has(wallet)) {
        whaleHistory.set(wallet, []);
    }

    whaleHistory.get(wallet).push({
        mint,
        buyUsd,
        timestamp: Date.now(),
    });

    return whales.size;
}

/**
 * Get whale count for a token
 */
export function getWhaleCount(mint) {
    return whaleActivity.get(mint)?.size || 0;
}

/**
 * Check if a wallet is a known whale
 * (has bought multiple tokens or large amounts)
 */
export function isKnownWhale(wallet) {
    const history = whaleHistory.get(wallet);
    if (!history) return false;

    // Check if they've bought 3+ different tokens
    const uniqueTokens = new Set(history.map((h) => h.mint));
    if (uniqueTokens.size >= 3) return true;

    // Check if they've made large purchases
    const totalSpent = history.reduce((sum, h) => sum + h.buyUsd, 0);
    if (totalSpent >= 5000) return true;

    return false;
}

/**
 * Get all tokens a whale has bought
 */
export function getWhaleTokens(wallet) {
    return whaleHistory.get(wallet) || [];
}

/**
 * Clear old data (run periodically to prevent memory issues)
 */
export function cleanupOldData(maxAge = 3600000) {
    // Clear tokens with no activity in last hour
    const now = Date.now();

    for (const [mint, whales] of whaleActivity.entries()) {
        let hasRecent = false;

        for (const whale of whales) {
            const history = whaleHistory.get(whale) || [];
            const recentBuys = history.filter(
                (h) => h.mint === mint && now - h.timestamp < maxAge
            );

            if (recentBuys.length > 0) {
                hasRecent = true;
                break;
            }
        }

        if (!hasRecent && whaleActivity.get(mint).size < 2) {
            whaleActivity.delete(mint);
        }
    }

    // Clear whale history older than maxAge
    for (const [wallet, history] of whaleHistory.entries()) {
        const recentHistory = history.filter((h) => now - h.timestamp < maxAge);

        if (recentHistory.length === 0) {
            whaleHistory.delete(wallet);
        } else {
            whaleHistory.set(wallet, recentHistory);
        }
    }
}

/**
 * Get statistics
 */
export function getStats() {
    return {
        trackedTokens: whaleActivity.size,
        trackedWhales: whaleHistory.size,
        topTokens: Array.from(whaleActivity.entries())
            .map(([mint, whales]) => ({ mint, whaleCount: whales.size }))
            .sort((a, b) => b.whaleCount - a.whaleCount)
            .slice(0, 10),
    };
}

// Cleanup every 30 minutes
setInterval(() => {
    cleanupOldData();
    console.log("🧹 Cleaned whale data:", getStats());
}, 1800000);