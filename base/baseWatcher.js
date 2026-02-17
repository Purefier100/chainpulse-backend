import { ethers } from "ethers";
import axios from "axios";

import { CONFIG } from "../config.js";
import { getTokenMeta } from "./tokenCache.js";
import { PAIR_ABI } from "./pairAbi.js";
import { scoreToken } from "../utils/alphaScorer.js";
import { queueAlert } from "../utils/alertQueue.js";

// Import advanced security modules
import {
    analyzeBaseHolders,
    isSafeBaseDistribution,
    getBaseDistributionGrade,
} from "../utils/baseHolderAnalyzer.js";
import {
    checkBaseSecurity,
    isBaseSafeToTrade,
    getBaseRiskEmoji,
} from "../utils/baseSecurityChecker.js";
import {
    verifyBaseLPLock,
    isBaseLPSafe,
} from "../utils/baseLPLockVerifier.js";
import {
    trackPriceMomentum,
    isPumpingNow,
} from "../utils/momentumTracker.js";
import {
    getSocialSentiment,
    hasGoodSocials,
} from "../utils/socialSentiment.js";

/**
 * ========================================
 * 🚀 ULTIMATE BASE WHALE DETECTOR
 * ========================================
 * With comprehensive security analysis
 */

const provider = new ethers.WebSocketProvider(CONFIG.BASE_WSS);

const SWAP_TOPIC = "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";

// Filters
const MIN_BUY_USD = 1000; // Lower since we have better filtering
const MIN_WHALES = 2;
const MIN_LIQ = 50000; // Lower threshold
const MIN_MCAP = 100000; // Lower threshold

// Advanced filters
const MIN_SCORE = 60; // Alpha score
const MIN_SAFETY_SCORE = 50; // Combined safety score
const REQUIRE_SECURITY_CHECK = true; // Require security pass

const pairCache = new Map();
const alerted = new Set();
const whaleBuyers = new Map();
const WINDOW = 10 * 60 * 1000;

async function getTokenStats(token) {
    try {
        const res = await axios.get(
            `https://api.dexscreener.com/latest/dex/tokens/${token}`,
            { timeout: 5000 }
        );

        const pair = res.data.pairs?.[0];
        if (!pair) return null;

        return {
            liquidity: pair.liquidity?.usd || 0,
            marketCap: pair.fdv || 0,
            priceUsd: pair.priceUsd || 0,
            pairAddress: pair.pairAddress,
        };
    } catch {
        return null;
    }
}

/**
 * ========================================
 * 🔬 DEEP SECURITY ANALYSIS
 * ========================================
 */
async function performDeepAnalysis(tokenAddress, tokenSymbol, pairAddress) {
    console.log(`🔬 Deep analyzing ${tokenSymbol} on Base...`);

    const [holders, security, lpLock, momentum, social] = await Promise.all([
        analyzeBaseHolders(tokenAddress, provider),
        checkBaseSecurity(tokenAddress),
        verifyBaseLPLock(tokenAddress, pairAddress),
        trackPriceMomentum(tokenAddress),
        getSocialSentiment(tokenAddress, tokenSymbol),
    ]);

    console.log(`✅ Analysis complete for ${tokenSymbol}`);

    return {
        holders,
        security,
        lpLock,
        momentum,
        social,
    };
}

/**
 * Calculate combined safety score
 */
function calculateSafetyScore(analysis) {
    let totalScore = 0;

    // Holder distribution (25 points)
    totalScore += (100 - analysis.holders.riskScore) * 0.25;

    // Security check (35 points) - most important for Base
    totalScore += analysis.security.safetyScore * 0.35;

    // LP Lock (25 points)
    totalScore += analysis.lpLock.safetyScore * 0.25;

    // Social sentiment (15 points)
    totalScore += analysis.social.score * 0.15;

    return Math.round(totalScore);
}

/**
 * ========================================
 * 🐋 WHALE BUY PROCESSOR
 * ========================================
 */
async function processWhaleBuy(tokenAddress, buyerAddress, buyUsd, meta, stats) {
    try {
        if (alerted.has(tokenAddress)) return;

        // Record whale
        if (!whaleBuyers.has(tokenAddress)) {
            whaleBuyers.set(tokenAddress, {
                buyers: new Set(),
                firstSeen: Date.now(),
            });
        }

        const data = whaleBuyers.get(tokenAddress);

        if (Date.now() - data.firstSeen > WINDOW) {
            data.buyers.clear();
            data.firstSeen = Date.now();
        }

        data.buyers.add(buyerAddress);

        const whaleCount = data.buyers.size;
        if (whaleCount < MIN_WHALES) {
            console.log(
                `🐋 ${whaleCount} whale(s) on ${meta.symbol} - waiting for more...`
            );
            return;
        }

        console.log(`🔥 ${whaleCount} whales on ${meta.symbol}! Starting analysis...`);

        // Basic alpha score
        const alphaScore = scoreToken({
            whaleCount,
            liquidity: stats.liquidity,
            marketCap: stats.marketCap,
            sniperCount: 0,
        });

        if (alphaScore < MIN_SCORE) {
            console.log(`⚠️  ${meta.symbol} alpha score too low: ${alphaScore}`);
            return;
        }

        // DEEP SECURITY ANALYSIS
        const analysis = await performDeepAnalysis(
            tokenAddress,
            meta.symbol,
            stats.pairAddress
        );

        // Calculate combined safety score
        const safetyScore = calculateSafetyScore(analysis);

        console.log(`📊 ${meta.symbol} Safety Score: ${safetyScore}/100`);

        // Security checks
        if (safetyScore < MIN_SAFETY_SCORE) {
            console.log(`❌ ${meta.symbol} failed safety check (${safetyScore}/100)`);
            return;
        }

        // Critical security check
        if (REQUIRE_SECURITY_CHECK && !isBaseSafeToTrade(analysis.security)) {
            console.log(`❌ ${meta.symbol} failed security check`);
            return;
        }

        // Honeypot check (absolute blocker)
        if (analysis.security.isHoneypot) {
            console.log(`🍯 ${meta.symbol} is a HONEYPOT - blocking alert`);
            return;
        }

        // Holder distribution check
        if (!isSafeBaseDistribution(analysis.holders)) {
            console.log(`❌ ${meta.symbol} has concentrated holders`);
            return;
        }

        alerted.add(tokenAddress);

        // BUILD COMPREHENSIVE ALERT
        const alert =
            `🚨 BASE HIGH-QUALITY ALPHA DETECTED 🚨\n\n` +
            `💎 ${meta.name} ($${meta.symbol})\n` +
            `📍 ${tokenAddress}\n\n` +
            `💰 Latest Buy: $${buyUsd.toFixed(0)}\n` +
            `🐋 Whales: ${whaleCount} | 💧 Liquidity: $${stats.liquidity.toFixed(0)}\n` +
            `📈 Market Cap: $${stats.marketCap.toFixed(0)}\n\n` +
            `⭐ ALPHA SCORE: ${alphaScore}/100\n` +
            `🛡️ SAFETY SCORE: ${safetyScore}/100 ${getBaseRiskEmoji(safetyScore)}\n\n` +
            `📊 SECURITY ANALYSIS:\n` +
            `👥 Holders: ${analysis.holders.distribution} (Top: ${analysis.holders.topHolderPercent}%)\n` +
            `🍯 Honeypot: ${analysis.security.isHoneypot ? "YES ❌" : "NO ✅"}\n` +
            `💸 Buy Tax: ${analysis.security.buyTax}% | Sell Tax: ${analysis.security.sellTax}%\n` +
            `📈 Momentum: ${analysis.momentum.momentum}\n` +
            `📱 Social: ${analysis.social.grade}\n` +
            `🔒 LP Lock: ${analysis.lpLock.grade}\n\n` +
            `${analysis.security.summary}\n\n` +
            `🔗 Dex: https://dexscreener.com/base/${tokenAddress}\n` +
            `📊 Chart: https://www.dextools.io/app/base/pair-explorer/${stats.pairAddress}`;

        queueAlert(alert);

        console.log(
            `✅ BASE PREMIUM ALERT: ${meta.symbol} | Alpha: ${alphaScore} | Safety: ${safetyScore}`
        );
    } catch (err) {
        console.log(`⚠️  Base whale processing error:`, err.message);
    }
}

/**
 * ========================================
 * 🎯 MAIN WATCHER
 * ========================================
 */
export function watchBase() {
    console.log("🟦 ULTIMATE Base Whale Detector LIVE");
    console.log(
        "🔬 Advanced Analysis: Holders, Security, Honeypot, LP Lock, Momentum, Social"
    );

    provider.on({ topics: [SWAP_TOPIC] }, async (log) => {
        try {
            const pairAddr = log.address.toLowerCase();

            let token0, token1;

            if (pairCache.has(pairAddr)) {
                ({ token0, token1 } = pairCache.get(pairAddr));
            } else {
                const pair = new ethers.Contract(pairAddr, PAIR_ABI, provider);

                try {
                    token0 = await pair.token0();
                    token1 = await pair.token1();
                } catch {
                    return;
                }

                pairCache.set(pairAddr, { token0, token1 });
            }

            const iface = new ethers.Interface(PAIR_ABI);
            const decoded = iface.parseLog(log);

            const { amount0Out, amount1Out, to } = decoded.args;

            let boughtToken, raw;

            if (amount0Out > 0n) {
                boughtToken = token0;
                raw = amount0Out;
            } else {
                boughtToken = token1;
                raw = amount1Out;
            }

            if (alerted.has(boughtToken)) return;

            const stats = await getTokenStats(boughtToken);
            if (!stats) return;

            if (stats.liquidity < MIN_LIQ) return;
            if (stats.marketCap < MIN_MCAP) return;

            const meta = await getTokenMeta(provider, boughtToken);
            if (!meta?.symbol) return;

            const amount = Number(ethers.formatUnits(raw, meta.decimals));
            const buyUsd = amount * Number(stats.priceUsd);

            if (buyUsd < MIN_BUY_USD) return;

            // Process whale buy with deep analysis
            await processWhaleBuy(boughtToken, to, buyUsd, meta, stats);
        } catch (err) {
            console.log("Base detector error:", err.message);
        }
    });

    // Cleanup old whale data
    setInterval(() => {
        const now = Date.now();
        for (const [token, data] of whaleBuyers.entries()) {
            if (now - data.firstSeen > WINDOW * 2) {
                whaleBuyers.delete(token);
            }
        }

        if (alerted.size > 500) {
            alerted.clear();
            console.log("🧹 Cleared Base alert cache");
        }
    }, 300000);
}