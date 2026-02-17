/**
 * ========================================
 * ⭐ ENHANCED ALPHA SCORING SYSTEM
 * ========================================
 * Multi-factor scoring for token quality
 */

/**
 * Calculate Alpha Score (0-100)
 */
export function scoreToken(data) {
    const { whaleCount, liquidity, marketCap, sniperCount } = data;

    let score = 0;

    // ============ WHALE COUNT (35 points) ============
    if (whaleCount >= 10) {
        score += 35;
    } else if (whaleCount >= 5) {
        score += 28;
    } else if (whaleCount >= 3) {
        score += 20;
    } else if (whaleCount >= 2) {
        score += 12;
    } else {
        score += 5;
    }

    // ============ LIQUIDITY (30 points) ============
    if (liquidity >= 100000) {
        score += 30; // $100k+ liquidity = very safe
    } else if (liquidity >= 50000) {
        score += 25; // $50k+
    } else if (liquidity >= 25000) {
        score += 20; // $25k+
    } else if (liquidity >= 10000) {
        score += 15; // $10k+
    } else if (liquidity >= 5000) {
        score += 10; // $5k+ = risky but tradeable
    } else {
        score += 3; // Below $5k = very risky
    }

    // ============ MARKET CAP (20 points) ============
    if (marketCap >= 1000000) {
        score += 20; // $1M+ = established
    } else if (marketCap >= 500000) {
        score += 17; // $500k+
    } else if (marketCap >= 100000) {
        score += 14; // $100k+
    } else if (marketCap >= 50000) {
        score += 10; // $50k+ = early but has traction
    } else if (marketCap >= 10000) {
        score += 5; // $10k+ = very early
    } else {
        score += 2; // Sub $10k = ultra risky
    }

    // ============ SNIPER PENALTY (15 points) ============
    // Fewer snipers = better (means not heavily botted)
    if (sniperCount === 0) {
        score += 15; // Clean launch
    } else if (sniperCount <= 2) {
        score += 12; // Minimal sniping
    } else if (sniperCount <= 5) {
        score += 8; // Moderate sniping
    } else if (sniperCount <= 10) {
        score += 4; // Heavy sniping
    } else {
        score += 0; // Heavily botted
    }

    // ============ BONUS FACTORS ============
    // Rapid whale accumulation bonus
    if (whaleCount >= 5 && liquidity >= 25000) {
        score += 5; // Strong combo
    }

    // Early gem bonus (low mcap + multiple whales)
    if (whaleCount >= 3 && marketCap < 100000 && marketCap > 10000) {
        score += 5; // Early alpha with validation
    }

    // Cap at 100
    return Math.min(score, 100);
}

/**
 * Get risk level description
 */
export function getRiskLevel(score) {
    if (score >= 90) return "🟢 VERY LOW RISK";
    if (score >= 80) return "🟢 LOW RISK";
    if (score >= 70) return "🟡 MEDIUM RISK";
    if (score >= 60) return "🟠 ELEVATED RISK";
    if (score >= 50) return "🔴 HIGH RISK";
    return "🔴 EXTREME RISK";
}

/**
 * Should we alert this token?
 */
export function shouldAlert(score, minScore = 75) {
    return score >= minScore;
}