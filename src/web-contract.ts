import type { AuthMode, Protocol } from './provider-contract.js'

/** Stable same-origin endpoint shared by the Node plugin and its bundled Web client. */
export const WEB_DRAFT_ENDPOINT = '/vision-bridge/v1/web-drafts'

/** Read-only, per-send route decision endpoint. It never admits a prompt or stores image bytes. */
export const WEB_IMAGE_ROUTE_ENDPOINT = '/vision-bridge/v1/web-image-route'

/** Session-authorized bridge image reader used by the native history gallery. */
export const WEB_ATTACHMENT_ENDPOINT = '/vision-bridge/v1/web-attachment'

/** User-triggered validation for one saved provider. The request contains only its id. */
export const WEB_PROVIDER_VALIDATION_ENDPOINT = '/vision-bridge/v1/provider-validation'

/** User-triggered model discovery; the request contains safe metadata and credential refs only. */
export const WEB_PROVIDER_MODELS_ENDPOINT = '/vision-bridge/v1/provider-models'

/** Safe editor metadata accepted by model discovery. It deliberately cannot contain a secret. */
export interface WebProviderModelsDraft {
  readonly providerId: string
  readonly protocol: Protocol
  readonly baseUrl: string
  readonly endpointPath?: string
  readonly authMode?: AuthMode
  readonly credential?: string
}

export const WEB_PROVIDER_VALIDATION_ERROR_CODES = [
  'VISION_NOT_CONFIGURED',
  'VISION_PROVIDER_NOT_FOUND',
  'VISION_CREDENTIAL_MISSING',
  'VISION_INVALID_ARGUMENT',
  'VISION_IMAGE_VALIDATION_FAILED',
  'VISION_UPSTREAM_HTTP',
  'VISION_UPSTREAM_PROTOCOL',
  'VISION_RESPONSE_TOO_LARGE',
  'VISION_TIMEOUT',
  'VISION_ABORTED',
] as const

export type WebProviderValidationError = (typeof WEB_PROVIDER_VALIDATION_ERROR_CODES)[number] | 'VISION_WEB_INTERNAL'

export const WEB_PROVIDER_VALIDATION_DIAGNOSTIC_REASONS = [
  'http',
  'network',
  'invalid-json',
  'invalid-response',
  'response-too-large',
] as const

export type WebProviderValidationDiagnosticReason =
  (typeof WEB_PROVIDER_VALIDATION_DIAGNOSTIC_REASONS)[number]

/** Safe validation detail. It deliberately cannot carry upstream text or request data. */
export interface WebProviderValidationDiagnostic {
  readonly reason: WebProviderValidationDiagnosticReason
  readonly httpStatus?: number
}
