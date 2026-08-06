import {
  useCutOperations,
  type CutOperationCoordinator,
  type CutOperationOptions,
} from "@/lib/useCutOperations";
import {
  useOperationRunner,
  type OperationRunnerCallbacks,
} from "@/lib/useOperationRunner";
import {
  useSubOperations,
  type SubOperationCoordinator,
  type SubOperationOptions,
} from "@/lib/useSubOperations";

export type ModeOperationOptions = {
  runner: OperationRunnerCallbacks;
  cut: Omit<CutOperationOptions, "operationRunner">;
  sub: Omit<SubOperationOptions, "operationRunner">;
};

export type ModeOperationCoordinators = {
  cut: CutOperationCoordinator;
  sub: SubOperationCoordinator;
};

/**
 * Compose the shared lifecycle runner with both mode-specific coordinators.
 * App supplies state adapters, while API calls and runner usage stay behind
 * this symmetric operation boundary.
 */
/** `useModeOperations`に必要な状態、派生値、副作用をReact hookとしてまとめる。 */
export function useModeOperations(options: ModeOperationOptions): ModeOperationCoordinators {
  const operationRunner = useOperationRunner(options.runner);
  const cut = useCutOperations({ ...options.cut, operationRunner });
  const sub = useSubOperations({ ...options.sub, operationRunner });
  return { cut, sub };
}
