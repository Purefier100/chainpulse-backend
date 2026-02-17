import { ethers } from "ethers";
import { ERC20_ABI } from "./erc20.js";

const cache = new Map();

export async function getTokenMeta(provider, address) {
    if (cache.has(address)) return cache.get(address);

    try {
        const token = new ethers.Contract(address, ERC20_ABI, provider);
        const [name, symbol, decimals] = await Promise.all([
            token.name(),
            token.symbol(),
            token.decimals()
        ]);

        const meta = { name, symbol, decimals };
        cache.set(address, meta);
        return meta;
    } catch {
        return null;
    }
}
