const RECOVERABLE_MUTATION_ERROR_PATTERNS = [
	/Failed to fetch proved forest/i,
	/No key returned from mutation/i,
	/\bBad Gateway\b/i
]

export const formatErrorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error)

export const isRecoverableMutationError = (error: unknown): boolean => {
	const message = formatErrorMessage(error)
	return RECOVERABLE_MUTATION_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}
