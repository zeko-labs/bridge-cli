import { defineCommand } from "citty"

export const createPlaceholderCommand = ({
	name,
	description
}: {
	name: string
	description: string
}) =>
	defineCommand({
		meta: { name, description },
		async run() {
			throw new Error(`${name} is not implemented yet.`)
		}
	})
