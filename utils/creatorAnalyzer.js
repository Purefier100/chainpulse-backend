import { Connection, PublicKey } from "@solana/web3.js";
import axios from "axios";
import { CONFIG } from "../config.js";

/**
 * ========================================
 * 🔍 CREATOR WALLET HISTORY CHECKER
 * ========================================
 * Checks if creator is a serial rugger or legitimate dev
 */

const connection = new Connection(CONFIG.SOLANA_RPC, "confirmed");

// Cache creator analysis
const creatorCache = new Map();

/**
 * Get token creator from mint authority or update authority
 */
async function getTokenCreator(mint) {
    try {
        const mintPubkey = new PublicKey(mint);
        const accountInfo = await connection.getAccountInfo(mintPubkey);

        if (!accountInfo) return null;

        // Parse mint data to get mint authority
        // First 32 bytes after the initial data are the mint authority
        const data = accountInfo.data;
        if (data.length < 82) return null;

        // Check if mint authority exists (byte 0 is a flag)
        const hasMintAuthority = data[0] === 1;
        if (!hasMintAuthority) return null;

        // Extract mint authority (next 32 bytes)
        const authorityBytes = data.slice(4, 36);
        const authority = new PublicKey(authorityBytes).toString();

        return authority;
    } catch (err) {
        console.log("⚠️  Failed to get creator:", err.message);
        return null;
    }
}

/**
 * Analyze creator's wallet history
 */
export async function analyzeCreatorHistory(mint) {
    try {
        // Check cache
        if (creatorCache.has(mint)) {
            return creatorCache.get(mint);
        }

        const creator = await getTokenCreator(mint);
        if (!creator) {
            return {
                isKnownRugger: false,
                trustScore: 50,
                tokensCreated: 0,
                reason: "Creator unknown",
                grade: "Unknown",
            };
        }

        // Get creator's transaction history
        const creatorPubkey = new PublicKey(creator);
        const signatures = await connection.getSignaturesForAddress(creatorPubkey, {
            limit: 100,
        });

        // Count token mints
        let tokenMints = 0;
        let suspiciousActivity = 0;

        for (const sig of signatures.slice(0, 50)) {
            try {
                const tx = await connection.getParsedTransaction(sig.signature, {
                    maxSupportedTransactionVersion: 0,
                });

                if (!tx?.meta) continue;

                // Look for token mint instructions
                const instructions = tx.transaction.message.instructions;
                for (const ix of instructions) {
                    if (ix.program === "spl-token") {
                        const parsed = ix.parsed;
                        if (parsed?.type === "initializeMint") {
                            tokenMints++;
                        }
                    }
                }

                // Check for suspicious patterns
                // Failed transactions = possible rug attempts
                if (tx.meta.err) {
                    suspiciousActivity++;
                }

                // Add small delay to avoid rate limits
                await new Promise((r) => setTimeout(r, 200));
            } catch (err) {
                // Skip errors
            }
        }

        // Calculate trust score
        let trustScore = 100;
        let reasons = [];

        // Too many tokens created = serial launcher (possible rugger)
        if (tokenMints > 10) {
            trustScore -= 40;
            reasons.push(`Created ${tokenMints} tokens (serial launcher)`);
        } else if (tokenMints > 5) {
            trustScore -= 20;
            reasons.push(`Created ${tokenMints} tokens`);
        } else if (tokenMints === 1) {
            trustScore += 10;
            reasons.push("First-time creator");
        }

        // Suspicious activity
        if (suspiciousActivity > 10) {
            trustScore -= 30;
            reasons.push("High failed transaction rate");
        }

        // Wallet age (newer = riskier for serial launchers)
        const oldestTx = signatures[signatures.length - 1];
        if (oldestTx?.blockTime) {
            const accountAge = Date.now() / 1000 - oldestTx.blockTime;
            const daysOld = accountAge / 86400;

            if (daysOld < 7 && tokenMints > 3) {
                trustScore -= 30;
                reasons.push("New wallet launching multiple tokens quickly");
            } else if (daysOld > 180) {
                trustScore += 10;
                reasons.push("Established wallet");
            }
        }

        trustScore = Math.max(0, Math.min(100, trustScore));

        const isKnownRugger = trustScore < 40 && tokenMints > 5;

        const result = {
            creator,
            isKnownRugger,
            trustScore,
            tokensCreated: tokenMints,
            suspiciousActivity,
            reason: reasons.join(", ") || "Normal activity",
            grade: getTrustGrade(trustScore),
        };

        creatorCache.set(mint, result);
        return result;
    } catch (err) {
        console.log("⚠️  Creator analysis failed:", err.message);
        return {
            isKnownRugger: false,
            trustScore: 50,
            tokensCreated: 0,
            reason: "Analysis failed",
            grade: "Unknown",
        };
    }
}

function getTrustGrade(score) {
    if (score >= 90) return "A+ (Trusted)";
    if (score >= 80) return "A (Very Trustworthy)";
    if (score >= 70) return "B (Trustworthy)";
    if (score >= 60) return "C (Neutral)";
    if (score >= 50) return "D (Questionable)";
    return "F (HIGH RISK)";
}

/**
 * Should we trust this creator?
 */
export function isTrustedCreator(analysis) {
    return analysis.trustScore >= 60 && !analysis.isKnownRugger;
}

/**
 * Clear cache periodically
 */
setInterval(() => {
    if (creatorCache.size > 500) {
        creatorCache.clear();
        console.log("🧹 Cleared creator cache");
    }
}, 600000); // Every 10 minutes