/**
 * Trending Meme Leaderboard
 */

const trendingTokens = new Map();

/**
 * Update token momentum score
 */
export function updateTrendingToken(mint, stats) {
    if (!mint || !stats) return;

    if (!trendingTokens.has(mint)) {
        trendingTokens.set(mint, {
            whales: 0,
            liquidity: stats.liquidity,
            marketCap: stats.marketCap,
            score: 0,
            lastUpdate: Date.now(),
        });
    }

    const data = trendingTokens.get(mint);

    data.whales += 1;

    // Simple scoring formula
    data.score =
        data.whales * 10 +
        data.liquidity / 10000 +
        data.marketCap / 50000;

    data.lastUpdate = Date.now();
}

/**
 * Get top trending memes
 */
export function getTrendingTokens(limit = 10) {
    return [...trendingTokens.entries()]
        .map(([mint, data]) => ({
            mint,
            ...data,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}
