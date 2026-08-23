/**
 * Gera o JSON que o botão "exportar para o estande" baixa — a tela Empresas edita a cópia
 * do catálogo no Firestore, e a reconciliação com `config/companies.json` do estande é
 * manual e explícita (Tarefa C7, brief): sincronizar as duas automaticamente criaria um
 * segundo canal nuvem→estande, que a Spec 05 §5 evita de propósito.
 *
 * Pura (sem `Blob`, sem `URL.createObjectURL`) para ser testável sem DOM — o componente
 * é quem dispara o download a partir da string que esta função devolve.
 */
export function toCompaniesFileJson(companies: string[]): string {
  return `${JSON.stringify({ companies }, null, 2)}\n`;
}
