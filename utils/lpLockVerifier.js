import { Connection, PublicKey } from "@solana/web3.js";
import axios from "axios";
import { CONFIG } from "../config.js";

/**
 * ========================================
 * 🔒 LIQUIDITY POOL LOCK VERIFIER
 * ========================================
 * Checks if LP tokens are locked (prevents rug pulls)
 */

const connection = new Connection(CONFIG.SOLANA_RPC, "confirmed");
const lockCache = new Map();

/**
 * Check if liquidity is locked
 */
export async function verifyLPLock(mint) {
    try {
        // Check cache
        if (lockCache.has(mint)) {
            return lockCache.get(mint);
        }

        // Get liquidity info from DexScreener
        const response = await axios.get(
            `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
            { timeout: 5000 }
        );

        const pairs = response.data?.pairs || [];
        if (pairs.length === 0) {
            return {
                isLocked: false,
                lockPercentage: 0,
                unlockDate: null,
                isSafe: false,
                reason: "No liquidity pools found",
                grade: "F",
            };
        }

        // Get the main pair (highest liquidity)
        const mainPair = pairs.reduce((best, current) => {
            const currentLiq = parseFloat(current.liquidity?.usd || 0);
            const bestLiq = parseFloat(best.liquidity?.usd || 0);
            return currentLiq > bestLiq ? current : best;
        });

        // Check for lock info in pair data
        const liquidity = parseFloat(mainPair.liquidity?.usd || 0);
        const pairAddress = mainPair.pairAddress;

        // Try to get LP token info
        const lpLockInfo = await checkLPTokenLock(pairAddress);

        // Calculate safety score
        let safetyScore = 0;
        let reasons = [];

        if (lpLockInfo.isLocked) {
            safetyScore += 50;
            reasons.push(`${lpLockInfo.lockPercentage}% locked`);

            if (lpLockInfo.unlockDate) {
                const daysUntilUnlock =
                    (lpLockInfo.unlockDate - Date.now()) / (1000 * 60 * 60 * 24);

                if (daysUntilUnlock > 365) {
                    safetyScore += 30;
                    reasons.push("Locked 1+ year");
                } else if (daysUntilUnlock > 180) {
                    safetyScore += 20;
                    reasons.push("Locked 6+ months");
                } else if (daysUntilUnlock > 30) {
                    safetyScore += 10;
                    reasons.push("Locked 1+ month");
                } else {
                    reasons.push("Short lock period");
                }
            }

            if (lpLockInfo.lockPercentage >= 90) {
                safetyScore += 20;
                reasons.push("Most LP locked");
            }
        } else {
            reasons.push("❌ NO LP LOCK DETECTED");
        }

        // Liquidity amount matters
        if (liquidity >= 50000) {
            safetyScore += 10;
            reasons.push("High liquidity");
        } else if (liquidity < 10000) {
            reasons.push("Low liquidity");
        }

        const isSafe = safetyScore >= 60;

        const result = {
            isLocked: lpLockInfo.isLocked,
            lockPercentage: lpLockInfo.lockPercentage,
            unlockDate: lpLockInfo.unlockDate,
            liquidityUsd: liquidity,
            isSafe,
            safetyScore,
            reason: reasons.join(", "),
            grade: getLockGrade(safetyScore),
        };

        lockCache.set(mint, result);
        return result;
    } catch (err) {
        console.log("⚠️  LP lock check failed:", err.message);
        return {
            isLocked: false,
            lockPercentage: 0,
            unlockDate: null,
            isSafe: false,
            reason: "Unable to verify",
            grade: "Unknown",
        };
    }
}

/**
 * Check if LP tokens are locked
 * This checks common lock programs on Solana
 */
async function checkLPTokenLock(pairAddress) {
    try {
        // Common Solana LP lock programs
        const LOCK_PROGRAMS = [
            "11111111111111111111111111111111", // System program (burn address)
            "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // Token program
            // Add known lock program addresses
        ];

        const pairPubkey = new PublicKey(pairAddress);

        // Get LP token accounts
        const tokenAccounts = await connection.getTokenAccountsByOwner(pairPubkey, {
            programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        });

        let totalSupply = 0;
        let lockedAmount = 0;

        // This is a simplified check
        // In production, you'd check specific lock programs
        // For now, assume not locked unless proven otherwise

        return {
            isLocked: false,
            lockPercentage: 0,
            unlockDate: null,
        };

        // Real implementation would:
        // 1. Get LP token mint
        // 2. Find all LP token holders
        // 3. Check if any are lock programs
        // 4. Check lock expiration dates
        // 5. Calculate locked percentage
    } catch (err) {
        return {
            isLocked: false,
            lockPercentage: 0,
            unlockDate: null,
        };
    }
}

/**
 * Get lock safety grade
 */
function getLockGrade(score) {
    if (score >= 90) return "A+ (Fully Locked)";
    if (score >= 75) return "A (Well Locked)";
    if (score >= 60) return "B (Partially Locked)";
    if (score >= 40) return "C (Some Lock)";
    if (score >= 20) return "D (Minimal Lock)";
    return "F (NO LOCK - RUG RISK)";
}

/**
 * Is LP safely locked?
 */
export function isLPSafe(lockInfo) {
    return lockInfo.isLocked && lockInfo.lockPercentage >= 50;
}

/**
 * Clear cache
 */
setInterval(() => {
    if (lockCache.size > 500) {
        lockCache.clear();
        console.log("🧹 Cleared LP lock cache");
    }
}, 600000);