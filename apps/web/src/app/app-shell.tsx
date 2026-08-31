import type { ReactNode } from "react";

export interface AppShellProps {
  readonly header: ReactNode;
  readonly sidebar: ReactNode;
  readonly stage: ReactNode;
  readonly inspector: ReactNode;
  readonly timeline: ReactNode;
}

export function AppShell({ header, sidebar, stage, inspector, timeline }: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="app-shell__header">{header}</header>
      <aside className="app-shell__sidebar">{sidebar}</aside>
      <main className="app-shell__stage">{stage}</main>
      <aside className="app-shell__inspector">{inspector}</aside>
      <footer className="app-shell__timeline">{timeline}</footer>
    </div>
  );
}
