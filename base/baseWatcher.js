import { ethers } from "ethers";
import axios from "axios";
import { CONFIG } from "../config.js";
import { PAIR_ABI } from "./pairAbi.js";
import { queueAlert } from "../utils/alertQueue.js";


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

const MIN_BUY_USD = 300;
const MIN_LIQ = 5000;
const MAX_LIQ = 500000;
const MIN_MCAP = 10000;
const MAX_MCAP = 5000000;
const MAX_TOKEN_AGE_HOURS = 48;

// WETH and stables — these are the INPUT tokens (what people spend)
const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const DAI = "0x50c5725949a6f0c72e6c4a641f24049a917db0cb";
const USDbC = "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca";

const BASE_TOKENS = new Set([WETH, USDC, DAI, USDbC]);

// ETH price cache (for WETH→USD conversion)
let ethPrice = 3000;
let lastEthUpdate = 0;

async function getEthPrice() {
    if (Date.now() - lastEthUpdate < 60000 && ethPrice > 0) return ethPrice;
    try {
        const res = await axios.get(
            "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
            { timeout: 4000 }
        );
        ethPrice = res.data.ethereum.usd;
        lastEthUpdate = Date.now();
        console.log(`💰 ETH: $${ethPrice}`);
    } catch {
        console.log("⚠️  Using cached ETH price");
    }
    return ethPrice;
}

const pairCache = new Map(); // pairAddr -> { token0, token1 }
const alerted = new Set();
const whaleBuyers = new Map();
const WINDOW = 5 * 60 * 1000;

let totalSwapsDetected = 0;
let totalAlertsTriggered = 0;

// ========================================
// 📊 TOKEN STATS
// ========================================
async function getTokenStats(token) {
    try {
        const res = await axios.get(
            `https://api.dexscreener.com/latest/dex/tokens/${token}`,
            { timeout: 4000 }
        );

        const pairs = res.data.pairs;
        if (!pairs?.length) return null;

        const basePair = pairs
            .filter((p) => p.chainId === "base")
            .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];

        if (!basePair) return null;

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
            buys5m: basePair.txns?.m5?.buys || 0,
            sells5m: basePair.txns?.m5?.sells || 0,
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
        return { isHoneypot: false, buyTax: null, sellTax: null };
    }
}


async function processWhaleBuy(tokenAddress, buyerAddress, buyUsd, stats) {
    try {
        if (alerted.has(tokenAddress)) return;

        if (!whaleBuyers.has(tokenAddress)) {
            whaleBuyers.set(tokenAddress, {
                buyers: new Map(),
                firstSeen: Date.now(),
                totalVolume: 0,
            });
        }

        const data = whaleBuyers.get(tokenAddress);

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

        const isBigSingleBuy = buyUsd >= 2000 && whaleCount === 1;
        const isMultiWhale = whaleCount >= 2;

        if (!isBigSingleBuy && !isMultiWhale) return;

        const honeypot = await quickHoneypotCheck(tokenAddress);

        if (honeypot.isHoneypot) {
            console.log(`🍯 HONEYPOT blocked: ${stats.symbol}`);
            return;
        }

        if (honeypot.buyTax > 10 || honeypot.sellTax > 10) {
            console.log(`❌ High tax: ${stats.symbol} Buy:${honeypot.buyTax}% Sell:${honeypot.sellTax}%`);
            return;
        }

        alerted.add(tokenAddress);
        totalAlertsTriggered++;

        const triggerReason = isBigSingleBuy
            ? `🐳 BIG SINGLE BUY ($${buyUsd.toFixed(0)})`
            : `🐋 ${whaleCount} WHALES IN 5 MIN`;

        const taxLine = honeypot.buyTax !== null
            ? `💸 Tax: Buy ${honeypot.buyTax}% / Sell ${honeypot.sellTax}%`
            : `💸 Tax: Unverified`;

        const ageLine = stats.ageHours !== null
            ? `⏱️ Age: ${stats.ageHours < 1 ? `${Math.round(stats.ageHours * 60)}m` : `${stats.ageHours.toFixed(1)}h`}`
            : `⏱️ Age: Unknown`;

        const momentumLine = stats.priceChange5m >= 0
            ? `📈 +${stats.priceChange5m}% (5m) | +${stats.priceChange1h}% (1h)`
            : `📉 ${stats.priceChange5m}% (5m) | ${stats.priceChange1h}% (1h)`;

        const buyPressure = stats.buys5m + stats.sells5m > 0
            ? `🟢 ${stats.buys5m}B / 🔴 ${stats.sells5m}S (5m)\n`
            : "";

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
            `${buyPressure}` +
            `${taxLine}\n\n` +
            `🔗 Dex: https://dexscreener.com/base/${tokenAddress}\n` +
            `📊 Chart: https://www.dextools.io/app/base/pair-explorer/${stats.pairAddress}\n` +
            `🦎 BaseScan: https://basescan.org/token/${tokenAddress}`;

        queueAlert(alert);
        console.log(`✅ BASE ALERT #${totalAlertsTriggered}: ${stats.symbol} | MCap: $${stats.marketCap.toLocaleString()}`);

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
                console.log(`📡 ${totalSwapsDetected} swaps | ${totalAlertsTriggered} alerts`);
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
            const { amount0In, amount1In, amount0Out, amount1Out, to } = decoded.args;


            let boughtToken = null;
            let buyUsd = 0;

            const eth = await getEthPrice();

            if (BASE_TOKENS.has(token0) && amount1Out > 0n) {
                // Buyer spent token0 (WETH/stable), received token1 (meme)
                boughtToken = token1;
                if (token0 === WETH) {
                    buyUsd = Number(ethers.formatEther(amount0In)) * eth;
                } else {
                    // USDC/DAI are 6 decimals
                    buyUsd = Number(ethers.formatUnits(amount0In, 6));
                }
            } else if (BASE_TOKENS.has(token1) && amount0Out > 0n) {
                // Buyer spent token1 (WETH/stable), received token0 (meme)
                boughtToken = token0;
                if (token1 === WETH) {
                    buyUsd = Number(ethers.formatEther(amount1In)) * eth;
                } else {
                    buyUsd = Number(ethers.formatUnits(amount1In, 6));
                }
            } else {
                return; // Token-to-token swap, not a meme buy
            }

            if (!boughtToken || buyUsd < MIN_BUY_USD) return;
            if (alerted.has(boughtToken)) return;

            // Fetch stats and apply meme filters
            const stats = await getTokenStats(boughtToken);
            if (!stats) return;

            if (stats.liquidity < MIN_LIQ || stats.liquidity > MAX_LIQ) return;
            if (stats.marketCap < MIN_MCAP || stats.marketCap > MAX_MCAP) return;
            if (stats.ageHours !== null && stats.ageHours > MAX_TOKEN_AGE_HOURS) return;

            await processWhaleBuy(boughtToken, to.toLowerCase(), buyUsd, stats);

        } catch {
            // Silent — high volume
        }
    });
}


export function watchBase() {
    console.log("🟦 Base Meme Detector LIVE (Fixed)");
    console.log(`💰 Min Buy: $${MIN_BUY_USD} | Liq: $${MIN_LIQ}-$${MAX_LIQ} | MCap: $${MIN_MCAP}-$${MAX_MCAP}`);
    console.log("🔧 Fix: buyUsd now reads ETH/USDC input side of swap");

    getEthPrice();
    startListening();

    setInterval(() => {
        const now = Date.now();
        for (const [token, data] of whaleBuyers.entries()) {
            if (now - data.firstSeen > WINDOW * 3) whaleBuyers.delete(token);
        }
        if (alerted.size > 1000) { alerted.clear(); console.log("🧹 Cleared alert cache"); }
        if (pairCache.size > 5000) pairCache.clear();
        console.log(`📊 Status: ${whaleBuyers.size} tracked | ${alerted.size} alerted | ${totalSwapsDetected} swaps`);
    }, 60000);
}