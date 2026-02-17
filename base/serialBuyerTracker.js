import { sendAlert } from "../services/telegram.js";

/**
 * Wallet → tokens bought recently
 */
const walletBuys = new Map();

/**
 * Prevent spam alerts
 */
const alertedWallets = new Set();

/**
 * Track wallets buying multiple memes
 */
export async function trackSerialBuyer(wallet, token) {
    if (!wallet || !token) return;

    if (!walletBuys.has(wallet)) {
        walletBuys.set(wallet, new Set());
    }

    const tokens = walletBuys.get(wallet);
    tokens.add(token);

    // If wallet bought 3+ different tokens → insider/sniper behavior
    if (tokens.size >= 3 && !alertedWallets.has(wallet)) {
        alertedWallets.add(wallet);

        await sendAlert(
            `🚨 SERIAL MEME BUYER DETECTED\n\n` +
            `Wallet: ${wallet}\n` +
            `Bought ${tokens.size} trending tokens recently\n\n` +
            `Possible insider/sniper activity 👀`
        );
    }
}
