import React from 'react';
import {Check, Copy, ExternalLink, RefreshCw, TerminalSquare} from 'lucide-react';
import {ProviderIcon} from './ProviderIcon';

/** What the engine reports per agent (acp/agents), see packages/acp/src/agents.ts. */
export type AgentCli = {
  name: string;
  path: string | null;
  version?: string;
  auth: 'authenticated' | 'unauthenticated' | 'unknown';
  install: string;
  login: string;
  docs: string;
};
export type AgentInfo = {id: string; label: string; available: boolean | 'unknown'; note?: string; cli?: AgentCli};
export type AgentState = 'ready' | 'missing' | 'signin' | 'unavailable';

/** Ready = the agent can start a chat now. */
export function agentState(agent: AgentInfo): AgentState {
  if (agent.cli && !agent.cli.path) return 'missing';
  if (agent.cli?.auth === 'unauthenticated') return 'signin';
  if (agent.available === false) return 'unavailable';
  return 'ready';
}

type Label = (en: string, ja: string) => string;

/** Which agent fits which plan: the question a new user can actually answer. */
const PATHS: {id: string; plan: [string, string]; product: string; free?: boolean}[] = [
  {id: 'claude', plan: ['I have Claude Pro or Max', 'Claude Pro / Max を持っている'], product: 'Claude Code'},
  {id: 'codex', plan: ['I have ChatGPT Plus or Pro', 'ChatGPT Plus / Pro を持っている'], product: 'Codex CLI'},
  {id: 'opencode', plan: ['No subscription (start free)', 'サブスクなし（無料で始める）'], product: 'OpenCode', free: true}
];

function Command({command, label}: {command: string; label: Label}) {
  const [copied, setCopied] = React.useState(false);
  const desktop = (window as any).AgentWarpDesktop;
  const [opened, setOpened] = React.useState(false);
  const [error, setError] = React.useState('');
  return (
    <div className="setup-command">
      <code>{command}</code>
      <div className="setup-command-actions">
        <button
          type="button"
          className="setup-button"
          onClick={() => {
            navigator.clipboard?.writeText(command).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }).catch(() => undefined);
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? label('Copied', 'コピーしました') : label('Copy', 'コピー')}
        </button>
        {desktop?.openTerminal && (
          <button
            type="button"
            className="setup-button primary"
            onClick={() => {
              setError('');
              desktop.openTerminal(command).then(() => setOpened(true)).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
            }}
          >
            <TerminalSquare size={13} />
            {opened ? label('Opened in Terminal', 'ターミナルで開きました') : label('Run in Terminal', 'ターミナルで実行')}
          </button>
        )}
      </div>
      {error && <p className="setup-error">{error}</p>}
    </div>
  );
}

function Badge({state, label}: {state: AgentState; label: Label}) {
  const text = {
    ready: label('Ready', '準備OK'),
    missing: label('Not installed', '未インストール'),
    signin: label('Sign-in required', 'サインインが必要'),
    unavailable: label('Unavailable', '使えません')
  }[state];
  return <span className={`setup-badge ${state}`}>{state === 'ready' && <Check size={11} />}{text}</span>;
}

/** What to do for one agent: install, sign in (not for OpenCode's free models), start. */
function Steps({agent, free, label, onStart, selected}: {agent: AgentInfo; free: boolean; label: Label; onStart: () => void; selected: boolean}) {
  const state = agentState(agent);
  const cli = agent.cli;
  if (state === 'unavailable') return <div className="setup-steps"><p>{agent.note || label('This agent cannot run here.', 'このエージェントはここでは使えません。')}</p></div>;
  const needsSignIn = !free && (state === 'missing' || state === 'signin');
  let n = 0;
  return (
    <div className="setup-steps">
      {state === 'missing' && cli && (
        <div className="setup-step">
          <p><b>{++n}</b>{label('Install it (needs Node.js):', 'インストールします（Node.js が必要です）：')}</p>
          <Command command={cli.install} label={label} />
          <p className="setup-note">
            {label('No npm command? Install ', '「npm」が見つからないと出たら、先に ')}
            <a href="https://nodejs.org/" target="_blank" rel="noreferrer">Node.js<ExternalLink size={10} /></a>
            {label(' (LTS) first.', '（LTS 版）を入れてください。')}
          </p>
        </div>
      )}
      {needsSignIn && cli && (
        <div className="setup-step">
          <p><b>{++n}</b>{label('Sign in with your subscription (a browser opens):', 'サブスクリプションのアカウントでサインインします（ブラウザが開きます）：')}</p>
          <Command command={cli.login} label={label} />
        </div>
      )}
      {free && (
        <div className="setup-step">
          <p><b>{++n}</b>{label('No sign-in needed: OpenCode\'s free models work right away.', 'サインインは不要です。OpenCode の無料モデルがすぐ使えます。')}</p>
          <p className="setup-note">
            {label(
              'Some free models may use what you send to improve the model. Do not send personal information.',
              '無料モデルの一部は、送った内容をモデルの改善に使うことがあります。個人情報は送らないでください。'
            )}
          </p>
        </div>
      )}
      {state === 'ready' ? (
        selected && !free ? (
          <p className="setup-done"><Check size={13} />{label('Ready. Type what you want to make below.', '準備できました。下の欄にやりたいことを書いてください。')}</p>
        ) : (
          <button type="button" className="setup-start" onClick={onStart}>
            {free ? label('Start with a free model', '無料モデルで始める') : label(`Start with ${cli?.name || agent.label}`, `${cli?.name || agent.label} で始める`)}
          </button>
        )
      ) : (
        <p className="setup-note">{label('When done, press "Check again".', '終わったら「もう一度確認」を押してください。')}</p>
      )}
    </div>
  );
}

/**
 * Setup, like T3 Code's provider setup: AgentWarp uses the agent CLIs installed on this computer
 * and their sign-in. First asks which plan the user has (Claude, ChatGPT, or none: OpenCode's
 * free models), then shows the exact steps for that agent; re-checks when the user comes back
 * from the terminal.
 */
export function Onboarding({agents, selectedAgent, label, onSelect, onFree, onRecheck, compact}: {
  agents: AgentInfo[];
  selectedAgent?: string;
  label: Label;
  onSelect: (id: string) => void;
  /** use OpenCode with a free model */
  onFree: () => void;
  onRecheck: () => void;
  /** some agent is ready: show the setup without the welcome text */
  compact?: boolean;
}) {
  const [checking, setChecking] = React.useState(false);
  const [chosen, setChosen] = React.useState<string | null>(() => {
    if (compact) return null;
    return agents.find((a) => agentState(a) === 'signin')?.id || null;
  });
  const recheck = React.useCallback(() => {
    setChecking(true);
    onRecheck();
    setTimeout(() => setChecking(false), 1200);
  }, [onRecheck]);
  // Coming back from the terminal: check again.
  React.useEffect(() => {
    let last = 0;
    const onFocus = () => {
      if (Date.now() - last < 3000) return;
      last = Date.now();
      onRecheck();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [onRecheck]);
  const byId = new Map(agents.map((a) => [a.id, a]));
  const paths = PATHS.filter((p) => byId.has(p.id));
  const others = agents.filter((a) => !PATHS.some((p) => p.id === a.id));
  return (
    <section className="setup" aria-labelledby="aw-setup-title">
      {compact ? (
        <h3 id="aw-setup-title">{label('Agents', 'エージェント')}</h3>
      ) : (
        <>
          <h2 id="aw-setup-title">{label('Set up an agent', 'エージェントを準備しましょう')}</h2>
          <p className="setup-lead">
            {label(
              'AgentWarp works with a coding agent on this computer. Which of these fits you?',
              'AgentWarp は、このパソコンのコーディングエージェントと一緒に動きます。あてはまるものを選んでください。'
            )}
          </p>
        </>
      )}
      <ul className="setup-paths" role="list">
        {paths.map((p) => {
          const agent = byId.get(p.id)!;
          const state = agentState(agent);
          const open = chosen === p.id;
          return (
            <li key={p.id} className={`setup-path${open ? ' open' : ''}${agent.id === selectedAgent && state === 'ready' ? ' current' : ''}`}>
              <button type="button" className="setup-path-head" aria-expanded={open} onClick={() => setChosen(open ? null : p.id)}>
                <ProviderIcon id={p.id} />
                <span className="setup-path-text">
                  <strong>{label(...p.plan)}</strong>
                  <small>
                    {p.free ? label('OpenCode with free models', 'OpenCode の無料モデル') : p.product}
                    {agent.cli?.version && state !== 'missing' ? ` · ${agent.cli.version}` : ''}
                  </small>
                </span>
                {p.free && state !== 'ready' ? <span className="setup-badge free">{label('Free', '無料')}</span> : <Badge state={state} label={label} />}
              </button>
              {open && (
                <Steps
                  agent={agent}
                  free={!!p.free}
                  label={label}
                  selected={agent.id === selectedAgent}
                  onStart={() => (p.free ? onFree() : onSelect(agent.id))}
                />
              )}
            </li>
          );
        })}
        {others.map((agent) => (
          <li key={agent.id} className="setup-path">
            <div className="setup-path-head">
              <ProviderIcon id={agent.id} />
              <span className="setup-path-text"><strong>{agent.label}</strong>{agent.note && <small>{agent.note}</small>}</span>
              <Badge state={agentState(agent)} label={label} />
            </div>
          </li>
        ))}
      </ul>
      <button type="button" className="setup-recheck" onClick={recheck} disabled={checking}>
        <RefreshCw size={13} className={checking ? 'spin' : ''} />
        {label('Check again', 'もう一度確認')}
      </button>
    </section>
  );
}
