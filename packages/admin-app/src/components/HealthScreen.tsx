import { useEffect, useState } from 'react';
import { fetchHealth, type AdminHealthReport } from '../api.js';

export function HealthScreen() {
  const [report, setReport] = useState<AdminHealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setReport(await fetchHealth());
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
      <h2>Saúde</h2>
      <button onClick={() => void load()} disabled={loading}>
        {loading ? 'Atualizando...' : 'Atualizar'}
      </button>
      {error && <p className="error">{error}</p>}

      {report && (
        <>
          <h3>Fila de sync por estação</h3>
          {report.syncQueue.stations.length === 0 ? (
            <p className="note">{report.syncQueue.note}</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Estação</th>
                  <th>Pendentes</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {report.syncQueue.stations.map((s) => (
                  <tr key={s.stationId}>
                    <td>{s.stationId}</td>
                    <td>{s.pending}</td>
                    <td>{s.state}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3>Rejeições recentes</h3>
          {report.recentRejections.items.length === 0 ? (
            <p className="note">{report.recentRejections.note}</p>
          ) : (
            <ul>
              {report.recentRejections.items.map((r, i) => (
                <li key={`${r.match_id}-${i}`}>
                  {r.match_id}: {r.reason}
                </li>
              ))}
            </ul>
          )}

          <h3>Taxa de preset de emergência</h3>
          <p>
            {(report.emergencyPreset.rate * 100).toFixed(1)}% (amostra de {report.emergencyPreset.sampleSize} partidas)
          </p>
          <p className="note">{report.emergencyPreset.note}</p>
        </>
      )}
    </section>
  );
}
