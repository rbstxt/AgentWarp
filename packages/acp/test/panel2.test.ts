/**
 * Panel v2 (P7 §5 + §6) host tests: mentions, images, checkpoints plumbing,
 * change summaries, sessions list, load, set-mode. Uses the fake ACP agent
 * (never a real agent); the TurnStore is stubbed — the real filesystem
 * implementation is exercised in packages/bridge/test.
 */
import { deepStrictEqual, equal, match, ok } from "node:assert";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, it } from "node:test";
import {
  createAcpHost,
  type AcpHost,
  type ChangeTarget,
  type TurnStore,
} from "../src/index.ts";
import type { AgentDef } from "../src/agents.ts";

const FAKE = new URL("./fake-agent.ts", import.meta.url).pathname;

type Sent = Array<Record<string, any>>;

interface Fixture {
  dir: string;
  host: AcpHost;
  sent: Sent;
  calls: { snapshots: Array<[string, string]>; restores: Array<[string, string]>; diffs: Array<[string, string]> };
}

function stubStore(
  calls: Fixture["calls"],
  diffResult: ChangeTarget[] = [],
  rev = 42,
): TurnStore {
  return {
    getRev: () => rev,
    snapshot: async (s, t) => {
      calls.snapshots.push([s, t]);
    },
    restore: async (s, t) => {
      calls.restores.push([s, t]);
      if (t.startsWith("nope")) throw new Error(`unknown checkpoint ${s}/${t}`);
      return 7;
    },
    diff: async (s, t) => {
      calls.diffs.push([s, t]);
      if (t.startsWith("nope")) throw new Error(`unknown checkpoint ${s}/${t}`);
      return diffResult;
    },
  };
}

async function fixture(
  env: Record<string, string> = {},
  diffResult: ChangeTarget[] = [],
): Promise<Fixture> {
  const dir = await mkdtemp(join(tmpdir(), "acp-panel2-"));
  const sent: Sent = [];
  const calls: Fixture["calls"] = { snapshots: [], restores: [], diffs: [] };
  const agents: AgentDef[] = [
    { id: "fake", label: "Fake", command: process.execPath, args: [FAKE], env: { ...env } },
  ];
  const host = createAcpHost({
    projectDir: dir,
    send: (m) => {
      sent.push(m as Record<string, any>);
    },
    agents,
    turnStore: stubStore(calls, diffResult),
  });
  return { dir, host, sent, calls };
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

async function startSession(f: Fixture): Promise<string> {
  await f.host.handle({ type: "acp/start", agentId: "fake" });
  const sess = await waitFor(f.sent, (m) => m.type === "acp/session");
  return sess.sessionId as string;
}

/** Minimal text project with a sourcemap + base for mention resolution. */
async function setupMentionsProject(dir: string): Promise<void> {
  await mkdir(join(dir, "player"), { recursive: true });
  await writeFile(join(dir, "player", "target.json"), JSON.stringify({ name: "player" }) + "\n");
  await writeFile(join(dir, "player", "scripts.ts"), "when flag clicked\nmove (10) steps\n");
  await mkdir(join(dir, ".agentwarp"), { recursive: true });
  const scriptsFile = join(dir, "player", "scripts.ts");
  await writeFile(
    join(dir, ".agentwarp", "sourcemap.json"),
    JSON.stringify({
      blk1: { file: scriptsFile, line: 3, col: 1 },
      blk2: { file: scriptsFile, line: 8, col: 1 },
    }),
  );
  await writeFile(
    join(dir, ".agentwarp", "base.json"),
    JSON.stringify({
      targets: [
        {
          name: "player",
          isStage: false,
          blocks: {
            blk1: { opcode: "event_whenflagclicked", next: "blk2", parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true },
            blk2: { opcode: "motion_movesteps", next: null, parent: "blk1", inputs: { STEPS: [1, [4, 10]] }, fields: {}, shadow: false, topLevel: false },
          },
          comments: {},
        },
      ],
    }),
  );
}

const SAMPLE_CHANGES: ChangeTarget[] = [
  {
    name: "player",
    isStage: false,
    scripts: [
      { status: "added", topBlockId: "n1", anchor: "a5", label: "when space pressed · 2 blocks", scratchblocks: "@a5\nwhen [space v] key pressed\nmove (1) steps\n", file: "player/scripts.ts", line: 10 },
    ],
  },
];

describe("prompt extensions", () => {
  it("sends resource_link blocks for mentions, with line ranges for scripts", async () => {
    const f = await fixture({ FAKE_ECHO_PROMPT: "1" });
    try {
      await setupMentionsProject(f.dir);
      const sessionId = await startSession(f);
      await f.host.handle({
        type: "acp/prompt",
        sessionId,
        text: "fix it",
        mentions: [
          { kind: "script", target: "player", name: "flag script", topBlockId: "blk1" },
          { kind: "sprite", target: "player" },
          { kind: "script", target: "ghost", topBlockId: "zzz" },
        ],
      });
      await waitFor(f.sent, (m) => m.type === "acp/done" && m.sessionId === sessionId);
      const text = f.sent
        .filter((m) => m.type === "acp/update" && m.sessionId === sessionId)
        .map((m) => (m.update.sessionUpdate === "agent_message_chunk" ? (m.update.content?.text ?? "") : ""))
        .join("");
      match(text, /blocks: text,resource_link:file:\/\/.*player\/scripts\.ts#L3-L8,resource_link:file:\/\/.*player\/scripts\.ts(?!#)/);
      // Checkpoint + turn-start preceded the turn.
      const turnStart = f.sent.find((m) => m.type === "acp/turn-start");
      ok(turnStart, "turn-start emitted");
      equal(turnStart.sessionId, sessionId);
      equal(turnStart.rev, 42);
      deepStrictEqual(f.calls.snapshots, [[sessionId, turnStart.turnId]]);
    } finally {
      await f.host.dispose();
    }
  });

  it("refuses images when the agent lacks image capability", async () => {
    const f = await fixture();
    try {
      const sessionId = await startSession(f);
      await f.host.handle({
        type: "acp/prompt",
        sessionId,
        text: "look",
        images: [{ mimeType: "image/png", data: "aGVsbG8=" }],
      });
      const err = await waitFor(f.sent, (m) => m.type === "acp/error" && /image/i.test(String(m.message)));
      equal(err.sessionId, sessionId);
      equal(f.sent.find((m) => m.type === "acp/turn-start"), undefined, "no turn started");
      equal(f.calls.snapshots.length, 0, "no checkpoint taken");
    } finally {
      await f.host.dispose();
    }
  });

  it("sends image blocks when the agent advertises image support", async () => {
    const f = await fixture({ FAKE_ECHO_PROMPT: "1", FAKE_PROMPT_CAPS: "image" });
    try {
      const sessionId = await startSession(f);
      await f.host.handle({
        type: "acp/prompt",
        sessionId,
        text: "look",
        images: [{ mimeType: "image/png", data: "aGVsbG8=" }],
      });
      await waitFor(f.sent, (m) => m.type === "acp/done" && m.sessionId === sessionId);
      const text = f.sent
        .filter((m) => m.type === "acp/update" && m.sessionId === sessionId)
        .map((m) => (m.update.sessionUpdate === "agent_message_chunk" ? (m.update.content?.text ?? "") : ""))
        .join("");
      match(text, /blocks: text,image:image\/png/);
    } finally {
      await f.host.dispose();
    }
  });
});

describe("passthrough + transcripts", () => {
  it("passes plan, commands, usage, info updates through and records them", async () => {
    const f = await fixture({ FAKE_EXTRA_UPDATES: "1" });
    try {
      const sessionId = await startSession(f);
      await f.host.handle({ type: "acp/prompt", sessionId, text: "hi" });
      await waitFor(f.sent, (m) => m.type === "acp/done" && m.sessionId === sessionId);
      const updates = f.sent.filter((m) => m.type === "acp/update" && m.sessionId === sessionId);
      for (const kind of ["plan", "available_commands_update", "usage_update"]) {
        ok(updates.some((m) => m.update.sessionUpdate === kind), `passthrough ${kind}`);
      }
      const { readFile } = await import("node:fs/promises");
      const transcript = await readFile(join(f.dir, ".agentwarp", "sessions", `${sessionId}.jsonl`), "utf8");
      for (const kind of ["plan", "available_commands_update", "usage_update"]) {
        match(transcript, new RegExp(kind), `transcript records ${kind}`);
      }
    } finally {
      await f.host.dispose();
    }
  });
});

describe("session modes + caps", () => {
  it("extends acp/session with modes and promptCapabilities", async () => {
    const f = await fixture({ FAKE_MODE_OPTION: "1", FAKE_PROMPT_CAPS: "image" });
    try {
      await startSession(f);
      const sess = f.sent.find((m) => m.type === "acp/session");
      ok(sess, "session emitted");
      deepStrictEqual(sess.modes, {
        currentModeId: "build",
        availableModes: [
          { id: "build", name: "Build" },
          { id: "plan", name: "Plan", description: "Plan first" },
        ],
      });
      deepStrictEqual(sess.promptCapabilities, { image: true });
    } finally {
      await f.host.dispose();
    }
  });

  it("acp/set-mode calls session/set_mode and broadcasts acp/mode", async () => {
    const f = await fixture({ FAKE_MODE_OPTION: "1" });
    try {
      const sessionId = await startSession(f);
      await f.host.handle({ type: "acp/set-mode", sessionId, modeId: "plan" });
      const mode = await waitFor(
        f.sent,
        (m) => m.type === "acp/mode" && m.sessionId === sessionId && m.currentModeId === "plan",
      );
      equal(mode.currentModeId, "plan");
    } finally {
      await f.host.dispose();
    }
  });

  it("acp/set-mode errors when the agent has no modes", async () => {
    const f = await fixture();
    try {
      const sessionId = await startSession(f);
      await f.host.handle({ type: "acp/set-mode", sessionId, modeId: "plan" });
      const err = await waitFor(f.sent, (m) => m.type === "acp/error" && /set-mode failed/.test(String(m.message)));
      equal(err.sessionId, sessionId);
      equal(f.sent.find((m) => m.type === "acp/mode"), undefined, "no mode broadcast");
    } finally {
      await f.host.dispose();
    }
  });
});

describe("checkpoints + changes", () => {
  it("emits final changes after done; answers on-request changes; restores", async () => {
    const f = await fixture({}, SAMPLE_CHANGES);
    try {
      const sessionId = await startSession(f);
      await f.host.handle({ type: "acp/prompt", sessionId, text: "hi" });
      const turnStart = await waitFor(f.sent, (m) => m.type === "acp/turn-start");
      const turnId = turnStart.turnId as string;
      await waitFor(f.sent, (m) => m.type === "acp/done" && m.sessionId === sessionId);
      const final = await waitFor(
        f.sent,
        (m) => m.type === "acp/changes" && m.sessionId === sessionId && m.final === true,
      );
      equal(final.turnId, turnId);
      deepStrictEqual(final.targets, SAMPLE_CHANGES);
      // On-request (re)compute goes only to the requester.
      const replies: Sent = [];
      await f.host.handle({ type: "acp/changes", sessionId, turnId }, (m) => replies.push(m as Record<string, any>));
      equal(replies.length, 1);
      equal(replies[0].type, "acp/changes");
      equal(replies[0].final, true);
      deepStrictEqual(replies[0].targets, SAMPLE_CHANGES);
      // Unknown turn answers acp/error.
      const replies2: Sent = [];
      await f.host.handle({ type: "acp/changes", sessionId, turnId: "nope-1" }, (m) => replies2.push(m as Record<string, any>));
      equal(replies2[0].type, "acp/error");
      // Restore replays the snapshot rev.
      await f.host.handle({ type: "acp/restore", sessionId, turnId });
      const restored = await waitFor(f.sent, (m) => m.type === "acp/restored");
      deepStrictEqual([restored.sessionId, restored.turnId, restored.rev], [sessionId, turnId, 7]);
      deepStrictEqual(f.calls.restores, [[sessionId, turnId]]);
    } finally {
      await f.host.dispose();
    }
  });

  it("refuses restore while a turn is running", async () => {
    const f = await fixture({ FAKE_ACP_MODE: "slow" });
    try {
      const sessionId = await startSession(f);
      await f.host.handle({ type: "acp/prompt", sessionId, text: "take your time" });
      await waitFor(f.sent, (m) => m.type === "acp/turn-start");
      await f.host.handle({ type: "acp/restore", sessionId, turnId: "t1" });
      const err = await waitFor(f.sent, (m) => m.type === "acp/error" && /running/.test(String(m.message)));
      equal(err.sessionId, sessionId);
      equal(f.calls.restores.length, 0, "store.restore not called");
      await f.host.handle({ type: "acp/cancel", sessionId });
      await waitFor(f.sent, (m) => m.type === "acp/done" && m.sessionId === sessionId);
    } finally {
      await f.host.dispose();
    }
  });
});

describe("sessions list", () => {
  it("lists newest first with prompt-derived titles, truncated", async () => {
    const f = await fixture();
    try {
      const longPrompt = `add a score counter that increments whenever the cat touches the edge of the stage and resets on flag ${"x".repeat(100)}`;
      await f.host.handle({ type: "acp/start", agentId: "fake" });
      const s1 = await waitFor(f.sent, (m) => m.type === "acp/session");
      await f.host.handle({ type: "acp/prompt", sessionId: s1.sessionId, text: longPrompt });
      await waitFor(f.sent, (m) => m.type === "acp/done" && m.sessionId === s1.sessionId);
      await f.host.handle({ type: "acp/start", agentId: "fake" });
      const s2 = await waitFor(f.sent, (m) => m.type === "acp/session" && m.sessionId !== s1.sessionId);
      await f.host.handle({ type: "acp/prompt", sessionId: s2.sessionId, text: "short prompt" });
      await waitFor(f.sent, (m) => m.type === "acp/done" && m.sessionId === s2.sessionId);
      const replies: Sent = [];
      await f.host.handle({ type: "acp/sessions" }, (m) => replies.push(m as Record<string, any>));
      equal(replies.length, 1);
      equal(replies[0].type, "acp/sessions");
      equal(replies[0].list.length, 2);
      equal(replies[0].list[0].sessionId, s2.sessionId, "newest first");
      equal(replies[0].list[0].title, "short prompt");
      equal(replies[0].list[0].agentId, "fake");
      equal(replies[0].list[0].turns, 1);
      ok(replies[0].list[1].title.length <= 80, "title truncated");
      match(replies[0].list[1].title, /add a score counter/);
      ok(f.sent.find((m) => m.type === "acp/sessions") === undefined, "reply only, no broadcast");
    } finally {
      await f.host.dispose();
    }
  });

  it("prefers session_info_update titles", async () => {
    const f = await fixture({ FAKE_SESSION_TITLE: "My Cool Title" });
    try {
      const sessionId = await startSession(f);
      await f.host.handle({ type: "acp/prompt", sessionId, text: "something else entirely" });
      await waitFor(f.sent, (m) => m.type === "acp/done" && m.sessionId === sessionId);
      const replies: Sent = [];
      await f.host.handle({ type: "acp/sessions" }, (m) => replies.push(m as Record<string, any>));
      equal(replies[0].list[0].title, "My Cool Title");
    } finally {
      await f.host.dispose();
    }
  });
});

describe("load", () => {
  it("replays read-only when the agent cannot load", async () => {
    const f = await fixture();
    let sessionId = "";
    try {
      sessionId = await startSession(f);
      await f.host.handle({ type: "acp/prompt", sessionId, text: "hello" });
      await waitFor(f.sent, (m) => m.type === "acp/done" && m.sessionId === sessionId);
    } finally {
      await f.host.dispose();
    }
    // Fresh host over the same project dir (transcript + meta survive).
    const sent: Sent = [];
    const { createAcpHost: create2 } = await import("../src/index.ts");
    const agents2: AgentDef[] = [{ id: "fake", label: "Fake", command: process.execPath, args: [FAKE], env: {} }];
    const calls = { snapshots: [] as Array<[string, string]>, restores: [] as Array<[string, string]>, diffs: [] as Array<[string, string]> };
    const host2 = create2({ projectDir: f.dir, send: (m) => sent.push(m as Record<string, any>), agents: agents2, turnStore: stubStore(calls) });
    try {
      const replies: Sent = [];
      await host2.handle({ type: "acp/load", sessionId }, (m) => replies.push(m as Record<string, any>));
      const sess = replies.find((m) => m.type === "acp/session");
      ok(sess, "session reply");
      equal(sess.readOnly, true);
      equal(sess.agentId, "fake");
      ok(replies.some((m) => m.type === "acp/update"), "transcript replayed as updates");
      ok(sent.find((m) => m.type === "acp/session") === undefined, "nothing broadcast");
    } finally {
      await host2.dispose();
    }
  });

  it("loads live via session/load and keeps prompting", async () => {
    const f = await fixture({ FAKE_SUPPORT_LOAD: "1" });
    let sessionId = "";
    try {
      sessionId = await startSession(f);
      await f.host.handle({ type: "acp/prompt", sessionId, text: "hello" });
      await waitFor(f.sent, (m) => m.type === "acp/done" && m.sessionId === sessionId);
    } finally {
      await f.host.dispose();
    }
    const sent: Sent = [];
    const { createAcpHost: create2 } = await import("../src/index.ts");
    const agents2: AgentDef[] = [{ id: "fake", label: "Fake", command: process.execPath, args: [FAKE], env: { FAKE_SUPPORT_LOAD: "1" } }];
    const calls = { snapshots: [] as Array<[string, string]>, restores: [] as Array<[string, string]>, diffs: [] as Array<[string, string]> };
    const host2 = create2({ projectDir: f.dir, send: (m) => sent.push(m as Record<string, any>), agents: agents2, turnStore: stubStore(calls) });
    try {
      await host2.handle({ type: "acp/load", sessionId });
      const sess = await waitFor(sent, (m) => m.type === "acp/session" && m.sessionId === sessionId);
      equal(sess.readOnly, undefined);
      await waitFor(sent, (m) => m.type === "acp/update" && /loaded history/.test(String(m.update?.content?.text ?? "")));
      // The loaded session is live: prompting works through the new host.
      await host2.handle({ type: "acp/prompt", sessionId, text: "follow-up" });
      await waitFor(sent, (m) => m.type === "acp/done" && m.sessionId === sessionId);
    } finally {
      await host2.dispose();
    }
  });

  it("resumes via session/resume with transcript replay", async () => {
    const f = await fixture({ FAKE_SUPPORT_RESUME: "1" });
    let sessionId = "";
    try {
      sessionId = await startSession(f);
      await f.host.handle({ type: "acp/prompt", sessionId, text: "hello resume" });
      await waitFor(f.sent, (m) => m.type === "acp/done" && m.sessionId === sessionId);
    } finally {
      await f.host.dispose();
    }
    const sent: Sent = [];
    const { createAcpHost: create2 } = await import("../src/index.ts");
    const agents2: AgentDef[] = [{ id: "fake", label: "Fake", command: process.execPath, args: [FAKE], env: { FAKE_SUPPORT_RESUME: "1" } }];
    const calls = { snapshots: [] as Array<[string, string]>, restores: [] as Array<[string, string]>, diffs: [] as Array<[string, string]> };
    const host2 = create2({ projectDir: f.dir, send: (m) => sent.push(m as Record<string, any>), agents: agents2, turnStore: stubStore(calls) });
    try {
      const replies: Sent = [];
      await host2.handle({ type: "acp/load", sessionId }, (m) => replies.push(m as Record<string, any>));
      const sess = await waitFor(sent, (m) => m.type === "acp/session" && m.sessionId === sessionId);
      equal(sess.readOnly, undefined);
      ok(replies.some((m) => m.type === "acp/update"), "transcript replayed to the requester");
      await host2.handle({ type: "acp/prompt", sessionId, text: "after resume" });
      await waitFor(sent, (m) => m.type === "acp/done" && m.sessionId === sessionId);
    } finally {
      await host2.dispose();
    }
  });
});
