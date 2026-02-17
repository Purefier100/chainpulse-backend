import { ethers } from "ethers";
import { CONFIG } from "../config.js";

const ABI = [
    "function publishSignal(address token,uint256 whaleBuys,uint256 liquidityUSD,uint256 marketCapUSD)"
];

const provider = new ethers.JsonRpcProvider(CONFIG.BASE_RPC);
const wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, provider);

export async function publishTrendingToken(
    registryAddress,
    token,
    whaleBuys,
    liquidity,
    marketCap
) {
    const contract = new ethers.Contract(registryAddress, ABI, wallet);

    const tx = await contract.publishSignal(
        token,
        whaleBuys,
        liquidity,
        marketCap
    );

    await tx.wait();

    console.log("✅ Published onchain signal:", token);
}
