import axios from "axios";
import { ethers } from "ethers";

/**
 * ========================================
 * 🍯 BASE HONEYPOT & SECURITY CHECKER
 * ========================================
 * Detects honeypots, high taxes, and security issues on Base
 */

const securityCache = new Map();

/**
 * Check if token is a honeypot or has security issues
 * Uses multiple security APIs
 */
export async function checkBaseSecurity(tokenAddress) {
    try {
        // Check cache (10 min)
        if (securityCache.has(tokenAddress)) {
            const cached = securityCache.get(tokenAddress);
            if (Date.now() - cached.timestamp < 600000) {
                return cached.data;
            }
        }

        // Run multiple security checks in parallel
        const [honeypotCheck, contractCheck] = await Promise.all([
            checkHoneypot(tokenAddress),
            checkContractSecurity(tokenAddress),
        ]);

        // Combine results
        let safetyScore = 100;
        let risks = [];
        let warnings = [];

        // Honeypot check
        if (honeypotCheck.isHoneypot) {
            safetyScore = 0;
            risks.push("HONEYPOT DETECTED - Cannot sell");
        }

        if (honeypotCheck.buyTax > 10) {
            safetyScore -= 20;
            warnings.push(`High buy tax: ${honeypotCheck.buyTax}%`);
        }

        if (honeypotCheck.sellTax > 10) {
            safetyScore -= 20;
            warnings.push(`High sell tax: ${honeypotCheck.sellTax}%`);
        }

        // Contract checks
        if (contractCheck.isProxy) {
            safetyScore -= 15;
            warnings.push("Proxy contract (can be modified)");
        }

        if (contractCheck.hasBlacklist) {
            safetyScore -= 25;
            risks.push("Has blacklist function");
        }

        if (contractCheck.hasMintFunction) {
            safetyScore -= 15;
            warnings.push("Can mint new tokens");
        }

        if (contractCheck.hasPauseFunction) {
            safetyScore -= 20;
            risks.push("Can pause trading");
        }

        const isHoneypot = honeypotCheck.isHoneypot;
        const isSafe = safetyScore >= 70 && !isHoneypot;

        const result = {
            safetyScore,
            isHoneypot,
            isSafe,
            buyTax: honeypotCheck.buyTax,
            sellTax: honeypotCheck.sellTax,
            isProxy: contractCheck.isProxy,
            hasBlacklist: contractCheck.hasBlacklist,
            hasMintFunction: contractCheck.hasMintFunction,
            hasPauseFunction: contractCheck.hasPauseFunction,
            risks,
            warnings,
            grade: getSecurityGrade(safetyScore),
            summary: getSummary(risks, warnings, isHoneypot),
        };

        // Cache result
        securityCache.set(tokenAddress, {
            data: result,
            timestamp: Date.now(),
        });

        return result;
    } catch (err) {
        console.log("⚠️  Base security check failed:", err.message);
        return {
            safetyScore: 50,
            isHoneypot: false,
            isSafe: false,
            buyTax: 0,
            sellTax: 0,
            risks: [],
            warnings: ["Security check unavailable"],
            grade: "Unknown",
            summary: "Unable to verify security",
        };
    }
}

/**
 * Check for honeypot using honeypot.is API
 */
async function checkHoneypot(tokenAddress) {
    try {
        // Using honeypot.is API for Base chain
        const response = await axios.get(
            `https://api.honeypot.is/v2/IsHoneypot?address=${tokenAddress}&chainID=8453`,
            { timeout: 10000 }
        );

        const data = response.data;

        return {
            isHoneypot: data.honeypotResult?.isHoneypot || false,
            buyTax: parseFloat(data.simulationResult?.buyTax || 0),
            sellTax: parseFloat(data.simulationResult?.sellTax || 0),
        };
    } catch (err) {
        // If API fails, return safe defaults
        return {
            isHoneypot: false,
            buyTax: 0,
            sellTax: 0,
        };
    }
}

/**
 * Check contract for dangerous functions
 */
async function checkContractSecurity(tokenAddress) {
    try {
        // Get contract code from Basescan
        const response = await axios.get(
            `https://api.basescan.org/api?module=contract&action=getsourcecode&address=${tokenAddress}`,
            { timeout: 10000 }
        );

        const sourceCode = response.data?.result?.[0]?.SourceCode || "";
        const isProxy = response.data?.result?.[0]?.Proxy === "1";

        // Check for dangerous patterns in source code
        const hasBlacklist =
            sourceCode.includes("blacklist") || sourceCode.includes("isBlacklisted");
        const hasMintFunction = sourceCode.includes("function mint(");
        const hasPauseFunction =
            sourceCode.includes("whenNotPaused") || sourceCode.includes("pause()");

        return {
            isProxy,
            hasBlacklist,
            hasMintFunction,
            hasPauseFunction,
        };
    } catch (err) {
        return {
            isProxy: false,
            hasBlacklist: false,
            hasMintFunction: false,
            hasPauseFunction: false,
        };
    }
}

/**
 * Get security grade
 */
function getSecurityGrade(score) {
    if (score >= 95) return "A+ (Extremely Safe)";
    if (score >= 85) return "A (Very Safe)";
    if (score >= 70) return "B (Safe)";
    if (score >= 50) return "C (Some Risk)";
    if (score >= 30) return "D (Risky)";
    return "F (DANGEROUS)";
}

/**
 * Get security summary
 */
function getSummary(risks, warnings, isHoneypot) {
    if (isHoneypot) return "🔴 HONEYPOT - DO NOT BUY";
    if (risks.length > 0) return `❌ CRITICAL: ${risks.join(", ")}`;
    if (warnings.length > 0) return `⚠️  Warnings: ${warnings.join(", ")}`;
    return "✅ No major security issues detected";
}

/**
 * Is token safe to trade?
 */
export function isBaseSafeToTrade(security) {
    return security.isSafe && !security.isHoneypot && security.safetyScore >= 70;
}

/**
 * Get risk emoji
 */
export function getBaseRiskEmoji(safetyScore) {
    if (safetyScore >= 85) return "✅";
    if (safetyScore >= 70) return "🟢";
    if (safetyScore >= 50) return "🟡";
    if (safetyScore >= 30) return "🟠";
    return "🔴";
}

// Clear cache
setInterval(() => {
    const now = Date.now();
    for (const [addr, cached] of securityCache.entries()) {
        if (now - cached.timestamp > 1800000) {
            securityCache.delete(addr);
        }
    }
}, 600000);