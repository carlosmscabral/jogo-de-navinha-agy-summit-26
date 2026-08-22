/**
 * Utilitários exclusivos de teste para `ingest.test.ts` — nunca importados pelo servidor
 * de produção (`src/index.ts`). Não faz parte do bundle publicado; existe só para dar a
 * `ingest.test.ts` um cliente Firestore real (Admin SDK) contra o emulador local, uma
 * forma de zerar o estado entre testes e uma fábrica de `MatchDocument` válido.
 *
 * `testDb` usa o Admin SDK (não `@firebase/rules-unit-testing`) porque `ingestBatch` roda
 * transações via `db.runTransaction`, que é a mesma API que o servidor de produção usa —
 * testar contra o mesmo tipo de cliente que roda em Cloud Run é o ponto.
 */
import { randomUUID } from 'node:crypto';
import { initializeApp, getApps, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { DATABASE_ID, SCHEMA_VERSION, type MatchDocument } from '@jogo/shared';

const PROJECT_ID = 'jogo-navinha-test';

// O Admin SDK lê FIRESTORE_EMULATOR_HOST automaticamente e ignora credenciais reais
// quando a variável está presente — não é preciso (nem desejável) uma chave de serviço
// para rodar os testes.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
}

function testApp(): App {
  const existing = getApps().find((a) => a.name === 'cloud-api-test');
  if (existing) return existing;
  return initializeApp({ projectId: PROJECT_ID }, 'cloud-api-test');
}

export const testDb: Firestore = getFirestore(testApp(), DATABASE_ID);

/**
 * Apaga todos os documentos do emulador entre testes, via o endpoint REST que o
 * emulador expõe só para isso. `cert`/`initializeApp` acima nunca fala com um projeto
 * real: FIRESTORE_EMULATOR_HOST garante isso, e este endpoint só existe no emulador.
 */
export async function clearFirestore(): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST!;
  const url = `http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    throw new Error(`clearFirestore: emulador respondeu ${res.status} ${await res.text()}`);
  }
}

/**
 * Fábrica de `MatchDocument` válido e completo, com valores plausíveis. Os testes passam
 * `overrides` só para o que importa ao caso (`match_id`, `final_score`, etc.); tudo o
 * resto vem de um piloto e uma nave "de mentirinha" mas com a forma real do schema.
 */
export function matchFixture(overrides: Partial<MatchDocument> = {}): MatchDocument {
  const base: MatchDocument = {
    schema_version: SCHEMA_VERSION,
    match_id: randomUUID(),
    pilot_id: 'pilot-fixture',
    callsign: 'Fixture',
    company_raw: 'Google',
    company_canonical: 'Google',
    company_confidence: 1,
    final_score: 10_000,
    score_breakdown: {
      combatScore: 6000,
      bossBonus: 2000,
      timeBonus: 1000,
      survivalBonus: 500,
      bossDamageBonus: 300,
      bossPhaseBonus: 200,
      synergyBonus: 0,
      mcpMultiplier: 1
    },
    telemetry: {
      duration_s: 120,
      enemies_killed: 40,
      boss_defeated: true,
      damage_taken: 3,
      accuracy_pct: 65,
      shots_fired: 200,
      shots_hit: 130,
      fallback_used: false,
      seed: 1,
      boss_ttk_s: 30,
      boss_fight_min_fps: 60,
      boss_damage_dealt: 500,
      boss_phase_reached: 3
    },
    ship_spec_snapshot: {
      pilot: { callsign: 'Fixture', company_raw: 'Google', company_canonical: 'Google' },
      build_metadata: {
        selected_mcps: ['weapons-arsenal'],
        selected_subagents: ['combat-strategist'],
        energy_sliders: { offense: 40, speed: 20, defense: 20, tech: 20 },
        fast_grill_me_choices: { weapon_focus: 'laser_piercing', visual_theme: 'dark_void_stealth' },
        synergies_unlocked: []
      },
      attributes: { max_hp: 3, shield_capacity: 1, speed_px_s: 260, hitbox_radius: 12 },
      weapons: {
        primary: { type: 'laser', damage: 10, fire_rate: 4, bullet_speed: 500, spread_angle: 0 },
        secondary: { type: 'none', damage: 0, cooldown_seconds: 0 }
      },
      visuals: {
        style_name: 'fixture',
        primary_color: '#00ffff',
        secondary_color: '#ffffff',
        engine_trail_color: '#00aaff',
        svg_path_data: 'M0 0 L1 1'
      }
    },
    created_at: new Date().toISOString()
  };

  return { ...base, ...overrides };
}
