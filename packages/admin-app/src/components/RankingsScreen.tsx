import { useEffect, useState } from 'react';
import { hasActivePilots, type CompanyRankingDocument } from '@jogo/shared';
import { fetchCompanyRankings } from '../rankings-source.js';

export function RankingsScreen() {
  const [rankings, setRankings] = useState<CompanyRankingDocument[]>([]);
  const [mostrarCascas, setMostrarCascas] = useState(false);
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

  // A tabela esconde as cascas por padrão, igual ao telão, mas o operador pode revelá-las: são o
  // rastro de uma recanonização e servem para conferir que a correção pegou.
  const visiveis = mostrarCascas ? rankings : rankings.filter(hasActivePilots);
  const ocultas = rankings.length - rankings.filter(hasActivePilots).length;

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
      {ocultas > 0 && (
        <p className="note">
          {ocultas} empresa(s) sem pilotos ocultada(s) — o telão também as ignora.{' '}
          <label>
            <input
              type="checkbox"
              checked={mostrarCascas}
              onChange={(e) => setMostrarCascas(e.target.checked)}
            />{' '}
            mostrar
          </label>
        </p>
      )}

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
          {visiveis.map((r) => (
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
