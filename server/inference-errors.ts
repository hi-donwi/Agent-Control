import { APICallError, EmptyResponseBodyError, InvalidResponseDataError, JSONParseError, RetryError, StreamProviderError, TypeValidationError } from 'ai';

/**
 * The stable, public view of a failed model call. The browser and the server log see only
 * this: an upstream error's message, response body, URL, and request body (which holds the
 * prompt) can carry credentials, account names, and client content, so none of it passes.
 * Agent Brain keeps the detail in its own logs.
 */
export type InferenceErrorCode =
  | 'unauthorized'
  | 'rate_limited'
  | 'not_found'
  | 'rejected'
  | 'unavailable'
  | 'unreachable'
  | 'timeout'
  | 'cancelled'
  | 'invalid_response'
  | 'failed';

export interface PublicInferenceError {
  code: InferenceErrorCode;
  /** The upstream HTTP status, when there was one. */
  status?: number;
  message: string;
}

const http = (status: number | undefined) => (status === undefined ? '' : ` (HTTP ${status})`);

const MESSAGES: Record<InferenceErrorCode, (status?: number) => string> = {
  unauthorized: (s) => `The model endpoint refused the credentials${http(s)}. Check the endpoint's credential.`,
  rate_limited: (s) => `The model endpoint is rate limited${http(s)}. Try again later.`,
  not_found: (s) => `The model endpoint does not offer this model or route${http(s)}.`,
  rejected: (s) => `The model endpoint rejected the request${http(s)}.`,
  unavailable: (s) => `The model endpoint failed${http(s)}. Try again.`,
  unreachable: () => 'The model endpoint is unreachable. Check that it is running.',
  timeout: (s) => `The model request timed out${http(s)}.`,
  cancelled: () => 'The model request was cancelled.',
  invalid_response: () => 'The model endpoint returned an invalid response.',
  failed: () => 'The model request failed.',
};

function codeForStatus(status: number): InferenceErrorCode {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'not_found';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'unavailable';
  return 'rejected';
}

const validStatus = (status: unknown): status is number =>
  typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599;

function classify(error: unknown): { code: InferenceErrorCode; status?: number } {
  // Retries hide the cause one level down; the last attempt is the one that decided.
  if (RetryError.isInstance(error)) return classify(error.lastError);

  if (APICallError.isInstance(error)) {
    // No status means no response arrived: refused connection, DNS, reset.
    return validStatus(error.statusCode) ? { code: codeForStatus(error.statusCode), status: error.statusCode } : { code: 'unreachable' };
  }
  if (StreamProviderError.isInstance(error)) {
    return validStatus(error.statusCode) ? { code: codeForStatus(error.statusCode), status: error.statusCode } : { code: 'failed' };
  }
  if (JSONParseError.isInstance(error) || InvalidResponseDataError.isInstance(error)
    || TypeValidationError.isInstance(error) || EmptyResponseBodyError.isInstance(error)) {
    return { code: 'invalid_response' };
  }
  if (error instanceof Error || error instanceof DOMException) {
    if (error.name === 'TimeoutError') return { code: 'timeout' };
    if (error.name === 'AbortError') return { code: 'cancelled' };
  }
  return { code: 'failed' };
}

/** What the browser may be told about a failed model call. */
export function publicInferenceError(error: unknown): PublicInferenceError {
  const { code, status } = classify(error);
  return { code, ...(status === undefined ? {} : { status }), message: MESSAGES[code](status) };
}

/**
 * A server log line for a failed model call: code, status, and the error's class name. The
 * default AI SDK handler would print the whole error object, request body (the prompt)
 * included.
 */
export function inferenceErrorLogLine(error: unknown): string {
  const { code, status } = publicInferenceError(error);
  const name = error instanceof Error && /^[A-Za-z_][\w]{0,63}$/.test(error.name) ? error.name : undefined;
  const detail = [status === undefined ? undefined : `HTTP ${status}`, name].filter(Boolean).join(', ');
  return `Inference error: ${code}${detail ? ` (${detail})` : ''}`;
}
