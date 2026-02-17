import axios from "axios";
import { ethers } from "ethers";

/**
 * ========================================
 * 🔒 BASE LP LOCK VERIFIER
 * ========================================
 * Checks if liquidity is locked on Base chain
 */

const lockCache = new Map();

// Common LP lock contracts on Base
const LOCK_CONTRACTS = {
    TEAM_FINANCE: "0xC77aab3c6D7dAb46248F3CC3033C856171878BD5", // Team Finance
    UNCX: "0x231278eDd38B00B07fBd52120CEf685B9BaEBCC1", // UNCX Network
    PINK_LOCK: "0x71B5759d73262FBb223956913ecF4ecC51057641", // PinkLock
};

/**
 * Verify LP lock status for Base tokens
 */
export async function verifyBaseLPLock(tokenAddress, pairAddress) {
    try {
        // Check cache
        if (lockCache.has(tokenAddress)) {
            const cached = lockCache.get(tokenAddress);
            if (Date.now() - cached.timestamp < 600000) {
                return cached.data;
            }
        }

        // Get liquidity info from DexScreener
        const dexInfo = await getDexScreenerInfo(tokenAddress);

        if (!dexInfo) {
            return {
                isLocked: false,
                lockPercentage: 0,
                unlockDate: null,
                isSafe: false,
                reason: "No liquidity data found",
                grade: "Unknown",
            };
        }

        // Check if LP tokens are in known lock contracts
        const lockInfo = await checkLockContracts(pairAddress);

        // Calculate safety
        let safetyScore = 0;
        let reasons = [];

        if (lockInfo.isLocked) {
            safetyScore += 50;
            reasons.push(`${lockInfo.lockPercentage.toFixed(0)}% locked`);

            if (lockInfo.unlockDate) {
                const daysUntilUnlock =
                    (lockInfo.unlockDate - Date.now()) / (1000 * 60 * 60 * 24);

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

            if (lockInfo.lockPercentage >= 90) {
                safetyScore += 20;
                reasons.push("Most LP locked");
            }
        } else {
            // Check if LP is burned
            if (lockInfo.isBurned) {
                safetyScore += 80;
                reasons.push("LP BURNED (permanent)");
            } else {
                reasons.push("❌ NO LP LOCK/BURN DETECTED");
            }
        }

        // Liquidity amount matters
        if (dexInfo.liquidity >= 100000) {
            safetyScore += 10;
            reasons.push("High liquidity");
        } else if (dexInfo.liquidity < 10000) {
            reasons.push("Low liquidity");
        }

        const isSafe = safetyScore >= 60;

        const result = {
            isLocked: lockInfo.isLocked || lockInfo.isBurned,
            lockPercentage: lockInfo.lockPercentage,
            isBurned: lockInfo.isBurned,
            unlockDate: lockInfo.unlockDate,
            liquidityUsd: dexInfo.liquidity,
            isSafe,
            safetyScore,
            reason: reasons.join(", "),
            grade: getLockGrade(safetyScore),
        };

        lockCache.set(tokenAddress, {
            data: result,
            timestamp: Date.now(),
        });

        return result;
    } catch (err) {
        console.log("⚠️  Base LP lock check failed:", err.message);
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
 * Get liquidity info from DexScreener
 */
async function getDexScreenerInfo(tokenAddress) {
    try {
        const response = await axios.get(
            `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
            { timeout: 5000 }
        );

        const pairs = response.data?.pairs || [];
        if (pairs.length === 0) return null;

        const mainPair = pairs.reduce((best, current) => {
            const currentLiq = parseFloat(current.liquidity?.usd || 0);
            const bestLiq = parseFloat(best.liquidity?.usd || 0);
            return currentLiq > bestLiq ? current : best;
        });

        return {
            liquidity: parseFloat(mainPair.liquidity?.usd || 0),
            pairAddress: mainPair.pairAddress,
        };
    } catch (err) {
        return null;
    }
}

/**
 * Check known lock contracts
 */
async function checkLockContracts(pairAddress) {
    try {
        // Check if LP tokens are in burn address
        const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD";

        // For production, you'd check LP token balances at lock contracts
        // This is a simplified version

        // Default to not locked for now
        // Real implementation would query lock contracts via RPC
        return {
            isLocked: false,
            isBurned: false,
            lockPercentage: 0,
            unlockDate: null,
        };

        // Real implementation example:
        // const lpToken = new ethers.Contract(pairAddress, ERC20_ABI, provider);
        // const burnBalance = await lpToken.balanceOf(BURN_ADDRESS);
        // const totalSupply = await lpToken.totalSupply();
        // const burnedPercent = (burnBalance / totalSupply) * 100;
        // return {
        //     isBurned: burnedPercent > 90,
        //     lockPercentage: burnedPercent
        // };
    } catch (err) {
        return {
            isLocked: false,
            isBurned: false,
            lockPercentage: 0,
            unlockDate: null,
        };
    }
}

/**
 * Get lock grade
 */
function getLockGrade(score) {
    if (score >= 90) return "A+ (LP Burned/Locked)";
    if (score >= 75) return "A (Well Locked)";
    if (score >= 60) return "B (Partially Locked)";
    if (score >= 40) return "C (Some Lock)";
    if (score >= 20) return "D (Minimal Lock)";
    return "F (NO LOCK - RUG RISK)";
}

/**
 * Is LP safe?
 */
export function isBaseLPSafe(lockInfo) {
    return lockInfo.isLocked && (lockInfo.lockPercentage >= 50 || lockInfo.isBurned);
}

// Clear cache
setInterval(() => {
    if (lockCache.size > 500) {
        lockCache.clear();
        console.log("🧹 Cleared Base LP lock cache");
    }
}, 600000);