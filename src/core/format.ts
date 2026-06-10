const NANOMINA_PER_MINA = 1_000_000_000n

export const nanominaToMinaString = (value: bigint): string => {
	const whole = value / NANOMINA_PER_MINA
	const fraction = value % NANOMINA_PER_MINA
	if (fraction === 0n) return whole.toString()

	const padded = fraction.toString().padStart(9, "0").replace(/0+$/, "")
	return `${whole.toString()}.${padded}`
}

export const minaStringToNanomina = (value: string): bigint => {
	const trimmed = value.trim()
	if (!/^\d+(?:\.\d{1,9})?$/.test(trimmed)) {
		throw new Error(`Invalid MINA amount: ${value}`)
	}

	const [wholePart, fractionPart = ""] = trimmed.split(".")
	const whole = BigInt(wholePart ?? "0")
	const fraction = BigInt(fractionPart.padEnd(9, "0"))
	return whole * NANOMINA_PER_MINA + fraction
}
