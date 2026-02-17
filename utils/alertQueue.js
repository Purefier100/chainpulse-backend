import { sendAlert } from "../services/telegram.js";

const queue = [];
let sending = false;

/**
 * Add alert to queue
 */
export function queueAlert(msg) {
    queue.push(msg);
    processQueue();
}

/**
 * Process alerts slowly (anti-spam)
 */
async function processQueue() {
    if (sending) return;
    sending = true;

    while (queue.length > 0) {
        const msg = queue.shift();

        await sendAlert(msg);

        console.log("✅ Alert sent");

        // wait 3 seconds between messages
        await new Promise((r) => setTimeout(r, 3000));
    }

    sending = false;
}




