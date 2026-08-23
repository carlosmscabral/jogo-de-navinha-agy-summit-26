/**
 * Leitura direta do Firestore para a tela Rankings — só leitura, para conferir o efeito
 * de uma correção do painel (Tarefa C7). `company_rankings` já tem leitura pública nas
 * regras (Spec 05 §6), então não passa por `/v1/admin/*`; não há razão para inventar um
 * endpoint administrativo para um dado que já é público, e a lista de endpoints do brief
 * não pede um.
 *
 * Sem `onSnapshot`: esta é uma tela de operador para conferência pontual, não um telão —
 * um botão "Atualizar" (busca única via `getDocs`) é suficiente e mais simples de raciocinar
 * do que gerenciar uma assinatura em tempo real aqui.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getFirestore, collection, getDocs, orderBy, query, type Firestore } from 'firebase/firestore';
import { DATABASE_ID, field, type CompanyRankingDocument } from '@jogo/shared';

let cachedApp: FirebaseApp | null = null;
let cachedDb: Firestore | null = null;

function getFirestoreDb(): Firestore | null {
  const env = import.meta.env;
  const projectId = env.VITE_FIREBASE_PROJECT_ID;
  if (!projectId) return null;
  if (!cachedDb) {
    cachedApp =
      cachedApp ??
      initializeApp({
        apiKey: env.VITE_FIREBASE_API_KEY,
        authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId,
        storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        appId: env.VITE_FIREBASE_APP_ID
      });
    // Banco nomeado, nunca (default) — Spec 08 §6.3, mesma regra de firestore-source.ts.
    cachedDb = getFirestore(cachedApp, DATABASE_ID);
  }
  return cachedDb;
}

export async function fetchCompanyRankings(): Promise<CompanyRankingDocument[]> {
  const db = getFirestoreDb();
  if (!db) {
    throw new Error('rankings-source: VITE_FIREBASE_PROJECT_ID is not configured');
  }
  const snap = await getDocs(
    query(collection(db, 'company_rankings'), orderBy(field<CompanyRankingDocument>('total_score'), 'desc'))
  );
  return snap.docs.map((d) => d.data() as CompanyRankingDocument);
}
