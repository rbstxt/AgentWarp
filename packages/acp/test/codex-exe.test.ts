// Windows: the user's codex.exe must be found inside an `npm install -g @openai/codex` tree, or the
// Codex ACP adapter gets no CODEX_PATH and falls back to the @openai/codex bundled with agentwarp,
// whose platform binary the desktop app leaves out ("Missing optional dependency @openai/codex-win32-x64").
import { equal } from "node:assert";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { findCodexExe } from "../src/agents.ts";

async function tree(files: string[]): Promise<string> {
  const nm = join(await mkdtemp(join(tmpdir(), "codex-exe-")), "node_modules");
  for (const rel of files) {
    const file = join(nm, ...rel.split("/"));
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, "");
  }
  return nm;
}

const LAUNCHER = "@openai/codex/bin/codex.js";
const VENDOR = "vendor/x86_64-pc-windows-msvc";

describe("findCodexExe", () => {
  it("finds codex.exe in the nested layout of npm install -g (codex 0.170)", async () => {
    const exe = `@openai/codex/node_modules/@openai/codex-win32-x64/${VENDOR}/bin/codex.exe`;
    const nm = await tree([
      LAUNCHER,
      `@openai/codex/node_modules/@openai/codex-win32-x64/${VENDOR}/codex-resources/codex-command-runner.exe`,
      `@openai/codex/node_modules/@openai/codex-win32-x64/${VENDOR}/codex-path/rg.exe`,
      exe,
    ]);
    try {
      equal(await findCodexExe(nm), join(nm, ...exe.split("/")));
    } finally {
      await rm(join(nm, ".."), { recursive: true, force: true });
    }
  });

  it("finds codex.exe when the platform package is hoisted next to the launcher", async () => {
    const exe = `@openai/codex-win32-x64/${VENDOR}/bin/codex.exe`;
    const nm = await tree([LAUNCHER, exe]);
    try {
      equal(await findCodexExe(nm), join(nm, ...exe.split("/")));
    } finally {
      await rm(join(nm, ".."), { recursive: true, force: true });
    }
  });

  it("is null when the platform package is missing", async () => {
    const nm = await tree([LAUNCHER]);
    try {
      equal(await findCodexExe(nm), null);
    } finally {
      await rm(join(nm, ".."), { recursive: true, force: true });
    }
  });
});
