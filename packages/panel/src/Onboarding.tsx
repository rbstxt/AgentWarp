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

function AgentRow({agent, label, selected, onSelect}: {agent: AgentInfo; label: Label; selected: boolean; onSelect: (id: string) => void}) {
  const state = agentState(agent);
  const cli = agent.cli;
  const name = cli?.name || agent.label;
  const badge = {
    ready: label('Ready', '準備OK'),
    missing: label('Not installed', '未インストール'),
    signin: label('Sign-in required', 'サインインが必要'),
    unavailable: label('Unavailable', '使えません')
  }[state];
  return (
    <li className={`setup-agent ${state}${selected ? ' selected' : ''}`}>
      <div className="setup-agent-head">
        <ProviderIcon id={agent.id} />
        <strong>{name}</strong>
        <span className={`setup-badge ${state}`}>{state === 'ready' && <Check size={11} />}{badge}</span>
      </div>
      {state === 'ready' && (
        <div className="setup-agent-body">
          {cli?.version && <small>{cli.version}</small>}
          {!selected && (
            <button type="button" className="setup-link" onClick={() => onSelect(agent.id)}>
              {label(`Use ${agent.label}`, `${agent.label} を使う`)}
            </button>
          )}
        </div>
      )}
      {state === 'missing' && cli && (
        <div className="setup-agent-body">
          <p>{label('Install the CLI (needs Node.js / npm):', 'CLI をインストールします（Node.js の npm が必要です）：')}</p>
          <Command command={cli.install} label={label} />
          <p>{label('Then sign in:', '続けてサインイン：')}</p>
          <Command command={cli.login} label={label} />
          <a className="setup-link" href={cli.docs} target="_blank" rel="noreferrer">
            {label('Setup guide', 'セットアップ方法')}<ExternalLink size={11} />
          </a>
        </div>
      )}
      {state === 'signin' && cli && (
        <div className="setup-agent-body">
          <p>{label('Sign in with your account (subscription or API key):', 'アカウント（サブスクリプションまたは API キー）でサインインします：')}</p>
          <Command command={cli.login} label={label} />
        </div>
      )}
      {state === 'unavailable' && agent.note && (
        <div className="setup-agent-body"><p>{agent.note}</p></div>
      )}
    </li>
  );
}

/**
 * First-run setup, like T3 Code's provider setup: AgentWarp uses the agent CLIs installed on this
 * computer and their sign-in. Lists Claude Code / Codex / OpenCode with what is missing and the
 * exact command to fix it; re-checks when the user comes back from the terminal.
 */
export function Onboarding({agents, selectedAgent, label, onSelect, onRecheck, compact}: {
  agents: AgentInfo[];
  selectedAgent?: string;
  label: Label;
  onSelect: (id: string) => void;
  onRecheck: () => void;
  /** some agent is ready: show the setup list without the welcome text */
  compact?: boolean;
}) {
  const [checking, setChecking] = React.useState(false);
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
  const known = agents.filter((a) => a.cli);
  const list = known.length ? known : agents;
  return (
    <section className="setup" aria-labelledby="aw-setup-title">
      {!compact && (
        <>
          <h2 id="aw-setup-title">{label('Set up an agent', 'エージェントを準備しましょう')}</h2>
          <p className="setup-lead">
            {label(
              'AgentWarp works with the coding agent CLIs on this computer and their sign-in (your Claude or ChatGPT subscription, or an API key). One is enough.',
              'AgentWarp は、このパソコンに入っているエージェントの CLI とそのサインイン（Claude や ChatGPT のサブスクリプション、API キー）を使います。どれか 1 つで使えます。'
            )}
          </p>
        </>
      )}
      {compact && <h3 id="aw-setup-title">{label('Agents', 'エージェント')}</h3>}
      <ul className="setup-agents">
        {list.map((agent) => (
          <AgentRow key={agent.id} agent={agent} label={label} selected={agent.id === selectedAgent} onSelect={onSelect} />
        ))}
      </ul>
      <button type="button" className="setup-recheck" onClick={recheck} disabled={checking}>
        <RefreshCw size={13} className={checking ? 'spin' : ''} />
        {label('Check again', 'もう一度確認')}
      </button>
    </section>
  );
}
