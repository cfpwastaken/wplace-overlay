export function backendError(status: number, statusText: string, text: string) {
	if(text.includes("Just a moment")) {
		return {
			error: "Cloudflare is blocking the request. Please try again later.",
			status,
			statusText,
			text
		};
	}

	return {
		error: `Backend error: ${status} ${statusText}`,
		status,
		statusText,
		text
	};
}