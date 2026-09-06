import { useState } from 'react';
import type { MatchDocument } from '@jogo/shared';
import { fetchMatches, patchMatch as patchMatchApi, bulkUpdateMatches } from '../api.js';
import { shipCardDataUri, shipCardLabel } from '../ship-card-preview.js';

const DELETE_CONFIRM_WORD = 'EXCLUIR';

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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);

  async function runSearch() {
    setLoading(true);
    setError(null);
    try {
      const { matches: found } = await fetchMatches({ q: q || undefined, company: company || undefined, limit: 100 });
      setMatches(found);
      // Uma nova busca pode não conter mais os ids selecionados antes dela — evita uma
      // ação em lote "fantasma" sobre linhas que não estão mais na tela.
      setSelected(new Set());
      setDeleteConfirmText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function toggleSelected(matchId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(matchId)) {
        next.delete(matchId);
      } else {
        next.add(matchId);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === matches.length ? new Set() : new Set(matches.map((m) => m.match_id))));
  }

  function describeBulkFailures(result: { failed: Array<{ match_id: string; reason: string }> }): string | null {
    if (result.failed.length === 0) return null;
    const details = result.failed.map((f) => `${f.match_id} (${f.reason})`).join('; ');
    return `${result.failed.length} partida(s) não puderam ser processadas: ${details}`;
  }

  async function bulkVoidSelected() {
    if (selected.size === 0) return;
    if (
      !window.confirm(
        `Anular ${selected.size} partida(s) selecionada(s)? Isto não pode ser desfeito pelo painel.`
      )
    ) {
      return;
    }
    setError(null);
    setBulkBusy(true);
    try {
      const result = await bulkUpdateMatches(Array.from(selected), 'void');
      setError(describeBulkFailures(result));
      await runSearch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkDeleteSelected() {
    if (selected.size === 0 || deleteConfirmText !== DELETE_CONFIRM_WORD) return;
    setError(null);
    setBulkBusy(true);
    try {
      const result = await bulkUpdateMatches(Array.from(selected), 'delete');
      setError(describeBulkFailures(result));
      await runSearch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkBusy(false);
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
          placeholder="Buscar por callsign, empresa ou match_id"
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

      {selected.size > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 12,
            padding: 8,
            border: '1px solid #999'
          }}
        >
          <span>{selected.size} selecionada(s)</span>
          <button onClick={() => void bulkVoidSelected()} disabled={bulkBusy}>
            Anular selecionadas
          </button>
          <span style={{ marginLeft: 16 }}>Digite {DELETE_CONFIRM_WORD} para excluir de verdade:</span>
          <input
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder={DELETE_CONFIRM_WORD}
          />
          <button
            onClick={() => void bulkDeleteSelected()}
            disabled={bulkBusy || deleteConfirmText !== DELETE_CONFIRM_WORD}
          >
            Excluir definitivamente
          </button>
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>
              <input
                type="checkbox"
                checked={matches.length > 0 && selected.size === matches.length}
                onChange={toggleSelectAll}
                aria-label="Selecionar todas"
              />
            </th>
            <th>Nave</th>
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
            const cardUri = shipCardDataUri(m);
            return (
              <tr key={m.match_id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(m.match_id)}
                    onChange={() => toggleSelected(m.match_id)}
                    aria-label={`Selecionar ${m.match_id}`}
                  />
                </td>
                <td>
                  {/* Um `<img>` com data: URI, nunca o SVG inline — ver ship-card-preview.ts. */}
                  {cardUri ? (
                    <img src={cardUri} alt={shipCardLabel(m)} title={shipCardLabel(m)} className="ship-card-thumb" />
                  ) : (
                    <span className="note" title="O cartão é gerado na nuvem depois da ingestão; partidas antigas só ganham um com o backfill.">
                      —
                    </span>
                  )}
                </td>
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
