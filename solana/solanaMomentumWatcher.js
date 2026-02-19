import { Connection, PublicKey } from "@solana/web3.js";
import axios from "axios";
import { CONFIG } from "../config.js";
import { queueAlert } from "../utils/alertQueue.js";

/**
 * ========================================
 * 🐸 SOLANA MEME COIN DETECTOR
 * ========================================
 * Optimized for early meme detection
 */

const connection = new Connection(CONFIG.SOLANA_RPC, "confirmed");

const PROGRAMS = {
    PUMPFUN: new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"),
    RAYDIUM_V4: new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"),
    RAYDIUM_CPMM: new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"),
};

// ✅ Meme-friendly thresholds
const MIN_BUY_USD = 200;           // Catch $200+ buys
const MIN_WHALES = 2;              // 2 unique whales in window
const BIG_SINGLE_BUY_USD = 2000;  // OR one massive buy
const WINDOW_MS = 5 * 60 * 1000;  // 5 min accumulation window
const MAX_AGE_MS = 30000;         // Only last 30s txns (fresh)

// Market cap filters — meme sweet spot
const MIN_MCAP = 10000;
const MAX_MCAP = 10000000; // Skip anything over $10M (already mooned)
const MIN_LIQ = 3000;
const MAX_LIQ = 300000;

// SOL price cache
let solPrice = 140;
let lastSolUpdate = 0;

// State
const alerted = new Set();
const seenTx = new Set();
const whaleBuyers = new Map(); // mint -> { buyers: Map, firstSeen, totalVolume }
const tokenMetaCache = new Map();

let totalScanned = 0;
let totalAlerts = 0;

// ========================================
// 💰 SOL PRICE
// ========================================
async function getSolPrice() {
    if (Date.now() - lastSolUpdate < 60000 && solPrice > 0) return solPrice;
    try {
        const res = await axios.get(
            "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
            { timeout: 4000 }
        );
        solPrice = res.data.solana.usd;
        lastSolUpdate = Date.now();
        console.log(`💰 SOL: $${solPrice}`);
    } catch {
        console.log("⚠️  Using cached SOL price");
    }
    return solPrice;
}

// ========================================
// 🔍 TOKEN METADATA (DexScreener first, RPC fallback)
// ========================================
async function getTokenInfo(mint) {
    if (tokenMetaCache.has(mint)) return tokenMetaCache.get(mint);

    try {
        const res = await axios.get(
            `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
            { timeout: 4000 }
        );

        const pairs = res.data?.pairs || [];
        const solanaPair = pairs
            .filter((p) => p.chainId === "solana")
            .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];

        if (!solanaPair) return null;

        const ageHours = solanaPair.pairCreatedAt
            ? (Date.now() - solanaPair.pairCreatedAt) / (1000 * 60 * 60)
            : null;

        const info = {
            name: solanaPair.baseToken?.name || "Unknown",
            symbol: solanaPair.baseToken?.symbol || "???",
            liquidity: solanaPair.liquidity?.usd || 0,
            marketCap: solanaPair.fdv || 0,
            priceUsd: solanaPair.priceUsd || 0,
            pairAddress: solanaPair.pairAddress,
            ageHours,
            priceChange5m: solanaPair.priceChange?.m5 || 0,
            priceChange1h: solanaPair.priceChange?.h1 || 0,
            volume5m: solanaPair.volume?.m5 || 0,
            buys5m: solanaPair.txns?.m5?.buys || 0,
            sells5m: solanaPair.txns?.m5?.sells || 0,
        };

        tokenMetaCache.set(mint, info);
        // Cache for only 2 min (meme prices move fast)
        setTimeout(() => tokenMetaCache.delete(mint), 120000);
        return info;
    } catch {
        return null;
    }
}

// ========================================
// 🍯 QUICK RUGCHECK (non-blocking)
// ========================================
async function quickRugCheck(mint) {
    try {
        const res = await axios.get(
            `https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`,
            { timeout: 3000 }
        );
        const score = res.data?.score || 0; // Higher = riskier on rugcheck
        const risks = res.data?.risks || [];

        // Block only the worst flags
        const criticalRisks = risks.filter((r) =>
            ["freeze_authority", "mint_authority", "honeypot"].includes(r.name)
        );

        return {
            score,
            isCritical: criticalRisks.length > 0,
            risks: risks.map((r) => r.name).slice(0, 3),
            grade: score < 500 ? "✅ Good" : score < 1000 ? "⚠️ Caution" : "❌ Risky",
        };
    } catch {
        // Don't block if rugcheck is down
        return { score: null, isCritical: false, risks: [], grade: "❓ Unknown" };
    }
}

// ========================================
// 📦 PARSE SWAP TRANSACTION
// ========================================
async function parseSwapTx(signature, programId) {
    try {
        if (seenTx.has(signature)) return null;
        seenTx.add(signature);

        const tx = await connection.getParsedTransaction(signature, {
            maxSupportedTransactionVersion: 0,
            commitment: "confirmed",
        });

        if (!tx?.meta || tx.meta.err) return null;

        // Age check — only fresh txns
        if (tx.blockTime && Date.now() - tx.blockTime * 1000 > MAX_AGE_MS) return null;

        const buyer = tx.transaction.message.accountKeys[0].pubkey.toString();
        const solSpent =
            (tx.meta.preBalances[0] - tx.meta.postBalances[0]) / 1e9;

        if (solSpent <= 0) return null;

        const price = await getSolPrice();
        const buyUsd = solSpent * price;
        if (buyUsd < MIN_BUY_USD) return null;

        // Find bought token
        const tokenBalances = tx.meta.postTokenBalances || [];
        let mint = null;
        for (const bal of tokenBalances) {
            if (bal.owner === buyer && bal.uiTokenAmount.uiAmount > 0) {
                mint = bal.mint;
                break;
            }
        }

        if (!mint) return null;

        return { mint, buyer, buyUsd, solSpent, signature, programId };
    } catch {
        return null;
    }
}

// ========================================
// 🐋 PROCESS WHALE BUY
// ========================================
async function processWhaleBuy(mint, buyer, buyUsd) {
    try {
        if (alerted.has(mint)) return;

        // Track whale window
        if (!whaleBuyers.has(mint)) {
            whaleBuyers.set(mint, {
                buyers: new Map(),
                firstSeen: Date.now(),
                totalVolume: 0,
            });
        }

        const data = whaleBuyers.get(mint);

        // Reset expired window
        if (Date.now() - data.firstSeen > WINDOW_MS) {
            data.buyers.clear();
            data.firstSeen = Date.now();
            data.totalVolume = 0;
        }

        data.buyers.set(buyer, (data.buyers.get(buyer) || 0) + buyUsd);
        data.totalVolume += buyUsd;

        const whaleCount = data.buyers.size;
        const totalVolume = data.totalVolume;

        const isBigSingleBuy = buyUsd >= BIG_SINGLE_BUY_USD && whaleCount === 1;
        const isMultiWhale = whaleCount >= MIN_WHALES;

        if (!isBigSingleBuy && !isMultiWhale) {
            console.log(`🐋 ${whaleCount} whale(s) | $${buyUsd.toFixed(0)} | ${mint.slice(0, 8)}...`);
            return;
        }

        // Fetch token info
        const info = await getTokenInfo(mint);
        if (!info) {
            console.log(`❌ No DexScreener data for ${mint.slice(0, 8)}`);
            return;
        }

        console.log(`🔥 ${info.symbol} | Whales: ${whaleCount} | Buy: $${buyUsd.toFixed(0)} | MCap: $${info.marketCap.toLocaleString()}`);

        // Meme coin market filters
        if (info.liquidity < MIN_LIQ) {
            console.log(`❌ ${info.symbol} liq too low: $${info.liquidity}`);
            return;
        }
        if (info.liquidity > MAX_LIQ) {
            console.log(`❌ ${info.symbol} too established (liq $${info.liquidity.toLocaleString()})`);
            return;
        }
        if (info.marketCap > MAX_MCAP) {
            console.log(`❌ ${info.symbol} already mooned: $${info.marketCap.toLocaleString()}`);
            return;
        }

        // Quick rugcheck (non-blocking)
        const rug = await quickRugCheck(mint);

        if (rug.isCritical) {
            console.log(`❌ ${info.symbol} critical rug flag: ${rug.risks.join(", ")}`);
            return;
        }

        alerted.add(mint);
        totalAlerts++;

        // Build alert
        const triggerReason = isBigSingleBuy
            ? `🐳 BIG BUY ($${buyUsd.toFixed(0)})`
            : `🐋 ${whaleCount} WHALES IN 5MIN`;

        const ageLine = info.ageHours !== null
            ? `⏱️ Age: ${info.ageHours < 1
                ? `${Math.round(info.ageHours * 60)}m`
                : `${info.ageHours.toFixed(1)}h`}`
            : `⏱️ Age: Unknown`;

        const momentumLine = info.priceChange5m >= 0
            ? `📈 +${info.priceChange5m}% (5m) | +${info.priceChange1h}% (1h)`
            : `📉 ${info.priceChange5m}% (5m) | ${info.priceChange1h}% (1h)`;

        const buyPressure = info.buys5m + info.sells5m > 0
            ? `🟢 ${info.buys5m}B / 🔴 ${info.sells5m}S (5m)`
            : "";

        const alert =
            `🚨 SOLANA MEME ALERT 🚨\n\n` +
            `🐸 ${info.name} ($${info.symbol})\n` +
            `📍 ${mint}\n\n` +
            `${triggerReason}\n` +
            `💰 Latest Buy: $${buyUsd.toFixed(0)}\n` +
            `💼 Window Volume: $${totalVolume.toFixed(0)}\n\n` +
            `💧 Liquidity: $${info.liquidity.toLocaleString()}\n` +
            `📊 Market Cap: $${info.marketCap.toLocaleString()}\n` +
            `${ageLine}\n` +
            `${momentumLine}\n` +
            `${buyPressure ? buyPressure + "\n" : ""}` +
            `⚠️ RugCheck: ${rug.grade}${rug.risks.length ? ` (${rug.risks.join(", ")})` : ""}\n\n` +
            `🔗 Dex: https://dexscreener.com/solana/${mint}\n` +
            `🦅 Birdeye: https://birdeye.so/token/${mint}\n` +
            `🔍 RugCheck: https://rugcheck.xyz/tokens/${mint}\n` +
            `📱 Photon: https://photon-sol.tinyastro.io/en/lp/${info.pairAddress}`;

        queueAlert(alert);
        console.log(`✅ MEME ALERT #${totalAlerts}: ${info.symbol} | MCap: $${info.marketCap.toLocaleString()} | Rug: ${rug.grade}`);

    } catch (err) {
        console.log(`⚠️ processWhaleBuy error:`, err.message);
    }
}

// ========================================
// 🔄 SCAN PROGRAM
// ========================================
async function scanProgram(programId, label) {
    try {
        const signatures = await connection.getSignaturesForAddress(programId, {
            limit: 10, // Grab more sigs per scan
        });

        for (const sig of signatures) {
            const parsed = await parseSwapTx(sig.signature, programId);
            if (parsed) {
                await processWhaleBuy(parsed.mint, parsed.buyer, parsed.buyUsd);
            }
            await new Promise((r) => setTimeout(r, 300)); // Lighter delay
        }

        totalScanned += signatures.length;
    } catch (err) {
        console.log(`⚠️ Error scanning ${label}:`, err.message);
    }
}

// ========================================
// 🎯 MAIN WATCHER
// ========================================
export function watchSolana() {
    console.log("🟣 Solana Meme Coin Detector LIVE");
    console.log(`💰 Min Buy: $${MIN_BUY_USD} | MCap: $${MIN_MCAP.toLocaleString()}-$${MAX_MCAP.toLocaleString()}`);
    console.log("📡 Monitoring: Pump.fun, Raydium V4, Raydium CPMM");

    getSolPrice();

    // Scan every 20s (faster than original 60s)
    setInterval(async () => {
        console.log(`\n🔄 Scanning... (${totalScanned} txns scanned so far)`);

        await scanProgram(PROGRAMS.PUMPFUN, "Pump.fun");
        await new Promise((r) => setTimeout(r, 1000));

        await scanProgram(PROGRAMS.RAYDIUM_V4, "Raydium V4");
        await new Promise((r) => setTimeout(r, 1000));

        await scanProgram(PROGRAMS.RAYDIUM_CPMM, "Raydium CPMM");

        console.log(`✅ Scan done | ${totalAlerts} alerts fired`);
    }, 20000);

    // SOL price refresh every 60s
    setInterval(getSolPrice, 60000);

    // Cleanup
    setInterval(() => {
        if (seenTx.size > 10000) {
            seenTx.clear();
            console.log("🧹 Cleared tx cache");
        }
        if (alerted.size > 1000) {
            alerted.clear();
            console.log("🧹 Cleared alert cache");
        }
        // Evict old whale windows
        const now = Date.now();
        for (const [mint, data] of whaleBuyers.entries()) {
            if (now - data.firstSeen > WINDOW_MS * 3) {
                whaleBuyers.delete(mint);
            }
        }
        console.log(`📊 Status: ${whaleBuyers.size} tracked | ${alerted.size} alerted | ${totalScanned} scanned`);
    }, 60000);
}