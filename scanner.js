import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

/**
 * ================================
 *  ALERT MEMORY SYSTEM
 * ================================
 */
const STATE_FILE = "./lastAlerts.json";

function loadState() {
    try {
        if (!fs.existsSync(STATE_FILE)) return [];
        return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    } catch {
        return [];
    }
}

function saveState(alerted) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(alerted, null, 2));
}

/**
 * ================================
 *  TELEGRAM ALERT
 * ================================
 */
async function sendTelegram(msg) {
    try {
        const url = `https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`;

        await axios.post(url, {
            chat_id: process.env.TG_CHAT_ID,
            text: msg,
        });

        console.log("✅ Telegram alert sent");
    } catch (err) {
        console.log("❌ Telegram failed:", err.message);
    }
}

/**
 * ================================
 *  FETCH TRENDING TOKENS
 * ================================
 */
async function fetchTrending(query) {
    try {
        const res = await axios.get(
            `https://api.dexscreener.com/latest/dex/search?q=${query}`
        );

        return res.data.pairs.slice(0, 10);
    } catch (err) {
        console.log("❌ DexScreener fetch error:", err.message);
        return [];
    }
}

/**
 * ================================
 *  WHALE FILTERS
 * ================================
 */
const MIN_LIQ = 200000;
const MIN_MCAP = 300000;

/**
 * ================================
 *  MAIN SCANNER
 * ================================
 */
async function runScanner() {
    console.log("🔄 ChainPulse GitHub Scanner Running...");

    // Load memory of already alerted tokens
    let alerted = loadState();

    /**
     * -------- SOLANA TRENDING --------
     */
    const solPairs = await fetchTrending("raydium");
    const solGood = solPairs.filter(
        (p) =>
            p.chainId === "solana" &&
            p.liquidity?.usd > MIN_LIQ &&
            p.fdv > MIN_MCAP
    );

    /**
     * -------- BASE TRENDING --------
     */
    const basePairs = await fetchTrending("base");
    const baseGood = basePairs.filter(
        (p) =>
            p.chainId === "base" &&
            p.liquidity?.usd > MIN_LIQ &&
            p.fdv > MIN_MCAP
    );

    /**
     * -------- COMBINE RESULTS --------
     */
    const final = [...solGood, ...baseGood];

    if (final.length === 0) {
        console.log("⚠️ No strong whale tokens found this run.");
        return;
    }

    console.log(`🔥 Found ${final.length} strong tokens...`);

    /**
     * -------- SEND ONLY NEW ALERTS --------
     */
    let sentCount = 0;

    for (const token of final.slice(0, 5)) {
        const address = token.baseToken.address;

        // Skip if already alerted
        if (alerted.includes(address)) continue;

        alerted.push(address);
        sentCount++;

        await sendTelegram(
            `🔥 ChainPulse Whale Trending Alert\n\n` +
            `Chain: ${token.chainId.toUpperCase()}\n` +
            `Token: ${token.baseToken.name} (${token.baseToken.symbol})\n\n` +
            `💧 Liquidity: $${token.liquidity.usd.toFixed(0)}\n` +
            `📈 MarketCap: $${token.fdv.toFixed(0)}\n\n` +
            `Dex: ${token.url}`
        );

        // Stop after 3 alerts max
        if (sentCount >= 3) break;
    }

    /**
     * -------- SAVE MEMORY --------
     */
    saveState(alerted.slice(-30));

    console.log(`✅ Scan complete. Sent ${sentCount} new alerts.`);
}

runScanner();
