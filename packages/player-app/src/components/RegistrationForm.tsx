import React, { useState, useEffect } from 'react';
import { User, Building2, ShieldCheck, ChevronRight, AlertCircle, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { PilotInfo, validateCallsign } from '@jogo/shared';

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
          const fallbacks = ['Google', 'Itaú', 'Bradesco', 'Nubank', 'Mercado Livre', 'Globo', 'Totvs', 'Petrobras', 'Embraer'];
          setCompanySuggestions(fallbacks.filter((c) => c.toLowerCase().includes(companyRaw.toLowerCase())));
        });
    } else {
      setCompanySuggestions([]);
    }
  }, [companyRaw]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    // 1. Validate Callsign with Content Moderation & Profanity Filtering
    const callsignValidation = validateCallsign(callsign);
    if (!callsignValidation.isValid) {
      setErrorMsg(callsignValidation.reason || 'Por favor, escolha um Callsign adequado para o telão público.');
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
      callsign: callsignValidation.sanitized,
      company_raw: companyRaw.trim().slice(0, 40),
      company_canonical: companyRaw.trim().slice(0, 40)
    });
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 select-none font-sans">
      <div className="w-full max-w-lg flight-panel p-8 rounded-3xl border border-slate-700/60 shadow-2xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-1.5 pb-4 border-b border-slate-700/60">
          <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-[#38bdf8]/10 border border-[#38bdf8]/30 text-[#38bdf8] text-[10px] font-bold tracking-widest uppercase font-mono mb-1">
            <ShieldCheck className="w-3.5 h-3.5 text-[#10b981]" /> Identificação do Piloto // Etapa 1 de 4
          </div>
          <h2 className="text-2xl font-black text-white tracking-wider uppercase">
            REGISTRO DE PILOTO
          </h2>
          <p className="text-xs text-slate-400 font-mono">Credenciamento para o Placar do Google Cloud Summit</p>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/40 text-red-300 text-xs flex items-center gap-2 font-mono animate-shake">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Callsign Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#ff9e0b] uppercase tracking-wider flex items-center gap-1.5 font-mono">
              <User className="w-3.5 h-3.5 text-[#ff9e0b]" /> Callsign (Codinome de Voo)
            </label>
            <input
              type="text"
              required
              maxLength={15}
              placeholder="EX: CYBER_ACE"
              value={callsign}
              onChange={(e) => {
                setCallsign(e.target.value.toUpperCase());
                if (errorMsg) setErrorMsg('');
              }}
              className="w-full p-3.5 rounded-xl bg-slate-900/80 border border-slate-700 text-white font-mono text-sm uppercase focus:border-[#ff9e0b] focus:outline-none transition-all placeholder:text-slate-600"
            />
            <div className="flex justify-between text-[10px] text-slate-400 font-mono">
              <span>Apenas letras, números e traço</span>
              <span>{callsign.length}/15</span>
            </div>
          </div>

          {/* Company Input with Autocomplete */}
          <div className="space-y-1.5 relative">
            <label className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider flex items-center gap-1.5 font-mono">
              <Building2 className="w-3.5 h-3.5 text-[#38bdf8]" /> Sua Empresa
            </label>
            <input
              type="text"
              required
              maxLength={40}
              placeholder="EX: Google, Itaú, Nubank..."
              value={companyRaw}
              onChange={(e) => {
                setCompanyRaw(e.target.value);
                if (errorMsg) setErrorMsg('');
              }}
              className="w-full p-3.5 rounded-xl bg-slate-900/80 border border-slate-700 text-white font-mono text-sm focus:border-[#38bdf8] focus:outline-none transition-all placeholder:text-slate-600"
            />

            {/* Suggestions dropdown */}
            {companySuggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-slate-900 border border-slate-700 rounded-xl overflow-hidden shadow-2xl z-50 max-h-40 overflow-y-auto">
                {companySuggestions.map((company) => (
                  <button
                    key={company}
                    type="button"
                    onClick={() => {
                      setCompanyRaw(company);
                      setCompanySuggestions([]);
                    }}
                    className="w-full p-2.5 text-left text-xs text-slate-200 hover:bg-[#38bdf8]/20 hover:text-[#38bdf8] transition-all border-b border-slate-800 last:border-none font-mono flex items-center justify-between"
                  >
                    <span>{company}</span>
                    <span className="text-[10px] text-slate-400">Patrocinador Summit</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Consent Checkbox */}
          <div className="pt-1">
            <label className="flex items-start gap-3 p-3 rounded-xl bg-slate-900/50 border border-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={hasConsented}
                onChange={(e) => setHasConsented(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-[#ff9e0b] rounded"
              />
              <span className="text-[11px] text-slate-300 leading-snug">
                Autorizo a exibição do meu Callsign, pontuação e Empresa no telão público de 60 FPS do estande durante o Google Cloud Summit 2026.
              </span>
            </label>
          </div>

          {/* Action Buttons */}
          <div className="pt-3 flex gap-3">
            <button
              type="button"
              onClick={onBack}
              className="p-3.5 px-5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all flex items-center gap-1.5 text-xs font-mono font-bold"
            >
              <ArrowLeft className="w-4 h-4" /> Voltar
            </button>
            <button
              type="submit"
              className="flex-1 p-3.5 rounded-2xl bg-gradient-to-r from-[#ff9e0b] to-[#f59e0b] hover:from-[#f59e0b] hover:to-[#d97706] text-black font-black text-sm tracking-wider uppercase transition-all shadow-[0_0_25px_rgba(255,158,11,0.4)] flex items-center justify-center gap-2 font-mono"
            >
              <span>Continuar para a Forja</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
