import { ethers } from "ethers";
import { CONFIG } from "../config.js";
import { sendAlert } from "../services/telegram.js";
import { getTokenMeta } from "./tokenCache.js";

const provider = new ethers.JsonRpcProvider(CONFIG.BASE_RPC);

/**
 * Aerodrome Factory (Base)
 */
const FACTORIES = [
    {
        name: "Aerodrome",
        address: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
    },
];

/**
 * PairCreated event ABI
 */
const FACTORY_ABI = [
    "event PairCreated(address indexed token0,address indexed token1,address pair,uint)",
];

/**
 * Ignore stablecoins + WETH pairs
 */
const IGNORE = new Set([
    // WETH
    "0x4200000000000000000000000000000000000006",

    // USDC (Base)
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
]);

/**
 * Prevent spam: alert once per pair
 */
const seenPairs = new Set();

/**
 * Track token first seen time
 */
const tokenFirstSeen = new Map();

export function watchNewPools() {
    console.log("🧪 Base Liquidity Watcher LIVE (Meme Launch Mode)");

    for (const factoryInfo of FACTORIES) {
        const factory = new ethers.Contract(
            factoryInfo.address,
            FACTORY_ABI,
            provider
        );

        factory.on("PairCreated", async (token0, token1, pair) => {
            try {
                token0 = token0.toLowerCase();
                token1 = token1.toLowerCase();
                pair = pair.toLowerCase();

                // Prevent duplicate alerts
                if (seenPairs.has(pair)) return;
                seenPairs.add(pair);

                // Ignore stablecoin/WETH pools
                if (IGNORE.has(token0) || IGNORE.has(token1)) return;

                // Metadata
                const meta0 = await getTokenMeta(provider, token0);
                const meta1 = await getTokenMeta(provider, token1);

                if (!meta0?.symbol || !meta1?.symbol) return;

                // Decide meme token (not WETH)
                const meme =
                    meta0.symbol === "WETH" ? meta1 : meta0;

                const memeToken =
                    meta0.symbol === "WETH" ? token1 : token0;

                // Track token age
                if (!tokenFirstSeen.has(memeToken)) {
                    tokenFirstSeen.set(memeToken, Date.now());
                }

                const age = Date.now() - tokenFirstSeen.get(memeToken);

                // Only alert tokens < 5 mins old
                if (age > 5 * 60 * 1000) return;

                // ALERT
                await sendAlert(
                    `🚀 NEW MEME POOL LIVE (Base)\n\n` +
                    `Token: ${meme.name} (${meme.symbol})\n` +
                    `Pool: ${pair}\n` +
                    `DEX: ${factoryInfo.name}\n\n` +
                    `🔗 Pool: https://basescan.org/address/${pair}\n` +
                    `🔗 Token: https://basescan.org/token/${memeToken}`
                );

                console.log("✅ New meme pool alert sent:", meme.symbol);
            } catch (err) {
                console.error("Factory watcher error:", err.message);
            }
        });
    }
}
