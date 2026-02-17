import { Connection, PublicKey } from "@solana/web3.js";
import axios from "axios";

import { CONFIG } from "../config.js";
import { queueAlert } from "../utils/alertQueue.js";
import { recordWhale } from "../utils/whaleCluster.js";
import { scoreToken } from "../utils/alphaScorer.js";

// Import all advanced analysis modules
import { analyzeHolderDistribution, isSafeDistribution } from "../utils/holderAnalyzer.js";
import { analyzeCreatorHistory, isTrustedCreator } from "../utils/creatorAnalyzer.js";
import { trackPriceMomentum, isPumpingNow } from "../utils/momentumTracker.js";
import { getSocialSentiment, hasGoodSocials } from "../utils/socialSentiment.js";
import { verifyLPLock, isLPSafe } from "../utils/lpLockVerifier.js";
import { checkRugRisk, isSafeToTrade, getRiskEmoji } from "../utils/rugcheckIntegration.js";

/**
 * ========================================
 * 🚀 ULTIMATE MULTI-DEX DETECTOR
 * ========================================
 * With ALL advanced security features
 */

const connection = new Connection(CONFIG.SOLANA_RPC, "confirmed");

const PROGRAMS = {
    PUMPFUN: new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"),
    RAYDIUM_V4: new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"),
    JUPITER_V6: new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"),
};

// Filters
const MIN_BUY_USD = 300;
const MIN_SCORE = 60; // Lower threshold since we have more filters
const MIN_WHALES = 2;
const MAX_AGE_MS = 60000;

// Advanced filtering
const MIN_SAFETY_SCORE = 60; // Minimum combined safety score
const REQUIRE_RUGCHECK = true; // Set to false to disable RugCheck requirement

// Rate limiting
let lastRpcCall = 0;
const RPC_DELAY = 1000;

async function rateLimitedCall(fn) {
    const now = Date.now();
    const timeSinceLastCall = now - lastRpcCall;
    if (timeSinceLastCall < RPC_DELAY) {
        await new Promise((r) => setTimeout(r, RPC_DELAY - timeSinceLastCall));
    }
    lastRpcCall = Date.now();
    return await fn();
}

// Cache
const alerted = new Set();
const seenTx = new Set();
const tokenData = new Map();

// SOL Price
let solPrice = 140;
let lastSolUpdate = 0;

async function getSolPrice() {
    if (Date.now() - lastSolUpdate < 300000 && solPrice > 0) {
        return solPrice;
    }
    try {
        const res = await axios.get(
            "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
            { timeout: 5000 }
        );
        solPrice = res.data.solana.usd;
        lastSolUpdate = Date.now();
        console.log(`💰 SOL Price: $${solPrice}`);
    } catch (err) {
        console.log("⚠️  Using cached SOL price");
    }
    return solPrice;
}

async function getTokenMetadata(mint) {
    if (tokenData.has(mint)) return tokenData.get(mint);
    try {
        const response = await rateLimitedCall(() =>
            axios.post(
                CONFIG.SOLANA_RPC,
                {
                    jsonrpc: "2.0",
                    id: "meta",
                    method: "getAsset",
                    params: { id: mint },
                },
                { timeout: 5000 }
            )
        );
        const metadata = {
            name: response.data?.result?.content?.metadata?.name || "Unknown",
            symbol: response.data?.result?.content?.metadata?.symbol || "???",
        };
        tokenData.set(mint, metadata);
        return metadata;
    } catch (err) {
        return { name: "Unknown", symbol: "???" };
    }
}

async function getTokenLiquidity(mint) {
    try {
        const response = await axios.get(
            `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
            { timeout: 5000 }
        );
        const pairs = response.data?.pairs || [];
        if (pairs.length === 0) return 0;
        return pairs.reduce((sum, pair) => sum + (parseFloat(pair.liquidity?.usd) || 0), 0);
    } catch (err) {
        return 0;
    }
}

async function parseSwapTransaction(signature, programId) {
    try {
        if (seenTx.has(signature)) return null;
        seenTx.add(signature);

        const tx = await rateLimitedCall(() =>
            connection.getParsedTransaction(signature, {
                maxSupportedTransactionVersion: 0,
                commitment: "confirmed",
            })
        );

        if (!tx || !tx.meta || tx.meta.err) return null;

        const blockTime = tx.blockTime;
        if (blockTime && Date.now() - blockTime * 1000 > MAX_AGE_MS) return null;

        const buyer = tx.transaction.message.accountKeys[0].pubkey.toString();
        const preBalance = tx.meta.preBalances[0] || 0;
        const postBalance = tx.meta.postBalances[0] || 0;
        const solSpent = (preBalance - postBalance) / 1e9;

        if (solSpent <= 0) return null;

        const price = await getSolPrice();
        const buyUsd = solSpent * price;
        if (buyUsd < MIN_BUY_USD) return null;

        const tokenBalances = tx.meta.postTokenBalances || [];
        let mint = null;

        for (const balance of tokenBalances) {
            if (balance.owner === buyer && balance.uiTokenAmount.uiAmount > 0) {
                mint = balance.mint;
                break;
            }
        }

        if (!mint) return null;

        return {
            mint,
            buyer,
            buyUsd,
            solSpent,
            signature,
            dex: getDexName(programId),
        };
    } catch (err) {
        return null;
    }
}

function getDexName(programId) {
    const id = programId.toString();
    if (id === PROGRAMS.PUMPFUN.toString()) return "Pump.fun";
    if (id === PROGRAMS.RAYDIUM_V4.toString()) return "Raydium";
    if (id === PROGRAMS.JUPITER_V6.toString()) return "Jupiter";
    return "Unknown";
}

/**
 * ========================================
 * 🔬 DEEP ANALYSIS FUNCTION
 * ========================================
 * Runs ALL security checks before alerting
 */
async function performDeepAnalysis(mint, metadata) {
    console.log(`🔬 Deep analyzing ${metadata.symbol}...`);

    // Run all checks in parallel for speed
    const [holders, creator, momentum, social, lpLock, rugcheck] = await Promise.all([
        analyzeHolderDistribution(mint),
        analyzeCreatorHistory(mint),
        trackPriceMomentum(mint),
        getSocialSentiment(mint, metadata.symbol),
        verifyLPLock(mint),
        checkRugRisk(mint),
    ]);

    console.log(`✅ Analysis complete for ${metadata.symbol}`);

    return {
        holders,
        creator,
        momentum,
        social,
        lpLock,
        rugcheck,
    };
}

/**
 * Calculate combined safety score
 */
function calculateSafetyScore(analysis) {
    let totalScore = 0;
    let maxScore = 0;

    // Holder distribution (20 points)
    maxScore += 20;
    totalScore += (100 - analysis.holders.riskScore) * 0.2;

    // Creator trust (20 points)
    maxScore += 20;
    totalScore += analysis.creator.trustScore * 0.2;

    // Social sentiment (15 points)
    maxScore += 15;
    totalScore += analysis.social.score * 0.15;

    // LP Lock (20 points)
    maxScore += 20;
    totalScore += analysis.lpLock.safetyScore * 0.2;

    // RugCheck (25 points) - most important
    maxScore += 25;
    totalScore += analysis.rugcheck.safetyScore * 0.25;

    return Math.round(totalScore);
}

async function processWhaleBuy(data) {
    const { mint, buyer, buyUsd, dex } = data;

    if (alerted.has(mint)) return;

    const whaleCount = recordWhale(mint, buyer);
    if (whaleCount < MIN_WHALES) {
        console.log(`🐋 ${whaleCount} whale(s) on ${mint.slice(0, 8)}...`);
        return;
    }

    console.log(`🔥 ${whaleCount} whales on ${mint.slice(0, 8)}! Starting analysis...`);

    const metadata = await getTokenMetadata(mint);
    const liquidity = await getTokenLiquidity(mint);

    // Basic alpha score
    const alphaScore = scoreToken({
        whaleCount,
        liquidity,
        marketCap: liquidity * 2,
        sniperCount: 0,
    });

    if (alphaScore < MIN_SCORE) {
        console.log(`⚠️  ${metadata.symbol} alpha score too low: ${alphaScore}`);
        return;
    }

    // DEEP ANALYSIS with all security checks
    const analysis = await performDeepAnalysis(mint, metadata);

    // Calculate combined safety score
    const safetyScore = calculateSafetyScore(analysis);

    console.log(`📊 ${metadata.symbol} Safety Score: ${safetyScore}/100`);

    // Check if token passes all filters
    if (safetyScore < MIN_SAFETY_SCORE) {
        console.log(`❌ ${metadata.symbol} failed safety check (${safetyScore}/100)`);
        return;
    }

    // RugCheck critical check
    if (REQUIRE_RUGCHECK && !isSafeToTrade(analysis.rugcheck)) {
        console.log(`❌ ${metadata.symbol} failed RugCheck`);
        return;
    }

    // Additional filters
    if (!isSafeDistribution(analysis.holders)) {
        console.log(`❌ ${metadata.symbol} has concentrated holders`);
        return;
    }

    alerted.add(mint);

    // BUILD COMPREHENSIVE ALERT
    const alert =
        `🚨 HIGH-QUALITY ALPHA DETECTED 🚨\n\n` +
        `💎 ${metadata.name} ($${metadata.symbol})\n` +
        `📍 ${mint}\n\n` +
        `💰 Latest Buy: $${buyUsd.toFixed(0)} | 🟢 ${dex}\n` +
        `🐋 Whales: ${whaleCount} | 💧 Liquidity: $${liquidity.toFixed(0)}\n\n` +
        `⭐ ALPHA SCORE: ${alphaScore}/100\n` +
        `🛡️ SAFETY SCORE: ${safetyScore}/100 ${getRiskEmoji(safetyScore)}\n\n` +
        `📊 ANALYSIS:\n` +
        `👥 Holders: ${analysis.holders.distribution} (Top: ${analysis.holders.topHolderPercent}%)\n` +
        `🏗️ Creator: ${analysis.creator.grade} (${analysis.creator.tokensCreated} tokens)\n` +
        `📈 Momentum: ${analysis.momentum.momentum}\n` +
        `📱 Social: ${analysis.social.grade}\n` +
        `🔒 LP Lock: ${analysis.lpLock.grade}\n` +
        `⚠️ RugCheck: ${analysis.rugcheck.grade}\n\n` +
        `${analysis.rugcheck.summary}\n\n` +
        `🔗 Dex: https://dexscreener.com/solana/${mint}\n` +
        `📊 Birdeye: https://birdeye.so/token/${mint}\n` +
        `⚠️ RugCheck: https://rugcheck.xyz/tokens/${mint}`;

    queueAlert(alert);

    console.log(`✅ PREMIUM ALERT: ${metadata.symbol} | Alpha: ${alphaScore} | Safety: ${safetyScore}`);
}

async function scanProgram(programId) {
    try {
        const signatures = await rateLimitedCall(() =>
            connection.getSignaturesForAddress(programId, { limit: 5 })
        );

        for (const sig of signatures) {
            const data = await parseSwapTransaction(sig.signature, programId);
            if (data) {
                await processWhaleBuy(data);
            }
            await new Promise((r) => setTimeout(r, 500));
        }
    } catch (err) {
        console.log(`⚠️  Error scanning ${getDexName(programId)}`);
    }
}

export function watchSolanaMomentum() {
    console.log("🚀 ULTIMATE Multi-DEX Detector LIVE");
    console.log("📡 Monitoring: Pump.fun, Raydium, Jupiter");
    console.log("🔬 Advanced Analysis: Holders, Creator, Momentum, Social, LP Lock, RugCheck");
    console.log("⏱️  Polling every 60s");

    getSolPrice();

    setInterval(async () => {
        console.log("🔄 Scanning with deep analysis...");

        await scanProgram(PROGRAMS.PUMPFUN);
        await new Promise((r) => setTimeout(r, 2000));

        await scanProgram(PROGRAMS.RAYDIUM_V4);
        await new Promise((r) => setTimeout(r, 2000));

        await scanProgram(PROGRAMS.JUPITER_V6);

        console.log("✅ Scan complete");
    }, 60000);

    setInterval(() => {
        if (seenTx.size > 5000) seenTx.clear();
        if (alerted.size > 500) alerted.clear();
    }, 300000);
}