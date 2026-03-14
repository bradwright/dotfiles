/**
 * Model Identity Extension
 *
 * Appends the active model name (without provider prefix) to the system
 * prompt on every turn so the model can accurately record its own identity
 * (e.g. in plan revision history).
 *
 * Usage: Place in ~/.pi/agent/extensions/ or .pi/extensions/
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function modelIdentity(pi: ExtensionAPI) {
  let currentModelId: string | undefined;

  pi.on("model_select", async (event) => {
    const fullModel = `${event.model.provider}/${event.model.id}`;
    currentModelId = fullModel.split("/").pop() ?? event.model.id;
  });

  pi.on("before_agent_start", async (event) => {
    if (currentModelId) {
      return {
        systemPrompt:
          event.systemPrompt +
          `\n\nYour exact model name is: ${currentModelId}. Use this value verbatim whenever you need to record which model produced output (e.g. in plan revision history). Never guess or substitute a different name.`,
      };
    }
    return undefined;
  });
}
