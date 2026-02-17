import { Connection, PublicKey } from "@solana/web3.js";
import { CONFIG } from "../config.js";

/**
 * ========================================
 * 👥 TOKEN HOLDER DISTRIBUTION ANALYZER
 * ========================================
 * Checks if token is fairly distributed or concentrated
 */

const connection = new Connection(CONFIG.SOLANA_RPC, "confirmed");

/**
 * Analyze token holder distribution
 * Returns risk score and holder stats
 */
export async function analyzeHolderDistribution(mint) {
    try {
        const mintPubkey = new PublicKey(mint);

        // Get largest token accounts
        const largestAccounts = await connection.getTokenLargestAccounts(mintPubkey);
        const accounts = largestAccounts.value;

        if (accounts.length === 0) {
            return {
                riskScore: 100, // Unknown = risky
                holderCount: 0,
                topHolderPercent: 0,
                top10Percent: 0,
                isRisky: true,
                reason: "No holders found",
            };
        }

        // Get total supply
        const supply = await connection.getTokenSupply(mintPubkey);
        const totalSupply = parseFloat(supply.value.amount);

        // Calculate percentages
        let top1Percent = 0;
        let top5Percent = 0;
        let top10Percent = 0;

        accounts.slice(0, 1).forEach((acc) => {
            top1Percent += (parseFloat(acc.amount) / totalSupply) * 100;
        });

        accounts.slice(0, 5).forEach((acc) => {
            top5Percent += (parseFloat(acc.amount) / totalSupply) * 100;
        });

        accounts.slice(0, 10).forEach((acc) => {
            top10Percent += (parseFloat(acc.amount) / totalSupply) * 100;
        });

        // Risk assessment
        let riskScore = 0;
        let risks = [];

        // Top holder has >50% = MEGA RUG RISK
        if (top1Percent > 50) {
            riskScore = 95;
            risks.push("Top holder owns >50% (EXTREME RUG RISK)");
        } else if (top1Percent > 30) {
            riskScore = 80;
            risks.push("Top holder owns >30% (HIGH RUG RISK)");
        } else if (top1Percent > 20) {
            riskScore = 60;
            risks.push("Top holder owns >20% (MODERATE RISK)");
        } else if (top1Percent > 10) {
            riskScore = 40;
            risks.push("Top holder owns >10%");
        } else {
            riskScore = 20;
            risks.push("Well distributed");
        }

        // Top 10 holders own >80% = centralized
        if (top10Percent > 80) {
            riskScore = Math.max(riskScore, 70);
            risks.push("Top 10 holders own >80%");
        }

        const isRisky = riskScore > 60;

        return {
            riskScore,
            holderCount: accounts.length,
            topHolderPercent: parseFloat(top1Percent.toFixed(2)),
            top5Percent: parseFloat(top5Percent.toFixed(2)),
            top10Percent: parseFloat(top10Percent.toFixed(2)),
            isRisky,
            reason: risks.join(", "),
            distribution: isRisky ? "❌ CENTRALIZED" : "✅ DISTRIBUTED",
        };
    } catch (err) {
        console.log("⚠️  Holder analysis failed:", err.message);
        return {
            riskScore: 50,
            holderCount: 0,
            topHolderPercent: 0,
            top10Percent: 0,
            isRisky: false,
            reason: "Analysis failed",
        };
    }
}

/**
 * Quick check if token is safe based on distribution
 */
export function isSafeDistribution(analysis) {
    return !analysis.isRisky && analysis.topHolderPercent < 20;
}

/**
 * Get distribution grade (A-F)
 */
export function getDistributionGrade(analysis) {
    if (analysis.topHolderPercent < 5) return "A+ (Excellent)";
    if (analysis.topHolderPercent < 10) return "A (Very Good)";
    if (analysis.topHolderPercent < 15) return "B (Good)";
    if (analysis.topHolderPercent < 20) return "C (Fair)";
    if (analysis.topHolderPercent < 30) return "D (Poor)";
    return "F (DANGER)";
}