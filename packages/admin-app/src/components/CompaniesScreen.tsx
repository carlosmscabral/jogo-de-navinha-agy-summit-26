import { useEffect, useState } from 'react';
import { fetchCompanies, putCompanies } from '../api.js';
import { toCompaniesFileJson } from '../companies-export.js';

export function CompaniesScreen() {
  const [companies, setCompanies] = useState<string[]>([]);
  const [newCompany, setNewCompany] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const catalog = await fetchCompanies();
      setCompanies(catalog.companies);
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
    try {
      await putCompanies(companies);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // Botão "exportar para o estande": gera o JSON no formato de config/companies.json
  // ({ companies: [...] }) e dispara o download. Puramente client-side — a reconciliação
  // com o arquivo do estande é manual e explícita, nunca automática (ver companies-export.ts).
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
        Este catálogo vive no Firestore e é editado aqui. O daemon do estande continua lendo{' '}
        <code>config/companies.json</code> como fonte local e offline — use "Exportar para o estande"
        para gerar o arquivo e substituí-lo manualmente. Não há sincronização automática entre os dois.
      </p>

      {error && <p className="error">{error}</p>}
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
      {savedAt && <p className="note">Salvo às {savedAt}.</p>}
    </section>
  );
}
