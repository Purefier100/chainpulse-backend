import { PublicKey } from "@solana/web3.js";

const META_PROGRAM = new PublicKey(
    "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

export async function getSolanaTokenMeta(connection, mint) {
    try {
        const [metaPDA] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("metadata"),
                META_PROGRAM.toBuffer(),
                new PublicKey(mint).toBuffer()
            ],
            META_PROGRAM
        );

        const account = await connection.getAccountInfo(metaPDA);
        if (!account) return null;

        const name = account.data
            .slice(33, 65)
            .toString()
            .replace(/\0/g, "");

        const symbol = account.data
            .slice(65, 75)
            .toString()
            .replace(/\0/g, "");

        return { name, symbol };
    } catch {
        return null;
    }
}
