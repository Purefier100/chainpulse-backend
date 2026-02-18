import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

/**
 * Telegram Alert
 */
async function sendTelegram(msg) {
    const url = `https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`;

    await axios.post(url, {
        chat_id: process.env.TG_CHAT_ID,
        text: msg,
    });

    console.log("✅ Telegram alert sent");
}

/**
 * Fetch Trending Tokens from DexScreener
 */
async function fetchTrending(chain) {
    const res = await axios.get(
        `https://api.dexscreener.com/latest/dex/search?q=${chain}`
    );

    return res.data.pairs.slice(0, 10);
}

/**
 * Whale Filters
 */
const MIN_LIQ = 200000;
const MIN_MCAP = 300000;

/**
 * MAIN SCANNER
 */
async function runScanner() {
    console.log("🔄 ChainPulse GitHub Scanner Running...");

    // Solana Trending
    const solPairs = await fetchTrending("raydium");
    const solGood = solPairs.filter(
        (p) =>
            p.chainId === "solana" &&
            p.liquidity?.usd > MIN_LIQ &&
            p.fdv > MIN_MCAP
    );

    // Base Trending
    const basePairs = await fetchTrending("base");
    const baseGood = basePairs.filter(
        (p) =>
            p.chainId === "base" &&
            p.liquidity?.usd > MIN_LIQ &&
            p.fdv > MIN_MCAP
    );

    // Combine
    const final = [...solGood, ...baseGood];

    if (final.length === 0) {
        console.log("⚠️ No strong whales found this run.");
        return;
    }

    // Send Alerts
    for (const token of final.slice(0, 3)) {
        await sendTelegram(
            `🔥 ChainPulse Whale Trending Alert\n\n` +
            `Chain: ${token.chainId.toUpperCase()}\n` +
            `Token: ${token.baseToken.name} (${token.baseToken.symbol})\n\n` +
            `💧 Liquidity: $${token.liquidity.usd.toFixed(0)}\n` +
            `📈 MarketCap: $${token.fdv.toFixed(0)}\n\n` +
            `Dex: ${token.url}`
        );
    }

    console.log("✅ Scan complete.");
}

runScanner();
