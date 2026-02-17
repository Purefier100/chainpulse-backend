let lastCall = 0;

export async function throttle(ms = 1000) {
    const now = Date.now();
    const wait = lastCall + ms - now;

    if (wait > 0) {
        await new Promise((res) => setTimeout(res, wait));
    }

    lastCall = Date.now();
}
