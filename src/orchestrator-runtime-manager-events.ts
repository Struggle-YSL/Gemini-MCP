import type { RunOrchestratorLoopOutput } from "./orchestrator-runtime.js";
import { appendOrchestratorEvent } from "./orchestrator-summary.js";
import type { OrchestratorSnapshot } from "./sqlite-persistence.js";

export function appendWorkItemStatusTransitionEvents(
  snapshot: OrchestratorSnapshot,
  previousStatusByWorkItemId: ReadonlyMap<string, OrchestratorSnapshot["state"]["work_items"][number]["status"]>,
  updatedAt: string,
): OrchestratorSnapshot {
  let nextSnapshot = snapshot;

  for (const item of snapshot.state.work_items) {
    const previous = previousStatusByWorkItemId.get(item.id);
    if (item.status === previous) {
      continue;
    }

    if (item.status === "completed") {
      nextSnapshot = {
        ...nextSnapshot,
        events: appendOrchestratorEvent(nextSnapshot.events, {
          level: "info",
          event_type: "work-item-completed",
          work_item_id: item.id,
          ts: updatedAt,
          message: `Work item '${item.id}' completed.`,
        }),
      };
      continue;
    }

    if (item.status === "failed") {
      nextSnapshot = {
        ...nextSnapshot,
        events: appendOrchestratorEvent(nextSnapshot.events, {
          level: "error",
          event_type: "work-item-failed",
          work_item_id: item.id,
          ts: updatedAt,
          message: `Work item '${item.id}' failed.`,
        }),
      };
    }
  }

  return nextSnapshot;
}

export function appendSubmittedTaskEvents(
  snapshot: OrchestratorSnapshot,
  submissions: RunOrchestratorLoopOutput["submitted_tasks"],
  updatedAt: string,
): OrchestratorSnapshot {
  let nextSnapshot = snapshot;

  for (const submission of submissions) {
    nextSnapshot = {
      ...nextSnapshot,
      events: appendOrchestratorEvent(nextSnapshot.events, {
        level: "info",
        event_type: "task-submitted",
        work_item_id: submission.work_item_id,
        ts: updatedAt,
        message: `Submitted task '${submission.task_id}' for work item '${submission.work_item_id}'.`,
        data: {
          task_id: submission.task_id,
          tool_name: submission.tool_name,
          session_id: submission.session_id,
        },
      }),
    };
  }

  return nextSnapshot;
}