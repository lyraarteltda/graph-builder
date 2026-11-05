/* ═══════════════════════════════════════════════════════════════════════
   GRAPH BUILDER — editor de grafos de agentes (protótipo local)
   Canvas infinito + fichas (nós) + fios (arestas) + inspetor de instruções.
   Exporta: (1) texto-protocolo para colar na IA, (2) JSON canônico,
            (3) scaffold LangGraph em Python.
   Sem dependências, sem build, sem backend.
   ═══════════════════════════════════════════════════════════════════════ */
(() => {
'use strict';

/* ─────────────────────────── constantes ─────────────────────────── */

const TYPES = {
  entrada: {
    label: 'Entrada',
    color: 'var(--c-entrada)',
    hex: '#a67c1f',
    instrLabel: 'O pedido que entra',
    placeholder: 'Descreva o pedido/insumo que inicia o grafo. Ex.: "O texto bruto da aula que o usuário colar."',
    hint: 'Isto vira o input inicial do grafo — o que o usuário fornece quando o time começa a rodar.'
  },
  trabalhador: {
    label: 'Trabalhador',
    color: 'var(--c-trabalhador)',
    hex: '#27496b',
    instrLabel: 'Instruções',
    placeholder: 'O que esta peça precisa construir, e como. Ex.: "Escreva a página de vendas inteira, com headline, prova e oferta. Português do Brasil, tom direto."',
    hint: 'Escreva como se estivesse instruindo uma pessoa. Isto vira o prompt de sistema deste agente.'
  },
  supervisor: {
    label: 'Supervisor',
    color: 'var(--c-supervisor)',
    hex: '#8c2f28',
    instrLabel: 'Instruções (a barra)',
    placeholder: 'O critério pelo qual esta peça julga o que chegou. Ex.: "Reprove se a headline não citar o público, se faltar prova concreta ou se houver promessa vaga."',
    hint: 'Um crítico cego: recebe só o artefato, nunca o raciocínio de quem construiu. Escreva a barra que ele aplica.'
  },
  entrega: {
    label: 'Entrega',
    color: 'var(--c-entrega)',
    hex: '#2f6b4a',
    instrLabel: 'Instruções de compilação',
    placeholder: 'Como juntar tudo que chegou num artefato só. Ex.: "Monte um documento com uma seção por trabalhador, na ordem em que aparecem, sem repetir conteúdo."',
    hint: 'Junta o resultado de todos os laços que chegam nela num artefato só. Se algo sair dela, esse artefato vira o insumo da fase seguinte.'
  },
  decisao: {
    label: 'Decisão',
    color: 'var(--c-decisao)',
    hex: '#6b3f7a',
    instrLabel: 'A pergunta que decide',
    placeholder: 'O que esta peça olha para escolher o caminho. Ex.: "O projeto mexe com dado sensível (CPF, saúde, financeiro)?"',
    hint: 'Não produz nada: lê o que chegou e escolhe UM caminho. Cada fio que sai dela leva uma condição escrita — e a escolha fica gravada no rastro.'
  },
  memoria: {
    label: 'Memória',
    color: 'var(--c-memoria)',
    hex: '#4b5563',
    instrLabel: 'Para que serve esta memória',
    placeholder: 'O que fica guardado aqui e quem usa. Ex.: "Tudo o que a pesquisa descobriu sobre preços, com a fonte de cada número."',
    hint: 'Não é um passo: é o quadro na parede. Fio de uma peça PARA cá = ela escreve. Fio DAQUI para uma peça = ela consulta. Quem escreve sempre roda antes de quem consulta.'
  }
};

/* ══════════ MEMÓRIA ESTRUTURADA (grafo de contexto) ══════════
   O dado mora no ITEM; a LIGAÇÃO só aponta e diz o nome da relação.
   Itens se escrevem na hora em que se descobre; ligações, quando se compara. */
const MEM_PRESETS = {
  pesquisa: {
    label: 'Pesquisa com fontes',
    sub: 'afirmação · fonte · conclusão',
    kinds: 'afirmação — texto, número ou faixa, unidade\nfonte — url, autor, data, natureza (oficial, venda, fórum…)\nconclusão — texto, data da decisão',
    rels: 'sustenta — fonte → afirmação\ncontradiz — afirmação → afirmação\nsubstitui — afirmação nova → afirmação velha\nbaseada em — conclusão → afirmação',
    rules: 'toda afirmação tem pelo menos uma fonte ligada por "sustenta"\ntoda conclusão tem pelo menos uma afirmação ligada por "baseada em"\nfonte com mais de 2 anos não sustenta conclusão sozinha'
  },
  clientes: {
    label: 'Clientes e decisões',
    sub: 'pessoa · empresa · decisão',
    kinds: 'pessoa — nome, papel\nempresa — nome, setor\npedido — texto, data\ndecisão — texto, data, quem decidiu',
    rels: 'trabalha em — pessoa → empresa\nfez — pessoa → pedido\nrespondeu — decisão → pedido\nsubstitui — decisão nova → decisão velha',
    rules: 'toda decisão responde a pelo menos um pedido\ntodo pedido tem quem fez'
  },
  regras: {
    label: 'Políticas e exceções',
    sub: 'regra · exceção · caso',
    kinds: 'regra — texto, versão, desde quando\nexceção — texto, motivo\ncaso — descrição, data',
    rels: 'abre exceção em — exceção → regra\nse aplica a — regra → caso\nsubstitui — regra nova → regra velha',
    rules: 'toda exceção aponta para a regra que ela abre\nnenhuma regra substituída se aplica a caso novo'
  }
};

/** "afirmação — texto, faixa" → { nome: 'afirmação', resto: 'texto, faixa' } */
function linhasSchema(txt) {
  return (txt || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(.+?)\s*(?:—|–|-|:)\s+(.*)$/);
    return m ? { nome: m[1].trim(), resto: m[2].trim() } : { nome: l, resto: '' };
  });
}

const REGRA_DUAS_PASSADAS = 'Itens se escrevem na hora em que se descobre; ligações, quando se compara. Quem pesquisa só escreve itens — as ligações entre achados de pesquisadores diferentes são feitas por quem lê a memória inteira de uma vez.';
const REGRA_ITEM_LIGACAO = 'O conteúdo mora no item. A ligação só aponta (de → para) e diz o tipo da relação — se você precisou escrever um parágrafo numa ligação, aquilo era um item que faltava.';
const REGRA_RASTRO = 'Grave o rastro: a cada peça que roda, uma linha com qual peça rodou, o que produziu ou decidiu e por quê. Numa Decisão, o rastro diz qual condição bateu. É o rastro que permite, depois, dizer por que o resultado saiu assim.';

/* ══════════ A BARRA — portada literalmente do Laços & Grafos (bar.md) ══════════
   Teste que cada botão precisa passar: "um estranho, recebendo só o artefato e a
   barra, conseguiria dizer APROVADO ou REPROVADO sem perguntar nada a mais?"
   Nunca 'deixa bom' — sempre um critério decidível por terceiro. */
const REF_VAZIA = '<nomeie aqui o exemplar de referência>';

const BARRAS = {
  wow: {
    label: 'Resultado WOW',
    sub: 'todo crítico aprova com reação "uau"',
    bar: 'todo crítico que receber o resultado final reage com um "uau" honesto e consegue nomear em UMA frase o elemento que carrega esse uau — "correto e competente" NÃO passa. Única exceção: tarefa puramente determinística, em que existe uma saída certa e não existe "quão bem foi feito" — nesse caso o crítico escreve `WOW: N/A — determinística`, justifica em uma linha por que não cabe julgamento de qualidade, e aprova só pela correção verificada. Fora dessa exceção, sem uau não há APROVADO.',
    como: 'Abrir/rodar o artefato no estado exato em que o usuário vai receber e registrar a reação honesta ANTES de racionalizar. Depois nomear o elemento que carrega o uau e o elo mais fraco. Nunca julgar pelo código-fonte quando existe algo renderizado ou executável para olhar.'
  },
  'sem-erros': {
    label: 'Sem erros',
    sub: 'roda limpo, borda e erro forçados',
    bar: 'roda limpo no caminho feliz, num caso de borda forçado e num caminho de erro forçado, com os códigos de saída conferidos — sem stub, sem TODO, sem função vazia.',
    como: 'Executar de verdade os três caminhos e colar a saída observada. Ler o código não conta.'
  },
  referencia: {
    label: 'Tão bom quanto a referência',
    sub: 'A/B cego contra um exemplar real',
    bar: 'num A/B cego contra ' + REF_VAZIA + ', fica no MESMO patamar ou acima — quem julga não consegue apontar nenhuma lacuna específica e corrigível que a referência resolva e este artefato não; empatar de igual para igual JÁ passa, ficar visivelmente abaixo reprova.',
    como: 'Colocar a referência na MESMA situação e observar o que ela faz — é isso que transforma "ficou abaixo" de opinião em fato citável. Lacuna vale como reprovação só quando é nomeável e corrigível; gosto irredutível vira RISCO NÃO VERIFICADO, não veredito.'
  },
  testes: {
    label: 'Passa nos testes',
    sub: 'a suíte do projeto roda verde',
    bar: 'a suíte de testes do projeto roda inteira e passa, com a saída literal do comando colada no veredito.',
    como: 'Rodar o comando de teste do projeto e colar a saída, não o resumo dela.'
  }
};
const BARRA_IDS = ['wow', 'sem-erros', 'referencia', 'testes'];

/** Regra que vale para TODO supervisor, venha ou não de um botão. */
const LER_NAO_VERIFICA = 'Ler não é verificar: veredito sem a evidência nomeada não conta. Na dúvida, REPROVADO.';

const ORDER = ['entrada', 'trabalhador', 'decisao', 'supervisor', 'entrega', 'memoria'];
const LIB_KEY = 'graph-builder:lib:v1';          // a biblioteca inteira
const STORE_KEY = 'graph-builder:graph:v1';      // grafo único (antes da biblioteca)
const STORE_KEY_LEGADO = 'mural-ia:graph:v1';    // antes do rename
const NODE_W = 232;
const Q3 = '"'.repeat(3);              // aspas triplas do Python, no codegen LangGraph

/* ─────────────────────────── estado ─────────────────────────── */

let state = blank();
let sel = null;                       // id do nó selecionado
const sizes = new Map();              // id -> {w, h} medidos
let view = { x: 120, y: 90, k: 1 };
const undoStack = [];
let seq = 1;

function blank() {
  return { title: 'Meu grafo', goal: '', nodes: [], edges: [] };
}

function uid(prefix) {
  return prefix + '_' + (seq++) + '_' + Math.random().toString(36).slice(2, 6);
}

/* ─────────────────────────── DOM ─────────────────────────── */

const $ = (id) => document.getElementById(id);
const canvas   = $('canvas');
const world    = $('world');
const wiresSvg = $('wires');
const nodesEl  = $('nodes');
const inspBody = $('insp-body');
const inspEmpty= $('insp-empty');

/* ═══════════════════════════════════════════════════════════════════
   RENDER
   ═══════════════════════════════════════════════════════════════════ */

function applyView() {
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
  // em zoom baixo a porta encolheria para ~7px: contra-escala para continuar clicável
  world.style.setProperty('--porta', Math.min(2.6, Math.max(1, 0.85 / view.k)).toFixed(2));
  $('zoom-reset').textContent = Math.round(view.k * 100) + '%';
}

function render() {
  renderNodes();
  measure();
  renderWires();
  renderLint();
  $('empty-hint').hidden = state.nodes.length > 0;
  applyView();
  save();
}

function renderNodes() {
  nodesEl.textContent = '';
  for (const n of state.nodes) {
    const t = TYPES[n.type];
    const el = document.createElement('div');
    el.className = 'node' + (n.id === sel ? ' sel' : '');
    el.dataset.id = n.id;
    el.dataset.type = n.type;
    el.style.left = n.x + 'px';
    el.style.top = n.y + 'px';
    el.style.setProperty('--type-color', t.color);

    const type = document.createElement('span');
    type.className = 'n-type';
    type.textContent = t.label;

    const name = document.createElement('p');
    name.className = 'n-name';
    name.textContent = n.name || t.label + ' sem nome';

    const instr = document.createElement('p');
    instr.className = 'n-instr' + (n.instructions.trim() ? '' : ' empty');
    instr.textContent = n.instructions.trim() || 'Sem instruções ainda — clique para escrever.';

    el.append(type, name, instr);

    if (n.type === 'supervisor') {
      const b = document.createElement('span');
      b.className = 'n-badge';
      b.textContent = 'até ' + (n.rounds || 3) + ' rodadas';
      el.append(b);
    }
    if (n.type === 'entrega' && n.format && n.format.trim()) {
      const b = document.createElement('span');
      b.className = 'n-badge';
      b.textContent = n.format.trim().slice(0, 34);
      el.append(b);
    }
    if (n.type === 'decisao') {
      const b = document.createElement('span');
      b.className = 'n-badge';
      const k = flowOut(n.id).length;
      b.textContent = k + (k === 1 ? ' caminho' : ' caminhos');
      el.append(b);
    }
    if (n.type === 'memoria') {
      const b = document.createElement('span');
      b.className = 'n-badge';
      b.textContent = linhasSchema(n.kinds).length + ' tipos de item · ' + linhasSchema(n.rels).length + ' de ligação';
      el.append(b);
    }

    const pin = document.createElement('span');
    pin.className = 'port in';
    pin.dataset.port = 'in';
    const pout = document.createElement('span');
    pout.className = 'port out';
    pout.dataset.port = 'out';
    el.append(pin, pout);

    nodesEl.append(el);
  }
}

function measure() {
  sizes.clear();
  for (const el of nodesEl.children) {
    sizes.set(el.dataset.id, { w: el.offsetWidth, h: el.offsetHeight });
  }
}

function portPos(id, which) {
  const n = byId(id);
  const s = sizes.get(id) || { w: NODE_W, h: 90 };
  return { x: which === 'out' ? n.x + s.w : n.x, y: n.y + s.h / 2 };
}

/** Fio com barriga: a corda "pesa" para baixo, como barbante esticado. */
function cordPath(a, b) {
  const dx = b.x - a.x;
  const back = dx < -20;                      // destino atrás da origem: o fio contorna
  const span = Math.abs(dx);
  const sag = Math.min(70, Math.max(18, span * 0.16));
  const c = back ? Math.min(170, 90 + span * 0.2) : Math.max(60, span * 0.45);
  const lift = back ? 60 : 0;
  return `M ${a.x} ${a.y} C ${a.x + c} ${a.y + sag + lift}, ${b.x - c} ${b.y + sag + lift}, ${b.x} ${b.y}`;
}

const SVGNS = 'http://www.w3.org/2000/svg';

function renderWires(ghost) {
  wiresSvg.textContent = '';
  for (const e of state.edges) {
    if (!byId(e.from) || !byId(e.to)) continue;
    const a = portPos(e.from, 'out');
    const b = portPos(e.to, 'in');
    const g = document.createElementNS(SVGNS, 'g');
    const ehMem = byId(e.from).type === 'memoria' || byId(e.to).type === 'memoria';
    g.setAttribute('class', 'wire' + (ehMem ? ' mem' : ''));

    const hit = document.createElementNS(SVGNS, 'path');
    hit.setAttribute('class', 'hit');
    hit.setAttribute('d', cordPath(a, b));
    hit.__edge = e;   // o corte é resolvido no pointerup do canvas

    const cord = document.createElementNS(SVGNS, 'path');
    cord.setAttribute('class', 'cord');
    cord.setAttribute('d', cordPath(a, b));

    for (const p of [a, b]) {
      const k = document.createElementNS(SVGNS, 'circle');
      k.setAttribute('class', 'knot');
      k.setAttribute('cx', p.x); k.setAttribute('cy', p.y); k.setAttribute('r', 2.6);
      g.append(k);
    }
    g.append(cord, hit);

    // etiqueta presa no meio do fio: a condição (Decisão) ou escreve/consulta (Memória)
    let rot = '';
    if (byId(e.from).type === 'decisao' && !ehMem) rot = (e.cond || '').trim() || 'sem condição';
    else if (byId(e.to).type === 'memoria') rot = 'escreve';
    else if (byId(e.from).type === 'memoria') rot = 'consulta';
    if (rot) {
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + Math.min(70, Math.max(18, Math.abs(b.x - a.x) * 0.16)) * 0.75 };
      const txt = rot.length > 30 ? rot.slice(0, 29) + '…' : rot;
      const w = txt.length * 5.9 + 14;
      const r = document.createElementNS(SVGNS, 'rect');
      r.setAttribute('class', 'tag' + ((e.cond || '').trim() || ehMem ? '' : ' vazia'));
      r.setAttribute('x', mid.x - w / 2); r.setAttribute('y', mid.y - 9);
      r.setAttribute('width', w); r.setAttribute('height', 18); r.setAttribute('rx', 2);
      const t = document.createElementNS(SVGNS, 'text');
      t.setAttribute('class', 'tag-txt');
      t.setAttribute('x', mid.x); t.setAttribute('y', mid.y + 3.6);
      t.textContent = txt;
      g.append(r, t);
    }
    wiresSvg.append(g);
  }

  if (ghost) {
    const p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('class', 'cord ghost');
    p.setAttribute('d', cordPath(ghost.a, ghost.b));
    wiresSvg.append(p);
  }
}

/* ═══════════════════════════════════════════════════════════════════
   MODELO
   ═══════════════════════════════════════════════════════════════════ */

const byId = (id) => state.nodes.find((n) => n.id === id);
const isMem = (id) => { const n = byId(id); return !!n && n.type === 'memoria'; };

/* Dois tipos de fio:
   • fio de fluxo  — entre peças que rodam (o trabalho passa de uma para a outra);
   • fio de memória — de uma peça PARA a Memória (escreve) ou DA Memória para uma peça (consulta).
   A Memória não roda: para ordenar o grafo, cada "quem escreve" vira predecessor
   implícito de cada "quem consulta" da mesma memória. */
const flowOut = (id) => state.edges.filter((e) => e.from === id && !isMem(e.to) && !isMem(e.from) && byId(e.to));
const directIn = (id) => state.edges.filter((e) => e.to === id && !isMem(e.from)).map((e) => byId(e.from)).filter(Boolean);
const directOut = (id) => flowOut(id).map((e) => byId(e.to));
const writersOf = (memId) => state.edges.filter((e) => e.to === memId).map((e) => byId(e.from)).filter(Boolean);
const readersOf = (memId) => state.edges.filter((e) => e.from === memId).map((e) => byId(e.to)).filter(Boolean);
const memsWrittenBy = (id) => state.edges.filter((e) => e.from === id && isMem(e.to)).map((e) => byId(e.to));
const memsReadBy = (id) => state.edges.filter((e) => e.to === id && isMem(e.from)).map((e) => byId(e.from));

/** Caminhos de uma mesma Decisão são exclusivos: só um roda, então um nunca espera o outro. */
function exclusivosEm(direto) {
  const desce = (de) => {
    const visto = new Set(), pilha = [de];
    while (pilha.length) {
      const x = pilha.pop();
      if (visto.has(x)) continue;
      visto.add(x);
      for (const e of direto) if (e.from === x) pilha.push(e.to);
    }
    return visto;
  };
  const ramos = state.nodes.filter((n) => n.type === 'decisao')
    .map((d) => direto.filter((e) => e.from === d.id).map((e) => desce(e.to)));
  return (a, b) => ramos.some((rs) => rs.some((ra, i) => rs.some((rb, j) =>
    i !== j && ra.has(a) && !rb.has(a) && rb.has(b) && !ra.has(b))));
}

function flowEdges() {
  const out = state.edges.filter((e) => !isMem(e.from) && !isMem(e.to) && byId(e.from) && byId(e.to))
    .map((e) => ({ from: e.from, to: e.to }));
  const tem = new Set(out.map((e) => e.from + '>' + e.to));
  // r alcança w pelos fios de fluxo? Então r já roda antes de w: não force a ordem ao contrário
  const alcanca = (de, ate) => {
    const visto = new Set(), pilha = [de];
    while (pilha.length) {
      const x = pilha.pop();
      if (x === ate) return true;
      if (visto.has(x)) continue;
      visto.add(x);
      for (const e of out) if (e.from === x) pilha.push(e.to);
    }
    return false;
  };
  const exclusivos = exclusivosEm(out.slice());
  for (const m of state.nodes.filter((n) => n.type === 'memoria')) {
    for (const w of writersOf(m.id)) for (const r of readersOf(m.id)) {
      if (w.id === r.id || tem.has(w.id + '>' + r.id) || alcanca(r.id, w.id) || alcanca(w.id, r.id) || exclusivos(w.id, r.id)) continue;
      tem.add(w.id + '>' + r.id);
      out.push({ from: w.id, to: r.id, implicito: m.id });
    }
  }
  return out;
}
const parentsOf = (id) => flowEdges().filter((e) => e.to === id).map((e) => byId(e.from));
const childrenOf = (id) => flowEdges().filter((e) => e.from === id).map((e) => byId(e.to));

/** Acha um lugar livre perto de (x,y) — nada de peça nova em cima de peça velha. */
function lugarLivre(x, y) {
  const ocupado = (px, py) => state.nodes.some((n) => Math.abs(n.x - px) < 200 && Math.abs(n.y - py) < 130);
  let ty = y;
  for (let i = 0; i < 12 && ocupado(x, ty); i++) ty += 150;
  return { x, y: ty };
}

function addNode(type, x, y) {
  if (type === 'entrada' && state.nodes.some((n) => n.type === 'entrada')) {
    toast('O grafo já tem uma Entrada');
    return null;
  }
  snapshot();
  const count = state.nodes.filter((n) => n.type === type).length + 1;
  const node = {
    id: uid(type),
    type,
    name: TYPES[type].label + (type === 'entrada' ? '' : ' ' + count),
    instructions: '',
    x: Math.round(x), y: Math.round(y)
  };
  if (type === 'supervisor') node.rounds = 3;
  if (type === 'entrega') node.format = '';
  if (type === 'memoria') { node.kinds = ''; node.rels = ''; node.rules = ''; }
  state.nodes.push(node);
  sel = node.id;
  render();
  syncInspector();
  return node;
}

/** Copia a peça selecionada com tudo dentro — instruções, barra, rodadas, referência. */
function duplicar() {
  const n = byId(sel);
  if (!n) { toast('Selecione uma peça para duplicar'); return; }
  snapshot();
  const p = lugarLivre(n.x, n.y + 150);
  const copia = { ...n, id: uid(n.type), name: n.name + ' (cópia)', x: p.x, y: p.y };
  if (copia.type === 'entrada') {                       // só pode existir uma Entrada
    copia.type = 'trabalhador';
    toast('Entrada é única — a cópia virou Trabalhador');
  }
  state.nodes.push(copia);
  sel = copia.id;
  render();
  syncInspector();
  $('f-name').focus();
  $('f-name').select();
}

function deleteNode(id) {
  snapshot();
  state.nodes = state.nodes.filter((n) => n.id !== id);
  state.edges = state.edges.filter((e) => e.from !== id && e.to !== id);
  if (sel === id) sel = null;
  render();
  syncInspector();
}

function connect(from, to) {
  if (!from || !to || from === to) return false;
  const a = byId(from), b = byId(to);
  if (!a || !b) return false;
  if (b.type === 'entrada') { toast('A Entrada não recebe fios'); return false; }
  if (a.type === 'memoria' && b.type === 'memoria') { toast('Memória não liga direto em memória — uma peça precisa ler uma e escrever na outra'); return false; }
  if (a.type === 'decisao' && b.type === 'memoria') { toast('A Decisão só escolhe o caminho — quem escreve na memória é um Trabalhador'); return false; }
  if (state.edges.some((e) => e.from === from && e.to === to)) { toast('Esse fio já existe'); return false; }
  snapshot();
  state.edges.push(a.type === 'decisao' ? { from, to, cond: '' } : { from, to });
  render();
  return true;
}

/* ─────────── desfazer ─────────── */

function snapshot() {
  undoStack.push(JSON.stringify({ nodes: state.nodes, edges: state.edges, title: state.title, goal: state.goal }));
  if (undoStack.length > 60) undoStack.shift();
}
function undo() {
  const s = undoStack.pop();
  if (!s) { toast('Nada para desfazer'); return; }
  const prev = JSON.parse(s);
  state.nodes = prev.nodes; state.edges = prev.edges; state.title = prev.title; state.goal = prev.goal || '';
  $('graph-title').value = state.title;
  $('f-goal').value = state.goal;
  if (!byId(sel)) sel = null;
  render();
  syncInspector();
}

/* ─────────── persistência ─────────── */

/* ─── biblioteca: vários grafos, um aberto por vez ─── */

let lib = { atual: null, grafos: [] };

function libLer() {
  try {
    const raw = localStorage.getItem(LIB_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.grafos)) return d;
    }
  } catch (_) {}
  return null;
}

function libGravar() {
  try { localStorage.setItem(LIB_KEY, JSON.stringify(lib)); } catch (_) {}
}

function save() {
  const g = lib.grafos.find((x) => x.id === lib.atual);
  if (!g) return;
  Object.assign(g, {
    title: state.title, goal: state.goal, nodes: state.nodes, edges: state.edges,
    view, atualizado: Date.now()
  });
  libGravar();
}

function abrir(id) {
  const g = lib.grafos.find((x) => x.id === id);
  if (!g) return;
  lib.atual = id;
  state = { title: g.title || 'Meu grafo', goal: g.goal || '', nodes: g.nodes || [], edges: g.edges || [] };
  view = g.view || { x: 120, y: 90, k: 1 };
  seq = state.nodes.length + 1;
  sel = null;
  $('graph-title').value = state.title;
  $('f-goal').value = state.goal;
  render();
  syncInspector();
  libGravar();
}

function novoGrafo(base) {
  const g = {
    id: 'g_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    title: base ? base.title + ' (cópia)' : 'Meu grafo',
    goal: base ? base.goal : '',
    nodes: base ? JSON.parse(JSON.stringify(base.nodes)) : [],
    edges: base ? JSON.parse(JSON.stringify(base.edges)) : [],
    view: { x: 120, y: 90, k: 1 },
    atualizado: Date.now()
  };
  lib.grafos.unshift(g);
  abrir(g.id);
  return g;
}

function load() {
  const guardada = libLer();
  if (guardada && guardada.grafos.length) {
    lib = guardada;
    if (!lib.grafos.some((g) => g.id === lib.atual)) lib.atual = lib.grafos[0].id;
    const g = lib.grafos.find((x) => x.id === lib.atual);
    state = { title: g.title || 'Meu grafo', goal: g.goal || '', nodes: g.nodes || [], edges: g.edges || [] };
    if (g.view) view = g.view;
    return true;
  }

  // migração: o grafo único que existia antes da biblioteca não se perde
  try {
    const raw = localStorage.getItem(STORE_KEY) || localStorage.getItem(STORE_KEY_LEGADO);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.nodes)) {
        state = { title: d.title || 'Meu grafo', goal: d.goal || '', nodes: d.nodes, edges: d.edges || [] };
        if (d.view) view = d.view;
      }
    }
  } catch (_) {}

  lib = { atual: null, grafos: [] };
  const g = {
    id: 'g_' + Date.now().toString(36),
    title: state.title, goal: state.goal, nodes: state.nodes, edges: state.edges,
    view, atualizado: Date.now()
  };
  lib.grafos.push(g);
  lib.atual = g.id;
  libGravar();
  return true;
}

/* ═══════════════════════════════════════════════════════════════════
   INTERAÇÃO NO CANVAS
   ═══════════════════════════════════════════════════════════════════ */

function toWorld(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return { x: (clientX - r.left - view.x) / view.k, y: (clientY - r.top - view.y) / view.k };
}

let drag = null;   // {mode:'node'|'pan'|'wire', ...}

canvas.addEventListener('pointerdown', (ev) => {
  const portEl = ev.target.closest('.port');
  const nodeEl = ev.target.closest('.node');

  if (portEl && nodeEl) {                                  // puxar um fio
    ev.preventDefault(); ev.stopPropagation();
    canvas.setPointerCapture(ev.pointerId);
    canvas.classList.add('wiring');
    drag = {
      mode: 'wire',
      from: nodeEl.dataset.id,
      side: portEl.dataset.port,
      pt: toWorld(ev.clientX, ev.clientY)
    };
    return;
  }

  if (nodeEl) {                                            // mover ficha
    ev.preventDefault();
    canvas.setPointerCapture(ev.pointerId);
    const n = byId(nodeEl.dataset.id);
    const p = toWorld(ev.clientX, ev.clientY);
    select(n.id);
    drag = { mode: 'node', id: n.id, dx: p.x - n.x, dy: p.y - n.y, moved: false };
    return;
  }

  if (ev.target.closest('.zoombar') || ev.target.closest('.empty-hint') || ev.target.closest('.lint')) return;

  canvas.setPointerCapture(ev.pointerId);
  const base = { sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y, moved: false };

  if (ev.target.classList && ev.target.classList.contains('hit')) {   // clique num fio = cortar
    drag = { mode: 'cut', edge: ev.target.__edge, ...base };
    return;
  }

  canvas.classList.add('panning');                          // arrastar o quadro
  drag = { mode: 'pan', ...base };
});

canvas.addEventListener('pointermove', (ev) => {
  if (!drag) return;

  if (drag.mode === 'cut') {
    if (Math.abs(ev.clientX - drag.sx) + Math.abs(ev.clientY - drag.sy) > 4) {
      drag = { ...drag, mode: 'pan' };
      canvas.classList.add('panning');
    } else return;
  }

  if (drag.mode === 'pan') {
    const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    view.x = drag.vx + dx; view.y = drag.vy + dy;
    applyView();
    return;
  }

  if (drag.mode === 'node') {
    const p = toWorld(ev.clientX, ev.clientY);
    const n = byId(drag.id);
    if (!n) return;
    if (!drag.moved) { snapshot(); drag.moved = true; }
    n.x = Math.round(p.x - drag.dx);
    n.y = Math.round(p.y - drag.dy);
    const el = nodesEl.querySelector(`[data-id="${n.id}"]`);
    if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
    renderWires();
    return;
  }

  if (drag.mode === 'wire') {
    drag.pt = toWorld(ev.clientX, ev.clientY);
    const anchor = portPos(drag.from, drag.side);
    const a = drag.side === 'out' ? anchor : drag.pt;
    const b = drag.side === 'out' ? drag.pt : anchor;
    renderWires({ a, b });
    const over = document.elementFromPoint(ev.clientX, ev.clientY);
    nodesEl.querySelectorAll('.port.hot').forEach((p) => p.classList.remove('hot'));
    const hot = over && over.closest('.port');
    if (hot && hot.dataset.port !== drag.side) hot.classList.add('hot');
  }
});

canvas.addEventListener('pointerup', (ev) => {
  if (!drag) return;

  if (drag.mode === 'wire') {
    const over = document.elementFromPoint(ev.clientX, ev.clientY);
    const targetNode = over && over.closest('.node');
    if (targetNode && targetNode.dataset.id !== drag.from) {
      if (drag.side === 'out') connect(drag.from, targetNode.dataset.id);
      else connect(targetNode.dataset.id, drag.from);
    }
    nodesEl.querySelectorAll('.port.hot').forEach((p) => p.classList.remove('hot'));
    canvas.classList.remove('wiring');
    render();
  }

  if (drag.mode === 'cut') {
    if (drag.edge) {
      snapshot();
      state.edges = state.edges.filter((x) => x !== drag.edge);
      render();
      toast('Fio cortado');
    }
  }

  if (drag.mode === 'pan' && !drag.moved) select(null);
  if (drag.mode === 'node' && drag.moved) render();

  canvas.classList.remove('panning');
  drag = null;
});

canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  const r = canvas.getBoundingClientRect();
  const mx = ev.clientX - r.left, my = ev.clientY - r.top;

  if (ev.shiftKey) {                       // shift + scroll = andar pelo quadro
    view.x -= (ev.deltaX || ev.deltaY);
    applyView();
  } else {                                 // scroll = zoom no ponteiro
    zoomAt(mx, my, Math.exp(-ev.deltaY * 0.0018));
  }
  save();
}, { passive: false });

function zoomAt(mx, my, factor) {
  const k = Math.min(2.4, Math.max(0.25, view.k * factor));
  view.x = mx - (mx - view.x) * (k / view.k);
  view.y = my - (my - view.y) * (k / view.k);
  view.k = k;
  applyView();
}

function zoomCenter(factor) {
  const r = canvas.getBoundingClientRect();
  zoomAt(r.width / 2, r.height / 2, factor);
  save();
}

function fitView() {
  if (!state.nodes.length) { view = { x: 120, y: 90, k: 1 }; applyView(); return; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of state.nodes) {
    const s = sizes.get(n.id) || { w: NODE_W, h: 100 };
    x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + s.w); y1 = Math.max(y1, n.y + s.h);
  }
  const r = canvas.getBoundingClientRect();
  const pad = 70;
  const k = Math.min(1.3, Math.max(0.25, Math.min((r.width - pad * 2) / (x1 - x0), (r.height - pad * 2) / (y1 - y0))));
  view.k = k;
  view.x = (r.width - (x1 - x0) * k) / 2 - x0 * k;
  view.y = (r.height - (y1 - y0) * k) / 2 - y0 * k;
  applyView();
  save();
}

/* centro visível do canvas, em coordenadas do mundo */
function centerOfView() {
  const r = canvas.getBoundingClientRect();
  return toWorld(r.left + r.width / 2, r.top + r.height / 2);
}

/* ═══════════════════════════════════════════════════════════════════
   INSPETOR
   ═══════════════════════════════════════════════════════════════════ */

function select(id) {
  sel = id;
  nodesEl.querySelectorAll('.node').forEach((el) => el.classList.toggle('sel', el.dataset.id === id));
  syncInspector();
}

function syncMural() {
  const t = state.nodes.filter((n) => n.type === 'trabalhador').length;
  const c = state.nodes.filter((n) => n.type === 'supervisor').length;
  const e = state.nodes.filter((n) => n.type === 'entrega').length;
  const d = state.nodes.filter((n) => n.type === 'decisao').length;
  const m = state.nodes.filter((n) => n.type === 'memoria').length;
  const entrada = state.nodes.find((n) => n.type === 'entrada');
  $('mural-meta').innerHTML =
    `<b>Peças:</b> ${t} trabalhador(es) · ${c} supervisor(es) · ${e} entrega(s)` +
    (d ? ` · ${d} decisão(ões)` : '') + (m ? ` · ${m} memória(s)` : '') + '<br>' +
    `<b>Começa por:</b> ${entrada ? escapeHtml(entrada.name) : 'o próprio objetivo (sem peça de Entrada)'}`;
}

function syncInspector() {
  const n = byId(sel);
  document.body.classList.toggle('com-selecao', !!n);
  syncMural();
  inspEmpty.hidden = !!n;
  inspBody.hidden = !n;
  if (!n) return;

  const t = TYPES[n.type];
  const typeEl = $('insp-type');
  typeEl.textContent = t.label;
  typeEl.style.setProperty('--type-color', t.color);

  $('f-name').value = n.name;
  $('f-instr').value = n.instructions;
  $('f-instr').placeholder = t.placeholder;
  $('f-instr-label').textContent = t.instrLabel;
  $('f-instr-hint').textContent = t.hint;

  $('row-barras').hidden = n.type !== 'supervisor';
  renderBarraChips();

  $('row-rodadas').hidden = n.type !== 'supervisor';
  if (n.type === 'supervisor') $('f-rodadas').value = n.rounds || 3;

  $('row-formato').hidden = n.type !== 'entrega';
  if (n.type === 'entrega') $('f-formato').value = n.format || '';

  $('row-caminhos').hidden = n.type !== 'decisao';
  if (n.type === 'decisao') renderCaminhos(n);

  $('row-memoria').hidden = n.type !== 'memoria';
  if (n.type === 'memoria') {
    $('f-kinds').value = n.kinds || '';
    $('f-rels').value = n.rels || '';
    $('f-rules').value = n.rules || '';
    renderMemPresets(n);
  }

  const line = (label, arr) =>
    `<b>${label}:</b> ${arr.length ? arr.map((x) => escapeHtml(x.name)).join(', ') : '—'}`;
  let meta;
  if (n.type === 'memoria') {
    meta = line('Escrevem aqui', writersOf(n.id)) + '<br>' + line('Consultam', readersOf(n.id));
  } else {
    const ins = directIn(n.id), outs = directOut(n.id);
    meta = line('Recebe de', ins) + '<br>' + line('Entrega para', outs);
    if (memsReadBy(n.id).length) meta += '<br>' + line('Consulta a memória', memsReadBy(n.id));
    if (memsWrittenBy(n.id).length) meta += '<br>' + line('Escreve na memória', memsWrittenBy(n.id));
    if (n.type === 'supervisor' && ins.length) {
      meta += `<br><b>Se reprovar:</b> devolve para ${ins.map((x) => escapeHtml(x.name)).join(', ')}`;
    }
  }
  $('insp-meta').innerHTML = meta;
}

/* ─── Decisão: um campo de condição por fio que sai dela ─── */
function renderCaminhos(n) {
  const wrap = $('caminhos');
  wrap.textContent = '';
  const fios = flowOut(n.id);
  if (!fios.length) {
    const p = document.createElement('p');
    p.className = 'field-hint';
    p.textContent = 'Ligue esta peça a dois ou mais destinos. Cada fio que sair dela aparece aqui para você escrever a condição.';
    wrap.append(p);
    return;
  }
  fios.forEach((e, i) => {
    const lab = document.createElement('label');
    lab.className = 'field caminho';
    const s = document.createElement('span');
    s.textContent = `Caminho ${i + 1} → ${byId(e.to).name}`;
    const inp = document.createElement('input');
    inp.spellcheck = false;
    inp.placeholder = i === fios.length - 1 && fios.length > 1 ? 'Ex.: em qualquer outro caso' : 'Ex.: se mexe com CPF ou dado de saúde';
    inp.value = e.cond || '';
    let dirty = false;
    inp.addEventListener('focus', () => { dirty = false; });
    inp.addEventListener('input', () => {
      if (!dirty) { snapshot(); dirty = true; }
      e.cond = inp.value;
      renderWires(); renderLint(); save();
    });
    lab.append(s, inp);
    wrap.append(lab);
  });
}

/* ─── Memória: preencher rápido com um esquema pronto ─── */
function renderMemPresets(n) {
  const wrap = $('mem-presets');
  wrap.textContent = '';
  for (const [id, p] of Object.entries(MEM_PRESETS)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'barra-chip';
    btn.innerHTML = `<b>${escapeHtml(p.label)}</b><span>${escapeHtml(p.sub)}</span>`;
    btn.addEventListener('click', () => {
      const node = byId(sel);
      if (!node) return;
      const tem = (node.kinds || node.rels || node.rules || '').trim();
      if (tem && !confirm('Trocar o esquema atual desta memória pelo modelo "' + p.label + '"?')) return;
      snapshot();
      node.kinds = p.kinds; node.rels = p.rels; node.rules = p.rules;
      syncInspector(); renderNodes(); measure(); renderWires(); renderLint(); save();
      nodesEl.querySelectorAll('.node').forEach((x) => x.classList.toggle('sel', x.dataset.id === sel));
      toast('Esquema "' + p.label + '" aplicado — edite à vontade');
    });
    wrap.append(btn);
  }
  void n;
}

function bindField(id, apply) {
  const el = $(id);
  let dirty = false;
  el.addEventListener('focus', () => { dirty = false; });
  el.addEventListener('input', () => {
    const n = byId(sel);
    if (!n) return;
    if (!dirty) { snapshot(); dirty = true; }
    apply(n, el.value);
    renderNodes(); measure(); renderWires(); renderLint(); save();
    nodesEl.querySelectorAll('.node').forEach((x) => x.classList.toggle('sel', x.dataset.id === sel));
  });
}

bindField('f-name', (n, v) => { n.name = v; });
bindField('f-instr', (n, v) => { n.instructions = v; if (n.type === 'supervisor') renderBarraChips(); });
bindField('f-rodadas', (n, v) => { n.rounds = Math.min(10, Math.max(1, parseInt(v, 10) || 3)); });
bindField('f-formato', (n, v) => { n.format = v; });
bindField('f-kinds', (n, v) => { n.kinds = v; });
bindField('f-rels', (n, v) => { n.rels = v; });
bindField('f-rules', (n, v) => { n.rules = v; });

(() => {                                    // o objetivo é do grafo, não de uma peça
  const el = $('f-goal');
  let dirty = false;
  el.addEventListener('focus', () => { dirty = false; });
  el.addEventListener('input', () => {
    if (!dirty) { snapshot(); dirty = true; }
    state.goal = el.value;
    renderLint(); save();
  });
})();

/* Cada barra vira um bloco de texto dentro das próprias Instruções da peça —
   um campo só, tudo editável à mão depois. */
function barraBloco(id, node) {
  const b = BARRAS[id];
  const bar = id === 'referencia'
    ? b.bar.replace(REF_VAZIA, ((node && node.ref) || '').trim() || REF_VAZIA)
    : b.bar;
  return `• ${b.label} — ${bar}\n  Como verificar: ${b.como}`;
}
function barraMarca(id) { return '• ' + BARRAS[id].label + ' —'; }

function temBarra(txt, id) { return txt.includes(barraMarca(id)); }

function poeBarra(txt, id, node) {
  const t = txt.replace(/\s+$/, '');
  return (t ? t + '\n\n' : '') + barraBloco(id, node);
}

/** Reescreve um bloco já presente, no mesmo lugar (usado ao digitar a referência). */
function trocaBarra(txt, id, node) {
  const i = txt.indexOf(barraMarca(id));
  if (i < 0) return txt;
  const resto = txt.indexOf('\n• ', i + 1);
  const fim = resto < 0 ? txt.length : resto;
  return txt.slice(0, i) + barraBloco(id, node) + txt.slice(fim);
}

function tiraBarra(txt, id) {
  const i = txt.indexOf(barraMarca(id));
  if (i < 0) return txt;
  const resto = txt.indexOf('\n• ', i + 1);
  const fim = resto < 0 ? txt.length : resto + 1;
  return (txt.slice(0, i) + txt.slice(fim)).replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
}

function renderBarraChips() {
  const wrap = $('barra-chips');
  const n = byId(sel);
  wrap.textContent = '';
  if (!n || n.type !== 'supervisor') return;

  for (const id of BARRA_IDS) {
    const b = BARRAS[id];
    const on = temBarra(n.instructions || '', id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'barra-chip' + (on ? ' on' : '');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.innerHTML = `<b>${escapeHtml(b.label)}</b><span>${escapeHtml(b.sub)}</span>`;
    btn.addEventListener('click', () => {
      const node = byId(sel);
      if (!node) return;
      snapshot();
      node.instructions = on ? tiraBarra(node.instructions || '', id)
                             : poeBarra(node.instructions || '', id, node);
      $('f-instr').value = node.instructions;
      renderNodes(); measure(); renderWires(); renderLint(); renderBarraChips(); save();
      nodesEl.querySelectorAll('.node').forEach((x) => x.classList.toggle('sel', x.dataset.id === sel));
      if (!on && id === 'referencia') $('f-ref').focus();   // o exemplar precisa de nome
    });
    wrap.append(btn);
  }

  const comRef = temBarra(n.instructions || '', 'referencia');
  $('row-ref').hidden = !comRef;
  $('row-ref-hint').hidden = !comRef;
  if (comRef && document.activeElement !== $('f-ref')) $('f-ref').value = n.ref || '';
}

(() => {
  const el = $('f-ref');
  let dirty = false;
  el.addEventListener('focus', () => { dirty = false; });
  el.addEventListener('input', () => {
    const n = byId(sel);
    if (!n) return;
    if (!dirty) { snapshot(); dirty = true; }
    n.ref = el.value;
    n.instructions = trocaBarra(n.instructions || '', 'referencia', n);
    $('f-instr').value = n.instructions;
    renderNodes(); measure(); renderWires(); renderLint(); save();
    nodesEl.querySelectorAll('.node').forEach((x) => x.classList.toggle('sel', x.dataset.id === sel));
  });
})();

$('btn-del').addEventListener('click', () => { if (sel) deleteNode(sel); });

/* ═══════════════════════════════════════════════════════════════════
   VALIDAÇÃO (o que a IA não conseguiria adivinhar)
   ═══════════════════════════════════════════════════════════════════ */

function lint() {
  const out = [];
  if (!state.nodes.length) return out;

  if (!(state.goal || '').trim()) out.push('O grafo está sem objetivo — escreva, na direita, o que ele precisa entregar.');
  if (!state.nodes.some((n) => n.type === 'entrega')) out.push('Falta uma Entrega — nada compila o resultado no fim.');

  for (const n of state.nodes) {
    if (n.type === 'memoria') {
      if (!writersOf(n.id).length) out.push(`A memória "${n.name}" não tem quem escreva nela — ligue um fio de uma peça PARA ela.`);
      if (!readersOf(n.id).length) out.push(`A memória "${n.name}" não é consultada por ninguém — ligue um fio DELA para a peça que usa.`);
      if (!linhasSchema(n.kinds).length) out.push(`A memória "${n.name}" está sem tipos de item — sem eles cada peça guarda do seu jeito.`);
      if (!linhasSchema(n.rels).length) out.push(`A memória "${n.name}" está sem tipos de ligação — sem ligações é só uma lista, não um grafo.`);
      if (!(n.instructions || '').trim()) out.push(`A memória "${n.name}" está sem descrição do que guarda.`);
      continue;
    }
    const ins = parentsOf(n.id), outs = childrenOf(n.id);
    const escreve = memsWrittenBy(n.id).length;
    if (n.type !== 'entrada' && !ins.length && n.type !== 'trabalhador') out.push(`"${n.name}" não recebe nada — está solta no quadro.`);
    if (n.type !== 'entrega' && !outs.length && !escreve) out.push(`"${n.name}" não entrega para ninguém.`);
    if (n.type === 'supervisor' && directIn(n.id).some((p) => p.type === 'supervisor')) {
      out.push(`"${n.name}" julga outro supervisor — supervisor julga trabalho, não julgamento.`);
    }
    if (n.type === 'decisao') {
      const fios = flowOut(n.id);
      if (fios.length < 2) out.push(`A decisão "${n.name}" tem ${fios.length} caminho(s) — decisão precisa de pelo menos dois.`);
      const sem = fios.filter((e) => !(e.cond || '').trim()).length;
      if (sem) out.push(`A decisão "${n.name}" tem ${sem} caminho(s) sem condição escrita.`);
    }
    if (!n.instructions.trim()) out.push(`"${n.name}" está sem instruções.`);
    if (n.instructions.includes(REF_VAZIA)) out.push(`"${n.name}" pede A/B contra uma referência que ninguém nomeou.`);
  }
  if (hasCycle()) out.push('Há um ciclo explícito de fios. O laço de reprova já é implícito — corte o fio que volta.');
  return out;
}

function hasCycle() {
  const seen = {}, stack = {};
  const visit = (id) => {
    if (stack[id]) return true;
    if (seen[id]) return false;
    seen[id] = stack[id] = true;
    for (const c of childrenOf(id)) if (visit(c.id)) return true;
    stack[id] = false;
    return false;
  };
  return state.nodes.some((n) => visit(n.id));
}

function renderLint() {
  const items = lint();
  const box = $('lint');
  if (!items.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = '<b>Antes de exportar</b><ul>' +
    items.slice(0, 5).map((i) => `<li>${escapeHtml(i)}</li>`).join('') +
    (items.length > 5 ? `<li>+ ${items.length - 5} outros</li>` : '') + '</ul>';
}

/* ═══════════════════════════════════════════════════════════════════
   ORDENAÇÃO TOPOLÓGICA
   ═══════════════════════════════════════════════════════════════════ */

function topo() {
  // só peças que rodam: a Memória não é passo, é o quadro que as peças leem e escrevem
  const indeg = {}, out = [];
  const exec = state.nodes.filter((n) => n.type !== 'memoria');
  exec.forEach((n) => { indeg[n.id] = 0; });
  flowEdges().forEach((e) => { if (indeg[e.to] !== undefined) indeg[e.to]++; });
  const queue = exec.filter((n) => indeg[n.id] === 0)
    .sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type) || a.y - b.y);
  const done = new Set();
  while (queue.length) {
    const n = queue.shift();
    if (done.has(n.id)) continue;
    done.add(n.id); out.push(n);
    for (const c of childrenOf(n.id)) {
      indeg[c.id]--;
      if (indeg[c.id] <= 0 && !done.has(c.id)) queue.push(c);
    }
  }
  for (const n of exec) if (!done.has(n.id)) out.push(n);   // restos de ciclo
  return out;
}

/* ═══════════════════════════════════════════════════════════════════
   ARRUMAR — coloca cada peça na coluna da sua profundidade no grafo
   ═══════════════════════════════════════════════════════════════════ */

const COL_W = 282;   // 232 do card + 50 de respiro
const ROW_H = 152;

function arrumar() {
  if (!state.nodes.length) return;
  snapshot();

  // profundidade = caminho mais longo desde uma raiz (tolera ciclo pelo teto)
  const prof = {};
  const calc = (id, visto) => {
    if (prof[id] !== undefined) return prof[id];
    if (visto.has(id)) return 0;
    visto.add(id);
    const pais = parentsOf(id);
    const d = pais.length ? Math.max(...pais.map((p) => calc(p.id, visto) + 1)) : 0;
    visto.delete(id);
    return (prof[id] = d);
  };
  const exec = state.nodes.filter((n) => n.type !== 'memoria');
  exec.forEach((n) => calc(n.id, new Set()));

  // agrupa por coluna, mantendo a ordem vertical que o autor já tinha
  const colunas = {};
  for (const n of exec) (colunas[prof[n.id]] ||= []).push(n);
  if (!exec.length) colunas[0] = [];

  const maisAlta = Math.max(...Object.values(colunas).map((c) => c.length));
  for (const [col, peças] of Object.entries(colunas)) {
    peças.sort((a, b) => a.y - b.y);
    const alturaCol = peças.length * ROW_H;
    const topo = (maisAlta * ROW_H - alturaCol) / 2;          // centraliza a coluna
    peças.forEach((n, i) => {
      n.x = Number(col) * COL_W;
      n.y = Math.round(topo + i * ROW_H);
    });
  }

  // as memórias ficam numa faixa própria embaixo, entre quem escreve e quem consulta
  const base = Math.max(1, maisAlta) * ROW_H + 40;
  const usadas = new Set();
  state.nodes.filter((n) => n.type === 'memoria').forEach((m) => {
    const viz = [...writersOf(m.id), ...readersOf(m.id)].filter((v) => prof[v.id] !== undefined);
    let col = viz.length ? Math.round(viz.reduce((s, v) => s + prof[v.id], 0) / viz.length) : 0;
    while (usadas.has(col)) col++;
    usadas.add(col);
    m.x = col * COL_W;
    m.y = base;
  });

  render();
  fitView();
  toast('Quadro arrumado');
}

/* ═══════════════════════════════════════════════════════════════════
   EXPORTAÇÕES
   ═══════════════════════════════════════════════════════════════════ */

function toJSON() {
  return JSON.stringify({
    format: 'graph-builder',
    version: 2,
    title: state.title,
    goal: state.goal || '',
    generated_at: new Date().toISOString(),
    generator: 'Graph Builder — Maestros da IA',
    semantics: {
      goal: 'O objetivo do grafo inteiro. Vale para TODOS os nós e deve entrar no prompt de sistema de cada agente, antes das instruções específicas dele.',
      entrada: 'OPCIONAL. Ponto de entrada do grafo: carrega o insumo que o usuário fornece em tempo de execução. Se não existir, os nós sem predecessor partem direto do goal.',
      trabalhador: 'Nó de execução. Produz um artefato a partir do que recebe, seguindo suas instructions.',
      supervisor: 'Nó crítico. Recebe SÓ o artefato do(s) nó(s) de origem (nunca o raciocínio), julga contra suas instructions e devolve aprovado/reprovado. Reprovado reenvia ao nó de origem, até rounds. ' + LER_NAO_VERIFICA,
      entrega: 'Nó de junção. Compila em um artefato único tudo que chega nela. Pode ser o fim do grafo ou alimentar a fase seguinte, quando tem sucessores.',
      decisao: 'Nó de roteamento (grafo de procedimento). Não produz artefato: lê o que chegou, responde à pergunta das instructions e segue por EXATAMENTE UM fio de saída — aquele cuja condition bateu. A escolha e o motivo entram no rastro.',
      memoria: 'Memória estruturada (grafo de contexto). NÃO é passo de execução. Guarda itens (item_types) ligados por relações tipadas (relation_types). Fio nó→memória = esse nó escreve; fio memória→nó = esse nó consulta. Todo escritor roda antes de todo leitor. ' + REGRA_ITEM_LIGACAO + ' ' + REGRA_DUAS_PASSADAS + ' Antes de qualquer Entrega, as integrity_rules precisam valer.',
      edge_condition: 'Só em fios que saem de uma Decisão: a condição, em linguagem natural, para seguir por este fio.',
      edge_kind: '"flow" = o trabalho passa de um nó a outro; "writes" = o nó de origem escreve na memória de destino; "reads" = o nó de destino consulta a memória de origem.',
      trace: REGRA_RASTRO
    },
    nodes: state.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      name: n.name,
      instructions: n.instructions,
      ...(n.type === 'supervisor'
        ? { max_rounds: n.rounds || 3, on_reject: directIn(n.id).map((p) => p.id), ...((n.ref || '').trim() ? { reference: n.ref.trim() } : {}) }
        : {}),
      ...(n.type === 'entrega' ? { output_format: n.format || '' } : {}),
      ...(n.type === 'memoria' ? {
        item_types: linhasSchema(n.kinds).map((x) => ({ name: x.nome, fields: x.resto })),
        relation_types: linhasSchema(n.rels).map((x) => ({ name: x.nome, between: x.resto })),
        integrity_rules: (n.rules || '').split('\n').map((l) => l.trim()).filter(Boolean),
        written_by: writersOf(n.id).map((x) => x.id),
        read_by: readersOf(n.id).map((x) => x.id)
      } : {}),
      position: { x: n.x, y: n.y }
    })),
    edges: state.edges.map((e) => ({
      from: e.from, to: e.to,
      kind: isMem(e.to) ? 'writes' : isMem(e.from) ? 'reads' : 'flow',
      ...(byId(e.from) && byId(e.from).type === 'decisao' && !isMem(e.to) ? { condition: e.cond || '' } : {})
    })),
    execution_order: topo().map((n) => n.id)
  }, null, 2);
}

function mermaid() {
  const shape = { entrada: ['([', '])'], trabalhador: ['[', ']'], supervisor: ['{{', '}}'], entrega: ['[(', ')]'], decisao: ['{', '}'], memoria: ['[/', '/]'] };
  const lim = (s) => (s || '').replace(/["|]/g, "'").replace(/\s+/g, ' ').trim().slice(0, 60);
  const lines = ['flowchart LR'];
  for (const n of state.nodes) {
    const [o, c] = shape[n.type];
    lines.push(`  ${n.id}${o}"${lim(n.name)}"${c}`);
  }
  for (const e of state.edges) {
    if (!byId(e.from) || !byId(e.to)) continue;
    if (isMem(e.to)) lines.push(`  ${e.from} -. escreve .-> ${e.to}`);
    else if (isMem(e.from)) lines.push(`  ${e.from} -. consulta .-> ${e.to}`);
    else if (byId(e.from).type === 'decisao') lines.push(`  ${e.from} -->|"${lim(e.cond) || 'sem condição'}"| ${e.to}`);
    else lines.push(`  ${e.from} --> ${e.to}`);
  }
  for (const n of state.nodes) {
    if (n.type !== 'supervisor') continue;
    for (const p of directIn(n.id)) lines.push(`  ${n.id} -. reprova .-> ${p.id}`);
  }
  return lines.join('\n');
}

function brief() {
  const order = topo();
  const L = [];
  const rule = '═'.repeat(72);

  L.push(rule);
  L.push(`GRAFO DE AGENTES — "${state.title}"`);
  L.push('Desenhado no Graph Builder · Maestros da IA');
  L.push(rule, '');

  L.push('## O OBJETIVO');
  L.push((state.goal || '').trim() || '(o autor não escreveu o objetivo — pergunte antes de executar)');
  L.push('');
  L.push('Este objetivo vale para TODAS as peças. Ele entra no prompt de sistema de cada');
  L.push('agente, antes das instruções específicas dele. Onde uma instrução conflitar com o');
  L.push('objetivo, o objetivo manda.');
  L.push('');

  L.push('## O QUE É ISTO');
  L.push('O desenho de um time de agentes de IA. São três papéis, e eles não se misturam:');
  L.push('  • TRABALHADOR — executa e produz o artefato.');
  L.push('  • SUPERVISOR  — crítico cego: recebe só o artefato, nunca o raciocínio de quem');
  L.push('                  construiu, julga contra a barra escrita e aprova ou reprova.');
  L.push('  • ENTREGA     — junta o resultado de todos os laços num artefato único.');
  L.push('Quem constrói nunca aprova o próprio trabalho. Essa é a regra que sustenta o grafo.');
  L.push('Pode haver ainda uma ENTRADA: o insumo que o usuário fornece na hora de rodar. Quando');
  L.push('ela não existe, as peças sem predecessor partem direto do objetivo acima.');
  const temDec = state.nodes.some((n) => n.type === 'decisao');
  const mems = state.nodes.filter((n) => n.type === 'memoria');
  if (temDec || mems.length) {
    L.push('');
    L.push('Este grafo também tem estrutura além do fluxo:');
    if (temDec) {
      L.push('  • DECISÃO — não produz nada: lê o que chegou, responde à pergunta dela e segue por');
      L.push('              UM caminho só, o da condição que bateu. É o método escrito como passos');
      L.push('              com saída condicional, em vez de um parágrafo de instruções.');
    }
    if (mems.length) {
      L.push('  • MEMÓRIA  — não é um passo, é o quadro na parede: itens ligados por relações com');
      L.push('              nome (sustenta, contradiz…). Guarda o que o trabalho descobriu e de onde');
      L.push('              veio cada coisa, num formato que dá para consultar e auditar depois.');
    }
  }
  L.push('');

  L.push('## O FLUXO');
  L.push('```mermaid');
  L.push(mermaid());
  L.push('```');
  L.push('');

  L.push('## ORDEM DE EXECUÇÃO');
  order.forEach((n, i) => {
    L.push(`${String(i + 1).padStart(2, ' ')}. [${TYPES[n.type].label.toUpperCase()}] ${n.name}`);
  });
  L.push('');

  L.push('## AS PEÇAS, UMA A UMA');
  L.push('');
  order.forEach((n, i) => {
    const ins = directIn(n.id), outs = directOut(n.id);
    L.push('─'.repeat(72));
    L.push(`PEÇA ${i + 1} · ${TYPES[n.type].label.toUpperCase()} · "${n.name}"`);
    L.push(`id: ${n.id}`);
    L.push(`Recebe de: ${ins.length ? ins.map((x) => `"${x.name}"`).join(', ') : '— (é o início do grafo)'}`);
    if (n.type === 'decisao') {
      L.push('Caminhos (siga EXATAMENTE UM — o primeiro cuja condição bater):');
      flowOut(n.id).forEach((e, k) => {
        L.push(`  ${k + 1}. ${(e.cond || '').trim() || '(condição não escrita — pergunte ao autor)'}  →  "${byId(e.to).name}"`);
      });
      L.push('Esta peça NÃO produz artefato. Ela repassa intacto o que recebeu para o caminho escolhido');
      L.push('e registra no rastro qual condição bateu e por quê.');
    } else {
      L.push(`Entrega para: ${outs.length ? outs.map((x) => `"${x.name}"`).join(', ') : '— (é o fim do grafo)'}`);
    }
    const lendo = memsReadBy(n.id), escrevendo = memsWrittenBy(n.id);
    if (lendo.length) L.push(`Consulta a memória: ${lendo.map((x) => `"${x.name}"`).join(', ')} — leia antes de começar e cite os itens (pelo id) que usar.`);
    if (escrevendo.length) {
      L.push(`Escreve na memória: ${escrevendo.map((x) => `"${x.name}"`).join(', ')} — além do artefato, devolva os itens novos`);
      L.push('  (e as ligações, se já tiver a memória inteira na mão) no formato da seção MEMÓRIA.');
    }

    if (n.type === 'supervisor') {
      L.push(`Máximo de rodadas: ${n.rounds || 3}`);
      L.push(`Se reprovar: devolve para ${ins.length ? ins.map((x) => `"${x.name}"`).join(', ') : 'o nó de origem'} com a lista de lacunas ordenada por impacto, e o trabalho é refeito.`);
      L.push('Esta peça NÃO reescreve o artefato. Ela julga e devolve.');
      if ((n.ref || '').trim()) L.push(`Referência a igualar ou superar: ${n.ref.trim()}`);
      L.push(LER_NAO_VERIFICA);
    }
    if (n.type === 'entrega' && (n.format || '').trim()) {
      L.push(`Formato final: ${n.format.trim()}`);
    }

    L.push('');
    L.push('INSTRUÇÕES (texto literal do autor — não resuma, não reescreva):');
    L.push('"""');
    L.push((n.instructions || '').trim() || '(em branco — peça ao autor antes de rodar)');
    L.push('"""');
    L.push('');
  });

  if (mems.length) {
    L.push('─'.repeat(72));
    L.push('## MEMÓRIA ESTRUTURADA (o grafo de contexto)');
    L.push('');
    L.push('A memória não é um passo do fluxo: é um arquivo de itens e ligações que as peças');
    L.push('escrevem e consultam. Guarde cada memória num arquivo JSON próprio, neste formato:');
    L.push('');
    L.push('  { "itens":    [ { "id": "A1", "tipo": "<tipo de item>", ...campos do tipo } ],');
    L.push('    "ligacoes": [ { "de": "F1", "tipo": "<tipo de ligação>", "para": "A1" } ] }');
    L.push('');
    L.push('Como preencher:');
    L.push('  • ' + REGRA_ITEM_LIGACAO);
    L.push('  • ' + REGRA_DUAS_PASSADAS);
    L.push('  • Use SÓ os tipos declarados abaixo. Precisou de um tipo novo? Pare e pergunte ao autor.');
    L.push('  • Ids são estáveis: um item nunca é reescrito por cima — um número novo entra como item');
    L.push('    novo, ligado ao velho por "substitui" (ou equivalente), para o histórico não sumir.');
    L.push('');
    for (const m of mems) {
      L.push(`### MEMÓRIA "${m.name}"  (id: ${m.id})`);
      L.push(`Para que serve: ${(m.instructions || '').trim() || '(o autor não descreveu)'}`);
      L.push(`Escrevem aqui: ${writersOf(m.id).map((x) => `"${x.name}"`).join(', ') || '— ninguém'}`);
      L.push(`Consultam: ${readersOf(m.id).map((x) => `"${x.name}"`).join(', ') || '— ninguém'}`);
      L.push('Tipos de item (o conteúdo mora aqui):');
      const ks = linhasSchema(m.kinds);
      if (ks.length) ks.forEach((k) => L.push(`  • ${k.nome}${k.resto ? ' — campos: ' + k.resto : ''}`));
      else L.push('  (nenhum declarado — pergunte ao autor antes de escrever)');
      L.push('Tipos de ligação (só apontam, de → para):');
      const rs = linhasSchema(m.rels);
      if (rs.length) rs.forEach((r) => L.push(`  • ${r.nome}${r.resto ? '  (' + r.resto + ')' : ''}`));
      else L.push('  (nenhum declarado)');
      const regras = (m.rules || '').split('\n').map((l) => l.trim()).filter(Boolean);
      L.push('Regras de integridade (confira ANTES de qualquer Entrega; se uma falhar, a Entrega');
      L.push('lista o que falhou e não apresenta como certo o que depende disso):');
      if (regras.length) regras.forEach((r) => L.push(`  • ${r}`));
      else L.push('  • toda ligação aponta para itens que existem');
      L.push('');
    }
  }

  L.push('─'.repeat(72));
  L.push('## REGRAS DO GRAFO (não negociáveis)');
  L.push('1. Quem constrói nunca aprova. Um supervisor jamais pode ser a mesma instância/contexto');
  L.push('   do trabalhador que ele julga.');
  L.push('2. O supervisor recebe APENAS o artefato — nunca o raciocínio, as justificativas ou as');
  L.push('   desculpas de quem construiu.');
  L.push('3. Reprovado volta para o trabalhador de origem com lacunas concretas e acionáveis.');
  L.push('   Ao estourar o teto de rodadas, entregue o melhor estado com as ressalvas anotadas.');
  L.push('4. A Entrega não inventa conteúdo: ela compila o que os laços produziram.');
  L.push('5. Onde uma instrução for ambígua, pergunte ao autor antes de improvisar.');
  L.push('6. O objetivo do grafo é o critério final: uma peça que cumpre a própria instrução mas');
  L.push('   afasta o grafo do objetivo está errada.');
  L.push('7. ' + REGRA_RASTRO);
  L.push('   Guarde o rastro num arquivo (ex.: rastro.md), uma linha por peça, na ordem em que rodou.');
  if (temDec) L.push('8. Numa Decisão, nunca siga dois caminhos nem invente um terceiro. Nenhuma condição bateu? Pare e pergunte.');
  L.push('');

  L.push('## O QUE FAZER COM ISTO');
  L.push('Monte este grafo no ambiente que você usa:');
  L.push('  • Claude Code / Codex / ChatGPT → crie um agente por peça, com as INSTRUÇÕES acima');
  L.push('    como prompt de sistema, e orquestre na ordem de execução.');
  L.push('  • LangGraph / LangChain → cada peça vira um nó do StateGraph; o supervisor vira uma');
  L.push('    conditional edge (aprovado → segue / reprovado → volta), com o teto de rodadas.');
  L.push('  • n8n → cada peça vira um nó de LLM; o supervisor vira um IF que roteia de volta.');
  if (temDec) L.push('  • Decisão → um roteador (conditional edge / Switch) com um ramo por condição escrita.');
  if (mems.length) L.push('  • Memória → um arquivo JSON (ou banco) por memória, que as peças leem e escrevem.');
  L.push('Comece confirmando comigo o entendimento do fluxo antes de escrever qualquer código.');
  L.push('');
  L.push(rule);
  L.push(`${state.nodes.length} peças · ${state.edges.length} fios · exportado em ${new Date().toLocaleString('pt-BR')}`);
  L.push(rule);

  return L.join('\n');
}

function pySafe(name, fallback) {
  const s = (name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(s) ? s.slice(0, 40) : (fallback || 'node');
}

function langgraph() {
  const order = topo();
  const fname = new Map();
  const used = new Set();
  order.forEach((n, i) => {
    let base = pySafe(n.name, n.type + '_' + (i + 1));
    let f = base, k = 2;
    while (used.has(f)) f = base + '_' + (k++);
    used.add(f);
    fname.set(n.id, f);
  });

  const q = (s) => (s || '').replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"');
  const qs = (s) => (s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
  const mems = state.nodes.filter((n) => n.type === 'memoria');
  const P = [];

  P.push('"""');
  P.push(`Grafo: ${state.title}`);
  P.push(`Objetivo: ${((state.goal || '').trim() || '(não escrito)').replace(/\s+/g, ' ').slice(0, 300)}`);
  P.push('Scaffold gerado pelo Graph Builder (Maestros da IA) a partir do desenho do grafo.');
  P.push('');
  P.push('É um esqueleto executável: a topologia, os prompts e os laços de supervisão já');
  P.push('estão corretos. Ajuste o modelo, o estado e o tratamento de erro ao seu caso.');
  P.push('');
  P.push('  pip install langgraph langchain-openai');
  P.push('  export OPENROUTER_API_KEY=...   # a SUA chave');
  P.push('"""');
  P.push('');
  P.push('import os');
  P.push('import re');
  P.push('import json');
  P.push('from typing import TypedDict, Annotated');
  P.push('from operator import add');
  P.push('from langgraph.graph import StateGraph, START, END');
  P.push('from langchain_openai import ChatOpenAI');
  P.push('');
  P.push('llm = ChatOpenAI(');
  P.push('    model="anthropic/claude-sonnet-5",');
  P.push('    base_url="https://openrouter.ai/api/v1",');
  P.push('    api_key=os.environ["OPENROUTER_API_KEY"],');
  P.push(')');
  P.push('');
  P.push('');
  P.push('def _mescla(a: dict, b: dict) -> dict:');
  P.push('    """Peças em paralelo escrevem no mesmo campo: junta as chaves em vez de brigar."""');
  P.push('    return {**(a or {}), **(b or {})}');
  P.push('');
  P.push('');
  P.push('def _mescla_memoria(a: dict, b: dict) -> dict:');
  P.push('    """Junta itens e ligações novos sem reescrever item que já existe (id é estável)."""');
  P.push('    out = {mid: {"itens": list(m["itens"]), "ligacoes": list(m["ligacoes"])} for mid, m in (a or {}).items()}');
  P.push('    for mid, novo in (b or {}).items():');
  P.push('        m = out.setdefault(mid, {"itens": [], "ligacoes": []})');
  P.push('        ids = {i.get("id") for i in m["itens"]}');
  P.push('        m["itens"] += [i for i in novo.get("itens", []) if i.get("id") not in ids]');
  P.push('        m["ligacoes"] += [l for l in novo.get("ligacoes", []) if l not in m["ligacoes"]]');
  P.push('    return out');
  P.push('');
  P.push('');
  P.push('class State(TypedDict):');
  P.push('    pedido: str                                  # insumo da Entrada (vazio se o grafo parte só do objetivo)');
  P.push('    artefatos: Annotated[dict, _mescla]          # id do nó -> último artefato produzido');
  P.push('    veredictos: Annotated[list, add]             # histórico de julgamentos dos supervisores');
  P.push('    rodadas: Annotated[dict, _mescla]            # id do supervisor -> rodadas já gastas');
  P.push('    rotas: Annotated[dict, _mescla]              # id da decisão -> caminho escolhido');
  P.push('    memoria: Annotated[dict, _mescla_memoria]    # id da memória -> {"itens": [...], "ligacoes": [...]}');
  P.push('    rastro: Annotated[list, add]                 # uma linha por peça que rodou: o que fez e por quê');
  P.push('');
  P.push('');
  P.push('# Regra fixa de todo supervisor.');
  P.push('LER_NAO_VERIFICA = "' + LER_NAO_VERIFICA + '"');
  P.push('');
  P.push('# O objetivo do grafo inteiro: entra no prompt de sistema de TODOS os agentes.');
  P.push('OBJETIVO = ' + Q3);
  P.push(q((state.goal || '').trim() || '(sem objetivo escrito — preencher antes de rodar)'));
  P.push(Q3);
  P.push('');
  P.push('');
  P.push('def _ask(system: str, user: str) -> str:');
  P.push('    contexto = f"Objetivo do time:\\n{OBJETIVO}\\n\\nSua função:\\n{system}"');
  P.push('    return llm.invoke([("system", contexto), ("human", user)]).content');
  P.push('');
  P.push('');

  if (mems.length) {
    P.push('# ── MEMÓRIA ESTRUTURADA (grafo de contexto) ─────────────────────────────');
    P.push('# Não é passo do fluxo: é o quadro que as peças escrevem e consultam.');
    P.push('# O conteúdo mora no item; a ligação só aponta (de -> para) e diz o tipo.');
    P.push('MEMORIAS = {');
    for (const m of mems) {
      P.push(`    "${m.id}": {`);
      P.push(`        "nome": "${qs(m.name)}",`);
      P.push(`        "tipos_item": [${linhasSchema(m.kinds).map((k) => `"${qs(k.nome)}"`).join(', ')}],`);
      P.push(`        "campos": {${linhasSchema(m.kinds).map((k) => `"${qs(k.nome)}": "${qs(k.resto)}"`).join(', ')}},`);
      P.push(`        "tipos_ligacao": [${linhasSchema(m.rels).map((r) => `"${qs(r.nome)}"`).join(', ')}],`);
      P.push(`        "regras": [${(m.rules || '').split('\n').map((l) => l.trim()).filter(Boolean).map((r) => `"${qs(r)}"`).join(', ')}],`);
      P.push('    },');
    }
    P.push('}');
    P.push('');
    P.push('');
    P.push('def _pede_memoria(mid: str) -> str:');
    P.push('    """O pedaço de prompt que ensina uma peça a escrever na memória."""');
    P.push('    m = MEMORIAS[mid]');
    P.push('    campos = "; ".join(f"{t}: {c}" for t, c in m["campos"].items())');
    P.push('    return (');
    P.push('        f"\\n\\nAlém do artefato, termine a resposta com UM bloco ```json``` para a memória \\"{m[\'nome\']}\\": "');
    P.push('        \'{"itens": [{"id": "...", "tipo": "...", ...campos}], "ligacoes": [{"de": "id", "tipo": "...", "para": "id"}]}. \'');
    P.push('        f"Tipos de item permitidos: {campos}. Tipos de ligação permitidos: {\', \'.join(m[\'tipos_ligacao\'])}. "');
    P.push('        "O conteúdo vai no item; a ligação só aponta. Se você não viu a memória inteira, devolva só itens."');
    P.push('    )');
    P.push('');
    P.push('');
    P.push('def _extrai_memoria(texto: str) -> dict:');
    P.push('    blocos = re.findall(r"```json\\s*(\\{.*?\\})\\s*```", texto, re.S)');
    P.push('    if not blocos:');
    P.push('        return {"itens": [], "ligacoes": []}');
    P.push('    try:');
    P.push('        d = json.loads(blocos[-1])');
    P.push('    except json.JSONDecodeError:');
    P.push('        return {"itens": [], "ligacoes": []}');
    P.push('    return {"itens": d.get("itens", []), "ligacoes": d.get("ligacoes", [])}');
    P.push('');
    P.push('');
    P.push('def _confere_memoria(mid: str, mem: dict) -> list:');
    P.push('    """Checagem determinística da estrutura. As regras em texto vão junto para quem entrega."""');
    P.push('    m, falhas = MEMORIAS[mid], []');
    P.push('    ids = {i.get("id") for i in mem.get("itens", [])}');
    P.push('    for i in mem.get("itens", []):');
    P.push('        if m["tipos_item"] and i.get("tipo") not in m["tipos_item"]:');
    P.push('            falhas.append(f"item {i.get(\'id\')} tem tipo não declarado: {i.get(\'tipo\')}")');
    P.push('    for l in mem.get("ligacoes", []):');
    P.push('        if l.get("de") not in ids or l.get("para") not in ids:');
    P.push('            falhas.append(f"ligação {l} aponta para item que não existe")');
    P.push('        if m["tipos_ligacao"] and l.get("tipo") not in m["tipos_ligacao"]:');
    P.push('            falhas.append(f"ligação {l} tem tipo não declarado")');
    P.push('    return falhas');
    P.push('');
    P.push('');
  }

  // funções dos nós
  for (const n of order) {
    const f = fname.get(n.id);
    const ins = directIn(n.id);
    const lendo = memsReadBy(n.id), escrevendo = memsWrittenBy(n.id);
    P.push(`# ── ${TYPES[n.type].label.toUpperCase()} · ${n.name} ${'─'.repeat(Math.max(2, 46 - n.name.length))}`);
    P.push(`${f.toUpperCase()}_INSTRUCOES = """`);
    P.push(q((n.instructions || '').trim() || '(sem instruções — preencher)'));
    P.push('"""');
    P.push('');

    if (n.type === 'entrada') {
      P.push(`def ${f}(state: State) -> dict:`);
      P.push(`    # ${q(n.name)} — ponto de entrada`);
      P.push('    return {');
      P.push(`        "artefatos": {"${n.id}": state["pedido"]},`);
      P.push(`        "rastro": ["${qs(n.name)}: recebeu o pedido"],`);
      P.push('    }');
      P.push('');
      P.push('');
      continue;
    }

    if (n.type === 'supervisor') {
      const target = ins[0] ? fname.get(ins[0].id) : null;
      P.push(`def ${f}(state: State) -> dict:`);
      if (ins.length > 1) {
        P.push('    # recebe de mais de um caminho: julga o que rodou por último (o caminho que a decisão abriu)');
        P.push(`    candidatos = [${ins.map((p) => `"${p.id}"`).join(', ')}]`);
        P.push('    julgado = next((nid for nid in reversed(list(state["artefatos"])) if nid in candidatos), candidatos[0])');
      } else {
        P.push(`    julgado = "${ins[0] ? ins[0].id : ''}"`);
      }
      P.push('    alvo = state["artefatos"].get(julgado, "")');
      P.push('    veredicto = _ask(');
      P.push(`        ${f.toUpperCase()}_INSTRUCOES`);
      P.push('        + "\\n\\n" + LER_NAO_VERIFICA');
      P.push('        + "\\n\\nResponda na primeira linha com APROVADO ou REPROVADO, nas seguintes a "');
      P.push('        "evidência que você de fato produziu, e depois a lista de lacunas por impacto.",');
      P.push('        alvo,');
      P.push('    )');
      P.push(`    gastas = state["rodadas"].get("${n.id}", 0) + 1`);
      P.push('    return {');
      P.push('        "veredictos": [veredicto],');
      P.push(`        "rodadas": {"${n.id}": gastas},`);
      P.push(`        "artefatos": {"${n.id}": veredicto},`);
      P.push(`        "rotas": {"${n.id}": julgado},`);
      P.push(`        "rastro": [f"${qs(n.name)}: rodada {gastas} — {veredicto.splitlines()[0] if veredicto else ''}"],`);
      P.push('    }');
      P.push('');
      P.push('');
      P.push(`def ${f}_decide(state: State) -> str:`);
      P.push('    """Aprovado segue; reprovado devolve para quem construiu, até o teto."""');
      P.push('    ultimo = state["veredictos"][-1] if state["veredictos"] else ""');
      P.push(`    gastas = state["rodadas"].get("${n.id}", 0)`);
      P.push(`    if "REPROVADO" in ultimo.upper() and gastas < ${n.rounds || 3}:`);
      P.push(ins.length > 1 ? `        return "refazer:" + state["rotas"]["${n.id}"]` : '        return "refazer"');
      P.push('    return "seguir"');
      P.push('');
      P.push('');
      if (!target) P.push('# ATENÇÃO: este supervisor não tem nó de origem — ligue-o a um trabalhador.\n');
      continue;
    }

    // entrada da peça: o que chega pelos fios de fluxo
    P.push(`def ${f}(state: State) -> dict:`);
    if (ins.length) {
      P.push('    entrada = "\\n\\n".join(');
      P.push('        f"### {nome}\\n{state[\'artefatos\'].get(nid, \'\')}"');
      P.push('        for nid, nome in [');
      ins.forEach((p) => P.push(`            ("${p.id}", "${qs(p.name)}"),`));
      P.push('        ]');
      P.push('    )');
    } else {
      P.push('    entrada = state["pedido"] or OBJETIVO   # sem peça de Entrada, parte do objetivo');
    }
    for (const m of lendo) {
      P.push(`    # consulta a memória "${qs(m.name)}"`);
      P.push(`    entrada += "\\n\\n### Memória: ${qs(m.name)} (cite os ids que usar)\\n" + json.dumps(`);
      P.push(`        state["memoria"].get("${m.id}", {"itens": [], "ligacoes": []}), ensure_ascii=False, indent=1)`);
    }

    if (n.type === 'decisao') {
      const fios = flowOut(n.id);
      P.push('    caminhos = [');
      fios.forEach((e, k) => P.push(`        ("caminho_${k + 1}", "${qs((e.cond || '').trim() || '(sem condição)')}"),`));
      P.push('    ]');
      P.push('    opcoes = "\\n".join(f"{i + 1}. {cond}" for i, (_, cond) in enumerate(caminhos))');
      P.push('    resposta = _ask(');
      P.push(`        ${f.toUpperCase()}_INSTRUCOES`);
      P.push('        + "\\n\\nEscolha UM caminho. Responda na primeira linha só com o número, e na segunda o motivo.\\n"');
      P.push('        + opcoes,');
      P.push('        entrada,');
      P.push('    )');
      P.push('    m = re.search(r"\\d+", resposta)');
      P.push('    k = int(m.group()) - 1 if m else -1');
      P.push('    if not 0 <= k < len(caminhos):');
      P.push(`        raise ValueError("${qs(n.name)}: nenhuma condição bateu — pare e pergunte ao autor:\\n" + resposta)`);
      P.push('    escolhido, cond = caminhos[k]');
      P.push('    motivo = resposta.splitlines()[1] if len(resposta.splitlines()) > 1 else ""');
      P.push('    return {');
      P.push(`        "rotas": {"${n.id}": escolhido},`);
      P.push(`        "artefatos": {"${n.id}": entrada},   # repassa intacto`);
      P.push(`        "rastro": [f"${qs(n.name)}: seguiu '{cond}' — {motivo}"],`);
      P.push('    }');
      P.push('');
      P.push('');
      P.push(`def ${f}_decide(state: State) -> str:`);
      P.push(`    return state["rotas"]["${n.id}"]`);
      P.push('');
      P.push('');
      continue;
    }

    // supervisores que julgam este nó: injeta a última crítica
    const critics = directOut(n.id).filter((c) => c.type === 'supervisor');
    if (critics.length) {
      P.push('    critica = state["veredictos"][-1] if state["veredictos"] else ""');
      P.push('    if critica:');
      P.push('        entrada += "\\n\\n### Crítica da rodada anterior — corrija ponto a ponto\\n" + critica');
    }
    if (n.type === 'entrega' && mems.length) {
      P.push('    # antes de entregar: as regras de integridade de cada memória');
      P.push('    for mid in MEMORIAS:');
      P.push('        falhas = _confere_memoria(mid, state["memoria"].get(mid, {}))');
      P.push('        regras = "\\n".join("- " + r for r in MEMORIAS[mid]["regras"])');
      P.push('        entrada += f"\\n\\n### Integridade da memória {MEMORIAS[mid][\'nome\']}\\nRegras:\\n{regras}\\n"');
      P.push('        entrada += ("Falhas encontradas:\\n" + "\\n".join(falhas)) if falhas else "Checagem estrutural: ok."');
      P.push('        entrada += "\\nNão apresente como certo nada que dependa de regra quebrada."');
    }
    let sys = `${f.toUpperCase()}_INSTRUCOES`;
    if (n.type === 'entrega' && (n.format || '').trim()) sys += ` + "\\n\\nFormato final: ${qs(n.format.trim())}"`;
    for (const m of escrevendo) sys += ` + _pede_memoria("${m.id}")`;
    P.push(`    saida = _ask(${sys}, entrada)`);
    if (escrevendo.length) {
      P.push('    novo = _extrai_memoria(saida)');
      P.push('    return {');
      P.push(`        "artefatos": {"${n.id}": saida},`);
      P.push(`        "memoria": {${escrevendo.map((m) => `"${m.id}": novo`).join(', ')}},   # só o que é novo; o estado junta`);
      P.push(`        "rastro": ["${qs(n.name)}: produziu o artefato e escreveu na memória"],`);
      P.push('    }');
    } else {
      P.push('    return {');
      P.push(`        "artefatos": {"${n.id}": saida},`);
      P.push(`        "rastro": ["${qs(n.name)}: produziu o artefato"],`);
      P.push('    }');
    }
    P.push('');
    P.push('');
  }

  // montagem do grafo
  P.push('# ── MONTAGEM ─────────────────────────────────────────────────────────');
  P.push('grafo = StateGraph(State)');
  for (const n of order) P.push(`grafo.add_node("${fname.get(n.id)}", ${fname.get(n.id)})`);
  P.push('');

  // junção: peça com 2+ pais "simples" (nem supervisor nem decisão) espera TODOS terminarem,
  // senão o LangGraph roda a peça uma vez para cada pai. Pais em caminhos exclusivos de uma
  // Decisão ficam fora: só um deles vai rodar, esperar os dois travaria o grafo.
  const fe = flowEdges();
  const exclusivo = exclusivosEm(fe);
  const chega = (de, ate) => {
    const visto = new Set(), pilha = [de];
    while (pilha.length) {
      const x = pilha.pop();
      if (x === ate) return true;
      if (visto.has(x)) continue;
      visto.add(x);
      for (const e of fe) if (e.from === x) pilha.push(e.to);
    }
    return false;
  };
  // fio redundante: se o pai p já chega a OUTRO pai de c, quem dispara c é esse outro.
  // Disparar por p também faria c rodar cedo demais (antes do supervisor aprovar, por ex.).
  // O artefato de p continua chegando a c pelo estado.
  const redundante = (p, c) => parentsOf(c.id).some((q) => q !== p && chega(p.id, q.id));
  const juncoes = new Map();
  for (const c of order) {
    const pais = parentsOf(c.id).filter((p) => p.type !== 'supervisor' && p.type !== 'decisao' && !redundante(p, c));
    if (pais.length < 2) continue;
    if (pais.some((a) => pais.some((b) => a !== b && exclusivo(a.id, b.id)))) continue;
    juncoes.set(c.id, pais);
  }

  const roots = order.filter((n) => !parentsOf(n.id).length);
  for (const r of roots) P.push(`grafo.add_edge(START, "${fname.get(r.id)}")`);

  for (const n of order) {
    if (n.type === 'supervisor') {
      const back = directIn(n.id)[0];
      const fwd = childrenOf(n.id);
      P.push(`grafo.add_conditional_edges(`);
      P.push(`    "${fname.get(n.id)}",`);
      P.push(`    ${fname.get(n.id)}_decide,`);
      P.push('    {');
      const insS = directIn(n.id);
      if (insS.length > 1) insS.forEach((p) => P.push(`        "refazer:${p.id}": "${fname.get(p.id)}",`));
      else P.push(`        "refazer": ${back ? `"${fname.get(back.id)}"` : 'END'},`);
      P.push(`        "seguir": ${fwd.length ? `"${fname.get(fwd[0].id)}"` : 'END'},`);
      P.push('    },');
      P.push(')');
      if (fwd.length > 1) {
        P.push(`# NOTA: "${qs(n.name)}" aprova para ${fwd.length} destinos; o conditional acima usa o primeiro.`);
        P.push('# Para abrir em paralelo, troque o destino "seguir" por uma lista com Send().');
      }
      continue;
    }
    if (n.type === 'decisao') {
      const fios = flowOut(n.id);
      P.push(`grafo.add_conditional_edges(`);
      P.push(`    "${fname.get(n.id)}",`);
      P.push(`    ${fname.get(n.id)}_decide,`);
      P.push('    {');
      fios.forEach((e, k) => P.push(`        "caminho_${k + 1}": "${fname.get(e.to)}",   # ${qs((e.cond || '').trim() || 'sem condição')}`));
      P.push('    },');
      P.push(')');
      continue;
    }
    const filhos = childrenOf(n.id);
    for (const c of filhos) {
      if (juncoes.has(c.id)) continue;   // sai numa linha só, mais abaixo
      if (redundante(n, c)) {
        P.push(`# "${qs(n.name)}" → "${qs(c.name)}": não dispara (o artefato chega pelo estado; quem dispara é a peça seguinte do caminho)`);
        continue;
      }
      P.push(`grafo.add_edge("${fname.get(n.id)}", "${fname.get(c.id)}")` +
        (directOut(n.id).includes(c) ? '' : '   # ordem: escreve na memória que o destino consulta'));
    }
    if (!filhos.length) P.push(`grafo.add_edge("${fname.get(n.id)}", END)`);
  }
  for (const [cid, pais] of juncoes) {
    P.push(`grafo.add_edge([${pais.map((p) => `"${fname.get(p.id)}"`).join(', ')}], "${fname.get(cid)}")   # espera todos chegarem`);
  }

  P.push('');
  P.push('app = grafo.compile()');
  P.push('');
  P.push('if __name__ == "__main__":');
  P.push('    resultado = app.invoke({');
  P.push(state.nodes.some((n) => n.type === 'entrada')
    ? '        "pedido": "COLE AQUI O INSUMO REAL",'
    : '        "pedido": "",   # sem peça de Entrada: o grafo parte do objetivo');
  P.push('        "artefatos": {},');
  P.push('        "veredictos": [],');
  P.push('        "rodadas": {},');
  P.push('        "rotas": {},');
  P.push('        "memoria": {},');
  P.push('        "rastro": [],');
  P.push('    })');
  P.push('    for nid, texto in resultado["artefatos"].items():');
  P.push('        print(f"\\n===== {nid} =====\\n{texto}")');
  P.push('    print("\\n===== RASTRO =====")');
  P.push('    for i, linha in enumerate(resultado["rastro"], 1):');
  P.push('        print(f"{i:2d}. {linha}")');
  if (mems.length) {
    P.push('    with open("memoria.json", "w", encoding="utf-8") as fh:');
    P.push('        json.dump(resultado["memoria"], fh, ensure_ascii=False, indent=2)');
    P.push('    print("\\nmemória gravada em memoria.json")');
  }
  P.push('');

  return P.join('\n');
}

/* ═══════════════════════════════════════════════════════════════════
   MODAL DE EXPORTAÇÃO
   ═══════════════════════════════════════════════════════════════════ */

const TAB_NOTES = {
  brief: 'O formato que a IA entende melhor: um protocolo em texto, com o fluxo, a ordem de execução e as instruções literais de cada peça. Cole num chat e peça para montar o time. Acima de ~8 mil caracteres, prefira Baixar arquivo e mandar a IA ler o arquivo — terminal e chat truncam colagem grande sem avisar.',
  json: 'O grafo canônico, para reabrir aqui no Graph Builder, versionar no git ou alimentar seu próprio código.',
  lang: 'Esqueleto executável em LangGraph: um nó por peça, conditional edge no supervisor (aprova segue / reprova volta) e na Decisão (um ramo por condição), memória estruturada no estado e o rastro de cada rodada. Use a SUA chave.'
};
const TAB_FILES = { brief: 'txt', json: 'json', lang: 'py' };

let tab = 'brief';

function currentOut() {
  return tab === 'brief' ? brief() : tab === 'json' ? toJSON() : langgraph();
}

function openModal() {
  if (!state.nodes.length) { toast('Pendure ao menos uma peça no quadro'); return; }
  $('modal').hidden = false;
  paintOut();
}

function paintOut() {
  const text = currentOut();
  $('out').textContent = text;
  $('tab-note').textContent = TAB_NOTES[tab];
  $('out-meta').textContent =
    `${text.length.toLocaleString('pt-BR')} caracteres · ${state.nodes.length} peças · ${state.edges.length} fios`;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === tab));
}

document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => { tab = t.dataset.tab; paintOut(); });
});

function renderLib() {
  const wrap = $('lib-lista');
  wrap.textContent = '';
  const fmt = (t) => new Date(t || Date.now()).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

  for (const g of [...lib.grafos].sort((a, b) => (b.atualizado || 0) - (a.atualizado || 0))) {
    const card = document.createElement('div');
    card.className = 'lib-card' + (g.id === lib.atual ? ' on' : '');

    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'lib-abrir';
    const t = (g.nodes || []).filter((n) => n.type === 'trabalhador').length;
    const c = (g.nodes || []).filter((n) => n.type === 'supervisor').length;
    info.innerHTML = `<b>${escapeHtml(g.title || 'Sem nome')}</b>` +
      `<span>${(g.nodes || []).length} peças · ${t} trabalhador(es) · ${c} supervisor(es) · ${fmt(g.atualizado)}</span>` +
      `<span class="lib-obj">${escapeHtml((g.goal || '').trim().slice(0, 110) || 'sem objetivo escrito')}</span>`;
    info.addEventListener('click', () => { abrir(g.id); renderLib(); toast('Aberto: ' + (g.title || 'sem nome')); });

    const acoes = document.createElement('div');
    acoes.className = 'lib-btns';

    const dup = document.createElement('button');
    dup.type = 'button'; dup.className = 'btn ghost sm'; dup.textContent = 'Duplicar';
    dup.addEventListener('click', () => { novoGrafo(g); renderLib(); toast('Grafo duplicado'); });

    const del = document.createElement('button');
    del.type = 'button'; del.className = 'btn ghost sm'; del.textContent = 'Apagar';
    del.addEventListener('click', () => {
      if (!confirm(`Apagar "${g.title || 'sem nome'}"? Não dá para desfazer.`)) return;
      lib.grafos = lib.grafos.filter((x) => x.id !== g.id);
      if (!lib.grafos.length) novoGrafo(null);
      else if (lib.atual === g.id) abrir(lib.grafos[0].id);
      libGravar(); renderLib(); toast('Grafo apagado');
    });

    acoes.append(dup, del);
    card.append(info, acoes);
    wrap.append(card);
  }
}

$('btn-lib').addEventListener('click', () => { renderLib(); $('modal-lib').hidden = false; });
$('btn-lib-close').addEventListener('click', () => { $('modal-lib').hidden = true; });
$('modal-lib').addEventListener('click', (e) => { if (e.target === $('modal-lib')) $('modal-lib').hidden = true; });
$('btn-novo').addEventListener('click', () => { novoGrafo(null); renderLib(); toast('Grafo novo criado'); });

$('btn-export').addEventListener('click', openModal);
$('btn-close').addEventListener('click', () => { $('modal').hidden = true; });
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) $('modal').hidden = true; });

$('btn-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(currentOut());
    toast('Copiado');
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = currentOut(); document.body.append(ta); ta.select();
    document.execCommand('copy'); ta.remove();
    toast('Copiado');
  }
});

$('btn-download').addEventListener('click', () => {
  const slug = pySafe(state.title, 'grafo');
  const blob = new Blob([currentOut()], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${slug}.${TAB_FILES[tab]}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

/* ═══════════════════════════════════════════════════════════════════
   CHROME: paleta, topbar, teclado
   ═══════════════════════════════════════════════════════════════════ */

document.querySelectorAll('[data-add]').forEach((b) => {
  b.addEventListener('click', () => {
    const atual = byId(sel);
    const base = atual
      ? { x: atual.x + NODE_W + 70, y: atual.y }        // encadeia à direita da peça atual
      : (() => { const c = centerOfView(); return { x: c.x - NODE_W / 2, y: c.y - 60 }; })();
    const p = lugarLivre(base.x, base.y);
    addNode(b.dataset.add, p.x, p.y);
  });
});

$('graph-title').addEventListener('input', (e) => { state.title = e.target.value; save(); });

$('btn-clear').addEventListener('click', () => {
  if (!state.nodes.length) return;
  if (!confirm('Limpar o quadro inteiro? Dá para desfazer com Ctrl+Z.')) return;
  snapshot();
  state.nodes = []; state.edges = []; sel = null;
  render(); syncInspector();
});

$('btn-import').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!Array.isArray(d.nodes)) throw new Error('sem nós');
    novoGrafo(null);
    state.title = d.title || 'Grafo importado';
    state.goal = d.goal || '';
    state.nodes = d.nodes.map((n) => ({
      id: n.id || uid(n.type || 'trabalhador'),
      type: TYPES[n.type] ? n.type : 'trabalhador',
      name: n.name || 'Sem nome',
      instructions: n.instructions || '',
      rounds: n.max_rounds || n.rounds || 3,
      ref: n.reference || n.ref || '',
      format: n.output_format || n.format || '',
      ...(n.type === 'memoria' ? {
        kinds: n.kinds || (n.item_types || []).map((t) => t.name + (t.fields ? ' — ' + t.fields : '')).join('\n'),
        rels: n.rels || (n.relation_types || []).map((t) => t.name + (t.between ? ' — ' + t.between : '')).join('\n'),
        rules: n.rules || (n.integrity_rules || []).join('\n')
      } : {}),
      x: (n.position && n.position.x) || n.x || 0,
      y: (n.position && n.position.y) || n.y || 0
    }));
    state.edges = (d.edges || []).map((x) => {
      const de = state.nodes.find((n) => n.id === x.from);
      return de && de.type === 'decisao' ? { from: x.from, to: x.to, cond: x.condition || x.cond || '' } : { from: x.from, to: x.to };
    });
    $('graph-title').value = state.title;
    $('f-goal').value = state.goal;
    sel = null;
    render(); syncInspector(); fitView();
    toast('Grafo importado');
  } catch (err) {
    toast('Arquivo inválido');
  }
  e.target.value = '';
});

$('zoom-in').addEventListener('click', () => zoomCenter(1.2));
$('zoom-out').addEventListener('click', () => zoomCenter(1 / 1.2));
$('zoom-reset').addEventListener('click', () => { const r = canvas.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1 / view.k); save(); });
$('zoom-fit').addEventListener('click', fitView);
$('btn-arrumar').addEventListener('click', arrumar);

$('btn-foco').addEventListener('click', () => {
  document.body.classList.toggle('foco');
  $('btn-foco').textContent = document.body.classList.contains('foco') ? 'Painéis' : 'Foco';
  requestAnimationFrame(() => { measure(); renderWires(); fitView(); });
});
$('btn-example').addEventListener('click', buildExample);
$('btn-example-2').addEventListener('click', buildExampleEstrutura);

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
  if (e.key === 'Escape') {
    if (!$('modal').hidden) { $('modal').hidden = true; return; }
    if (!$('modal-lib').hidden) { $('modal-lib').hidden = true; return; }
    select(null); return;
  }
  if (typing) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicar(); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); deleteNode(sel); }
});

/* ═══════════════════════════════════════════════════════════════════
   EXEMPLO
   ═══════════════════════════════════════════════════════════════════ */

function buildExample() {
  snapshot();
  const mk = (type, name, instructions, x, y, extra = {}) => {
    const n = { id: uid(type), type, name, instructions, x, y, ...extra };
    state.nodes.push(n);
    return n;
  };
  state.nodes = []; state.edges = [];
  state.title = 'Página de vendas com crítico cego';
  state.goal = 'Entregar uma página de vendas pronta para publicar — que um estranho leia e entenda em 30 segundos para quem é, o que ganha e qual o próximo passo, sem nenhuma promessa que não dê para provar.';
  $('graph-title').value = state.title;
  $('f-goal').value = state.goal;

  const e0 = mk('entrada', 'O pedido do cliente', 'O usuário cola: o produto, para quem é, o preço e a promessa central.', 0, 250);
  const w1 = mk('trabalhador', 'Pesquisador de ângulo', 'Levante os três ângulos de venda mais fortes para este produto e escolha um, justificando em duas linhas. Nada de lugar-comum.', 300, 20);
  const w2 = mk('trabalhador', 'Redator da página', 'Escreva a página de vendas inteira a partir do ângulo escolhido: headline, subheadline, prova, objeções, oferta e CTA. Português do Brasil, tom direto, sem hype.', 300, 300);
  const s1 = mk('supervisor', 'Crítico da copy',
    'Você recebe SÓ a página. Reprove se: a headline não deixar claro para quem é; faltar prova concreta; houver promessa vaga ou impossível de verificar; o CTA não disser o próximo passo exato. Liste as lacunas por impacto.\n\n' + barraBloco('wow'),
    600, 300, { rounds: 3 });
  const d1 = mk('entrega', 'Página final', 'Monte o documento final: o ângulo escolhido no topo, depois a página aprovada por inteiro, e no fim as ressalvas que o crítico deixou em aberto.', 600, 20, { format: 'Markdown, pronto para colar no editor da página' });

  state.edges = [
    { from: e0.id, to: w1.id },
    { from: e0.id, to: w2.id },
    { from: w1.id, to: w2.id },
    { from: w2.id, to: s1.id },
    { from: s1.id, to: d1.id },
    { from: w1.id, to: d1.id }
  ];
  sel = null;
  render(); syncInspector(); fitView();
  toast('Exemplo montado — clique nas peças para ler as instruções');
}

/* Exemplo 2: a mesma força-tarefa, com o quadro na parede e o manual da delegacia.
   Pesquisadores escrevem itens → um ligador faz as ligações → uma Decisão escolhe o
   método de preço → a Entrega só sai se a memória fechar. */
function buildExampleEstrutura() {
  snapshot();
  const mk = (type, name, instructions, x, y, extra = {}) => {
    const n = { id: uid(type), type, name, instructions, x, y, ...extra };
    state.nodes.push(n);
    return n;
  };
  state.nodes = []; state.edges = [];
  state.title = 'Pesquisa de preço com memória e decisão';
  state.goal = 'Recomendar quanto cobrar por um projeto de implementação de IA, com cada número apoiado numa fonte que dá para abrir — e dizer, no fim, por que o método de preço escolhido foi esse.';
  $('graph-title').value = state.title;
  $('f-goal').value = state.goal;

  const p = MEM_PRESETS.pesquisa;
  const e0 = mk('entrada', 'O projeto do cliente', 'O usuário cola: o que o cliente quer construir, que dados o sistema vai tocar e o tamanho da equipe.', 0, 200);
  const w1 = mk('trabalhador', 'Pesquisador de agências', 'Ache quanto agências e consultorias no Brasil cobram por projetos parecidos. Para cada número, registre a afirmação e a fonte (url, autor, data, natureza). Não compare nada ainda: só anote o que achou.', 300, 40);
  const w2 = mk('trabalhador', 'Pesquisador de freelancers', 'Ache quanto freelancers cobram por projetos parecidos (Workana, 99Freelas, fóruns). Para cada número, registre a afirmação e a fonte. Não compare nada ainda: só anote o que achou.', 300, 330);
  const mem = mk('memoria', 'Quadro da pesquisa', 'Tudo o que a pesquisa descobriu sobre preços, com a fonte de cada número e as contradições entre fontes.', 450, 620, { kinds: p.kinds, rels: p.rels, rules: p.rules });
  const w3 = mk('trabalhador', 'Ligador', 'Leia a memória inteira de uma vez. Ligue as afirmações entre si: marque o que se contradiz e o que é versão mais nova de outro número. Não crie afirmação nova — só ligações.', 600, 180);
  const d1 = mk('decisao', 'Que tipo de projeto é?', 'Olhe o projeto do cliente. Ele toca dado sensível (CPF, saúde, financeiro), plataforma de terceiros ou equipe grande?', 900, 180);
  const w4 = mk('trabalhador', 'Preço por comparáveis', 'Com as afirmações da memória que têm fonte de menos de 2 anos, monte uma faixa de preço por comparáveis. Cite os ids de cada número usado. Grave a conclusão na memória, ligada às afirmações por "baseada em".', 1200, 40);
  const w5 = mk('trabalhador', 'Preço por classe de sistema', 'Projeto de classe "sistema": aplique o piso de sistema e some o degrau de complexidade. Use a memória só para conferir se o piso está dentro do mercado, citando os ids. Grave a conclusão na memória.', 1200, 330);
  const s1 = mk('supervisor', 'Auditor das fontes', 'Você recebe SÓ a recomendação. Reprove se algum número não citar o id de uma afirmação, se uma afirmação citada não tiver fonte, ou se a recomendação ignorar uma contradição marcada.\n\n' + barraBloco('sem-erros'), 1500, 180, { rounds: 3 });
  const f1 = mk('entrega', 'Recomendação de preço', 'Monte a recomendação: a faixa, o método escolhido e por quê (copie do rastro qual condição da decisão bateu), e a lista de fontes. Se alguma regra da memória falhou, diga qual e o que fica em aberto.', 1800, 180, { format: 'Markdown de uma página' });

  const lig = (a, b, cond) => state.edges.push(cond === undefined ? { from: a.id, to: b.id } : { from: a.id, to: b.id, cond });
  lig(e0, w1); lig(e0, w2);
  lig(w1, mem); lig(w2, mem);           // pesquisadores escrevem itens
  lig(mem, w3); lig(w3, mem);           // o ligador lê tudo e escreve as ligações
  lig(e0, d1); lig(w3, d1);
  lig(d1, w4, 'se não toca dado sensível, plataforma de terceiros nem equipe grande');
  lig(d1, w5, 'se toca qualquer um desses');
  lig(mem, w4); lig(mem, w5);
  lig(w4, mem); lig(w5, mem);
  lig(w4, s1); lig(w5, s1);
  lig(s1, f1); lig(mem, f1);
  sel = null;
  render(); syncInspector(); fitView();
  toast('Exemplo com memória e decisão — clique na Memória e na Decisão');
}

/* ═══════════════════════════════════════════════════════════════════
   UTILITÁRIOS
   ═══════════════════════════════════════════════════════════════════ */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 1900);
}

/* ═══════════════════════════════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════════════════════════════ */

load();
seq = state.nodes.length + 1;
$('graph-title').value = state.title;
$('f-goal').value = state.goal || '';
render();
syncInspector();

/* O app vive atrás do gate: enquanto #app-screen está oculta, offsetWidth é 0 e
   qualquer medida sai errada. Observamos a classe 'active' (MutationObserver, não
   evento — COR-044) e re-renderizamos no instante em que a tela aparece. */
(() => {
  const tela = document.getElementById('app-screen');
  if (!tela) return;
  let jaAbriu = false;
  const aoAbrir = () => {
    if (!tela.classList.contains('active') || jaAbriu) return;
    jaAbriu = true;
    requestAnimationFrame(() => { render(); if (state.nodes.length) fitView(); });
  };
  new MutationObserver(aoAbrir).observe(tela, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('maestria:app-ready', aoAbrir);
  aoAbrir();
})();

window.addEventListener('resize', () => renderWires());
console.log('Graph Builder v1 pronto —', state.nodes.length, 'peças');

})();
