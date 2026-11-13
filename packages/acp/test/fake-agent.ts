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
import { agent, ndJsonStream, type ClientRequestParamsByMethod } from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";

const mode = process.env.FAKE_ACP_MODE ?? "normal";

let sessionSeq = 0;
const sessionPrefix = `fake-sess-${process.pid}`;
let cancelled = false;

const app = agent({ name: "fake-acp-agent" });

app.onRequest("initialize", async () => {
  return { protocolVersion: 1 as const, agentCapabilities: {} };
});

app.onRequest("session/new", async (ctx) => {
  sessionSeq += 1;
  void ctx.params.cwd;
  return { sessionId: `${sessionPrefix}-${sessionSeq}`, configOptions: [{ id: 'model', name: 'Model', category: 'model', type: 'select' as const, currentValue: 'fast', options: [{ value: 'fast', name: 'Fast' }, { value: 'smart', name: 'Smart' }] }] };
});

app.onRequest('session/set_config_option', async (ctx) => ({ configOptions: [{ id: ctx.params.configId, name: 'Model', category: 'model', type: 'select' as const, currentValue: String(ctx.params.value), options: [{ value: 'fast', name: 'Fast' }, { value: 'smart', name: 'Smart' }] }] }));

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
  }
  if (mode === "slow") {
    await chunk("thinking slowly…");
    for (let i = 0; i < 300 && !cancelled; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return { stopReason: cancelled ? ("cancelled" as const) : ("end_turn" as const) };
  }

  await chunk("world");
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
