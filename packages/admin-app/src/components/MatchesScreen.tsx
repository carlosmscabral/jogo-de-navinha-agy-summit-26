import { useState } from 'react';
import type { MatchDocument } from '@jogo/shared';
import { fetchMatches, patchMatch as patchMatchApi } from '../api.js';

type EditableFields = { callsign: string; company_canonical: string; final_score: string };

function toEditable(m: MatchDocument): EditableFields {
  return { callsign: m.callsign, company_canonical: m.company_canonical, final_score: String(m.final_score) };
}

export function MatchesScreen() {
  const [q, setQ] = useState('');
  const [company, setCompany] = useState('');
  const [matches, setMatches] = useState<MatchDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<EditableFields | null>(null);

  async function runSearch() {
    setLoading(true);
    setError(null);
    try {
      const { matches: found } = await fetchMatches({ q: q || undefined, company: company || undefined, limit: 100 });
      setMatches(found);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function startEdit(m: MatchDocument) {
    setEditingId(m.match_id);
    setEditValues(toEditable(m));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValues(null);
  }

  async function saveEdit(original: MatchDocument) {
    if (!editValues) return;
    const changes: Record<string, string | number> = {};
    if (editValues.callsign !== original.callsign) changes.callsign = editValues.callsign;
    if (editValues.company_canonical !== original.company_canonical) {
      changes.company_canonical = editValues.company_canonical;
    }
    const scoreNum = Number(editValues.final_score);
    if (scoreNum !== original.final_score) changes.final_score = scoreNum;

    if (Object.keys(changes).length === 0) {
      cancelEdit();
      return;
    }
    setError(null);
    try {
      await patchMatchApi(original.match_id, changes);
      cancelEdit();
      await runSearch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function voidMatch(m: MatchDocument) {
    if (m.voided) return; // já anulada — evita clique duplo desnecessário na UI
    if (!window.confirm(`Anular a partida ${m.match_id} (${m.callsign})? Isto não pode ser desfeito pelo painel.`)) {
      return;
    }
    setError(null);
    try {
      await patchMatchApi(m.match_id, { voided: true });
      await runSearch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section>
      <h2>Partidas</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          placeholder="Buscar por callsign ou empresa"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1 }}
        />
        <input placeholder="Filtrar empresa exata" value={company} onChange={(e) => setCompany(e.target.value)} />
        <button onClick={() => void runSearch()} disabled={loading}>
          {loading ? 'Buscando...' : 'Buscar'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <table>
        <thead>
          <tr>
            <th>Match ID</th>
            <th>Callsign</th>
            <th>Empresa</th>
            <th>Score</th>
            <th>Criada em</th>
            <th>Status</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((m) => {
            const isEditing = editingId === m.match_id;
            return (
              <tr key={m.match_id}>
                <td>{m.match_id}</td>
                <td>
                  {isEditing ? (
                    <input
                      value={editValues!.callsign}
                      onChange={(e) => setEditValues({ ...editValues!, callsign: e.target.value })}
                    />
                  ) : (
                    m.callsign
                  )}
                </td>
                <td>
                  {isEditing ? (
                    <input
                      value={editValues!.company_canonical}
                      onChange={(e) => setEditValues({ ...editValues!, company_canonical: e.target.value })}
                    />
                  ) : (
                    m.company_canonical
                  )}
                </td>
                <td>
                  {isEditing ? (
                    <input
                      type="number"
                      value={editValues!.final_score}
                      onChange={(e) => setEditValues({ ...editValues!, final_score: e.target.value })}
                    />
                  ) : (
                    m.final_score
                  )}
                </td>
                <td>{m.created_at}</td>
                <td>{m.voided ? <span className="tag-voided">ANULADA</span> : 'ativa'}</td>
                <td>
                  {isEditing ? (
                    <>
                      <button onClick={() => void saveEdit(m)}>Salvar</button>{' '}
                      <button onClick={cancelEdit}>Cancelar</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => startEdit(m)}>Editar</button>{' '}
                      <button onClick={() => void voidMatch(m)} disabled={m.voided}>
                        Anular
                      </button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {matches.length === 0 && !loading && <p className="note">Nenhuma partida na busca atual.</p>}
    </section>
  );
}
