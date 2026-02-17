const sniperScores = new Map();

// record sniper hits
export function recordSniper(wallet, chain) {
    const key = `${chain}:${wallet}`;

    if (!sniperScores.has(key)) {
        sniperScores.set(key, {
            wallet,
            chain,
            score: 1,
        });
    } else {
        sniperScores.get(key).score++;
    }
}

// get top snipers
export function getTopSnipers(limit = 5) {
    return [...sniperScores.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}
