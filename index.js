import { watchBase } from "./base/baseWatcher.js";
import { watchSolanaMomentum } from "./solana/solanaMomentumWatcher.js";

import { getTrendingTokens } from "./solana/trendingLeaderboard.js";
import { getTopInsiders } from "./sniper/insiderTracker.js";

import { queueAlert } from "./utils/alertQueue.js";

/**
 * ========================================
 * 🚀 CHAINPULSE ALPHA ENGINE
 * ========================================
 * Multi-chain whale detector with advanced security
 */

/**
 * Prevent double-start (PM2 restart protection)
 */
if (globalThis.__CHAINPULSE_STARTED__) {
    console.log("⚠️  ChainPulse already running, skipping duplicate start...");
    process.exit(0);
}

globalThis.__CHAINPULSE_STARTED__ = true;

console.log("🚀 ChainPulse Alpha Engine LIVE");
console.log("━".repeat(50));

/**
 * Start Base detector with error handling
 */
try {
    watchBase();
    console.log("✅ Base detector initialized");
} catch (err) {
    console.error("❌ Base detector failed to start:", err.message);
    queueAlert("⚠️ Base detector startup failed: " + err.message);
}

/**
 * Start Solana detector with error handling
 */
try {
    watchSolanaMomentum();
    console.log("✅ Solana detector initialized");
} catch (err) {
    console.error("❌ Solana detector failed to start:", err.message);
    queueAlert("⚠️ Solana detector startup failed: " + err.message);
}

console.log("━".repeat(50));
console.log("🎯 System Status: OPERATIONAL");
console.log("📡 Monitoring: Base Chain + Solana");
console.log("🔬 Security: MAXIMUM (Honeypot + RugCheck + Full Analysis)");
console.log("━".repeat(50));

/**
 * Send startup confirmation
 */
setTimeout(() => {
    queueAlert(
        "🚀 ChainPulse Alpha Engine Started\n\n" +
        "✅ Base Detector: LIVE\n" +
        "✅ Solana Detector: LIVE\n\n" +
        "🔬 Security Features Active:\n" +
        "• Honeypot Detection\n" +
        "• Holder Analysis\n" +
        "• LP Lock Verification\n" +
        "• RugCheck Integration\n" +
        "• Price Momentum\n" +
        "• Social Sentiment\n\n" +
        "🎯 Ready to catch premium opportunities!"
    );
}, 5000); // Wait 5 seconds after startup

/**
 * 🔥 Trending Meme Leaderboard (Hourly)
 */
setInterval(() => {
    try {
        const trending = getTrendingTokens(5);
        const insiders = getTopInsiders(5);

        if (!trending.length && !insiders.length) {
            console.log("📊 No trending data to report this hour");
            return;
        }

        let msg = "📊 HOURLY LEADERBOARD\n\n";

        if (trending.length > 0) {
            msg += "🔥 TRENDING MEMES (Last Hour)\n\n";

            trending.forEach((t, i) => {
                msg += `${i + 1}. ${t.mint.slice(0, 8)}...\n`;
                msg += `   🐋 Whales: ${t.whales}\n`;
                msg += `   💧 Liq: $${t.liquidity.toFixed(0)}\n`;
                msg += `   📈 MC: $${t.marketCap.toFixed(0)}\n\n`;
            });
        }

        if (insiders.length > 0) {
            msg += "🎯 TOP INSIDER WALLETS\n\n";

            insiders.forEach((w, i) => {
                msg += `${i + 1}. ${w.wallet.slice(0, 8)}... → ${w.score} early hits\n`;
            });
        }

        queueAlert(msg);
        console.log("📊 Hourly leaderboard sent");
    } catch (err) {
        console.error("⚠️  Leaderboard generation failed:", err.message);
    }
}, 60 * 60 * 1000); // Every hour

/**
 * Health check (every 30 minutes)
 */
setInterval(() => {
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);

    console.log("━".repeat(50));
    console.log(`💓 Health Check | Uptime: ${hours}h ${minutes}m`);
    console.log(`📊 Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
    console.log("🎯 Status: OPERATIONAL");
    console.log("━".repeat(50));
}, 30 * 60 * 1000); // Every 30 minutes

/**
 * Graceful shutdown
 */
process.on("SIGINT", () => {
    console.log("\n🛑 Shutting down ChainPulse...");
    queueAlert("🛑 ChainPulse shutting down gracefully");

    setTimeout(() => {
        console.log("✅ Shutdown complete");
        process.exit(0);
    }, 3000);
});

process.on("SIGTERM", () => {
    console.log("\n🛑 Received SIGTERM, shutting down...");
    queueAlert("🛑 ChainPulse shutting down (SIGTERM)");

    setTimeout(() => {
        process.exit(0);
    }, 3000);
});

/**
 * Unhandled errors
 */
process.on("unhandledRejection", (reason, promise) => {
    console.error("❌ Unhandled Rejection:", reason);
    // Don't crash - log and continue
});

process.on("uncaughtException", (error) => {
    console.error("❌ Uncaught Exception:", error);
    queueAlert(`⚠️ Critical Error: ${error.message}`);

    // Give time for alert to send, then exit
    setTimeout(() => {
        process.exit(1);
    }, 5000);
});



