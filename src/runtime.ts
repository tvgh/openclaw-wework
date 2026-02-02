import type { PluginRuntime } from "clawdbot/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setWorkWeixinRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getWorkWeixinRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("WorkWeixin runtime not initialized");
  }
  return runtime;
}
