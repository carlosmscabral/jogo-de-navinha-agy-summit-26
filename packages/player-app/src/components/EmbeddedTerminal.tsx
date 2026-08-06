import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { ShipSpecification, FALLBACK_PRESETS } from '@jogo/shared';
import { Terminal as TermIcon, Play, Rocket, Sparkles, AlertCircle } from 'lucide-react';

interface EmbeddedTerminalProps {
  onShipReady: (spec: ShipSpecification) => void;
  onEmergencyFallback: () => void;
}

export function EmbeddedTerminal({ onShipReady, onEmergencyFallback }: EmbeddedTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termInstance = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [isShipForged, setIsShipForged] = useState(false);
  const [forgedSpec, setForgedSpec] = useState<ShipSpecification | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    // 1. Initialize xterm
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"Share Tech Mono", monospace',
      fontSize: 14,
      theme: {
        background: '#070714',
        foreground: '#00f3ff',
        cursor: '#ffd700',
        selectionBackground: '#ff0055',
        black: '#070714',
        red: '#ff0055',
        green: '#00ff88',
        yellow: '#ffd700',
        blue: '#00f3ff',
        magenta: '#ff00ff',
        cyan: '#00f3ff',
        white: '#ffffff'
      }
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();
    termInstance.current = term;

    term.writeln('\x1b[1;36m===================================================================\x1b[0m');
    term.writeln('\x1b[1;33m       ANTIGRAVITY CLI // FORJA DE NAVES ESPACIAIS AGY 2026       \x1b[0m');
    term.writeln('\x1b[1;36m===================================================================\x1b[0m');
    term.writeln('\x1b[90mConectando ao daemon local e inicializando sub-agentes...\x1b[0m\r\n');

    // 2. Connect WebSocket to daemon PTY
    const ws = new WebSocket('ws://localhost:3000/pty');
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'start_pty', initialPrompt: 'agy' }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'pty_output') {
          term.write(msg.data);
        } else if (msg.type === 'EVENT_SHIP_READY') {
          console.log('[Terminal] EVENT_SHIP_READY received:', msg.spec);
          setForgedSpec(msg.spec);
          setIsShipForged(true);
        }
      } catch {
        term.write(event.data);
      }
    };

    ws.onerror = (err) => {
      console.warn('[Terminal] WebSocket connection error:', err);
      term.writeln('\r\n\x1b[1;31m[AVISO] Daemon PTY offline. Usando simulação interativa da forja.\x1b[0m');
      // Simulate terminal output if daemon not running
      simulateTerminalForge(term, (spec) => {
        setForgedSpec(spec);
        setIsShipForged(true);
      });
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'pty_input', data }));
      }
    });

    const handleResize = () => fitAddon.fit();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (wsRef.current) wsRef.current.close();
      term.dispose();
    };
  }, []);

  const simulateTerminalForge = (term: Terminal, onReady: (spec: ShipSpecification) => void) => {
    setTimeout(() => {
      term.writeln('\x1b[1;32m✓ Sub-Agente aesthetic-designer conectado.\x1b[0m');
      term.writeln('\x1b[1;32m✓ Sub-Agente combat-strategist conectado.\x1b[0m');
      term.writeln('\x1b[1;33m[Fast Grill-Me]\x1b[0m Selecione o foco de armamento:');
      term.writeln('  (1) Laser Perfurante   (2) Chuva de Mísseis   (3) Vulcan Espalhado');
      term.writeln('\x1b[36m> Escolha selecionada: [1] Laser Perfurante\x1b[0m\r\n');

      setTimeout(() => {
        term.writeln('\x1b[1;35m[MCP] weapons-arsenal: configure_primary_cannon(type="laser", dps=720)\x1b[0m');
        term.writeln('\x1b[1;35m[MCP] hull-propulsion: tune_thrusters(speed_px_s=360, hitbox=9px)\x1b[0m');
        term.writeln('\x1b[1;32m✓ ship_spec.json gerado com sucesso na sessão!\x1b[0m\r\n');
        onReady(FALLBACK_PRESETS.interceptor);
      }, 2000);
    }, 1000);
  };

  const handleLaunch = () => {
    if (forgedSpec) {
      onShipReady(forgedSpec);
    } else {
      onEmergencyFallback();
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 bg-radial from-[#15082e] via-[#080214] to-[#020108] select-none">
      <div className="w-full max-w-4xl glass-panel p-6 rounded-3xl border border-[#00f3ff]/40 shadow-2xl space-y-4 flex flex-col h-[85vh]">
        {/* Terminal Header */}
        <div className="flex justify-between items-center pb-3 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <TermIcon className="w-5 h-5 text-[#00f3ff]" />
            <span className="text-xs font-bold tracking-wider text-white">
              ANTIGRAVITY CLI TERMINAL // <b className="text-[#00f3ff]">xterm.js PTY</b>
            </span>
          </div>

          <div className="flex items-center gap-3">
            {isShipForged ? (
              <span className="text-[11px] px-3 py-1 rounded-full bg-[#00ff88]/20 border border-[#00ff88]/50 text-[#00ff88] font-bold animate-pulse flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" /> SISTEMAS DA NAVE ONLINE
              </span>
            ) : (
              <span className="text-[11px] text-gray-400 font-mono">FORJANDO COMPONENTES...</span>
            )}
          </div>
        </div>

        {/* Xterm Container */}
        <div className="flex-1 rounded-2xl overflow-hidden border border-white/10 bg-[#070714] p-3">
          <div ref={terminalRef} className="w-full h-full" />
        </div>

        {/* Action Bar */}
        <div className="flex justify-between items-center pt-2 shrink-0">
          <button
            type="button"
            onClick={onEmergencyFallback}
            className="px-4 py-2.5 rounded-xl border border-white/15 text-gray-400 text-xs hover:text-white hover:bg-white/5 transition-all"
          >
            Pular / Iniciar com Preset Fallback
          </button>

          {isShipForged && (
            <button
              onClick={handleLaunch}
              className="px-8 py-3.5 rounded-2xl bg-gradient-to-r from-[#00ff88] to-[#00f3ff] text-black text-xs font-black uppercase tracking-widest hover:scale-105 transition-all shadow-[0_0_30px_rgba(0,255,136,0.6)] flex items-center gap-2 animate-bounce"
            >
              <Rocket className="w-5 h-5 fill-black" /> LANÇAR NAVE NO ESPAÇO
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
