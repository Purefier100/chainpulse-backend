import axios from "axios";

/**
 * ========================================
 * 📱 SOCIAL SENTIMENT SCRAPER
 * ========================================
 * Checks Twitter/X mentions and community buzz
 */

const sentimentCache = new Map();

/**
 * Get social sentiment score
 * Uses multiple data sources to gauge community interest
 */
export async function getSocialSentiment(mint, tokenSymbol) {
    try {
        // Check cache (5 min)
        if (sentimentCache.has(mint)) {
            const cached = sentimentCache.get(mint);
            if (Date.now() - cached.timestamp < 300000) {
                return cached.data;
            }
        }

        let sentimentScore = 50; // Neutral baseline
        let signals = [];

        // 1. Check DexScreener social links
        const dexData = await getDexScreenerSocials(mint);
        if (dexData.hasTwitter) {
            sentimentScore += 10;
            signals.push("Has Twitter");
        }
        if (dexData.hasTelegram) {
            sentimentScore += 10;
            signals.push("Has Telegram");
        }
        if (dexData.hasWebsite) {
            sentimentScore += 5;
            signals.push("Has Website");
        }

        // 2. Check Birdeye for community activity
        const birdeyeData = await getBirdeyeActivity(mint);
        if (birdeyeData.isVerified) {
            sentimentScore += 15;
            signals.push("Verified on Birdeye");
        }
        if (birdeyeData.watchlistCount > 100) {
            sentimentScore += 10;
            signals.push(`${birdeyeData.watchlistCount}+ watchers`);
        }

        // 3. Check for trending status
        const isTrending = await checkIfTrending(mint, tokenSymbol);
        if (isTrending) {
            sentimentScore += 20;
            signals.push("TRENDING 🔥");
        }

        // Cap at 100
        sentimentScore = Math.min(sentimentScore, 100);

        const result = {
            score: sentimentScore,
            hasSocials: dexData.hasTwitter || dexData.hasTelegram,
            isVerified: birdeyeData.isVerified,
            isTrending,
            signals: signals.join(", ") || "No social presence",
            grade: getSentimentGrade(sentimentScore),
        };

        // Cache result
        sentimentCache.set(mint, {
            data: result,
            timestamp: Date.now(),
        });

        return result;
    } catch (err) {
        console.log("⚠️  Social sentiment check failed:", err.message);
        return {
            score: 50,
            hasSocials: false,
            isVerified: false,
            isTrending: false,
            signals: "Unable to check",
            grade: "Unknown",
        };
    }
}

/**
 * Get social links from DexScreener
 */
async function getDexScreenerSocials(mint) {
    try {
        const response = await axios.get(
            `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
            { timeout: 5000 }
        );

        const pairs = response.data?.pairs || [];
        if (pairs.length === 0) {
            return { hasTwitter: false, hasTelegram: false, hasWebsite: false };
        }

        const mainPair = pairs[0];
        const info = mainPair.info || {};

        return {
            hasTwitter: !!info.socials?.find((s) => s.type === "twitter"),
            hasTelegram: !!info.socials?.find((s) => s.type === "telegram"),
            hasWebsite: !!info.websites && info.websites.length > 0,
        };
    } catch (err) {
        return { hasTwitter: false, hasTelegram: false, hasWebsite: false };
    }
}

/**
 * Get Birdeye community data
 */
async function getBirdeyeActivity(mint) {
    try {
        // Note: Birdeye API requires key, this is a placeholder
        // In production, you'd need a Birdeye API key
        // For now, just return defaults
        return {
            isVerified: false,
            watchlistCount: 0,
        };

        // Example with real API:
        // const response = await axios.get(
        //     `https://public-api.birdeye.so/defi/token_overview?address=${mint}`,
        //     {
        //         headers: { "X-API-KEY": "YOUR_BIRDEYE_KEY" },
        //         timeout: 5000
        //     }
        // );
        //
        // return {
        //     isVerified: response.data?.data?.verified || false,
        //     watchlistCount: response.data?.data?.watchlist_count || 0
        // };
    } catch (err) {
        return {
            isVerified: false,
            watchlistCount: 0,
        };
    }
}

/**
 * Check if token is trending
 * Checks DexScreener trending endpoint
 */
async function checkIfTrending(mint, symbol) {
    try {
        const response = await axios.get(
            "https://api.dexscreener.com/latest/dex/search?q=" + symbol,
            { timeout: 5000 }
        );

        const pairs = response.data?.pairs || [];

        // Check if in top results (indicates trending)
        const foundInTop10 = pairs
            .slice(0, 10)
            .some((p) => p.baseToken?.address === mint);

        return foundInTop10;
    } catch (err) {
        return false;
    }
}

/**
 * Get sentiment grade
 */
function getSentimentGrade(score) {
    if (score >= 85) return "A+ (Strong Community)";
    if (score >= 75) return "A (Good Community)";
    if (score >= 65) return "B (Decent Community)";
    if (score >= 55) return "C (Some Community)";
    if (score >= 45) return "D (Weak Community)";
    return "F (No Community)";
}

/**
 * Does token have good social presence?
 */
export function hasGoodSocials(sentiment) {
    return sentiment.score >= 65 && sentiment.hasSocials;
}

/**
 * Clear cache periodically
 */
setInterval(() => {
    const now = Date.now();
    for (const [mint, cached] of sentimentCache.entries()) {
        if (now - cached.timestamp > 600000) {
            // 10 min
            sentimentCache.delete(mint);
        }
    }
}, 300000);