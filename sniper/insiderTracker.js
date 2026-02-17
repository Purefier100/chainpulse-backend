/**
 * Insider Wallet Tracker
 *
 * Detect wallets that repeatedly enter trending memes early.
 */

const insiderWallets = new Map();

/**
 * Track insider activity
 */
export async function trackInsider(wallet, mint) {
    if (!wallet || !mint) return;

    if (!insiderWallets.has(wallet)) {
        insiderWallets.set(wallet, {
            tokens: new Set(),
            score: 0,
            firstSeen: Date.now(),
        });
    }

    const data = insiderWallets.get(wallet);

    // If wallet enters new token
    if (!data.tokens.has(mint)) {
        data.tokens.add(mint);
        data.score += 1;
    }

    // Auto-clean after 24h
    if (Date.now() - data.firstSeen > 24 * 60 * 60 * 1000) {
        insiderWallets.delete(wallet);
    }
}

/**
 * Return top insider wallets
 */
export function getTopInsiders(limit = 5) {
    return [...insiderWallets.entries()]
        .map(([wallet, data]) => ({
            wallet,
            score: data.score,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}
