/**
 * "Is this the same Scratch project?" — a fingerprint of a project.json that ignores runtime state
 * (sprite positions, current costume, variable values, monitor state, key order) and keeps what a
 * human would call the project's identity: targets and their names, block ids + opcodes, and the
 * names of costumes, sounds, variables, lists and broadcasts. Block ids survive the whole
 * agentwarp pipeline (unoptimized serializer, lossless pack), so equal fingerprints mean the
 * editor holds the workspace's project.
 */
export function projectFingerprint(project: any): string {
    const targets = Array.isArray(project?.targets) ? project.targets : [];
    const parts = targets.map((t: any) => {
        const blocks = Object.entries(t?.blocks ?? {})
            .map(([id, b]: [string, any]) => `${id}:${Array.isArray(b) ? `#${b[0]}` : b?.opcode ?? '?'}`)
            .sort();
        const names = (o: any) => Object.values(o ?? {}).map((v: any) => (Array.isArray(v) ? String(v[0]) : String(v))).sort();
        return JSON.stringify([
            t?.isStage ? 'stage' : 'sprite',
            String(t?.name ?? ''),
            blocks,
            (t?.costumes ?? []).map((c: any) => String(c?.name ?? '')),
            (t?.sounds ?? []).map((s: any) => String(s?.name ?? '')),
            names(t?.variables),
            names(t?.lists),
            names(t?.broadcasts),
        ]);
    });
    return parts.sort().join('\n');
}
