/** Protocol identifiers shared by Host adapters and the browser settings card. */
export const PROTOCOLS = ['openai-responses', 'openai-chat-completions', 'anthropic-messages'] as const
export type Protocol = (typeof PROTOCOLS)[number]

/** Authentication modes shared by validated Host config and browser-safe drafts. */
export const AUTH_MODES = ['bearer', 'x-api-key', 'none'] as const
export type AuthMode = (typeof AUTH_MODES)[number]
