/**
 * Shape returned by every `<form>`-driven server action, so a page can render a
 * pending state and an honest error message without a toast library.
 */
export type FormState =
  | {
      ok: boolean;
      message?: string;
      /** Field-level messages, keyed by input name. */
      fieldErrors?: Record<string, string>;
      /** Non-error payload the UI needs, e.g. freshly minted credentials. */
      data?: unknown;
    }
  | null;

export const IDLE_FORM_STATE: FormState = null;

export function formError(message: string): FormState {
  return { ok: false, message };
}

export function formSuccess(message?: string, data?: unknown): FormState {
  return { ok: true, message, data };
}
