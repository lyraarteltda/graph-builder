# Teste de campo — 2026-09-10

Grafo real desenhado à mão na ferramenta, exportado, e executado por uma **sessão limpa
do Claude Code em Sonnet**, num repo vazio (`/tmp/gb-test/repo`), sem nenhum contexto
deste projeto.

## O grafo testado

13 peças · 15 fios · dois estágios de paralelismo, cada subtarefa com seu par
trabalhador → verificador:

```
                    ┌ Pesquisa Claude Code → Crítico ┐
As três URLs (Entrada) ─ Pesquisa Codex        → Crítico ─→ Relatório único (Entrega)
                    └ Pesquisa Cursor       → Crítico ┘             │
                                                                    ├→ HTML  → Crítico conteúdo ┐
                                                                    └→ CSS   → Crítico visual   ┴→ Site pronto (Entrega)
```

## Resultado

| O que | Veredito |
|-------|----------|
| Montar o grafo na UI (13 peças, 15 fios, à mão) | funcionou, com atritos (abaixo) |
| Exportar "Texto para a IA" | 14.725 caracteres, sem aviso de lint |
| Sessão limpa em Sonnet **entender** o grafo | **exato** — reconstruiu os 3 estágios, o paralelismo dos dois níveis, o crítico cego, o teto de 3 rodadas, a referência A/B e todos os nomes de arquivo, sem inventar peça nenhuma |
| Sessão limpa **executar** | rodou o grafo INTEIRO, ponta a ponta, sem intervenção |

### O que a sessão limpa produziu, sozinha

- `relatorio-claude-code.md`, `relatorio-codex.md`, `relatorio-cursor.md` — os três
  pesquisadores rodaram **em paralelo real** (3 subagentes simultâneos), cada relatório
  com citação de fonte por afirmação, como a instrução da peça pedia.
- Os três críticos rodaram como instâncias separadas e aprovaram na 1ª rodada.
- `relatorio-final.md` (16,8 KB) — a Entrega intermediária compilou os três **e alimentou
  a fase 2**, provando o encadeamento de duas fases.
- `site/index.html` (20,6 KB) + `site/styles.css` (28,7 KB) — os dois trabalhadores da
  fase 2 rodaram **em paralelo**, cada um com seu crítico.
- `ENTREGA.md` — a peça final conferiu que os dois arquivos abrem juntos (subiu um
  servidor local, comparou os bytes com `cmp`) e registrou o veredito peça por peça.

### A prova mais forte: o laço de reprova funcionou

O crítico visual — cuja barra eu montei **clicando nos botões** (Resultado WOW +
"Tão bom quanto a referência", com `linear.app` digitado no campo de referência) —
reprovou o CSS **duas vezes** e aprovou na terceira, exatamente no teto de 3 rodadas
que configurei na peça:

1. REPROVADO: "falta de uau, abaixo do linear.app no A/B — tipografia em degradê, coluna
   única monótona, tabela comparativa enterrada".
2. REPROVADO: "engenharia sólida, mas hero sem objeto visual próprio".
3. APROVADO, "com ressalva": no A/B contra linear.app "empatou/ficou acima em sobriedade
   e respiro" — e registrou uma ressalva honesta (o tile do hero mostra "Pro $17/mês" sem
   o qualificador "com desconto anual" que está por extenso na tabela).

Ou seja: o texto dos botões de barra chegou íntegro até um agente que nunca viu este
projeto, e mudou o resultado do trabalho. Verifiquei o site no browser: carrega, o hero
está de pé, a tabela comparativa existe, console limpo (só o 404 de favicon).

## Achados corrigidos durante o teste

1. **Entrega era terminal.** O grafo de duas fases é impossível de desenhar: a Entrega não
   tinha porta de saída, então "junta os 3 relatórios **e depois** manda para os
   construtores do site" não cabia no modelo. Corrigido: Entrega tem saída; sem sucessor
   ela continua sendo o fim do grafo.
2. **Peça nova empilhava no centro.** Com 13 peças, cada uma nascia sobre a anterior e
   exigia arrasto. Corrigido: a peça nova nasce **à direita da peça selecionada**, em
   lugar livre — construir uma cadeia virou clicar em sequência.
3. **Não havia duplicar.** Três pesquisadores e três críticos quase idênticos foram
   digitados um a um. Corrigido: `Ctrl/Cmd + D` duplica a peça selecionada com
   instruções, barra, rodadas e referência, e já foca o nome para renomear.
4. **Colagem grande trunca.** Colar os 14.725 caracteres no TUI do Claude Code perdeu
   metade do texto **sem aviso** (7.289 de 14.725 chegaram; depois 8.325 numa segunda
   tentativa com pedaços menores). O conteúdo só chegou íntegro salvando o arquivo no
   repo e mandando a IA lê-lo. A nota da aba de exportação agora diz isso.

Detalhe que salvou o teste: mesmo truncado, o Sonnet **percebeu** que faltava conteúdo e
perguntou, em vez de inventar — efeito direto das peças numeradas ("PEÇA 7 · …") no
formato exportado.

## Atritos observados que ficam como próximos passos

- **Enquadrar num grafo largo** cai para ~28–49%, e a essa escala as portas têm ~7px.
  Ligar fio exige zoom; soltar em qualquer ponto do card (já suportado) é o que salva.
- **Sem multi-seleção nem alinhamento** — posicionar 13 peças é 13 arrastos.
- A peça de Entrada pode acabar **debaixo do painel esquerdo** ao ser arrastada; só
  "Enquadrar" a traz de volta.
- O texto exportado termina pedindo confirmação antes de codificar. Numa sessão de chat
  isso custa uma ida e volta — correto para segurança, mas vale um seletor futuro
  ("confirmar antes" × "executar direto").
