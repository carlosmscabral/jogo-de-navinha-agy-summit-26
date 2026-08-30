import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ShipSpecification, SUBAGENT_CATALOG, FALLBACK_PRESETS } from '@jogo/shared';
import { derivePilotBriefing, PilotBriefingPanel } from './PilotBriefingPanel.js';

/** Uma nave qualquer; só `build_metadata.pilot_tips` importa para este painel. */
function specWithTips(tips: unknown): ShipSpecification {
  const spec = JSON.parse(JSON.stringify(FALLBACK_PRESETS.interceptor)) as ShipSpecification;
  if (tips === undefined) {
    delete (spec.build_metadata as unknown as Record<string, unknown>).pilot_tips;
  } else {
    (spec.build_metadata as unknown as Record<string, unknown>).pilot_tips = tips;
  }
  return spec;
}

const render = (spec: ShipSpecification | null, subagents: Parameters<typeof derivePilotBriefing>[1]) =>
  renderToStaticMarkup(<PilotBriefingPanel briefing={derivePilotBriefing(spec, subagents)} />);

describe('PilotBriefingPanel', () => {
  it('mostra as duas dicas que o sub-agente tático devolveu', () => {
    const tips = [
      'Fuja pelo corredor lateral quando o casco cair da metade.',
      'Guarde o EMP para o enxame; ele não fere o boss.'
    ];
    const html = render(specWithTips(tips), ['combat-strategist']);

    for (const tip of tips) {
      expect(html).toContain(tip);
    }
  });

  it('atribui o briefing ao especialista pelo rótulo do SUBAGENT_CATALOG', () => {
    const html = render(specWithTips(['Sustente o tiro: sua cadência premia pressão constante.']), [
      'systems-engineer'
    ]);

    expect(html).toContain(SUBAGENT_CATALOG['systems-engineer'].label);
    expect(html).toContain(SUBAGENT_CATALOG['systems-engineer'].color);
    // O projetista visual não produz dica e não pode assinar a de ninguém.
    expect(html).not.toContain(SUBAGENT_CATALOG['aesthetic-designer'].label);
  });

  // Sem dica não existe painel vazio nem placeholder — a mesma disciplina do `DASH` da tela.
  it('não monta nada quando pilot_tips está ausente', () => {
    expect(render(specWithTips(undefined), ['combat-strategist'])).toBe('');
  });

  it('não monta nada quando pilot_tips vem vazio, em branco ou malformado', () => {
    expect(render(specWithTips([]), ['combat-strategist'])).toBe('');
    expect(render(specWithTips(['   ']), ['combat-strategist'])).toBe('');
    expect(render(specWithTips('uma string só, não um array'), ['combat-strategist'])).toBe('');
    expect(render(null, ['combat-strategist'])).toBe('');
  });

  // Preset de emergência: o daemon entrega a nave com dica fixa mesmo sem tático selecionado.
  it('renderiza as dicas sem assinatura quando nenhum tático foi selecionado', () => {
    const html = render(specWithTips(['Acelere para fora do padrão antes de revidar.']), []);

    expect(html).toContain('Acelere para fora do padrão antes de revidar.');
    expect(html).toContain('Briefing do seu especialista');
    expect(html).not.toContain(SUBAGENT_CATALOG['combat-strategist'].label);
  });
});
