import { ethers } from "ethers";
import axios from "axios";
import { CONFIG } from "../config.js";
import { getTokenMeta } from "./tokenCache.js";
import { PAIR_ABI } from "./pairAbi.js";
import { queueAlert } from "../utils/alertQueue.js";

/**
 * ========================================
 * 🐸 BASE MEME COIN WHALE DETECTOR
 * ========================================
 * Optimized for early meme coin detection
 */

let provider = createProvider();

function createProvider() {
    const p = new ethers.WebSocketProvider(CONFIG.BASE_WSS);
    p.on("error", (err) => {
        console.error("❌ WSS Error:", err.message);
        reconnect();
    });
    return p;
}

function reconnect() {
    console.log("🔄 Reconnecting WSS...");
    setTimeout(() => {
        provider = createProvider();
        startListening();
    }, 3000);
}

const SWAP_TOPIC = "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";

// ✅ Meme-friendly thresholds
const MIN_BUY_USD = 300;       // Catch $300+ buys
const MIN_LIQ = 5000;          // Memes start with low liq
const MAX_LIQ = 500000;        // Skip established tokens
const MIN_MCAP = 10000;        // Very early stage
const MAX_MCAP = 5000000;      // Skip if already mooned ($5M+)
const MAX_TOKEN_AGE_HOURS = 48; // Only fresh tokens

// Known Base stablecoins/wrapped tokens to ignore
const IGNORED_TOKENS = new Set([
    "0x4200000000000000000000000000000000000006", // WETH
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // USDC
    "0x50c5725949a6f0c72e6c4a641f24049a917db0cb", // DAI
    "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca", // USDbC
]);

const pairCache = new Map();
const alerted = new Set();
const whaleBuyers = new Map();
const WINDOW = 5 * 60 * 1000; // 5 min window for memes (faster)

let totalSwapsDetected = 0;
let totalAlertsTriggered = 0;

async function getTokenStats(token) {
    try {
        const res = await axios.get(
            `https://api.dexscreener.com/latest/dex/tokens/${token}`,
            { timeout: 4000 }
        );

        const pairs = res.data.pairs;
        if (!pairs?.length) return null;

        // Pick the Base pair with most liquidity
        const basePair = pairs
            .filter((p) => p.chainId === "base")
            .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];

        if (!basePair) return null;

        // Calculate token age
        const createdAt = basePair.pairCreatedAt;
        const ageHours = createdAt
            ? (Date.now() - createdAt) / (1000 * 60 * 60)
            : null;

        return {
            liquidity: basePair.liquidity?.usd || 0,
            marketCap: basePair.fdv || 0,
            priceUsd: basePair.priceUsd || 0,
            pairAddress: basePair.pairAddress,
            ageHours,
            priceChange5m: basePair.priceChange?.m5 || 0,
            priceChange1h: basePair.priceChange?.h1 || 0,
            txns5m: (basePair.txns?.m5?.buys || 0) + (basePair.txns?.m5?.sells || 0),
            volume5m: basePair.volume?.m5 || 0,
            name: basePair.baseToken?.name,
            symbol: basePair.baseToken?.symbol,
        };
    } catch {
        return null;
    }
}

async function quickHoneypotCheck(tokenAddress) {
    try {
        const res = await axios.get(
            `https://api.honeypot.is/v2/IsHoneypot?address=${tokenAddress}&chainID=8453`,
            { timeout: 3000 }
        );
        return {
            isHoneypot: res.data.honeypotResult?.isHoneypot || false,
            buyTax: res.data.simulationResult?.buyTax || 0,
            sellTax: res.data.simulationResult?.sellTax || 0,
        };
    } catch {
        // If check fails, don't block — just flag as unknown
        return { isHoneypot: false, buyTax: null, sellTax: null };
    }
}

async function processWhaleBuy(tokenAddress, buyerAddress, buyUsd, stats) {
    try {
        if (alerted.has(tokenAddress)) return;

        // Track buyers in window
        if (!whaleBuyers.has(tokenAddress)) {
            whaleBuyers.set(tokenAddress, {
                buyers: new Map(), // address -> buyUsd
                firstSeen: Date.now(),
                totalVolume: 0,
            });
        }

        const data = whaleBuyers.get(tokenAddress);

        // Reset window if expired
        if (Date.now() - data.firstSeen > WINDOW) {
            data.buyers.clear();
            data.firstSeen = Date.now();
            data.totalVolume = 0;
        }

        data.buyers.set(buyerAddress, (data.buyers.get(buyerAddress) || 0) + buyUsd);
        data.totalVolume += buyUsd;

        const whaleCount = data.buyers.size;
        const totalVolume = data.totalVolume;

        console.log(
            `🐋 ${stats.symbol} | Buy: $${buyUsd.toFixed(0)} | Whales: ${whaleCount} | Vol: $${totalVolume.toFixed(0)} | MCap: $${stats.marketCap.toFixed(0)}`
        );

        // Alert on first big buy OR after 2+ whales
        const isBigSingleBuy = buyUsd >= 2000 && whaleCount === 1;
        const isMultiWhale = whaleCount >= 2;

        if (!isBigSingleBuy && !isMultiWhale) return;

        // Quick honeypot check (non-blocking on failure)
        const honeypot = await quickHoneypotCheck(tokenAddress);

        if (honeypot.isHoneypot) {
            console.log(`🍯 HONEYPOT blocked: ${stats.symbol}`);
            return;
        }

        // Block insane taxes
        if (honeypot.buyTax > 10 || honeypot.sellTax > 10) {
            console.log(
                `❌ High tax blocked: ${stats.symbol} Buy: ${honeypot.buyTax}% Sell: ${honeypot.sellTax}%`
            );
            return;
        }

        alerted.add(tokenAddress);
        totalAlertsTriggered++;

        const triggerReason = isBigSingleBuy
            ? `🐳 BIG SINGLE BUY ($${buyUsd.toFixed(0)})`
            : `🐋 ${whaleCount} WHALES IN 5 MIN`;

        const taxLine =
            honeypot.buyTax !== null
                ? `💸 Tax: Buy ${honeypot.buyTax}% / Sell ${honeypot.sellTax}%`
                : `💸 Tax: Unverified`;

        const ageLine =
            stats.ageHours !== null
                ? `⏱️ Age: ${stats.ageHours < 1 ? `${Math.round(stats.ageHours * 60)}m` : `${stats.ageHours.toFixed(1)}h`}`
                : `⏱️ Age: Unknown`;

        const momentumLine =
            stats.priceChange5m > 0
                ? `📈 +${stats.priceChange5m}% (5m) | +${stats.priceChange1h}% (1h)`
                : `📉 ${stats.priceChange5m}% (5m) | ${stats.priceChange1h}% (1h)`;

        const alert =
            `🚨 BASE MEME ALERT 🚨\n\n` +
            `🐸 ${stats.name} ($${stats.symbol})\n` +
            `📍 ${tokenAddress}\n\n` +
            `${triggerReason}\n` +
            `💰 Latest Buy: $${buyUsd.toFixed(0)}\n` +
            `💼 Window Volume: $${totalVolume.toFixed(0)}\n\n` +
            `💧 Liquidity: $${stats.liquidity.toLocaleString()}\n` +
            `📊 Market Cap: $${stats.marketCap.toLocaleString()}\n` +
            `${ageLine}\n` +
            `${momentumLine}\n` +
            `${taxLine}\n\n` +
            `🔗 Dex: https://dexscreener.com/base/${tokenAddress}\n` +
            `📊 Chart: https://www.dextools.io/app/base/pair-explorer/${stats.pairAddress}\n` +
            `🦅 Maestro: https://t.me/MaestroSniperBot?start=${tokenAddress}`;

        queueAlert(alert);
        console.log(`✅ MEME ALERT #${totalAlertsTriggered}: ${stats.symbol} | MCap: $${stats.marketCap.toLocaleString()}`);

    } catch (err) {
        console.log(`⚠️ processWhaleBuy error:`, err.message);
    }
}

function startListening() {
    console.log("🐸 Listening for Base meme swaps...");

    provider.on({ topics: [SWAP_TOPIC] }, async (log) => {
        try {
            totalSwapsDetected++;
            if (totalSwapsDetected % 500 === 0) {
                console.log(`📡 ${totalSwapsDetected} swaps scanned | ${totalAlertsTriggered} alerts fired`);
            }

            const pairAddr = log.address.toLowerCase();

            let token0, token1;

            if (pairCache.has(pairAddr)) {
                ({ token0, token1 } = pairCache.get(pairAddr));
            } else {
                const pair = new ethers.Contract(pairAddr, PAIR_ABI, provider);
                try {
                    [token0, token1] = await Promise.all([pair.token0(), pair.token1()]);
                    token0 = token0.toLowerCase();
                    token1 = token1.toLowerCase();
                } catch {
                    return;
                }
                pairCache.set(pairAddr, { token0, token1 });
            }

            const iface = new ethers.Interface(PAIR_ABI);
            const decoded = iface.parseLog(log);
            const { amount0Out, amount1Out, to } = decoded.args;

            // Determine which token was bought
            let boughtToken;
            if (amount0Out > 0n && !IGNORED_TOKENS.has(token0)) {
                boughtToken = token0;
            } else if (amount1Out > 0n && !IGNORED_TOKENS.has(token1)) {
                boughtToken = token1;
            } else {
                return; // Buying a stable/WETH — not a meme
            }

            if (alerted.has(boughtToken)) return;

            // Fetch stats
            const stats = await getTokenStats(boughtToken);
            if (!stats) return;

            // Meme coin filters
            if (stats.liquidity < MIN_LIQ || stats.liquidity > MAX_LIQ) return;
            if (stats.marketCap < MIN_MCAP || stats.marketCap > MAX_MCAP) return;
            if (stats.ageHours !== null && stats.ageHours > MAX_TOKEN_AGE_HOURS) return;

            // Calculate buy size
            const decimals = 18; // Default, good enough for USD calc via priceUsd
            const amountOut = amount0Out > 0n ? amount0Out : amount1Out;
            const amount = Number(ethers.formatUnits(amountOut, decimals));
            const buyUsd = amount * Number(stats.priceUsd);

            if (buyUsd < MIN_BUY_USD) return;

            await processWhaleBuy(boughtToken, to.toLowerCase(), buyUsd, stats);

        } catch (err) {
            // Silent — high volume, errors expected
        }
    });
}

export function watchBase() {
    console.log("🟦 Base Meme Coin Detector LIVE");
    console.log(`💰 Min Buy: $${MIN_BUY_USD} | Liq: $${MIN_LIQ}-$${MAX_LIQ} | MCap: $${MIN_MCAP}-$${MAX_MCAP}`);

    startListening();

    // Cleanup
    setInterval(() => {
        const now = Date.now();
        for (const [token, data] of whaleBuyers.entries()) {
            if (now - data.firstSeen > WINDOW * 3) {
                whaleBuyers.delete(token);
            }
        }
        if (alerted.size > 1000) {
            alerted.clear();
            console.log("🧹 Cleared alert cache");
        }
        console.log(`📊 Status: ${whaleBuyers.size} tracked tokens | ${alerted.size} alerted`);
    }, 60000);
}