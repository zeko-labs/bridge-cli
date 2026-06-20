export const DEFAULT_RETRY_DELAY_MS = 5_000
export const DEFAULT_MAX_RETRIES = 5

const formatErrorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error)

export class RetryBudgetExceededError extends Error {
	constructor({
		operation,
		attempts,
		cause
	}: {
		operation: string
		attempts: number
		cause: unknown
	}) {
		super(`${operation} failed after ${attempts} attempts: ${formatErrorMessage(cause)}`)
		this.cause = cause
	}
}

export const getExponentialRetryDelayMs = ({
	baseDelayMs = DEFAULT_RETRY_DELAY_MS,
	retryIndex
}: {
	baseDelayMs?: number
	retryIndex: number
}) => Math.max(0, baseDelayMs) * 2 ** Math.max(0, retryIndex - 1)

export const retryWithBackoff = async <T>({
	operation,
	run,
	sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	baseDelayMs = DEFAULT_RETRY_DELAY_MS,
	maxRetries = DEFAULT_MAX_RETRIES,
	shouldRetry = () => true,
	onRetry
}: {
	operation: string
	run: (attempt: number) => Promise<T>
	sleep?: (ms: number) => Promise<void>
	baseDelayMs?: number
	maxRetries?: number
	shouldRetry?: (error: unknown) => boolean
	onRetry?: (input: {
		attempt: number
		retryIndex: number
		delayMs: number
		error: unknown
	}) => Promise<void> | void
}): Promise<T> => {
	for (let attempt = 1; ; attempt += 1) {
		try {
			return await run(attempt)
		} catch (error) {
			if (!shouldRetry(error)) {
				throw error
			}

			const retryIndex = attempt
			if (retryIndex > maxRetries) {
				throw new RetryBudgetExceededError({ operation, attempts: attempt, cause: error })
			}

			const delayMs = getExponentialRetryDelayMs({ baseDelayMs, retryIndex })
			await onRetry?.({ attempt, retryIndex, delayMs, error })
			await sleep(delayMs)
		}
	}
}
