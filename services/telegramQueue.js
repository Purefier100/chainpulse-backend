import { sendAlert } from "./telegram.js";

const queue = [];
let sending = false;

export function queueAlert(msg) {
    queue.push(msg);
}

async function processQueue() {
    if (sending) return;
    sending = true;

    while (queue.length > 0) {
        const msg = queue.shift();

        try {
            await sendAlert(msg);
            await new Promise((r) => setTimeout(r, 2000)); // 1 msg per 2s
        } catch (err) {
            console.log("Queue send failed:", err.message);
        }
    }

    sending = false;
}

setInterval(processQueue, 1000);
