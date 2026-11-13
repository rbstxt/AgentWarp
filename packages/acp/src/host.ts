import { spawn, type ChildProcess } from "node:child_process";
import { realpathSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import {
  client,
  ndJsonStream,
  type ActiveSession,
  type ClientConnection,
  type ClientContext,
} from "@agentclientprotocol/sdk";
import {
  detectAll,
  loadAgentRegistry,
  type AgentDef,
  type AgentStatus,
} from "./agents.ts";
import { chooseAutoAllow, type PermissionOptionLike } from "./policy.ts";
import { appendTranscript, readTranscript } from "./transcripts.ts";

export const HOST_VERSION = "0.1.0";

export interface AcpHostOptions {
  projectDir: string;
  send: (msg: object) => void;
  agentsConfigPath?: string;
  log?: (...a: unknown[]) => void;
  /** Default permission policy (auto-allow project-local edits + agentwarp commands). Default true. */
  autoAllow?: boolean;
  /** How long to wait for an acp/permission reply before treating it as rejected. Default 10 min. */
  permissionTimeoutMs?: number;
  /** Test hook: bypass the on-disk registry with a fixed agent list. */
  agents?: AgentDef[];
}

export interface AcpHost {
  handle(msg: unknown, reply?: (msg: object) => void): Promise<void>;
  dispose(): Promise<void>;
}

interface PendingPermission {
  options: PermissionOptionLike[];
  toolKey: string;
  sessionId: string;
  resolve: (optionId: string | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ConnState {
  def: AgentDef;
  child: ChildProcess;
  connection: ClientConnection;
  agent: ClientContext;
  dead: boolean;
  stderrTail: string;
  sessions: Set<string>;
}

interface SessionState {
  sessionId: string;
  agentId: string;
  active: ActiveSession;
  turnRunning: boolean;
  pump: Promise<void>;
  configOptions: ActiveSession['newSessionResponse']['configOptions'];
}

/** Build the `[TurboWarp] …` context line prepended to prompts (docs/P5-DESIGN.md). */
export function formatEditorContext(context: unknown): string {
  if (context == null) return "";
  if (typeof context === "string") return context ? `[TurboWarp] ${context}` : "";
  if (typeof context !== "object") return "";
  const c = context as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === "string" && v ? v : "");
  const num = (v: unknown): string =>
    typeof v === "number" && Number.isFinite(v) ? String(v) : "";
  const parts: string[] = [];
  const target = str(c.editingTarget ?? c.target);
  const scripts = str(c.scriptsPath ?? c.scripts);
  if (target || scripts) {
    parts.push(`editing: ${target || "?"}${scripts ? ` (${scripts})` : ""}`);
  }
  const selected = str(c.selectedBlock ?? c.selected ?? c.selectedBlockId);
  const loc = str(c.selectedLocation ?? c.location ?? c.anchor);
  if (selected || loc) {
    parts.push(`selected: ${selected || "?"}${loc ? ` (${loc})` : ""}`);
  }
  const rev = num(c.rev);
  if (rev) parts.push(`rev ${rev}`);
  if (c.running === true) parts.push("running");
  const stage = str(c.stageSize ?? c.stage);
  if (stage) parts.push(`stage ${stage}`);
  return parts.length > 0 ? `[TurboWarp] ${parts.join(" · ")}` : "";
}

export function createAcpHost(opts: AcpHostOptions): AcpHost {
  let projectDir: string = opts.projectDir;
  try {
    projectDir = realpathSync(opts.projectDir);
  } catch {
    /* project dir may not exist yet; use as-is */
  }
  const log: (...a: unknown[]) => void = opts.log ?? (() => undefined);
  const autoAllow = opts.autoAllow ?? true;
  const permissionTimeoutMs = opts.permissionTimeoutMs ?? 10 * 60 * 1000;

  let registry: AgentDef[] | null = opts.agents ? [...opts.agents] : null;
  const conns = new Map<string, ConnState>();
  const sessions = new Map<string, SessionState>();
  const pendingPerms = new Map<string, PendingPermission>();
  /** "always" decisions: `${sessionId}:${toolKey}` -> optionId */
  const sticky = new Map<string, string>();
  let permSeq = 0;
  let disposed = false;

  function emit(msg: object): void {
    try {
      opts.send(msg);
    } catch (e) {
      log("acp send failed:", e);
    }
  }

  async function agents(): Promise<AgentDef[]> {
    if (!registry) registry = await loadAgentRegistry({ projectDir, agentsConfigPath: opts.agentsConfigPath });
    return registry;
  }

  function findSession(sessionId: string): SessionState | undefined {
    return sessions.get(sessionId);
  }

  function settlePermission(requestId: string, optionId: string | null): void {
    const p = pendingPerms.get(requestId);
    if (!p) return;
    pendingPerms.delete(requestId);
    clearTimeout(p.timer);
    const valid = optionId != null && p.options.some((o) => o.optionId === optionId);
    if (!valid && optionId != null) {
      log(`acp/permission: unknown optionId ${optionId} for ${requestId}; treating as reject`);
    }
    const chosen = valid ? (optionId as string) : null;
    if (chosen) {
      const kind = p.options.find((o) => o.optionId === chosen)?.kind;
      if (kind === "allow_always" || kind === "reject_always") {
        sticky.set(`${p.sessionId}:${p.toolKey}`, chosen);
      }
    }
    p.resolve(chosen);
  }

  function onChildExit(conn: ConnState, info: string): void {
    if (conn.dead) return;
    conn.dead = true;
    conns.delete(conn.def.id);
    const suffix = conn.stderrTail ? `: ${conn.stderrTail}` : "";
    const message = `agent ${conn.def.id} exited (${info})${suffix}`;
    log(message);
    for (const sid of conn.sessions) {
      const s = sessions.get(sid);
      if (s?.turnRunning) {
        s.turnRunning = false;
        emit({ type: "acp/error", sessionId: sid, message });
      }
      sessions.delete(sid);
    }
    // Unblock any permission handlers waiting on this agent.
    for (const [id, p] of [...pendingPerms]) {
      const sess = sessions.get(p.sessionId);
      if (!sess || sess.agentId === conn.def.id) settlePermission(id, null);
    }
    try {
      conn.connection.close();
    } catch {
      /* ignore */
    }
  }

  async function ensureConn(def: AgentDef): Promise<ConnState> {
    const existing = conns.get(def.id);
    if (existing && !existing.dead) return existing;

    let command = def.command;
    // Resolve relative command paths against the project dir.
    if (command.startsWith("./") || command.startsWith("../") || command.startsWith(".")) {
      const { resolve } = await import("node:path");
      command = resolve(projectDir, command);
    }

    let child: ChildProcess;
    try {
      child = spawn(command, def.args, {
        cwd: projectDir,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...(def.env ?? {}) },
      });
    } catch (e) {
      throw new Error(`failed to spawn ${def.id} (${command}): ${(e as Error)?.message}`);
    }

    const conn: ConnState = {
      def,
      child,
      connection: undefined as unknown as ClientConnection,
      agent: undefined as unknown as ClientContext,
      dead: false,
      stderrTail: "",
      sessions: new Set(),
    };

    child.on("error", (e) => {
      onChildExit(conn, `spawn error: ${(e as Error)?.message}`);
      void appendTranscript(projectDir, `agent-${def.id}`, {
        kind: "error",
        message: `spawn error: ${(e as Error)?.message}`,
      }).catch(() => undefined);
    });
    child.stderr?.on("data", (d: Buffer) => {
      const text = String(d);
      conn.stderrTail = `${conn.stderrTail}${text}`.slice(-2000);
      for (const line of text.split("\n")) {
        if (line.trim()) log(`[${def.id} stderr]`, line);
      }
    });
    child.on("exit", (code, signal) => {
      onChildExit(conn, code != null ? `code ${code}` : `signal ${signal}`);
    });

    if (!child.stdin || !child.stdout) {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      throw new Error(`failed to spawn ${def.id}: stdio unavailable`);
    }

    const app = client({ name: "agentwarp-acp-host" });
    app.onRequest("session/request_permission", async (ctx) => {
      const params = ctx.params as {
        sessionId: string;
        toolCall: Record<string, unknown>;
        options: PermissionOptionLike[];
      };
      const toolCall = params.toolCall ?? {};
      const options = params.options ?? [];
      const toolKey = String(
        (toolCall as { name?: unknown }).name ?? (toolCall as { title?: unknown }).title ?? "?",
      );
      const rejectFallback = options.find((o) => o.kind === "reject_once");
      if (options.length === 0) return { outcome: { outcome: "cancelled" } } as const;

      const stickyKey = `${params.sessionId}:${toolKey}`;
      const remembered = sticky.get(stickyKey);
      if (remembered && options.some((o) => o.optionId === remembered)) {
        log(`permission ${toolKey}: applying remembered ${remembered}`);
        return { outcome: { outcome: "selected", optionId: remembered } } as const;
      }

      if (autoAllow) {
        const auto = chooseAutoAllow(
          toolCall as Parameters<typeof chooseAutoAllow>[0],
          options,
          projectDir,
        );
        if (auto) {
          log(`permission ${toolKey}: auto-allowed by default policy`);
          void appendTranscript(projectDir, params.sessionId, {
            kind: "permission-auto",
            toolCall,
            optionId: auto,
          }).catch(() => undefined);
          return { outcome: { outcome: "selected", optionId: auto } } as const;
        }
      }

      const requestId = `perm-${++permSeq}`;
      emit({
        type: "acp/permission-request",
        requestId,
        sessionId: params.sessionId,
        toolCall,
        options,
      });
      const optionId = await new Promise<string | null>((resolvePromise) => {
        const timer = setTimeout(() => settlePermission(requestId, null), permissionTimeoutMs);
        pendingPerms.set(requestId, {
          options,
          toolKey,
          sessionId: params.sessionId,
          resolve: resolvePromise,
          timer,
        });
      });
      if (optionId == null) {
        if (rejectFallback) return { outcome: { outcome: "selected", optionId: rejectFallback.optionId } } as const;
        return { outcome: { outcome: "cancelled" } } as const;
      }
      return { outcome: { outcome: "selected", optionId } } as const;
    });

    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
    );
    const connection = app.connect(stream);
    conn.connection = connection;
    conn.agent = connection.agent;

    try {
      await conn.agent.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: { fs: {}, terminal: false },
        clientInfo: { name: "agentwarp-acp-host", version: HOST_VERSION },
      });
    } catch (e) {
      const message = `agent ${def.id} initialize failed: ${(e as Error)?.message}${conn.stderrTail ? `: ${conn.stderrTail}` : ""}`;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      conns.delete(def.id);
      throw new Error(message);
    }
    connection.closed
      .then(() => onChildExit(conn, "connection closed"))
      .catch(() => undefined);
    conns.set(def.id, conn);
    return conn;
  }

  function startPump(sess: SessionState): void {
    sess.pump = (async () => {
      try {
        for (;;) {
          if (disposed) return;
          const msg = await sess.active.nextUpdate();
          if (msg.kind === "session_update") {
            if (msg.update.sessionUpdate === 'config_option_update') sess.configOptions = msg.update.configOptions;
            void appendTranscript(projectDir, sess.sessionId, {
              kind: "update",
              update: msg.update,
            }).catch(() => undefined);
            emit({ type: "acp/update", sessionId: sess.sessionId, update: msg.update });
          } else {
            sess.turnRunning = false;
            void appendTranscript(projectDir, sess.sessionId, {
              kind: "done",
              stopReason: msg.stopReason,
            }).catch(() => undefined);
            emit({ type: "acp/done", sessionId: sess.sessionId, stopReason: msg.stopReason });
          }
        }
      } catch (e) {
        if (disposed) return;
        sess.turnRunning = false;
        const conn = conns.get(sess.agentId);
        if (!conn || conn.dead) {
          // onChildExit already emitted acp/error for running turns.
          sessions.delete(sess.sessionId);
          return;
        }
        const message = `session ${sess.sessionId}: ${(e as Error)?.message ?? e}`;
        log(message);
        emit({ type: "acp/error", sessionId: sess.sessionId, message });
      }
    })();
  }

  async function doStart(agentId: string): Promise<void> {
    const defs = await agents();
    const def = defs.find((d) => d.id === agentId);
    if (!def) {
      emit({ type: "acp/error", message: `unknown agent: ${agentId}` });
      return;
    }
    let conn: ConnState;
    try {
      conn = await ensureConn(def);
    } catch (e) {
      emit({ type: "acp/error", message: (e as Error)?.message ?? String(e) });
      return;
    }
    if (conn.dead) {
      emit({ type: "acp/error", message: `agent ${agentId} exited before session start` });
      return;
    }
    try {
      const active = await conn.agent.buildSession(projectDir).start();
      const sessionId = active.sessionId;
      const sess: SessionState = { sessionId, agentId: def.id, active, turnRunning: false, pump: Promise.resolve(), configOptions: active.newSessionResponse.configOptions };
      sessions.set(sessionId, sess);
      conn.sessions.add(sessionId);
      startPump(sess);
      emit({ type: "acp/session", sessionId, agentId: def.id, configOptions: sess.configOptions });
    } catch (e) {
      emit({ type: "acp/error", message: `session/new failed for ${agentId}: ${(e as Error)?.message}` });
    }
  }

  async function doPrompt(msg: {
    sessionId?: string;
    text?: string;
    context?: unknown;
  }): Promise<void> {
    const sess = msg.sessionId ? findSession(msg.sessionId) : undefined;
    if (!sess) {
      emit({ type: "acp/error", sessionId: msg.sessionId, message: `unknown session: ${msg.sessionId}` });
      return;
    }
    if (sess.turnRunning) {
      emit({ type: "acp/error", sessionId: sess.sessionId, message: "a turn is already running for this session" });
      return;
    }
    const conn = conns.get(sess.agentId);
    if (!conn || conn.dead) {
      emit({ type: "acp/error", sessionId: sess.sessionId, message: `agent ${sess.agentId} is not running` });
      return;
    }
    const contextLine = formatEditorContext(msg.context);
    const text = typeof msg.text === "string" ? msg.text : "";
    const full = contextLine ? `${contextLine}\n\n${text}` : text;
    sess.turnRunning = true;
    void appendTranscript(projectDir, sess.sessionId, { kind: "user", text: full }).catch(() => undefined);
    // Fire-and-forget: the pump loop observes updates + the final stop, so
    // handle() must stay responsive (e.g. permission replies arrive via
    // handle() while the turn is running).
    void sess.active
      .prompt(full)
      .then(
        () => undefined,
        (e: unknown) => {
          // If the host is gone or the session was already cleaned up (e.g.
          // agent death, which emits its own acp/error), stay quiet to avoid
          // double-reporting.
          if (disposed || !sessions.has(sess.sessionId)) return;
          sess.turnRunning = false;
          emit({
            type: "acp/error",
            sessionId: sess.sessionId,
            message: `prompt failed: ${(e as Error)?.message ?? e}`,
          });
        },
      );
  }

  async function doCancel(sessionId: string): Promise<void> {
    const sess = findSession(sessionId);
    if (!sess) {
      emit({ type: "acp/error", sessionId, message: `unknown session: ${sessionId}` });
      return;
    }
    const conn = conns.get(sess.agentId);
    if (!conn || conn.dead) {
      sess.turnRunning = false;
      emit({ type: "acp/error", sessionId, message: `agent ${sess.agentId} is not running` });
      return;
    }
    try {
      await conn.agent.notify("session/cancel", { sessionId });
    } catch (e) {
      emit({ type: "acp/error", sessionId, message: `cancel failed: ${(e as Error)?.message ?? e}` });
    }
  }

  async function doHistory(sessionId: string, reply: (msg: object) => void): Promise<void> {
    const session = findSession(sessionId);
    const entries = await readTranscript(projectDir, sessionId);
    if (!entries) {
      reply({ type: "acp/error", sessionId, message: `no transcript for session ${sessionId}` });
      return;
    }
    for (const entry of entries) {
      const e = entry as { kind?: string; update?: unknown; stopReason?: string };
      if (e.kind === "update") {
        reply({ type: "acp/update", sessionId, update: e.update });
      } else if (e.kind === "user") {
        reply({
          type: "acp/update",
          sessionId,
          update: {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: (e as { text?: string }).text ?? "" },
          },
        });
      } else if (e.kind === "done") {
        reply({ type: "acp/done", sessionId, stopReason: e.stopReason });
      }
      // permission-auto entries are host-internal; skip them on replay.
    }
    if (session) reply({ type: "acp/config", sessionId, configOptions: session.configOptions });
  }

  async function handle(msg: unknown, reply: (msg: object) => void = emit): Promise<void> {
    if (disposed) return;
    const m = msg as { type?: string } | null;
    if (!m || typeof m !== "object" || typeof m.type !== "string") {
      log("acp: ignoring malformed message", msg);
      return;
    }
    const full = m as Record<string, unknown>;
    try {
      switch (m.type) {
        case "acp/agents": {
          const defs = await agents();
          const list: AgentStatus[] = await detectAll(defs);
          reply({ type: "acp/agents", list });
          break;
        }
        case "acp/start":
          await doStart(String(full.agentId ?? ""));
          break;
        case "acp/prompt":
          await doPrompt({
            sessionId: typeof full.sessionId === "string" ? full.sessionId : undefined,
            text: typeof full.text === "string" ? full.text : "",
            context: full.context,
          });
          break;
        case "acp/cancel":
          await doCancel(String(full.sessionId ?? ""));
          break;
        case "acp/permission":
          settlePermission(
            String(full.requestId ?? ""),
            typeof full.optionId === "string" ? full.optionId : null,
          );
          break;
        case "acp/history":
          await doHistory(String(full.sessionId ?? ""), reply);
          break;
        case "acp/set-config": {
          const sess = findSession(String(full.sessionId ?? ""));
          if (!sess) throw new Error(`unknown session: ${full.sessionId}`);
          const conn = conns.get(sess.agentId);
          if (!conn || conn.dead) throw new Error(`agent ${sess.agentId} is not running`);
          const result = await conn.agent.request('session/set_config_option', { sessionId: sess.sessionId, configId: String(full.optionId ?? ""), value: String(full.value ?? "") });
          sess.configOptions = result.configOptions;
          emit({ type: "acp/config", sessionId: sess.sessionId, configOptions: result.configOptions });
          break;
        }
        default:
          log(`acp: ignoring unknown message type ${m.type}`);
      }
    } catch (e) {
      emit({ type: "acp/error", message: `acp/${m.type} failed: ${(e as Error)?.message ?? e}` });
    }
  }

  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;
    for (const [id] of [...pendingPerms]) settlePermission(id, null);
    for (const [, conn] of [...conns]) {
      try {
        conn.connection.close();
      } catch {
        /* ignore */
      }
      try {
        conn.child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
    // Give children a moment to exit, then SIGKILL stragglers.
    await new Promise((r) => setTimeout(r, 300));
    for (const [, conn] of [...conns]) {
      try {
        if (conn.child.exitCode == null && conn.child.signalCode == null) conn.child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
    conns.clear();
    sessions.clear();
  }

  return { handle, dispose };
}
