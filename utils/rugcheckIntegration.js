import axios from "axios";

/**
 * ========================================
 * ⚠️  RUGCHECK INTEGRATION
 * ========================================
 * Integrates with RugCheck.xyz API for comprehensive security analysis
 */

const rugcheckCache = new Map();

/**
 * Check token safety using RugCheck API
 * RugCheck analyzes: mutable metadata, freeze authority, LP locks, etc.
 */
export async function checkRugRisk(mint) {
    try {
        // Check cache (10 min)
        if (rugcheckCache.has(mint)) {
            const cached = rugcheckCache.get(mint);
            if (Date.now() - cached.timestamp < 600000) {
                return cached.data;
            }
        }

        // Call RugCheck API
        const response = await axios.get(
            `https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`,
            { timeout: 10000 }
        );

        const data = response.data;

        // Parse RugCheck response
        const risks = data.risks || [];
        const score = parseFloat(data.score || 0);
        const tokenMeta = data.tokenMeta || {};
        const markets = data.markets || [];

        // Calculate our safety score (0-100, higher = safer)
        let safetyScore = 100;
        let criticalRisks = [];
        let warnings = [];

        // Check for critical risks
        risks.forEach((risk) => {
            const riskLevel = risk.level || "unknown";
            const riskName = risk.name || "";
            const riskDescription = risk.description || "";

            if (riskLevel === "danger") {
                safetyScore -= 25;
                criticalRisks.push(riskName);
            } else if (riskLevel === "warning") {
                safetyScore -= 10;
                warnings.push(riskName);
            }
        });

        // Check specific red flags
        const hasFreeze = tokenMeta.freezeAuthority;
        const hasMint = tokenMeta.mintAuthority;
        const isLPBurned = markets.some((m) => m.lp?.lpLockedPct === 100);

        if (hasFreeze) {
            safetyScore -= 20;
            criticalRisks.push("Freeze Authority Active (can freeze wallets)");
        }

        if (hasMint) {
            safetyScore -= 15;
            warnings.push("Mint Authority Active (can print tokens)");
        }

        if (!isLPBurned && markets.length > 0) {
            safetyScore -= 10;
            warnings.push("LP not fully burned/locked");
        }

        safetyScore = Math.max(0, safetyScore);

        const isRuggable = safetyScore < 50;
        const isSafe = safetyScore >= 75;

        const result = {
            safetyScore,
            rugcheckScore: score,
            isRuggable,
            isSafe,
            criticalRisks,
            warnings,
            hasFreeze,
            hasMint,
            isLPBurned,
            riskCount: risks.length,
            grade: getRugcheckGrade(safetyScore),
            summary: getRiskSummary(criticalRisks, warnings),
        };

        // Cache result
        rugcheckCache.set(mint, {
            data: result,
            timestamp: Date.now(),
        });

        return result;
    } catch (err) {
        // If RugCheck API fails, return neutral result
        console.log("⚠️  RugCheck API failed:", err.message);
        return {
            safetyScore: 50,
            rugcheckScore: 0,
            isRuggable: false,
            isSafe: false,
            criticalRisks: [],
            warnings: ["Unable to verify with RugCheck"],
            hasFreeze: false,
            hasMint: false,
            isLPBurned: false,
            riskCount: 0,
            grade: "Unknown",
            summary: "Security check unavailable",
        };
    }
}

/**
 * Get safety grade
 */
function getRugcheckGrade(score) {
    if (score >= 95) return "A+ (Extremely Safe)";
    if (score >= 85) return "A (Very Safe)";
    if (score >= 75) return "B (Safe)";
    if (score >= 65) return "C (Some Risk)";
    if (score >= 50) return "D (Risky)";
    return "F (HIGH RUG RISK)";
}

/**
 * Get risk summary
 */
function getRiskSummary(criticalRisks, warnings) {
    if (criticalRisks.length > 0) {
        return `❌ CRITICAL: ${criticalRisks.join(", ")}`;
    }
    if (warnings.length > 0) {
        return `⚠️  Warnings: ${warnings.join(", ")}`;
    }
    return "✅ No major risks detected";
}

/**
 * Quick check if token is safe to trade
 */
export function isSafeToTrade(rugcheck) {
    return (
        rugcheck.isSafe &&
        !rugcheck.isRuggable &&
        rugcheck.criticalRisks.length === 0
    );
}

/**
 * Get risk emoji
 */
export function getRiskEmoji(safetyScore) {
    if (safetyScore >= 85) return "✅";
    if (safetyScore >= 75) return "🟢";
    if (safetyScore >= 60) return "🟡";
    if (safetyScore >= 40) return "🟠";
    return "🔴";
}

/**
 * Clear cache
 */
setInterval(() => {
    const now = Date.now();
    for (const [mint, cached] of rugcheckCache.entries()) {
        if (now - cached.timestamp > 1800000) {
            // 30 min
            rugcheckCache.delete(mint);
        }
    }
}, 600000);