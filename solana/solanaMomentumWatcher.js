import { Connection, PublicKey } from "@solana/web3.js";
import axios from "axios";
import { CONFIG } from "../config.js";
import { queueAlert } from "../utils/alertQueue.js";


const connection = new Connection(CONFIG.SOLANA_RPC, "confirmed");

const PROGRAMS = {
    PUMPFUN: new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"),
    RAYDIUM_V4: new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"),
    RAYDIUM_CPMM: new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"),
};

const MIN_BUY_USD = 200;
const MIN_WHALES = 2;
const BIG_SINGLE_BUY_USD = 2000;
const WINDOW_MS = 5 * 60 * 1000;


const MAX_AGE_MS = 3 * 60 * 1000;

const MIN_MCAP = 10000;
const MAX_MCAP = 10000000;
const MIN_LIQ = 3000;
const MAX_LIQ = 300000;

let solPrice = 140;
let lastSolUpdate = 0;

const alerted = new Set();


const seenTx = new Map(); // signature -> timestamp
const SEEN_TX_TTL = 10 * 60 * 1000; // forget txns after 10 min

const whaleBuyers = new Map();
const tokenMetaCache = new Map();


const lastSignature = {
    PUMPFUN: null,
    RAYDIUM_V4: null,
    RAYDIUM_CPMM: null,
};

let totalScanned = 0;
let totalAlerts = 0;


async function getSolPrice() {
    if (Date.now() - lastSolUpdate < 60000 && solPrice > 0) return solPrice;
    try {
        const res = await axios.get(
            "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
            { timeout: 4000 }
        );
        solPrice = res.data.solana.usd;
        lastSolUpdate = Date.now();
        console.log(`💰 SOL: $${solPrice}`);
    } catch {
        console.log("⚠️  Using cached SOL price");
    }
    return solPrice;
}


async function getTokenInfo(mint) {
    if (tokenMetaCache.has(mint)) return tokenMetaCache.get(mint);

    try {
        const res = await axios.get(
            `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
            { timeout: 4000 }
        );

        const pairs = res.data?.pairs || [];
        const solanaPair = pairs
            .filter((p) => p.chainId === "solana")
            .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];

        if (!solanaPair) return null;

        const ageHours = solanaPair.pairCreatedAt
            ? (Date.now() - solanaPair.pairCreatedAt) / (1000 * 60 * 60)
            : null;

        const info = {
            name: solanaPair.baseToken?.name || "Unknown",
            symbol: solanaPair.baseToken?.symbol || "???",
            liquidity: solanaPair.liquidity?.usd || 0,
            marketCap: solanaPair.fdv || 0,
            priceUsd: solanaPair.priceUsd || 0,
            pairAddress: solanaPair.pairAddress,
            ageHours,
            priceChange5m: solanaPair.priceChange?.m5 || 0,
            priceChange1h: solanaPair.priceChange?.h1 || 0,
            volume5m: solanaPair.volume?.m5 || 0,
            buys5m: solanaPair.txns?.m5?.buys || 0,
            sells5m: solanaPair.txns?.m5?.sells || 0,
        };

        tokenMetaCache.set(mint, info);
        setTimeout(() => tokenMetaCache.delete(mint), 120000);
        return info;
    } catch {
        return null;
    }
}


async function quickRugCheck(mint) {
    try {
        const res = await axios.get(
            `https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`,
            { timeout: 3000 }
        );
        const score = res.data?.score || 0;
        const risks = res.data?.risks || [];
        const criticalRisks = risks.filter((r) =>
            ["freeze_authority", "mint_authority", "honeypot"].includes(r.name)
        );
        return {
            score,
            isCritical: criticalRisks.length > 0,
            risks: risks.map((r) => r.name).slice(0, 3),
            grade: score < 500 ? "✅ Good" : score < 1000 ? "⚠️ Caution" : "❌ Risky",
        };
    } catch {
        return { score: null, isCritical: false, risks: [], grade: "❓ Unknown" };
    }
}


async function parseSwapTx(signature) {
    // ✅ FIX 2 cont: check TTL, not just presence
    if (seenTx.has(signature)) return null;
    seenTx.set(signature, Date.now());

    try {
        const tx = await connection.getParsedTransaction(signature, {
            maxSupportedTransactionVersion: 0,
            commitment: "confirmed",
        });

        if (!tx?.meta || tx.meta.err) return null;

        // ✅ FIX 1 cont: use expanded MAX_AGE_MS
        if (tx.blockTime && Date.now() - tx.blockTime * 1000 > MAX_AGE_MS) return null;

        const buyer = tx.transaction.message.accountKeys[0].pubkey.toString();
        const solSpent = (tx.meta.preBalances[0] - tx.meta.postBalances[0]) / 1e9;
        if (solSpent <= 0) return null;

        const price = await getSolPrice();
        const buyUsd = solSpent * price;
        if (buyUsd < MIN_BUY_USD) return null;

        const tokenBalances = tx.meta.postTokenBalances || [];
        let mint = null;
        for (const bal of tokenBalances) {
            if (bal.owner === buyer && bal.uiTokenAmount.uiAmount > 0) {
                mint = bal.mint;
                break;
            }
        }

        if (!mint) return null;
        return { mint, buyer, buyUsd };
    } catch {
        return null;
    }
}


async function processWhaleBuy(mint, buyer, buyUsd) {
    try {
        if (alerted.has(mint)) return;

        if (!whaleBuyers.has(mint)) {
            whaleBuyers.set(mint, {
                buyers: new Map(),
                firstSeen: Date.now(),
                totalVolume: 0,
            });
        }

        const data = whaleBuyers.get(mint);

        if (Date.now() - data.firstSeen > WINDOW_MS) {
            data.buyers.clear();
            data.firstSeen = Date.now();
            data.totalVolume = 0;
        }

        data.buyers.set(buyer, (data.buyers.get(buyer) || 0) + buyUsd);
        data.totalVolume += buyUsd;

        const whaleCount = data.buyers.size;
        const totalVolume = data.totalVolume;

        const isBigSingleBuy = buyUsd >= BIG_SINGLE_BUY_USD && whaleCount === 1;
        const isMultiWhale = whaleCount >= MIN_WHALES;

        if (!isBigSingleBuy && !isMultiWhale) {
            console.log(`🐋 ${whaleCount} whale(s) | $${buyUsd.toFixed(0)} | ${mint.slice(0, 8)}...`);
            return;
        }

        const info = await getTokenInfo(mint);
        if (!info) { console.log(`❌ No data for ${mint.slice(0, 8)}`); return; }

        console.log(`🔥 ${info.symbol} | Whales: ${whaleCount} | $${buyUsd.toFixed(0)} | MCap: $${info.marketCap.toLocaleString()}`);

        if (info.liquidity < MIN_LIQ) { console.log(`❌ ${info.symbol} liq too low`); return; }
        if (info.liquidity > MAX_LIQ) { console.log(`❌ ${info.symbol} too established`); return; }
        if (info.marketCap > MAX_MCAP) { console.log(`❌ ${info.symbol} already mooned`); return; }

        const rug = await quickRugCheck(mint);
        if (rug.isCritical) { console.log(`❌ ${info.symbol} rug flag: ${rug.risks.join(", ")}`); return; }

        alerted.add(mint);
        totalAlerts++;

        const triggerReason = isBigSingleBuy
            ? `🐳 BIG BUY ($${buyUsd.toFixed(0)})`
            : `🐋 ${whaleCount} WHALES IN 5MIN`;

        const ageLine = info.ageHours !== null
            ? `⏱️ Age: ${info.ageHours < 1 ? `${Math.round(info.ageHours * 60)}m` : `${info.ageHours.toFixed(1)}h`}`
            : `⏱️ Age: Unknown`;

        const momentumLine = info.priceChange5m >= 0
            ? `📈 +${info.priceChange5m}% (5m) | +${info.priceChange1h}% (1h)`
            : `📉 ${info.priceChange5m}% (5m) | ${info.priceChange1h}% (1h)`;

        const buyPressure = info.buys5m + info.sells5m > 0
            ? `🟢 ${info.buys5m}B / 🔴 ${info.sells5m}S (5m)\n`
            : "";

        const alert =
            `🚨 SOLANA MEME ALERT 🚨\n\n` +
            `🐸 ${info.name} ($${info.symbol})\n` +
            `📍 ${mint}\n\n` +
            `${triggerReason}\n` +
            `💰 Latest Buy: $${buyUsd.toFixed(0)}\n` +
            `💼 Window Volume: $${totalVolume.toFixed(0)}\n\n` +
            `💧 Liquidity: $${info.liquidity.toLocaleString()}\n` +
            `📊 Market Cap: $${info.marketCap.toLocaleString()}\n` +
            `${ageLine}\n` +
            `${momentumLine}\n` +
            `${buyPressure}` +
            `⚠️ RugCheck: ${rug.grade}${rug.risks.length ? ` (${rug.risks.join(", ")})` : ""}\n\n` +
            `🔗 Dex: https://dexscreener.com/solana/${mint}\n` +
            `🦅 Birdeye: https://birdeye.so/token/${mint}\n` +
            `🔍 RugCheck: https://rugcheck.xyz/tokens/${mint}\n` +
            `📱 Photon: https://photon-sol.tinyastro.io/en/lp/${info.pairAddress}`;

        queueAlert(alert);
        console.log(`✅ ALERT #${totalAlerts}: ${info.symbol} | MCap: $${info.marketCap.toLocaleString()}`);

    } catch (err) {
        console.log(`⚠️ processWhaleBuy error:`, err.message);
    }
}


async function scanProgram(programId, label, lastSigKey) {
    try {
        const options = { limit: 15 };

        // ✅ FIX 3: Only fetch signatures NEWER than last seen
        if (lastSignature[lastSigKey]) {
            options.until = lastSignature[lastSigKey];
        }

        const signatures = await connection.getSignaturesForAddress(programId, options);

        if (signatures.length === 0) {
            console.log(`📡 ${label}: No new txns since last scan`);
            return;
        }

        // Update cursor to newest sig
        lastSignature[lastSigKey] = signatures[0].signature;

        console.log(`📡 ${label}: ${signatures.length} new txns`);

        for (const sig of signatures) {
            if (sig.err) continue; // Skip failed txns immediately
            const parsed = await parseSwapTx(sig.signature);
            if (parsed) {
                await processWhaleBuy(parsed.mint, parsed.buyer, parsed.buyUsd);
            }
            await new Promise((r) => setTimeout(r, 200));
        }

        totalScanned += signatures.length;
    } catch (err) {
        console.log(`⚠️ Error scanning ${label}:`, err.message);
    }
}


export function watchSolanaMomentum() {
    console.log("🟣 Solana Meme Detector LIVE (Fixed)");
    console.log(`💰 Min Buy: $${MIN_BUY_USD} | MCap: $${MIN_MCAP.toLocaleString()}-$${MAX_MCAP.toLocaleString()}`);
    console.log("📡 Monitoring: Pump.fun | Raydium V4 | Raydium CPMM");
    console.log("🔧 Fixes: cursor-based scanning, TTL tx cache, expanded age window");

    getSolPrice();

    setInterval(async () => {
        console.log(`\n🔄 Scanning... (${totalScanned} total | ${totalAlerts} alerts)`);

        await scanProgram(PROGRAMS.PUMPFUN, "Pump.fun", "PUMPFUN");
        await new Promise((r) => setTimeout(r, 800));

        await scanProgram(PROGRAMS.RAYDIUM_V4, "Raydium V4", "RAYDIUM_V4");
        await new Promise((r) => setTimeout(r, 800));

        await scanProgram(PROGRAMS.RAYDIUM_CPMM, "Raydium CPMM", "RAYDIUM_CPMM");

        console.log(`✅ Scan done`);
    }, 20000);

    setInterval(getSolPrice, 60000);

    // Cleanup
    setInterval(() => {
        // ✅ FIX 2 cont: Expire seenTx entries by TTL instead of clearing all
        const now = Date.now();
        let expired = 0;
        for (const [sig, ts] of seenTx.entries()) {
            if (now - ts > SEEN_TX_TTL) {
                seenTx.delete(sig);
                expired++;
            }
        }
        if (expired > 0) console.log(`🧹 Expired ${expired} old tx entries`);

        if (alerted.size > 1000) { alerted.clear(); console.log("🧹 Cleared alert cache"); }

        for (const [mint, data] of whaleBuyers.entries()) {
            if (now - data.firstSeen > WINDOW_MS * 3) whaleBuyers.delete(mint);
        }

        console.log(`📊 Status: ${whaleBuyers.size} tracked | ${alerted.size} alerted | seenTx: ${seenTx.size}`);
    }, 60000);
}