/**
 * OpenCode's free models (OpenCode Zen, `opencode/<id>-free` and Big Pickle). They work right
 * after installing OpenCode, without signing in, so they are the way in for people who have no
 * Claude or ChatGPT subscription. The list changes over time, so match by name.
 */
export const isFreeModel = (agentId: string, value: unknown): boolean =>
  /opencode/i.test(agentId) && /^opencode\/[^/]*(-free\b|big-pickle)/i.test(String(value));

/** Free models whose providers keep no data and do not train on it (per OpenCode's docs). */
const RECOMMENDED = [/^opencode\/glm-[\d.]+-flash-free/i, /^opencode\/deepseek-[^/]*-free/i, /^opencode\/minimax-[^/]*-free/i];

/** The free model to start with, if the agent offers one. */
export function pickFreeModel(values: string[]): string | undefined {
  for (const pattern of RECOMMENDED) {
    const hit = values.find((v) => pattern.test(v));
    if (hit) return hit;
  }
  return values.find((v) => isFreeModel('opencode', v));
}
