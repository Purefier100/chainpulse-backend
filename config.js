import dotenv from "dotenv";
dotenv.config({ path: "./.env" });

export const CONFIG = {
    BASE_RPC: process.env.BASE_RPC,
    BASE_WSS: process.env.BASE_WSS,

    SOLANA_RPC: process.env.SOLANA_RPC,

    TG_TOKEN: process.env.TG_BOT_TOKEN,
    TG_CHAT_ID: process.env.TG_CHAT_ID,

    PRIVATE_KEY: process.env.PRIVATE_KEY,

    ALERT_REGISTRY: process.env.ALERT_REGISTRY,
    SUBSCRIPTION_REGISTRY: process.env.SUBSCRIPTION_REGISTRY,
    USAGE_TRACKER: process.env.USAGE_TRACKER,
};
