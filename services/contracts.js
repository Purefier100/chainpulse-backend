import { ethers } from "ethers";
import { CONFIG } from "../config.js";

const provider = new ethers.JsonRpcProvider(CONFIG.BASE_RPC);
const wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, provider);

export const alertRegistry = new ethers.Contract(
    CONFIG.ALERT_REGISTRY,
    ["function recordAlert(string,string,uint256)"],
    wallet
);

export const usageTracker = new ethers.Contract(
    CONFIG.USAGE_TRACKER,
    ["function logAlert()"],
    wallet
);
