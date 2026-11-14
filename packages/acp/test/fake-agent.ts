/**
 * Fake ACP agent for host tests. Speaks ACP over stdio using the SDK's
 * agent side. Behaviour knobs via env:
 *
 * FAKE_ACP_MODE=normal (default): streams two text chunks, emits a file
 *   tool_call, asks one permission, emits a tool_call_update, streams a final
 *   chunk, returns end_turn.
 * FAKE_ACP_MODE=crash: exits(1) right after the first chunk (tests crash handling).
 * FAKE_ACP_MODE=slow: waits ~30s (in slices) so tests can cancel; honours
 *   session/cancel by returning stopReason "cancelled".
 * FAKE_TOOL_PATH: file path used in the tool call locations (default:
 *   <cwd>/player/scripts.ts). Set to /etc/passwd to exercise the ask path.
 * FAKE_TOOL_COMMAND: if set, the tool call is kind=execute with this command
 *   instead of a file edit (exercises the agentwarp-command auto-allow path).
 */
import { agent, ndJsonStream, type ClientRequestParamsByMethod, type SessionConfigOption, type SessionModeState } from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";

const mode = process.env.FAKE_ACP_MODE ?? "normal";

let sessionSeq = 0;
const sessionPrefix = `fake-sess-${process.pid}`;
let cancelled = false;

const app = agent({ name: "fake-acp-agent" });

app.onRequest("initialize", async () => {
  const agentCapabilities: Record<string, unknown> = {};
  if (process.env.FAKE_PROMPT_CAPS === "image") agentCapabilities.promptCapabilities = { image: true };
  if (process.env.FAKE_SUPPORT_LOAD === "1") agentCapabilities.loadSession = true;
  if (process.env.FAKE_SUPPORT_RESUME === "1") agentCapabilities.sessionCapabilities = { resume: {} };
  return { protocolVersion: 1 as const, agentCapabilities };
});

const configBySession = new Map<string, SessionConfigOption[]>();

function baseConfigOptions(): SessionConfigOption[] {
  return [
    { id: 'model', name: 'Model', type: 'select' as const, currentValue: 'fast', options: [{ value: 'fast', name: 'Fast' }, { value: 'smart', name: 'Smart' }] },
  ];
}

function baseModes(): SessionModeState | null {
  if (process.env.FAKE_MODE_OPTION !== "1") return null;
  return { currentModeId: 'build', availableModes: [{ id: 'build', name: 'Build' }, { id: 'plan', name: 'Plan', description: 'Plan first' }] };
}

app.onRequest("session/new", async (ctx) => {
  sessionSeq += 1;
  void ctx.params.cwd;
  const sessionId = `${sessionPrefix}-${sessionSeq}`;
  configBySession.set(sessionId, baseConfigOptions());
  return { sessionId, configOptions: configBySession.get(sessionId), modes: baseModes() };
});

app.onRequest('session/set_config_option', async (ctx) => {
  const list = configBySession.get(ctx.params.sessionId) ?? baseConfigOptions();
  const opt = list.find((o) => o.id === ctx.params.configId);
  if (opt) (opt as { currentValue: unknown }).currentValue = String(ctx.params.value);
  configBySession.set(ctx.params.sessionId, list);
  return { configOptions: list };
});

app.onRequest("session/set_mode", async (ctx) => {
  if (process.env.FAKE_MODE_OPTION !== "1") throw new Error(`unknown method: session/set_mode`);
  await ctx.client.notify("session/update", {
    sessionId: ctx.params.sessionId,
    update: { sessionUpdate: "current_mode_update", currentModeId: ctx.params.modeId },
  });
  return {};
});

if (process.env.FAKE_SUPPORT_LOAD === "1") {
  app.onRequest("session/load", async (ctx) => {
    const sessionId = ctx.params.sessionId;
    if (!configBySession.has(sessionId)) configBySession.set(sessionId, baseConfigOptions());
    // Replay after the response: the client only routes session/update once
    // the load has returned and it attached the session.
    setTimeout(() => {
      void ctx.client
        .notify("session/update", {
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "loaded history" },
          },
        })
        .catch(() => undefined);
    }, 150);
    return { configOptions: configBySession.get(sessionId), modes: baseModes() };
  });
}

if (process.env.FAKE_SUPPORT_RESUME === "1") {
  app.onRequest("session/resume", async (ctx) => {
    const sessionId = ctx.params.sessionId;
    if (!configBySession.has(sessionId)) configBySession.set(sessionId, baseConfigOptions());
    setTimeout(() => {
      void ctx.client
        .notify("session/update", {
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "resumed history" },
          },
        })
        .catch(() => undefined);
    }, 150);
    return { configOptions: configBySession.get(sessionId), modes: baseModes() };
  });
}

app.onNotification("session/cancel", async (ctx) => {
  void ctx.params.sessionId;
  cancelled = true;
});

app.onRequest("session/prompt", async (ctx) => {
  const sessionId = ctx.params.sessionId;
  const cwd = process.cwd();
  const toolPath = process.env.FAKE_TOOL_PATH ?? `${cwd}/player/scripts.ts`;
  const toolCommand = process.env.FAKE_TOOL_COMMAND;

  const chunk = (text: string): Promise<void> =>
    ctx.client.notify("session/update", {
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    });

  await chunk("Hello ");
  if (mode === "crash") {
    await new Promise((r) => setTimeout(r, 50));
    process.exit(1);
  }
  if (process.env.FAKE_ECHO_PROMPT === "1") {
    const texts = ctx.params.prompt
      .map((b) => ((b as { type?: string }).type === "text" ? (b as { text?: string }).text ?? "" : ""))
      .join("");
    await chunk(`prompt was: ${texts}`);
    const summary = ctx.params.prompt
      .map((b) => {
        const t = (b as { type?: string }).type;
        if (t === "text") return "text";
        if (t === "resource_link") return `resource_link:${(b as { uri?: string }).uri ?? ""}`;
        if (t === "image") return `image:${(b as { mimeType?: string }).mimeType ?? ""}`;
        return String(t);
      })
      .join(",");
    await chunk(`blocks: ${summary}`);
  }
  if (mode === "slow") {
    await chunk("thinking slowly…");
    for (let i = 0; i < 300 && !cancelled; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return { stopReason: cancelled ? ("cancelled" as const) : ("end_turn" as const) };
  }

  await chunk("world");
  if (process.env.FAKE_SESSION_TITLE) {
    await ctx.client.notify("session/update", {
      sessionId,
      update: { sessionUpdate: "session_info_update", title: process.env.FAKE_SESSION_TITLE },
    });
  }
  if (process.env.FAKE_EXTRA_UPDATES === "1") {
    await ctx.client.notify("session/update", {
      sessionId,
      update: {
        sessionUpdate: "plan",
        entries: [{ content: "Do the thing", priority: "high" as const, status: "in_progress" as const }],
      },
    });
    await ctx.client.notify("session/update", {
      sessionId,
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [{ name: "check", description: "Check the project" }],
      },
    });
    await ctx.client.notify("session/update", {
      sessionId,
      update: { sessionUpdate: "usage_update", used: 10, size: 100 },
    });
  }
  const toolCall: {
    toolCallId: string;
    title: string;
    name: string;
    kind: "execute" | "edit";
    status: "in_progress";
    rawInput: unknown;
    locations?: Array<{ path: string; line: number }>;
  } = toolCommand
    ? {
        toolCallId: "tc-1",
        title: `Run ${toolCommand}`,
        name: "execute",
        kind: "execute",
        status: "in_progress",
        rawInput: { command: toolCommand },
      }
    : {
        toolCallId: "tc-1",
        title: `Edit ${toolPath}`,
        name: "edit",
        kind: "edit",
        status: "in_progress",
        rawInput: { path: toolPath, edits: [] as unknown[] },
        locations: [{ path: toolPath, line: 1 }],
      };
  await ctx.client.notify("session/update", {
    sessionId,
    update: { sessionUpdate: "tool_call", ...toolCall },
  });

  const permParams: ClientRequestParamsByMethod["session/request_permission"] = {
    sessionId,
    toolCall: { ...toolCall, status: "pending" as const },
    options: [
      { optionId: "allow", name: "Allow", kind: "allow_once" as const },
      { optionId: "reject", name: "Reject", kind: "reject_once" as const },
    ],
  };
  const perm = await ctx.client.request("session/request_permission", permParams);
  const allowed =
    perm.outcome.outcome === "selected" && perm.outcome.optionId === "allow";

  await ctx.client.notify("session/update", {
    sessionId,
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "tc-1",
      status: allowed ? ("completed" as const) : ("failed" as const),
    },
  });
  await chunk(allowed ? "done" : "blocked");
  return { stopReason: "end_turn" as const };
});

const stream = ndJsonStream(
  Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
  Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>,
);
const conn = app.connect(stream);
await conn.closed;
