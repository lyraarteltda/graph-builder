/**
 * gate-bridge.js — ponte entre o gate unificado e um app SEM BYOK.
 *
 * Por que existe: o Graph Builder não chama nenhuma IA. Ele PRODUZ o texto que a
 * IA do próprio membro vai executar, no ambiente dele. Não há inferência, não há
 * chave de terceiro, então não há `api-key-manager.js` — a Hard Rule #1 (BYOK)
 * simplesmente não tem o que regular aqui, e uma tela pedindo chave seria uma
 * fricção sem propósito.
 *
 * O gate unificado (gate.maestrosdaia.com/v1) sempre encaminha para `key-screen`
 * depois de verificar o membro, e só chega em `app-screen` quando
 * `ApiKeyManager.hasRequiredKeys()` diz que sim. Esta ponte faz duas coisas:
 *
 *   1. Publica um ApiKeyManager mínimo que declara "não preciso de chave".
 *   2. Observa `#key-screen` e, no instante em que ela é ativada, segue direto
 *      para `#app-screen` (MutationObserver, não evento — COR-044: o evento
 *      `maestria:app-ready` não é confiável no caminho de primeiro login).
 *
 * A decisão de acesso continua 100% no backend (n8n → comunidade_purchases).
 * Nada aqui concede acesso: isto só escolhe qual tela mostrar DEPOIS que o
 * backend já disse que o membro é válido.
 */
(function () {
  'use strict';

  window.ApiKeyManager = window.ApiKeyManager || {
    hasRequiredKeys: function () { return true; },   // este app não usa chave de IA
    renderInputs: function () {},
    getKey: function () { return null; }
  };

  function pular() {
    var key = document.getElementById('key-screen');
    if (!key || !key.classList.contains('active')) return;
    if (window.MembershipGate && typeof window.MembershipGate.showScreen === 'function') {
      window.MembershipGate.showScreen('app-screen');
    } else {
      key.classList.remove('active');
      var app = document.getElementById('app-screen');
      if (app) app.classList.add('active');
      document.dispatchEvent(new Event('maestria:app-ready'));
    }
  }

  var alvo = document.getElementById('key-screen');
  if (alvo) new MutationObserver(pular).observe(alvo, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('DOMContentLoaded', pular);
  pular();
})();
