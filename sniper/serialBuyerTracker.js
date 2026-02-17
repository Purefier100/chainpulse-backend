import { sendAlert } from "../services/telegram.js";

/**
 * Wallet → tokens bought
 */
const walletTokens = new Map();

/**
 * Prevent spam alerts
 */
const alertedWallets = new Set();

/**
 * Detect wallets buying many trending memes
 */
export async function trackSerialBuyer(wallet, tokenMint) {
    if (!wallet || !tokenMint) return;

    if (!walletTokens.has(wallet)) {
        walletTokens.set(wallet, new Set());
    }

    walletTokens.get(wallet).add(tokenMint);

    const count = walletTokens.get(wallet).size;

    // Alert once when wallet hits 3 trending tokens
    if (count >= 3 && !alertedWallets.has(wallet)) {
        alertedWallets.add(wallet);

        await sendAlert(
            `🎯 SERIAL SNIPER WALLET DETECTED\n\n` +
            `Wallet: ${wallet}\n` +
            `Trending Meme Buys: ${count}\n\n` +
            `This wallet is early-buying multiple hot launches 👀`
        );
    }
}
