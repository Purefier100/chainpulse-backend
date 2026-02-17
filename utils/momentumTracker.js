import axios from "axios";

/**
 * ========================================
 * 📈 PRICE MOMENTUM TRACKER
 * ========================================
 * Tracks price movement and identifies pumps
 */

const priceHistory = new Map(); // mint -> array of price points

/**
 * Track price for a token
 */
export async function trackPriceMomentum(mint) {
    try {
        // Fetch current price from DexScreener
        const response = await axios.get(
            `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
            { timeout: 5000 }
        );

        const pairs = response.data?.pairs || [];
        if (pairs.length === 0) {
            return {
                momentum: "UNKNOWN",
                priceChange5m: 0,
                priceChange1h: 0,
                volume24h: 0,
                isPumping: false,
                reason: "No price data",
            };
        }

        // Get the most liquid pair
        const mainPair = pairs.reduce((best, current) => {
            const currentLiq = parseFloat(current.liquidity?.usd || 0);
            const bestLiq = parseFloat(best.liquidity?.usd || 0);
            return currentLiq > bestLiq ? current : best;
        });

        const currentPrice = parseFloat(mainPair.priceUsd || 0);
        const volume24h = parseFloat(mainPair.volume?.h24 || 0);
        const priceChange5m = parseFloat(mainPair.priceChange?.m5 || 0);
        const priceChange1h = parseFloat(mainPair.priceChange?.h1 || 0);
        const priceChange24h = parseFloat(mainPair.priceChange?.h24 || 0);

        // Store price history
        if (!priceHistory.has(mint)) {
            priceHistory.set(mint, []);
        }

        const history = priceHistory.get(mint);
        history.push({
            price: currentPrice,
            timestamp: Date.now(),
            volume: volume24h,
        });

        // Keep last 20 data points (~ 20 minutes if checking every minute)
        if (history.length > 20) {
            history.shift();
        }

        // Calculate momentum
        let momentum = "SIDEWAYS";
        let isPumping = false;
        let reasons = [];

        // Strong pump signals
        if (priceChange5m > 50) {
            momentum = "MEGA PUMP 🚀🚀🚀";
            isPumping = true;
            reasons.push("+50%+ in 5 minutes");
        } else if (priceChange5m > 20) {
            momentum = "STRONG PUMP 🚀🚀";
            isPumping = true;
            reasons.push("+20%+ in 5 minutes");
        } else if (priceChange5m > 10) {
            momentum = "PUMPING 🚀";
            isPumping = true;
            reasons.push("+10%+ in 5 minutes");
        } else if (priceChange1h > 30) {
            momentum = "STRONG UPTREND ⬆️";
            isPumping = true;
            reasons.push("+30%+ in 1 hour");
        } else if (priceChange1h > 15) {
            momentum = "UPTREND ⬆️";
            reasons.push("+15%+ in 1 hour");
        } else if (priceChange1h < -20) {
            momentum = "DUMPING ⬇️";
            reasons.push("-20%+ in 1 hour");
        } else if (priceChange24h > 100) {
            momentum = "HOT 🔥";
            isPumping = true;
            reasons.push("+100%+ in 24h");
        }

        // Check volume surge
        if (history.length >= 3) {
            const avgVolume =
                history.slice(0, -1).reduce((sum, p) => sum + p.volume, 0) /
                (history.length - 1);
            const currentVol = history[history.length - 1].volume;

            if (currentVol > avgVolume * 3) {
                reasons.push("Volume surge 3x");
                isPumping = true;
            }
        }

        // Calculate velocity (price change over time)
        if (history.length >= 5) {
            const oldPrice = history[0].price;
            const velocity = ((currentPrice - oldPrice) / oldPrice) * 100;

            if (velocity > 30) {
                reasons.push(`+${velocity.toFixed(0)}% momentum`);
            }
        }

        return {
            momentum,
            currentPrice,
            priceChange5m,
            priceChange1h,
            priceChange24h,
            volume24h,
            isPumping,
            reason: reasons.join(", ") || "Stable",
            marketCap: parseFloat(mainPair.marketCap || 0),
            liquidity: parseFloat(mainPair.liquidity?.usd || 0),
        };
    } catch (err) {
        console.log("⚠️  Price tracking failed:", err.message);
        return {
            momentum: "UNKNOWN",
            priceChange5m: 0,
            priceChange1h: 0,
            volume24h: 0,
            isPumping: false,
            reason: "Tracking failed",
        };
    }
}

/**
 * Is this token actively pumping right now?
 */
export function isPumpingNow(momentum) {
    return momentum.isPumping && momentum.priceChange5m > 10;
}

/**
 * Get momentum emoji
 */
export function getMomentumEmoji(momentum) {
    if (momentum.includes("MEGA")) return "🚀🚀🚀";
    if (momentum.includes("STRONG PUMP")) return "🚀🚀";
    if (momentum.includes("PUMPING")) return "🚀";
    if (momentum.includes("UPTREND")) return "⬆️";
    if (momentum.includes("DUMPING")) return "⬇️";
    if (momentum.includes("HOT")) return "🔥";
    return "➡️";
}

/**
 * Clear old data
 */
setInterval(() => {
    for (const [mint, history] of priceHistory.entries()) {
        // Remove entries older than 30 minutes
        const cutoff = Date.now() - 1800000;
        const filtered = history.filter((p) => p.timestamp > cutoff);

        if (filtered.length === 0) {
            priceHistory.delete(mint);
        } else {
            priceHistory.set(mint, filtered);
        }
    }

    if (priceHistory.size > 1000) {
        priceHistory.clear();
        console.log("🧹 Cleared price history");
    }
}, 300000); // Every 5 minutes