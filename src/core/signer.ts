import { PrivateKey } from "o1js"

type EnvLike = Partial<Record<string, string | undefined>>

export type SignerKeys = {
	mina: string
	zeko: string
	eth?: string
}

export const resolveSignerKeys = (env: EnvLike = process.env): SignerKeys => {
	const wallet = env.MINA_PRIVATE_KEY?.trim()
	if (!wallet) {
		throw new Error("Missing required signer private key: MINA_PRIVATE_KEY")
	}

	return { mina: wallet, zeko: wallet }
}

export const toSignerPublicKey = (privateKey: string): string =>
	PrivateKey.fromBase58(privateKey).toPublicKey().toBase58()

export const assertSignerMatchesAccount = ({
	account,
	privateKey,
	network
}: {
	account?: string
	privateKey: string
	network: string
}) => {
	const signerPublicKey = toSignerPublicKey(privateKey)
	if (account !== undefined && account !== signerPublicKey) {
		throw new Error(
			`Signer public key ${signerPublicKey} does not match --account ${account} for ${network}. Set MINA_PRIVATE_KEY for that account or omit --account.`
		)
	}

	return signerPublicKey
}
