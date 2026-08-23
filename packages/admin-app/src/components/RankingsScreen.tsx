import { useEffect, useState } from 'react';
import type { CompanyRankingDocument } from '@jogo/shared';
import { fetchCompanyRankings } from '../rankings-source.js';

export function RankingsScreen() {
  const [rankings, setRankings] = useState<CompanyRankingDocument[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setRankings(await fetchCompanyRankings());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <section>
      <h2>Rankings (somente leitura)</h2>
      <p className="note">
        Leitura direta de <code>company_rankings</code> no Firestore, útil para conferir o efeito de uma
        correção feita em Partidas.
      </p>
      <button onClick={() => void load()} disabled={loading}>
        {loading ? 'Atualizando...' : 'Atualizar'}
      </button>
      {error && <p className="error">{error}</p>}

      <table>
        <thead>
          <tr>
            <th>Empresa</th>
            <th>Score total</th>
            <th>Pilotos</th>
            <th>Recorde individual</th>
          </tr>
        </thead>
        <tbody>
          {rankings.map((r) => (
            <tr key={r.company_canonical}>
              <td>{r.company_canonical}</td>
              <td>{r.total_score}</td>
              <td>{r.pilots_count}</td>
              <td>{r.top_individual_score}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
