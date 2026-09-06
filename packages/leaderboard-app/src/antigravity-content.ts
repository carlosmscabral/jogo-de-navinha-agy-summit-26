/**
 * O texto institucional do Antigravity que o telão exibe entre uma fatia de placar e outra.
 *
 * SEPARADO DO LAYOUT DE PROPÓSITO. Quem revisa a mensagem do estande — e ela vai ser revisada na
 * véspera do evento, por alguém que não quer ler JSX — mexe só neste arquivo. O componente
 * `AntigravityShowcase.tsx` não tem uma única frase escrita dentro dele.
 *
 * FONTE: antigravity.google e antigravity.google/docs/getting-started, consultados em 2026-09-06.
 * Números de versão envelhecem rápido e por isso NÃO entram aqui; se o estande quiser citá-los,
 * reconferir no dia. O comando de instalação do CLI é o mesmo que roda nas bancadas.
 */

export interface ShowcaseItem {
  name: string;
  blurb: string;
}

export interface ShowcaseSection {
  id: string;
  /** Linha curta acima do título, no mesmo espírito do "HALL DA FAMA //" dos painéis do placar. */
  kicker: string;
  title: string;
  items: ShowcaseItem[];
  /** Fecho opcional da seção, em destaque. */
  footnote?: string;
}

export const ANTIGRAVITY_SECTIONS: ShowcaseSection[] = [
  {
    id: 'superficies',
    kicker: 'ANTIGRAVITY //',
    title: 'AS SUPERFÍCIES',
    items: [
      {
        name: 'Antigravity 2.0',
        blurb: 'O centro de comando para gerenciar vários agentes locais em paralelo, organizados por projeto.'
      },
      {
        name: 'Antigravity CLI',
        blurb: 'A superfície leve e rápida do terminal — é ela que forja as naves aqui no estande.'
      },
      {
        name: 'Antigravity IDE',
        blurb: 'O IDE agêntico completo: gerenciador de agentes, artefatos e entendimento profundo do seu código.'
      },
      {
        name: 'Antigravity for IDEs',
        blurb: 'A extensão para VS Code, Visual Studio, JetBrains, Zed e Xcode — o agente onde você já trabalha.'
      },
      {
        name: 'Antigravity SDK',
        blurb: 'Agentes sob medida em Python, com personas, ferramentas e políticas próprias.'
      },
      {
        name: 'Remote Control',
        blurb: 'Acesso pelo navegador aos agentes que ficaram rodando na sua máquina.'
      }
    ],
    footnote: 'Uma ferramenta, seis portas de entrada. Você escolhe por onde chega.'
  },
  {
    id: 'diferenciais',
    kicker: 'ANTIGRAVITY //',
    title: 'OS DIFERENCIAIS',
    items: [
      {
        name: 'Vários agentes, em paralelo',
        blurb: 'Não é um chat: é um gerenciador de agentes trabalhando ao mesmo tempo em projetos diferentes.'
      },
      {
        name: 'Artefatos, não só respostas',
        blurb: 'O agente entrega saídas estruturadas, com walkthrough revisável, em vez de um bloco de texto para conferir na mão.'
      },
      {
        name: 'Agente com navegador',
        blurb: 'O comando /browser dirige o Chrome para automatizar o que é repetitivo, com você no circuito.'
      },
      {
        name: 'Trabalho agendado',
        blurb: 'Tarefas de rotina disparadas por mensagens programadas, sem você presente.'
      },
      {
        name: 'Confiança como requisito',
        blurb: 'Construído para a era agêntica com o humano no controle do que o agente pode fazer.'
      }
    ],
    footnote: 'A nave que está no placar saiu de uma conversa de dois minutos com um agente.'
  },
  {
    id: 'como-adquirir',
    kicker: 'ANTIGRAVITY //',
    title: 'COMO ADQUIRIR',
    items: [
      {
        name: 'Sem custo para desenvolvedores',
        blurb: 'Baixe em antigravity.google — Apple Silicon, Intel, Windows e Linux.'
      },
      {
        name: 'O CLI numa linha',
        blurb: 'curl -fsSL https://antigravity.google/cli/install.sh | bash'
      },
      {
        name: 'Para o seu time',
        blurb: 'A camada enterprise fica na mesma página, em antigravity.google.'
      }
    ],
    // Herdado do bloco "SUA VEZ DE PILOTAR" que este painel substituiu. Sem esta linha o telão
    // ficaria sem nenhuma chamada para ação — e são DUAS bancadas: mandar todo mundo para "a
    // bancada" faz a fila inteira ir para a mesma, com a outra livre ao lado.
    footnote: 'Sua vez: vá até uma das duas bancadas, escolha seus MCPs e forje a sua nave no Antigravity CLI.'
  }
];
