import { useEffect, useState } from 'react';
import type { CompanyCatalogDocument } from '@jogo/shared';
import { ApiError, fetchCompanies, putCompanies } from '../api.js';
import { toCompaniesFileJson } from '../companies-export.js';

export function CompaniesScreen() {
  const [companies, setCompanies] = useState<string[]>([]);
  const [newCompany, setNewCompany] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // Versão que esta tela carregou. Vai junto no PUT para o servidor recusar a gravação se
  // alguém tiver salvado nesse meio-tempo — sem isso, a última aba a clicar "Salvar" apagava
  // as edições da outra em silêncio, e agora esse documento alimenta as duas estações.
  const [version, setVersion] = useState<number | null>(null);
  // Catálogo que o servidor devolveu junto do 409, para o operador comparar antes de decidir.
  const [conflict, setConflict] = useState<CompanyCatalogDocument | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    setConflict(null);
    try {
      const catalog = await fetchCompanies();
      setCompanies(catalog.companies);
      setVersion(catalog.version ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function addCompany() {
    const trimmed = newCompany.trim();
    if (!trimmed || companies.includes(trimmed)) return;
    setCompanies([...companies, trimmed]);
    setNewCompany('');
  }

  function removeCompany(name: string) {
    setCompanies(companies.filter((c) => c !== name));
  }

  async function save() {
    setError(null);
    setSavedAt(null);
    setConflict(null);
    try {
      // `version ?? undefined`: enquanto a carga inicial não terminou não há versão para
      // apostar, e mandar um palpite errado transformaria a primeira gravação num 409 falso.
      const result = await putCompanies(companies, { expectedVersion: version ?? undefined });
      setVersion(result.version);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { current?: CompanyCatalogDocument };
        setConflict(body?.current ?? null);
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // Botão "exportar para o estande": gera o JSON no formato de config/companies.json
  // ({ companies: [...] }) e dispara o download. Puramente client-side.
  //
  // Deixou de ser o canal de sincronização: os daemons puxam este catálogo do Firestore.
  // O arquivo em disco é só a semente do primeiro boot de uma máquina nova — e a rede de
  // segurança de um estande que sobe sem rede, antes do primeiro pull dar certo.
  function exportForBooth() {
    const json = toCompaniesFileJson(companies);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'companies.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section>
      <h2>Empresas</h2>
      <p className="note">
        Este catálogo vive no Firestore e é a <strong>fonte única</strong>: a canonicalização na
        nuvem consulta ele, e os dois estandes o puxam periodicamente — inclusive as remoções. O{' '}
        <code>config/companies.json</code> de cada Mac é só semente de primeiro boot e rede de
        segurança offline. Use "Exportar para o estande" apenas para preparar uma máquina nova.
      </p>

      {error && <p className="error">{error}</p>}

      {conflict && (
        <div className="error">
          <p>
            <strong>Outro operador salvou primeiro.</strong> Nada foi gravado — suas edições ainda
            estão nesta tela. O catálogo no servidor está na versão {conflict.version ?? '?'} com{' '}
            {conflict.companies.length} empresa(s):
          </p>
          <p>
            <code>{conflict.companies.join(', ') || '(vazio)'}</code>
          </p>
          <p>
            Compare com a sua lista abaixo. "Recarregar do servidor" descarta o que você editou
            aqui e começa da versão dele.
          </p>
          <button onClick={() => void load()}>Recarregar do servidor (descarta suas edições)</button>
        </div>
      )}

      {loading && <p>Carregando...</p>}

      <ul>
        {companies.map((c) => (
          <li key={c}>
            {c} <button onClick={() => removeCompany(c)}>Remover</button>
          </li>
        ))}
      </ul>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          placeholder="Nova empresa"
          value={newCompany}
          onChange={(e) => setNewCompany(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addCompany();
          }}
        />
        <button onClick={addCompany}>Adicionar</button>
      </div>

      <button onClick={() => void save()}>Salvar catálogo</button>{' '}
      <button onClick={exportForBooth}>Exportar para o estande (companies.json)</button>
      {savedAt && (
        <p className="note">
          Salvo às {savedAt} (versão {version}). Os estandes aplicam em até um ciclo do worker.
        </p>
      )}
    </section>
  );
}
