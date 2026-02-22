import { watchBase } from "./base/baseWatcher.js";
import { watchSolanaMomentum } from "./solana/solanaMomentumWatcher.js";
import { queueAlert } from "./utils/alertQueue.js";

// Optional — only import if these files exist
let getTrendingTokens = null;
let getTopInsiders = null;

try {
    const trending = await import("./solana/trendingLeaderboard.js");
    getTrendingTokens = trending.getTrendingTokens;
} catch {
    console.log("⚠️  trendingLeaderboard.js not found — skipping");
}

try {
    const insider = await import("./sniper/insiderTracker.js");
    getTopInsiders = insider.getTopInsiders;
} catch {
    console.log("⚠️  insiderTracker.js not found — skipping");
}

if (globalThis.__CHAINPULSE_STARTED__) {
    console.log("⚠️  ChainPulse already running, skipping duplicate start...");
    process.exit(0);
}

globalThis.__CHAINPULSE_STARTED__ = true;

console.log("🚀 ChainPulse Alpha Engine LIVE");
console.log("━".repeat(50));

try {
    watchBase();
    console.log("✅ Base detector initialized");
} catch (err) {
    console.error("❌ Base detector failed:", err.message);
    queueAlert("⚠️ Base detector startup failed: " + err.message);
}

try {
    watchSolanaMomentum();
    console.log("✅ Solana detector initialized");
} catch (err) {
    console.error("❌ Solana detector failed:", err.message);
    queueAlert("⚠️ Solana detector startup failed: " + err.message);
}

console.log("━".repeat(50));
console.log("🎯 Status: OPERATIONAL");
console.log("📡 Monitoring: Base Chain + Solana");
console.log("━".repeat(50));

setTimeout(() => {
    queueAlert(
        "🚀 ChainPulse Started\n\n" +
        "✅ Base Detector: LIVE\n" +
        "✅ Solana Detector: LIVE\n\n" +
        "🎯 Ready to catch meme opportunities!"
    );
}, 5000);

// Hourly leaderboard (only if modules loaded)
setInterval(() => {
    try {
        if (!getTrendingTokens && !getTopInsiders) return;

        const trending = getTrendingTokens ? getTrendingTokens(5) : [];
        const insiders = getTopInsiders ? getTopInsiders(5) : [];

        if (!trending.length && !insiders.length) {
            console.log("📊 No trending data this hour");
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
    } catch (err) {
        console.error("⚠️  Leaderboard error:", err.message);
    }
}, 60 * 60 * 1000);

// Health check every 30 min
setInterval(() => {
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    console.log(`💓 Uptime: ${hours}h ${minutes}m | Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
}, 30 * 60 * 1000);

process.on("SIGINT", () => {
    console.log("\n🛑 Shutting down...");
    queueAlert("🛑 ChainPulse shutting down");
    setTimeout(() => process.exit(0), 3000);
});

process.on("SIGTERM", () => {
    console.log("\n🛑 SIGTERM received...");
    setTimeout(() => process.exit(0), 3000);
});

process.on("unhandledRejection", (reason) => {
    console.error("❌ Unhandled Rejection:", reason);
});

process.on("uncaughtException", (error) => {
    console.error("❌ Uncaught Exception:", error.message);
    queueAlert(`⚠️ Critical Error: ${error.message}`);
    setTimeout(() => process.exit(1), 5000);
});


