import { getHotTokens, resetMomentum } from "../tokenMomentum.js";
import { sendAlert } from "./telegram.js";

export function startTrendingBot() {
    console.log("🔥 Trending Bot LIVE");

    setInterval(async () => {
        const hot = await getHotTokens();

        if (!hot.length) return;

        let msg = "🔥 HOT MEMES TRENDING (10m)\n\n";

        hot.forEach((t, i) => {
            msg +=
                `${i + 1}. ${t.symbol}\n` +
                `   Buyers: ${t.buyers}\n` +
                `   Token: ${t.token.slice(0, 8)}...\n\n`;
        });

        await sendAlert(msg);

        // reset after posting
        resetMomentum();
    }, 10 * 60 * 1000); // every 10 minutes
}
