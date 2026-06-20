export const DEPOSIT_SLOT_DURATION_SECONDS = 180
export const DEFAULT_DEPOSIT_TIMEOUT_HOURS = 24
export const DEFAULT_DEPOSIT_TIMEOUT_SLOTS =
	(DEFAULT_DEPOSIT_TIMEOUT_HOURS * 60 * 60) / DEPOSIT_SLOT_DURATION_SECONDS

export const resolveDepositTimeoutSlots = (timeoutSlots?: number): number =>
	timeoutSlots ?? DEFAULT_DEPOSIT_TIMEOUT_SLOTS
