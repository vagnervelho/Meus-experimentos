/**
 * HealthService — regras sanitárias (05, seções 2.8 e 4.7 a 4.8). Puro: recebe as linhas de SANIDADE (vigentes) de quem
 * chama, sem ler planilha nem relógio. O evento SANIDADE, a agenda e os protocolos chegam na Fase 3; nesta fase está
 * a regra de carência que a VENDA consulta (RN-072): o mesmo cálculo servirá à agenda e ao alerta "animais em
 * carência" quando a Fase 3 gravar SANIDADE.
 */
var HealthService = (function () {
  function vazio_(v) {
    return v === null || v === undefined || v === '';
  }
  /**
   * Último dia de carência de uma aplicação (05, seção 4.8): `data_fim_carencia` gravada ou, sem ela, `data_aplicacao`
   * + `periodo_carencia_dias`. Sem aplicação válida ou sem período positivo → null (não há carência).
   * Vermífugo em 01/11/2026 com 35 dias → carência até 06/12/2026.
   */
  function fimCarencia(registro) {
    var r = registro || {};
    if (!vazio_(r.data_fim_carencia) && Utils.dataValida(r.data_fim_carencia)) return r.data_fim_carencia;
    if (vazio_(r.data_aplicacao) || !Utils.dataValida(r.data_aplicacao)) return null;
    var dias = r.periodo_carencia_dias;
    if (typeof dias !== 'number' || !isFinite(dias) || Math.floor(dias) !== dias || dias <= 0) return null;
    return Utils.somaDias(r.data_aplicacao, dias);
  }
  /**
   * Carência vigente na data D (fim do dia): entre as aplicações até D, a de maior fim de carência, se o fim é ≥ D
   * (em carência se D ≤ C; 05, seção 4.8). registros = linhas de SANIDADE de UM animal. Devolve {fim, health_id,
   * event_id, nome_produto, data_aplicacao, tipo_procedimento} ou null (livre). Data inválida → INTERNAL.
   */
  function carenciaEm(registros, data) {
    if (vazio_(data) || !Utils.dataValida(data)) throw Validation.erro('INTERNAL', 'carenciaEm precisa de uma data válida.');
    var melhor = null;
    (registros || []).forEach(function (r) {
      if (!r || vazio_(r.data_aplicacao) || r.data_aplicacao > data) return;
      var fim = fimCarencia(r);
      if (fim === null || fim < data) return;
      if (!melhor || fim > melhor.fim || (fim === melhor.fim && r.data_aplicacao > melhor.data_aplicacao)) {
        melhor = { fim: fim, health_id: r.health_id || null, event_id: r.event_id || null, nome_produto: vazio_(r.nome_produto) ? null : r.nome_produto, data_aplicacao: r.data_aplicacao, tipo_procedimento: r.tipo_procedimento || null };
      }
    });
    return melhor;
  }

  return {
    fimCarencia: fimCarencia,
    carenciaEm: carenciaEm,
  };
})();
