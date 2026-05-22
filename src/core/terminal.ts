const ANSI = {
	reset: "\u001B[0m",
	bold: "\u001B[1m",
	dim: "\u001B[2m",
	red: "\u001B[31m",
	green: "\u001B[32m",
	yellow: "\u001B[33m",
	blue: "\u001B[34m",
	cyan: "\u001B[36m",
	gray: "\u001B[90m"
} as const

const useColor = (): boolean => {
	if (process.env.NO_COLOR) return false
	if (process.env.FORCE_COLOR === "0") return false
	return process.stdout.isTTY === true || process.stderr.isTTY === true
}

const wrap = (value: string, ...codes: string[]): string =>
	useColor() ? `${codes.join("")}${value}${ANSI.reset}` : value

export const color = {
	bold: (value: string) => wrap(value, ANSI.bold),
	dim: (value: string) => wrap(value, ANSI.dim),
	red: (value: string) => wrap(value, ANSI.red),
	green: (value: string) => wrap(value, ANSI.green),
	yellow: (value: string) => wrap(value, ANSI.yellow),
	blue: (value: string) => wrap(value, ANSI.blue),
	cyan: (value: string) => wrap(value, ANSI.cyan),
	gray: (value: string) => wrap(value, ANSI.gray)
}

const SYMBOLS = {
	success: "✓",
	error: "x",
	info: "i",
	waiting: "…",
	arrow: "→",
	bullet: "•"
} as const

export const icon = {
	success: () => color.green(SYMBOLS.success),
	error: () => color.red(SYMBOLS.error),
	info: () => color.cyan(SYMBOLS.info),
	waiting: () => color.yellow(SYMBOLS.waiting),
	arrow: () => color.gray(SYMBOLS.arrow),
	bullet: () => color.gray(SYMBOLS.bullet)
}

export const section = (title: string): string => color.bold(title)

export const keyValue = (label: string, value: string | number | boolean): string =>
	`${color.gray(`${label}:`)} ${String(value)}`
