import { deepStrictEqual, equal, match, ok } from "node:assert";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, it } from "node:test";
import { createAcpHost, type AcpHost } from "../src/index.ts";
import { chooseAutoAllow } from "../src/policy.ts";
import { formatEditorContext } from "../src/host.ts";
import { loadAgentRegistry, type AgentDef } from "../src/agents.ts";

const FAKE = new URL("./fake-agent.ts", import.meta.url).pathname;

type Sent = Array<Record<string, any>>;

interface Fixture {
  dir: string;
  host: AcpHost;
  sent: Sent;
}

async function fixture(
  env: Record<string, string> = {},
  hostOpts: Record<string, unknown> = {},
): Promise<Fixture> {
  const dir = await mkdtemp(join(tmpdir(), "acp-test-"));
  const sent: Sent = [];
  const agents: AgentDef[] = [
    {
      id: "fake",
      label: "Fake",
      command: process.execPath,
      args: [FAKE],
      env: { ...env },
    },
  ];
  const host = createAcpHost({
    projectDir: dir,
    send: (m) => {
      sent.push(m as Record<string, any>);
    },
    agents,
    ...(hostOpts as object),
  });
  return { dir, host, sent };
}

async function waitFor(
  sent: Sent,
  pred: (m: Record<string, any>) => boolean,
  timeoutMs = 15000,
): Promise<Record<string, any>> {
  const start = Date.now();
  for (;;) {
    const found = sent.find(pred);
    if (found) return found;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timeout waiting for message; got: ${JSON.stringify(sent.slice(-5), null, 1).slice(0, 2000)}`);
    }
    await delay(50);
  }
}

async function startAndPrompt(
  f: Fixture,
  text = "hi",
  context: unknown = undefined,
): Promise<string> {
  await f.host.handle({ type: "acp/start", agentId: "fake" });
  const sess = await waitFor(f.sent, (m) => m.type === "acp/session");
  await f.host.handle({ type: "acp/prompt", sessionId: sess.sessionId, text, context });
  return sess.sessionId as string;
}

describe("registry", () => {
  it("acp/agents lists agents with availability flags", async () => {
    const f = await fixture();
    try {
      await f.host.handle({ type: "acp/agents" });
      const msg = await waitFor(f.sent, (m) => m.type === "acp/agents");
      ok(Array.isArray(msg.list), "list is array");
      const fake = msg.list.find((a: any) => a.id === "fake");
      ok(fake, "fake agent listed");
      equal(fake.available, true, "node-spawned fake is available");
    } finally {
      await f.host.dispose();
    }
  });

  it("agents.json override merges by id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "acp-reg-"));
    const cfg = join(dir, "agents.json");
    await writeFile(
      cfg,
      JSON.stringify({
        agents: [{ id: "codex", label: "Custom Codex", command: "my-codex", args: ["acp"] }],
      }),
    );
    const defs = await loadAgentRegistry({ projectDir: dir, agentsConfigPath: cfg });
    const codex = defs.find((d) => d.id === "codex");
    equal(codex?.command, "my-codex");
    equal(codex?.label, "Custom Codex");
    ok(defs.find((d) => d.id === "claude"), "defaults retained");
    ok(defs.find((d) => d.id === "opencode"), "defaults retained");
  });
});

describe("start/prompt/stream", () => {
  it("streams chunks, tool calls and done; persists transcript", async () => {
    const f = await fixture();
    try {
      const sessionId = await startAndPrompt(f, "hello");
      const done = await waitFor(
        f.sent,
        (m) => m.type === "acp/done" && m.sessionId === sessionId,
      );
      equal(done.stopReason, "end_turn");
      const updates = f.sent.filter((m) => m.type === "acp/update" && m.sessionId === sessionId);
      const kinds = updates.map((m) => m.update.sessionUpdate);
      ok(kinds.includes("agent_message_chunk"), `got chunks: ${kinds}`);
      ok(kinds.includes("tool_call"), `got tool_call: ${kinds}`);
      ok(kinds.includes("tool_call_update"), `got tool_call_update: ${kinds}`);
      const text = updates
        .filter((m) => m.update.sessionUpdate === "agent_message_chunk")
        .map((m) => m.update.content?.text ?? "")
        .join("");
      match(text, /Hello /);
      match(text, /done/); // permission auto-allowed (project-local path, default policy ON)
      const noPerm = f.sent.find((m) => m.type === "acp/permission-request");
      equal(noPerm, undefined, "no permission request when auto-allowed");

      const transcript = await readFile(join(f.dir, ".agentwarp", "sessions", `${sessionId}.jsonl`), "utf8");
      const lines = transcript.trim().split("\n").map((l) => JSON.parse(l));
      equal(lines[0].kind, "user");
      ok(lines.some((l) => l.kind === "update"), "transcript has updates");
      equal(lines[lines.length - 1].kind, "done");
    } finally {
      await f.host.dispose();
    }
  });

  it("prepends the [TurboWarp] context line", async () => {
    const f = await fixture({ FAKE_ECHO_PROMPT: "1" });
    try {
      const sessionId = await startAndPrompt(f, "fix it", {
        editingTarget: "player",
        scriptsPath: "player/scripts.ts",
        selectedBlock: "a3 tick",
        selectedLocation: "player/scripts.ts:31",
        rev: 12,
      });
      await waitFor(f.sent, (m) => m.type === "acp/done" && m.sessionId === sessionId);
      const text = f.sent
        .filter((m) => m.type === "acp/update" && m.sessionId === sessionId)
        .map((m) => (m.update.sessionUpdate === "agent_message_chunk" ? (m.update.content?.text ?? "") : ""))
        .join("");
      match(
        text,
        /\[TurboWarp\] editing: player \(player\/scripts\.ts\) · selected: a3 tick \(player\/scripts\.ts:31\) · rev 12/,
      );
    } finally {
      await f.host.dispose();
    }
  });
});

describe("multi-turn", () => {
  it("supports sequential prompts on one session (multi-turn)", async () => {
    const f = await fixture();
    try {
      const sessionId = await startAndPrompt(f, "first");
      await waitFor(f.sent, (m) => m.type === "acp/done" && m.sessionId === sessionId);
      await f.host.handle({ type: "acp/prompt", sessionId, text: "second" });
      const start = Date.now();
      for (;;) {
        const dones = f.sent.filter((m) => m.type === "acp/done" && m.sessionId === sessionId);
        if (dones.length >= 2) break;
        if (Date.now() - start > 15000) throw new Error("timeout waiting for second done");
        await delay(50);
      }
      const dones = f.sent.filter((m) => m.type === "acp/done" && m.sessionId === sessionId);
      equal(dones.length, 2, "two turns, two dones");
      const transcript = await readFile(join(f.dir, ".agentwarp", "sessions", `${sessionId}.jsonl`), "utf8");
      const kinds = transcript.trim().split("\n").map((l) => (JSON.parse(l) as { kind: string }).kind);
      deepStrictEqual(kinds[0], "user");
      equal(kinds.filter((k) => k === "done").length, 2);
    } finally {
      await f.host.dispose();
    }
  });
});

describe("permissions", () => {
  it("asks the panel and honours allow", async () => {
    const f = await fixture({ FAKE_TOOL_PATH: "/etc/passwd" }, { autoAllow: false });
    try {
      const sessionId = await startAndPrompt(f, "read it");
      const req = await waitFor(
        f.sent,
        (m) => m.type === "acp/permission-request" && m.sessionId === sessionId,
      );
      ok(req.requestId, "has requestId");
      equal(req.toolCall.toolCallId, "tc-1");
      await f.host.handle({ type: "acp/permission", requestId: req.requestId, optionId: "allow" });
      const done = await waitFor(
        f.sent,
        (m) => m.type === "acp/done" && m.sessionId === sessionId,
      );
      equal(done.stopReason, "end_turn");
      const text = f.sent
        .filter((m) => m.type === "acp/update" && m.sessionId === sessionId)
        .map((m) => (m.update.sessionUpdate === "agent_message_chunk" ? (m.update.content?.text ?? "") : ""))
        .join("");
      match(text, /done/);
    } finally {
      await f.host.dispose();
    }
  });

  it("honours reject and unknown optionIds", async () => {
    for (const optionId of ["reject", "bogus-option"]) {
      const f = await fixture({ FAKE_TOOL_PATH: "/etc/passwd" }, { autoAllow: false });
      try {
        const sessionId = await startAndPrompt(f, "read it");
        const req = await waitFor(
          f.sent,
          (m) => m.type === "acp/permission-request" && m.sessionId === sessionId,
        );
        await f.host.handle({ type: "acp/permission", requestId: req.requestId, optionId });
        await waitFor(f.sent, (m) => m.type === "acp/done" && m.sessionId === sessionId);
        const text = f.sent
          .filter((m) => m.type === "acp/update" && m.sessionId === sessionId)
          .map((m) => (m.update.sessionUpdate === "agent_message_chunk" ? (m.update.content?.text ?? "") : ""))
          .join("");
        match(text, /blocked/, `optionId=${optionId} rejects the tool call`);
      } finally {
        await f.host.dispose();
      }
    }
  });

  it("auto-allows agentwarp commands when policy is on", async () => {
    const f = await fixture({ FAKE_TOOL_COMMAND: "bin/agentwarp check" });
    try {
      const sessionId = await startAndPrompt(f, "check it");
      await waitFor(f.sent, (m) => m.type === "acp/done" && m.sessionId === sessionId);
      equal(
        f.sent.find((m) => m.type === "acp/permission-request"),
        undefined,
        "agentwarp command auto-allowed",
      );
    } finally {
      await f.host.dispose();
    }
  });
});

describe("cancel", () => {
  it("acp/cancel ends the turn with cancelled", async () => {
    const f = await fixture({ FAKE_ACP_MODE: "slow" });
    try {
      const sessionId = await startAndPrompt(f, "take your time");
      await waitFor(
        f.sent,
        (m) =>
          m.type === "acp/update" &&
          m.sessionId === sessionId &&
          m.update.sessionUpdate === "agent_message_chunk",
      );
      await f.host.handle({ type: "acp/cancel", sessionId });
      const done = await waitFor(
        f.sent,
        (m) => m.type === "acp/done" && m.sessionId === sessionId,
        20000,
      );
      equal(done.stopReason, "cancelled");
    } finally {
      await f.host.dispose();
    }
  });
});

describe("history", () => {
  it("replays the transcript after the turn", async () => {
    const f = await fixture();
    try {
      const sessionId = await startAndPrompt(f, "hello");
      await waitFor(f.sent, (m) => m.type === "acp/done" && m.sessionId === sessionId);
      const live = f.sent.filter(
        (m) => (m.type === "acp/update" || m.type === "acp/done") && m.sessionId === sessionId,
      );
      f.sent.length = 0;
      await f.host.handle({ type: "acp/history", sessionId });
      // Replay = live updates + done, plus the original user prompt rendered
      // as a user_message_chunk (live turns don't echo the prompt).
      const replayed = f.sent.filter(
        (m) => (m.type === "acp/update" || m.type === "acp/done") && m.sessionId === sessionId,
      );
      const userChunks = replayed.filter(
        (m) => m.type === "acp/update" && m.update.sessionUpdate === "user_message_chunk",
      );
      equal(userChunks.length, 1, "replay includes the user prompt");
      match(String(userChunks[0].update.content?.text ?? ""), /\[TurboWarp\]|hello/);
      deepStrictEqual(
        replayed.filter((m) => m !== userChunks[0]),
        live,
      );
    } finally {
      await f.host.dispose();
    }
  });

  it("errors on unknown sessions", async () => {
    const f = await fixture();
    try {
      await f.host.handle({ type: "acp/history", sessionId: "nope" });
      const err = await waitFor(f.sent, (m) => m.type === "acp/error");
      match(String(err.message), /no transcript/);
      await f.host.handle({ type: "acp/prompt", sessionId: "nope", text: "hi" });
      await waitFor(f.sent, (m) => m.type === "acp/error" && /unknown session/.test(String(m.message)));
      await f.host.handle({ type: "acp/start", agentId: "nope" });
      await waitFor(f.sent, (m) => m.type === "acp/error" && /unknown agent/.test(String(m.message)));
    } finally {
      await f.host.dispose();
    }
  });
});

describe("crash recovery", () => {
  it("emits acp/error on agent crash and restarts on next start", async () => {
    const f = await fixture({ FAKE_ACP_MODE: "crash" });
    try {
      const s1 = await startAndPrompt(f, "hello");
      const err = await waitFor(
        f.sent,
        (m) => m.type === "acp/error" && m.sessionId === s1,
        20000,
      );
      match(String(err.message), /fake/);
      // Restart: a fresh acp/start must respawn and yield a new session.
      await f.host.handle({ type: "acp/start", agentId: "fake" });
      const s2msg = await waitFor(
        f.sent,
        (m) => m.type === "acp/session" && m.sessionId !== s1,
        20000,
      );
      ok(s2msg.sessionId, "second session started after crash");
    } finally {
      await f.host.dispose();
    }
  });
});

describe("policy units", () => {
  const dir = "/proj";
  const opts = [
    { optionId: "allow", kind: "allow_once", name: "Allow" },
    { optionId: "reject", kind: "reject_once", name: "Reject" },
  ];
  it("allows project-local file edits", () => {
    equal(
      chooseAutoAllow(
        { kind: "edit", rawInput: { path: "/proj/a.ts" }, locations: [{ path: "/proj/a.ts" }] },
        opts,
        dir,
      ),
      "allow",
    );
  });
  it("asks for outside paths", () => {
    equal(
      chooseAutoAllow({ kind: "edit", rawInput: { path: "/etc/passwd" } }, opts, dir),
      null,
    );
  });
  it("asks when indeterminate", () => {
    equal(chooseAutoAllow({ kind: "other", name: "mystery" }, opts, dir), null);
  });
  it("allows think", () => {
    equal(chooseAutoAllow({ kind: "think" }, opts, dir), "allow");
  });
  it("allows agentwarp commands only", () => {
    equal(
      chooseAutoAllow({ kind: "execute", rawInput: { command: "bin/agentwarp check" } }, opts, dir),
      "allow",
    );
    equal(
      chooseAutoAllow({ kind: "execute", rawInput: { command: "rm -rf /" } }, opts, dir),
      null,
    );
  });
  it("returns null without allow options", () => {
    equal(
      chooseAutoAllow({ kind: "edit", rawInput: { path: "/proj/a.ts" } }, [], dir),
      null,
    );
  });
});

describe("context formatting", () => {
  it("matches the P5 compact line", () => {
    equal(
      formatEditorContext({
        editingTarget: "player",
        scriptsPath: "player/scripts.ts",
        selectedBlock: "a3 tick",
        selectedLocation: "player/scripts.ts:31",
        rev: 12,
      }),
      "[TurboWarp] editing: player (player/scripts.ts) · selected: a3 tick (player/scripts.ts:31) · rev 12",
    );
  });
  it("handles missing/string contexts", () => {
    equal(formatEditorContext(undefined), "");
    equal(formatEditorContext({}), "");
    equal(formatEditorContext("custom note"), "[TurboWarp] custom note");
  });
});
