import { useState } from 'react';
import { GAME_NAME } from '@jogo/shared';
import { MatchesScreen } from './components/MatchesScreen.js';
import { CompaniesScreen } from './components/CompaniesScreen.js';
import { HealthScreen } from './components/HealthScreen.js';
import { RankingsScreen } from './components/RankingsScreen.js';

type Tab = 'matches' | 'companies' | 'health' | 'rankings';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'matches', label: 'Partidas' },
  { id: 'companies', label: 'Empresas' },
  { id: 'health', label: 'Saúde' },
  { id: 'rankings', label: 'Rankings' }
];

// Quatro telas e nada mais (Tarefa C7, brief): sem tema, sem animação, sem roteador —
// é ferramenta de operador, legibilidade sob pressa vale mais que estética.
export function App() {
  const [tab, setTab] = useState<Tab>('matches');

  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: '0 auto' }}>
      <header style={{ marginBottom: 16, borderBottom: '1px solid var(--gz-obsidian-700)', paddingBottom: 8 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>{GAME_NAME} — Operação</h1>
        <nav style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{ fontWeight: tab === t.id ? 'bold' : 'normal' }}
              aria-current={tab === t.id}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {tab === 'matches' && <MatchesScreen />}
      {tab === 'companies' && <CompaniesScreen />}
      {tab === 'health' && <HealthScreen />}
      {tab === 'rankings' && <RankingsScreen />}
    </div>
  );
}
