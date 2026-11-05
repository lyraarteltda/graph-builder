# Graph Builder — editor de grafos de agentes

Protótipo **local** de um editor de nós (estilo n8n) onde o membro desenha o time de
agentes de IA e leva o grafo pronto para a IA construir.

**Direção de design:** `Mural de Fios` — mural de investigação em linho/cortiça, fichas
de papel presas com pino de latão, fios de barbante ligando as peças. Registrada em
`registry.md` (Regra #16 — nunca reutilizar).

---

## Rodar

```bash
cd projects/graph-builder && python3 -m http.server 8795
# abre http://localhost:8795
```

Sem build, sem dependências, sem backend. Três arquivos: `index.html`, `styles.css`, `app.js`.

---

## Objetivo ≠ Entrada

O **objetivo** é do grafo, não de uma peça — ele vive no painel da direita, orienta
TODAS as peças ao mesmo tempo, abre o texto exportado e entra no prompt de sistema de
cada agente antes das instruções específicas. Não é um passo de execução, então não vira
nó (no LangGraph ele é uma constante, não um `add_node`).

A **Entrada** é outra coisa: o insumo que o usuário fornece *na hora de rodar*. Ela é
**opcional** — sem ela, as peças sem predecessor partem direto do objetivo
(`state["pedido"] or OBJETIVO` no código gerado).

## As peças

| Peça | Papel | Campos |
|------|-------|--------|
| **Entrada** | *Opcional.* O insumo que o usuário cola na hora de rodar. Só uma por grafo. | nome, instruções |
| **Trabalhador** | Executa. É quem constrói o artefato. | nome, instruções |
| **Supervisor** | Crítico cego: recebe SÓ o artefato, julga contra a barra, aprova ou reprova. | nome, instruções (a barra) + **botões de barra**, máximo de rodadas |
| **Entrega** | Junta o resultado de vários laços num artefato único. | nome, instruções, formato de saída |

### Estrutura (v2, 05/11/2026): Decisão e Memória

O fluxo (trabalhador → supervisor → entrega) diz **quem roda depois de quem**. Duas peças
novas guardam o que o fluxo sozinho não guarda: **como se decide** e **o que se sabe**.

| Peça | Papel | Campos |
|------|-------|--------|
| **Decisão** | Grafo de procedimento. Não produz nada: lê o que chegou, responde à pergunta dela e segue por **um** caminho só. Cada fio que sai dela leva uma **condição escrita** (aparece como etiqueta no fio). | nome, a pergunta que decide, uma condição por fio de saída |
| **Memória** | Grafo de contexto. Não é passo: é o quadro na parede. Guarda **itens** (o conteúdo mora neles) ligados por **relações com nome** (só apontam). Fio peça→Memória = escreve; fio Memória→peça = consulta. | para que serve, tipos de item, tipos de ligação, regras de integridade + 3 esquemas prontos (Pesquisa com fontes, Clientes e decisões, Políticas e exceções) |

Regras que entram em toda exportação:
- **Item × ligação:** o conteúdo mora no item; a ligação só aponta e diz o tipo.
- **Duas passadas:** itens se escrevem na hora em que se descobre; ligações, quando se
  compara (quem lê a memória inteira de uma vez).
- **Ids estáveis:** número novo entra como item novo ligado ao velho por "substitui".
- **Integridade antes da Entrega:** regra quebrada → a Entrega diz o que ficou em aberto.
- **Rastro:** cada peça que roda grava uma linha (o que fez, qual condição bateu e por quê).

Ordem: a Memória não roda, mas quem escreve roda antes de quem consulta — exceto quando o
fluxo já põe o leitor antes (o ligador que lê e reescreve) ou quando escritor e leitor estão
em caminhos diferentes da mesma Decisão (só um deles vai rodar).

No LangGraph: Decisão = `add_conditional_edges` com um ramo por condição; Memória = campo
`memoria` do estado com reducer que junta itens sem sobrescrever; checagem estrutural
`_confere_memoria` antes da Entrega; `rastro` impresso no fim e `memoria.json` gravado.
O codegen também passou a usar reducers em `artefatos/rodadas/rotas` (peças em paralelo
quebravam com `InvalidUpdateError`), junção `add_edge([a, b], c)` quando a peça espera
vários pais, e não dispara por fio redundante (a Entrega do exemplo 1 rodava antes do
crítico aprovar). Testado rodando os dois exemplos com um modelo falso roteirizado.

Exemplo novo no quadro vazio: **"Exemplo com memória e decisão"** — pesquisa de preço com
dois pesquisadores em paralelo, ligador, decisão por classe de projeto, auditor e entrega.

**O laço de reprova é implícito.** O supervisor tem uma saída só (aprovado → segue). Quando
ele reprova, o trabalho volta para o nó que o alimentou — o Mural deriva isso da própria
ligação, então o usuário não precisa desenhar o fio de volta (e o validador avisa se ele
desenhar um ciclo explícito).

## A barra do supervisor (botões de preenchimento rápido)

O inspetor do supervisor traz os quatro botões do **Laços & Grafos**, com os textos
canônicos portados **literalmente** de `bar.md` (não parafraseados):

| Botão | O que escreve |
|-------|----------------|
| **Resultado WOW** | reação "uau" nomeável em uma frase; "correto e competente" não passa; exceção declarada para tarefa puramente determinística (`WOW: N/A`) |
| **Sem erros** | roda limpo no caminho feliz + borda forçada + erro forçado, exit codes conferidos, sem stub/TODO |
| **Tão bom quanto a referência** | A/B cego contra um exemplar real; empatar já passa; ficar visivelmente abaixo reprova |
| **Passa nos testes** | a suíte do projeto roda inteira, com a saída literal colada no veredito |

O teste que cada botão precisa passar é o do `bar.md`: *"um estranho, recebendo só o
artefato e a barra, conseguiria dizer APROVADO ou REPROVADO sem perguntar nada?"*.

Cada botão insere no próprio campo de **Instruções** um bloco com o critério **e o
`Como verificar`** — um campo só, tudo editável à mão depois. Clicar de novo remove
exatamente aquele bloco e preserva o resto do texto.

O botão da referência abre logo abaixo dos chips um campo **"Referência a igualar ou
superar"**. O que se digita ali é reescrito dentro do bloco, no lugar exato do
`{ref}` — enquanto estiver vazio o bloco carrega o marcador
`<nomeie aqui o exemplar de referência>` e o validador bloqueia a exportação. A
referência também sai como campo `reference` no JSON e como uma linha própria na ficha
da peça no texto para a IA.

Independente dos botões, todo supervisor exportado carrega a regra fixa
**"Ler não é verificar: veredito sem a evidência nomeada não conta. Na dúvida,
REPROVADO."** — no texto para a IA, na semântica do JSON e como constante
`LER_NAO_VERIFICA` no LangGraph.

## O canvas

- Pan: arrastar o fundo · Zoom: scroll no ponteiro (ou os botões) · `Enquadrar` ajusta tudo à tela
- `Arrumar` põe cada peça na coluna da sua profundidade no grafo (caminho mais longo até
  uma raiz), centraliza as colunas e enquadra — ninguém precisa arrastar treze cartões
- `Foco` some com os painéis e devolve a tela ao quadro (num grafo de 7 colunas isso é a
  diferença entre 36% e 64% de zoom); clicar numa peça traz o inspetor de volta sozinho
- As portas têm contra-escala: em zoom baixo elas não viram um ponto de 7px
- Ligar: arrastar do ponto direito de uma peça até o ponto esquerdo de outra
- Cortar fio: clicar no fio · Apagar peça: `Del` (ou o botão no inspetor)
- `Ctrl/Cmd + Z` desfaz (pilha de 60 passos)
- Auto-salva em `localStorage` (`graph-builder:graph:v1`; lê a chave antiga `mural-ia:graph:v1` uma vez, para não perder grafo salvo antes do rename)
- Validador ao vivo (canto inferior direito): mural sem objetivo, peça solta, peça sem
  instruções, supervisor julgando supervisor, falta de Entrega, ciclo explícito

---

## Os três formatos de saída (e por que estes)

O botão **Exportar para a IA** abre três abas:

### 1. `Texto para a IA` — o formato principal
Um protocolo em texto puro: **o objetivo abrindo o documento**, o que é o grafo, um diagrama Mermaid do fluxo, a ordem de
execução topológica, uma seção por peça (de onde recebe, para onde entrega, e as
**instruções literais do autor**, entre `"""`), as regras não-negociáveis do laço e o que
fazer com aquilo. É o formato que qualquer LLM interpreta melhor — texto ordenado e
explícito, sem sintaxe para decodificar — e é o que o membro cola no Claude Code, no
Codex ou no ChatGPT.

### 2. `JSON do grafo` — o canônico
Schema próprio (`format: "graph-builder", version: 1`) com `goal`, `nodes`, `edges`, `semantics`
(o que cada tipo de nó significa, embutido no arquivo para a IA não ter que adivinhar) e
as posições. Serve para reabrir no Graph Builder (`Abrir JSON`), versionar no git ou alimentar
código próprio.

### 3. `LangGraph (Python)` — o esqueleto executável
Codegen determinístico: uma função por peça, `StateGraph` montado, o supervisor virando
`add_conditional_edges` (aprovado → segue / reprovado → volta ao construtor) com teto de
rodadas, o `State` carregando `artefatos`/`veredictos`/`rodadas` e o `OBJETIVO` injetado
em todo prompt de sistema por dentro do `_ask()`. A sintaxe do arquivo gerado é validada
com `py_compile` a cada mudança do codegen. Roda com a chave do
próprio usuário via OpenRouter. É honestamente rotulado como scaffold no cabeçalho.

**Por que não n8n JSON?** O JSON do n8n é acoplado a versões de nó e credenciais; o
membro que quer n8n é melhor servido pelo texto do item 1, que a IA converte para o
ambiente dele. Se virar demanda recorrente, entra como quarta aba.

---

## O que falta para virar app da comunidade

Este protótipo é a camada de produto. Para publicar em `graphbuilder.maestrosdaia.com` falta a
casca padrão da frota (Regras #2/#7/#9/#13):

1. `config.js` + `kill-switch.js` + `rate-limiter.js` + `membership-gate.js` +
   `api-key-manager.js` + `feedback-widget.js` na ordem padrão, com o app atual virando
   o conteúdo de `#app-screen`.
2. Gate de membro pelo webhook n8n `verify-membership` (o browser nunca toca no Supabase).
3. `about.html`, `privacy-policy.html`, `data-deletion.html`, `404.html`, `netlify.toml`.
4. Biblioteca de grafos por membro (hoje é um grafo só, em `localStorage`).
5. Pipeline de segurança (Regra #17) + teste act-as-user em produção (Regras #18/#21).

Nenhuma chave de IA é necessária: o Graph Builder não chama IA nenhuma — ele **produz** o texto
que a IA vai executar. O BYOK só entra se um dia o app rodar o grafo por dentro.
