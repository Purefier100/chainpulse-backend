import axios from "axios";
import { CONFIG } from "../config.js";

/**
 * ✅ Send Telegram Alert
 */
export async function sendAlert(message) {
    try {
        await axios.post(
            `https://api.telegram.org/bot${CONFIG.TG_TOKEN}/sendMessage`,
            {
                chat_id: CONFIG.TG_CHAT_ID,
                text: message,
                parse_mode: "HTML",
            }
        );

        console.log("✅ Telegram sent");
    } catch (err) {
        console.log("❌ Telegram error:", err.message);
    }
}

