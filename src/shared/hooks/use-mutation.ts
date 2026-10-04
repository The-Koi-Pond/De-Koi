import {
  useMutation as useQueryMutation,
  type DefaultError,
  type MutateOptions,
  type QueryClient,
  type UseMutationOptions,
  type UseMutationResult,
} from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import { toUserMessage } from "../lib/error-message";

export type AppMutationMeta = Record<string, unknown> & {
  /** The mutation's own `onError` already tells the user, so `mutate()` stays quiet. */
  handlesOwnErrors?: boolean;
  /** Message shown when a fire-and-forget `mutate()` call fails. */
  errorMessage?: string;
};

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: AppMutationMeta;
  }
}

const DEFAULT_MUTATION_ERROR_MESSAGE = "Couldn't save that change. Try again.";

export function notifyMutationFailure(error: unknown, message = DEFAULT_MUTATION_ERROR_MESSAGE) {
  const text = toUserMessage(error, { fallback: message });
  // A burst of identical failures (offline, server down) collapses into one toast.
  toast.error(text, { id: `mutation-failure:${text}` });
}

/**
 * TanStack's `useMutation`, except a `mutate()` call that fails without any error
 * handling shows a toast instead of being swallowed. `mutateAsync()` is unchanged:
 * its caller receives the rejection and owns the message.
 */
export function useMutation<TData = unknown, TError = DefaultError, TVariables = void, TOnMutateResult = unknown>(
  options: UseMutationOptions<TData, TError, TVariables, TOnMutateResult>,
  queryClient?: QueryClient,
): UseMutationResult<TData, TError, TVariables, TOnMutateResult> {
  const result = useQueryMutation(options, queryClient);
  const { mutateAsync } = result;
  const handlesOwnErrors = options.meta?.handlesOwnErrors === true;
  const errorMessage = options.meta?.errorMessage;

  const mutate = useCallback(
    (variables: TVariables, mutateOptions?: MutateOptions<TData, TError, TVariables, TOnMutateResult>) => {
      const callerHandlesError = handlesOwnErrors || Boolean(mutateOptions?.onError);
      // Same as TanStack's mutate(), which is mutateAsync() with the rejection dropped.
      // The rejection still arrives after the calling component unmounts, unlike
      // per-call callbacks, so a save fired from a closing dialog still reports.
      mutateAsync(variables, mutateOptions).catch((error: unknown) => {
        if (!callerHandlesError) notifyMutationFailure(error, errorMessage);
      });
    },
    [errorMessage, handlesOwnErrors, mutateAsync],
  );

  return { ...result, mutate };
}
