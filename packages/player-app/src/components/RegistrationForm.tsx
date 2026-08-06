import React, { useState, useEffect } from 'react';
import { User, Building2, ShieldCheck, ChevronRight, AlertCircle } from 'lucide-react';
import { PilotInfo } from '@jogo/shared';

interface RegistrationFormProps {
  onRegister: (pilot: PilotInfo) => void;
  onBack: () => void;
}

export function RegistrationForm({ onRegister, onBack }: RegistrationFormProps) {
  const [callsign, setCallsign] = useState('');
  const [companyRaw, setCompanyRaw] = useState('');
  const [companySuggestions, setCompanySuggestions] = useState<string[]>([]);
  const [hasConsented, setHasConsented] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (companyRaw.trim().length > 0) {
      fetch(`http://localhost:3000/api/companies?q=${encodeURIComponent(companyRaw)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.companies) setCompanySuggestions(data.companies);
        })
        .catch(() => {
          // Fallback static list
          const fallbacks = ['Google', 'Itaú', 'Bradesco', 'Nubank', 'Mercado Livre', 'Globo', 'Totvs', 'Petrobras'];
          setCompanySuggestions(fallbacks.filter((c) => c.toLowerCase().includes(companyRaw.toLowerCase())));
        });
    } else {
      setCompanySuggestions([]);
    }
  }, [companyRaw]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!callsign.trim()) {
      setErrorMsg('Por favor, informe seu Callsign (Codinome de Piloto).');
      return;
    }
    if (!companyRaw.trim()) {
      setErrorMsg('Por favor, informe o nome da sua Empresa.');
      return;
    }
    if (!hasConsented) {
      setErrorMsg('Você deve concordar com os termos para registrar sua pontuação no telão.');
      return;
    }

    onRegister({
      callsign: callsign.trim().toUpperCase().slice(0, 15),
      company_raw: companyRaw.trim().slice(0, 40),
      company_canonical: companyRaw.trim().slice(0, 40)
    });
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 bg-radial from-[#15082e] via-[#080214] to-[#020108] select-none">
      <div className="w-full max-w-lg glass-panel p-8 rounded-3xl border border-[#00f3ff]/30 shadow-2xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-1 pb-4 border-b border-white/10">
          <h2 className="text-2xl font-black text-[#00f3ff] tracking-wider uppercase">
            REGISTRO DE PILOTO
          </h2>
          <p className="text-xs text-gray-300">Identificação para o Ranking Público do Google Cloud Summit</p>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-[#ff0055]/20 border border-[#ff0055]/50 text-[#ff0055] text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Callsign Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#ffd700] uppercase tracking-wider flex items-center gap-1.5">
              <User className="w-4 h-4 text-[#ffd700]" /> Callsign do Piloto (Codinome)
            </label>
            <input
              type="text"
              required
              maxLength={15}
              placeholder="EX: CYBER_ACE"
              value={callsign}
              onChange={(e) => setCallsign(e.target.value.toUpperCase())}
              className="w-full p-3.5 rounded-xl bg-black/60 border border-white/15 text-white font-mono text-sm uppercase focus:border-[#00f3ff] focus:outline-none transition-all placeholder:text-gray-600"
            />
            <span className="text-[10px] text-gray-400">Máximo 15 caracteres (será exibido no placar)</span>
          </div>

          {/* Company Input with Autocomplete */}
          <div className="space-y-1.5 relative">
            <label className="text-xs font-bold text-[#00f3ff] uppercase tracking-wider flex items-center gap-1.5">
              <Building2 className="w-4 h-4 text-[#00f3ff]" /> Sua Empresa
            </label>
            <input
              type="text"
              required
              maxLength={40}
              placeholder="EX: Google, Itaú, Nubank..."
              value={companyRaw}
              onChange={(e) => setCompanyRaw(e.target.value)}
              className="w-full p-3.5 rounded-xl bg-black/60 border border-white/15 text-white font-mono text-sm focus:border-[#00f3ff] focus:outline-none transition-all placeholder:text-gray-600"
            />

            {/* Suggestions dropdown */}
            {companySuggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-[#0a0a20] border border-[#00f3ff]/40 rounded-xl overflow-hidden shadow-2xl z-50 max-h-40 overflow-y-auto">
                {companySuggestions.map((company) => (
                  <button
                    key={company}
                    type="button"
                    onClick={() => {
                      setCompanyRaw(company);
                      setCompanySuggestions([]);
                    }}
                    className="w-full p-2.5 text-left text-xs text-gray-200 hover:bg-[#00f3ff]/20 hover:text-[#00f3ff] transition-all border-b border-white/5 last:border-none"
                  >
                    {company}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Consent Checkbox */}
          <div className="pt-2">
            <label className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/10 cursor-pointer">
              <input
                type="checkbox"
                checked={hasConsented}
                onChange={(e) => setHasConsented(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-[#00f3ff] rounded"
              />
              <span className="text-[11px] text-gray-300 leading-snug">
                Concordo em exibir meu Callsign, pontuação e Empresa no telão público do estande durante o Google Cloud Summit 2026.
              </span>
            </label>
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onBack}
              className="w-1/3 p-3.5 rounded-xl border border-white/15 text-gray-300 text-xs font-bold uppercase hover:bg-white/5 transition-all"
            >
              Voltar
            </button>
            <button
              type="submit"
              className="w-2/3 p-3.5 rounded-xl bg-gradient-to-r from-[#00f3ff] to-[#ff0055] text-black text-xs font-black uppercase tracking-wider hover:scale-[1.02] transition-all shadow-[0_0_20px_rgba(0,243,255,0.5)] flex items-center justify-center gap-2"
            >
              <span>Ir para a Forja da Nave</span>
              <ChevronRight className="w-4 h-4 stroke-[3]" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
