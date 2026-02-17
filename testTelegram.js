import { sendAlert } from "./services/telegram.js";

await sendAlert("✅ ChainPulse is connected to the NEW channel!");
console.log("Sent!");
