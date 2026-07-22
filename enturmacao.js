// ============================================================
// enturmacao.js — usa shared.js (mesmo padrão de turmas_alunos.html
// e secretaria_dashboard.html)
//
// De shared.js já vêm prontos: SUPABASE_URL, SUPABASE_KEY, apiSec,
// dbFrom, db, currentUser, currentSchoolId, currentSchoolData,
// userSchools, singleSchool, checkSession, loadUserProfile,
// loadUserSchools, showToast, val, corTurno, corStatus, formatDate,
// escapeHtml, handleLogout, setupDateDefaults.
//
// Este arquivo só precisa definir onSchoolsReady() (chamada pelo
// shared.js assim que currentSchoolId estiver pronto) e a lógica
// específica desta página.
// ============================================================

let currentTurmaId = null;

const state = {
  turmaAtual: null,
  isEnsinoMedio: false,
  alunosSemTurma: [],
  alunosEnturmados: [],
  selecionadosSem: new Set(),
  selecionadosEnt: new Set(),
  candidatosEnturmar: new Map(), // id -> objeto aluno (marcados na tela cheia)
  candidatoConferencia: null
};

// ---------- HELPERS PRÓPRIOS DESTA PÁGINA (não vêm de shared.js) ----------
function nomeAluno(a) {
  return a.nome_completo || a.nome || 'Sem Nome';
}

function badgeSituacao(situacao) {
  // Reaproveita a lógica de cor de corStatus() do shared.js (retorna 'success'/'warning'/etc)
  return `badge-${corStatus(situacao)}`;
}

function trocarPagina(idAtiva) {
  document.querySelectorAll('#content .page').forEach(el => el.classList.remove('active'));
  document.getElementById(idAtiva).classList.add('active');
}

// ============================================================
// onSchoolsReady — disparado pelo shared.js (dentro de loadUserSchools)
// assim que currentSchoolId está definido. Aqui só ficam os loads
// específicos DESTA página.
// ============================================================
async function onSchoolsReady() {
  await pesquisarTurmas();
}

// ===== INICIALIZAÇÃO =====
window.onload = async () => {
  setupDateDefaults();
  await checkSession();
};

// ============================================================
// TELA 1 — PESQUISA DE TURMA
// ============================================================
function limparFiltros() {
  ['fCodigo', 'fNome', 'fPeriodo', 'fTipoEnsino', 'fNivel', 'fEtapa', 'fTurno'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  pesquisarTurmas();
}

async function pesquisarTurmas() {
  if (!currentSchoolId) return;

  const tbody = document.getElementById('tbodyTurmas');
  tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Buscando...</p></div></td></tr>`;

  const codigo = val('fCodigo').trim();
  const nome = val('fNome').trim();
  const periodo = val('fPeriodo');
  const tipoEnsino = val('fTipoEnsino');
  const nivel = val('fNivel');
  const etapa = val('fEtapa');
  const turno = val('fTurno');

  let filtros = [`escola_id=eq.${currentSchoolId}`];
  if (codigo) filtros.push(`id=eq.${encodeURIComponent(codigo)}`);
  if (nome) filtros.push(`nome=ilike.*${encodeURIComponent(nome)}*`);
  if (periodo) filtros.push(`periodo_letivo=eq.${encodeURIComponent(periodo)}`);
  if (tipoEnsino) filtros.push(`tipo_ensino=eq.${encodeURIComponent(tipoEnsino)}`);
  if (nivel) filtros.push(`nivel=eq.${encodeURIComponent(nivel)}`);
  if (etapa) filtros.push(`etapa=eq.${encodeURIComponent(etapa)}`);
  if (turno) filtros.push(`turno=eq.${encodeURIComponent(turno)}`);

  const query = `turmas?select=*&${filtros.join('&')}&order=nome.asc`;
  const { data: turmas, error } = await apiSec(query);

  if (error) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><i class="fas fa-triangle-exclamation"></i><p>Erro ao buscar turmas</p></div></td></tr>`;
    showToast('Erro ao buscar turmas: ' + error.message, 'danger');
    return;
  }
  renderTurmas(turmas || []);
}

function renderTurmas(turmas) {
  const tbody = document.getElementById('tbodyTurmas');
  document.getElementById('turmasCount').textContent = `Mostrando ${turmas.length} de ${turmas.length}`;

  if (!turmas.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><i class="fas fa-chalkboard"></i><p>Nenhuma turma encontrada</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = turmas.map(t => `
    <tr>
      <td>${escapeHtml(t.id)}</td>
      <td><strong>${escapeHtml(t.nome)}</strong></td>
      <td>${escapeHtml(t.periodo_letivo || '—')}</td>
      <td>${escapeHtml(t.tipo_ensino || '—')}</td>
      <td>${escapeHtml(t.nivel || '—')}</td>
      <td>${escapeHtml(t.etapa || '—')}</td>
      <td><span class="badge badge-${corTurno(t.turno)}">${escapeHtml(t.turno || '—')}</span></td>
      <td class="td-actions">
        <button class="btn btn-sm btn-primary" onclick="abrirGerenciamento('${t.id}')">
          <i class="fas fa-user-group"></i> Enturmação
        </button>
      </td>
    </tr>
  `).join('');
}

// ============================================================
// TELA 2 — GERENCIAMENTO DA TURMA
// ============================================================
async function abrirGerenciamento(turmaId) {
  const { data: turmas, error } = await apiSec(`turmas?id=eq.${turmaId}&select=*`);
  if (error || !turmas || !turmas.length) {
    showToast('Erro ao carregar turma', 'danger');
    return;
  }
  currentTurmaId = turmaId;
  state.turmaAtual = turmas[0];
  state.isEnsinoMedio = /m[ée]dio/i.test(state.turmaAtual.nivel || '');

  document.getElementById('headerSubtitle').textContent = `Turma: ${state.turmaAtual.nome}`;
  document.getElementById('alertaEnsinoMedio').style.display = state.isEnsinoMedio ? 'flex' : 'none';

  renderTurmaHeader();
  trocarPagina('tela2');

  await Promise.all([carregarAlunosSemTurma(), carregarAlunosEnturmados()]);
}

function renderTurmaHeader() {
  const t = state.turmaAtual;
  document.getElementById('tbodyTurmaHeader').innerHTML = `
    <tr>
      <td><strong>${escapeHtml(t.nome)}</strong></td>
      <td><span class="badge badge-${corTurno(t.turno)}">${escapeHtml(t.turno || '—')}</span></td>
      <td>${escapeHtml(t.periodo_letivo || '—')}</td>
      <td>${escapeHtml(t.periodo_letivo || '—')}</td>
      <td>${escapeHtml(t.tipo_ensino || '—')}</td>
      <td>${escapeHtml(t.nivel || '—')}</td>
      <td>${escapeHtml(t.etapa || '—')}</td>
      <td id="colQtdAtivos">—</td>
    </tr>
  `;
}

async function carregarAlunosSemTurma() {
  const tbody = document.getElementById('tbodySemTurma');
  tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Carregando...</p></div></td></tr>`;

  const { data: alunos, error } = await apiSec(
    `alunos?turma_id=is.null&escola_id=eq.${currentSchoolId}&select=id,nome_completo,nome,codigo_simade,codigo_inep,turno,data_nascimento,naturalidade,nome_mae,nome_pai,escola_anterior&order=nome_completo.asc`
  );

  if (error) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><i class="fas fa-triangle-exclamation"></i><p>Erro ao carregar alunos</p></div></td></tr>`;
    return;
  }

  state.alunosSemTurma = alunos || [];
  state.selecionadosSem.clear();
  renderAlunosSemTurma(state.alunosSemTurma);
  atualizarBotaoEnturmar();
}

function renderAlunosSemTurma(lista) {
  const tbody = document.getElementById('tbodySemTurma');
  document.getElementById('qtdSemTurma').textContent = `Quantidade de alunos: ${lista.length}`;

  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><i class="fas fa-users"></i><p>Não há dados disponíveis</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map(a => `
    <tr>
      <td><input type="checkbox" data-id="${a.id}" onchange="toggleSelecaoSem('${a.id}', this.checked)" ${state.selecionadosSem.has(a.id) ? 'checked' : ''}></td>
      <td>${escapeHtml(a.codigo_simade || '—')}</td>
      <td>${escapeHtml(nomeAluno(a))}</td>
      <td><span class="badge badge-${corTurno(a.turno)}">${escapeHtml(a.turno || '—')}</span></td>
      <td class="td-actions">
        <button class="btn btn-sm btn-outline btn-icon" onclick="verDetalheAluno('${a.id}')" title="Ver detalhes">
          <i class="fas fa-file-lines"></i>
        </button>
      </td>
    </tr>
  `).join('');
}

function filtrarSemTurma() {
  const termo = val('buscaSemTurma').trim().toLowerCase();
  if (!termo) { renderAlunosSemTurma(state.alunosSemTurma); return; }
  const filtrado = state.alunosSemTurma.filter(a =>
    nomeAluno(a).toLowerCase().includes(termo) ||
    (a.codigo_simade || '').toString().toLowerCase().includes(termo)
  );
  renderAlunosSemTurma(filtrado);
}

function toggleSelecaoSem(id, checked) {
  if (checked) {
    if (state.isEnsinoMedio && state.selecionadosSem.size >= 1) {
      showToast('Para turmas de Ensino Médio, selecione apenas 1 aluno por vez', 'warning');
      renderAlunosSemTurma(state.alunosSemTurma);
      return;
    }
    state.selecionadosSem.add(id);
  } else {
    state.selecionadosSem.delete(id);
  }
  document.getElementById('selSemTurma').textContent = `Alunos selecionados: ${state.selecionadosSem.size}`;
  atualizarBotaoEnturmar();
}

function toggleAllSem(checkbox) {
  if (state.isEnsinoMedio && checkbox.checked) {
    showToast('Para turmas de Ensino Médio, selecione apenas 1 aluno por vez', 'warning');
    checkbox.checked = false;
    return;
  }
  state.selecionadosSem.clear();
  if (checkbox.checked) {
    state.alunosSemTurma.forEach(a => state.selecionadosSem.add(a.id));
  }
  renderAlunosSemTurma(state.alunosSemTurma);
  document.getElementById('selSemTurma').textContent = `Alunos selecionados: ${state.selecionadosSem.size}`;
  atualizarBotaoEnturmar();
}

function atualizarBotaoEnturmar() {
  document.getElementById('btnEnturmar').disabled = state.selecionadosSem.size === 0;
}

async function carregarAlunosEnturmados() {
  const tbody = document.getElementById('tbodyEnturmados');
  tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Carregando...</p></div></td></tr>`;

  const { data: alunos, error } = await apiSec(
    `alunos?turma_id=eq.${state.turmaAtual.id}&select=id,nome_completo,nome,codigo_simade,codigo_inep,data_nascimento,nome_mae,nome_pai,situacao_final,naturalidade,escola_anterior&order=nome_completo.asc`
  );

  if (error) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><i class="fas fa-triangle-exclamation"></i><p>Erro ao carregar alunos</p></div></td></tr>`;
    return;
  }

  state.alunosEnturmados = alunos || [];
  state.selecionadosEnt.clear();
  renderAlunosEnturmados(state.alunosEnturmados);
  document.getElementById('colQtdAtivos').textContent =
    state.alunosEnturmados.filter(a => (a.situacao_final || 'Ativo') === 'Ativo').length;
}

function renderAlunosEnturmados(lista) {
  const tbody = document.getElementById('tbodyEnturmados');
  document.getElementById('qtdEnturmados').textContent = `Quantidade de alunos: ${lista.length}`;

  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><i class="fas fa-users"></i><p>Não há dados disponíveis</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map(a => {
    const situacao = a.situacao_final || 'Ativo';
    return `
    <tr>
      <td><input type="checkbox" data-id="${a.id}" onchange="toggleSelecaoEnt('${a.id}', this.checked)" ${state.selecionadosEnt.has(a.id) ? 'checked' : ''}></td>
      <td><span class="badge ${badgeSituacao(situacao)}">${escapeHtml(situacao)}</span></td>
      <td>${escapeHtml(a.codigo_simade || '—')}</td>
      <td>${escapeHtml(a.codigo_inep || '—')}</td>
      <td>${escapeHtml(nomeAluno(a))}</td>
      <td>${formatDate(a.data_nascimento)}</td>
      <td>${escapeHtml(a.nome_mae || '—')}</td>
      <td class="td-actions">
        <button class="btn btn-sm btn-outline btn-icon" onclick="verDetalheAluno('${a.id}', true)" title="Ver detalhes">
          <i class="fas fa-file-lines"></i>
        </button>
      </td>
    </tr>`;
  }).join('');
}

function toggleSelecaoEnt(id, checked) {
  if (checked) {
    if (state.isEnsinoMedio && state.selecionadosEnt.size >= 1) {
      showToast('Para turmas de Ensino Médio, selecione apenas 1 aluno por vez', 'warning');
      renderAlunosEnturmados(state.alunosEnturmados);
      return;
    }
    state.selecionadosEnt.add(id);
  } else {
    state.selecionadosEnt.delete(id);
  }
  document.getElementById('selEnturmados').textContent = `Alunos selecionados: ${state.selecionadosEnt.size}`;
  document.getElementById('btnRemanejar').disabled = state.selecionadosEnt.size === 0;
}

function toggleAllEnt(checkbox) {
  if (state.isEnsinoMedio && checkbox.checked) {
    showToast('Para turmas de Ensino Médio, selecione apenas 1 aluno por vez', 'warning');
    checkbox.checked = false;
    return;
  }
  state.selecionadosEnt.clear();
  if (checkbox.checked) {
    state.alunosEnturmados.forEach(a => state.selecionadosEnt.add(a.id));
  }
  renderAlunosEnturmados(state.alunosEnturmados);
  document.getElementById('selEnturmados').textContent = `Alunos selecionados: ${state.selecionadosEnt.size}`;
  document.getElementById('btnRemanejar').disabled = state.selecionadosEnt.size === 0;
}

function voltarTela1() {
  trocarPagina('tela1');
  document.getElementById('headerSubtitle').textContent = 'Pesquise uma turma para gerenciar alunos';
}

// ============================================================
// TELA CHEIA — ENTURMAR ALUNOS (.fullscreen-page)
// ============================================================
function abrirTelaEnturmar() {
  state.candidatosEnturmar.clear();
  state.selecionadosSem.forEach(id => {
    const aluno = state.alunosSemTurma.find(a => a.id === id);
    if (aluno) state.candidatosEnturmar.set(id, aluno);
  });

  document.getElementById('fsSubtitle').textContent = `Turma de destino: ${state.turmaAtual.nome}`;
  document.getElementById('resultadoBuscaAluno').innerHTML = '';
  document.getElementById('buscaEnturmar').value = '';
  renderCandidatosMarcados();

  document.getElementById('fsEnturmar').classList.add('open');
}

function voltarTela2() {
  document.getElementById('fsEnturmar').classList.remove('open');
}

async function buscarAlunoParaEnturmar() {
  const termo = val('buscaEnturmar').trim();
  const container = document.getElementById('resultadoBuscaAluno');
  if (!termo) { showToast('Digite um nome ou código para buscar', 'warning'); return; }

  container.innerHTML = `<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Buscando...</p></div>`;

  const isNumeric = /^\d+$/.test(termo);
  const query = isNumeric
    ? `alunos?turma_id=is.null&escola_id=eq.${currentSchoolId}&or=(codigo_simade.eq.${termo},codigo_inep.eq.${termo})&select=*`
    : `alunos?turma_id=is.null&escola_id=eq.${currentSchoolId}&or=(nome_completo.ilike.*${encodeURIComponent(termo)}*,nome.ilike.*${encodeURIComponent(termo)}*)&select=*`;

  const { data: alunos, error } = await apiSec(query);

  if (error) {
    container.innerHTML = `<div class="empty-state"><i class="fas fa-triangle-exclamation"></i><p>Erro ao buscar aluno</p></div>`;
    return;
  }

  if (!alunos || !alunos.length) {
    container.innerHTML = `<div class="empty-state"><i class="fas fa-user-xmark"></i><p>Nenhum aluno sem turma encontrado com esse termo</p></div>`;
    return;
  }

  container.innerHTML = alunos.map(a => `
    <div class="result-card">
      <div>
        <strong>${escapeHtml(nomeAluno(a))}</strong>
        <div style="font-size:12.5px; color:var(--text-muted); margin-top:2px;">
          Código SIMADE: ${escapeHtml(a.codigo_simade || '—')} · Nascimento: ${formatDate(a.data_nascimento)}
        </div>
      </div>
      <button class="btn btn-sm btn-primary" onclick='abrirConferencia(${JSON.stringify(a).replace(/'/g, "&#39;")})'>
        <i class="fas fa-eye"></i> Conferir
      </button>
    </div>
  `).join('');
}

function abrirConferencia(aluno) {
  state.candidatoConferencia = aluno;
  document.getElementById('btnMarcarConferido').style.display = '';
  renderConferenciaBody(aluno);
  openModal('modalConferencia');
}

function renderConferenciaBody(aluno) {
  document.getElementById('conferenciaBody').innerHTML = `
    <div class="aluno-card">
      <div class="avatar-lg">${escapeHtml(nomeAluno(aluno).charAt(0))}</div>
      <div class="aluno-info">
        <div class="full"><div class="lbl">Nome completo</div><div class="val">${escapeHtml(nomeAluno(aluno))}</div></div>
        <div><div class="lbl">Código SIMADE</div><div class="val">${escapeHtml(aluno.codigo_simade || '—')}</div></div>
        <div><div class="lbl">Código INEP</div><div class="val">${escapeHtml(aluno.codigo_inep || '—')}</div></div>
        <div><div class="lbl">Data de Nascimento</div><div class="val">${formatDate(aluno.data_nascimento)}</div></div>
        <div><div class="lbl">Naturalidade</div><div class="val">${escapeHtml(aluno.naturalidade || '—')}</div></div>
        <div><div class="lbl">Nome da Mãe</div><div class="val">${escapeHtml(aluno.nome_mae || '—')}</div></div>
        <div><div class="lbl">Nome do Pai</div><div class="val">${escapeHtml(aluno.nome_pai || '—')}</div></div>
        <div class="full"><div class="lbl">Escola Anterior</div><div class="val">${escapeHtml(aluno.escola_anterior || '—')}</div></div>
      </div>
    </div>
  `;
}

function marcarAlunoConferido() {
  if (state.isEnsinoMedio && state.candidatosEnturmar.size >= 1) {
    showToast('Para turmas de Ensino Médio, apenas 1 aluno por vez', 'warning');
    closeModal('modalConferencia');
    return;
  }
  const a = state.candidatoConferencia;
  state.candidatosEnturmar.set(a.id, a);
  renderCandidatosMarcados();
  closeModal('modalConferencia');
  showToast(`${nomeAluno(a)} marcado para enturmar`, 'success');
}

function removerCandidato(id) {
  state.candidatosEnturmar.delete(id);
  renderCandidatosMarcados();
}

function renderCandidatosMarcados() {
  const tbody = document.getElementById('tbodyMarcados');
  const lista = Array.from(state.candidatosEnturmar.values());

  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><i class="fas fa-list"></i><p>Nenhum aluno marcado ainda</p></div></td></tr>`;
  } else {
    tbody.innerHTML = lista.map(a => `
      <tr>
        <td>${escapeHtml(a.codigo_simade || '—')}</td>
        <td>${escapeHtml(nomeAluno(a))}</td>
        <td><span class="badge badge-gray">Sem turma</span></td>
        <td class="td-actions">
          <button class="btn btn-sm btn-outline" onclick="removerCandidato('${a.id}')">
            <i class="fas fa-xmark"></i> Remover
          </button>
        </td>
      </tr>
    `).join('');
  }

  document.getElementById('btnConfirmarEnturmacao').disabled = lista.length === 0;
}

async function confirmarEnturmacao() {
  const lista = Array.from(state.candidatosEnturmar.values());
  if (!lista.length) return;

  const btn = document.getElementById('btnConfirmarEnturmacao');
  btn.disabled = true;
  const originalHtml = btn.innerHTML;
  btn.innerHTML = `<span class="loading-spinner" style="width:16px;height:16px;border-width:2px;"></span> Enturmando...`;

  let algumErro = false;
  for (const a of lista) {
    // PATCH direto em alunos.turma_id — mesmo padrão de salvarEnturmar() do sistema original
    const { error } = await apiSec(`alunos?id=eq.${a.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ turma_id: state.turmaAtual.id })
    });
    if (error) {
      algumErro = true;
      showToast(`Erro ao enturmar ${nomeAluno(a)}: ${error.message}`, 'danger');
    }
  }

  if (!algumErro) {
    state.candidatosEnturmar.clear();
    mostrarSucesso('Aluno(s) enturmado(s)!', `${lista.length} aluno(s) enturmado(s) com sucesso na turma ${state.turmaAtual.nome}.`);
    voltarTela2();
  }

  await Promise.all([carregarAlunosSemTurma(), carregarAlunosEnturmados()]);
  btn.disabled = false;
  btn.innerHTML = originalHtml;
}

// ============================================================
// MODAL DE REMANEJAMENTO
// ============================================================
function abrirModalRemanejar() {
  if (state.selecionadosEnt.size === 0) return;
  document.getElementById('remTurno').value = '';
  document.getElementById('remTurma').innerHTML = '<option value="">Selecione o turno primeiro...</option>';
  openModal('remanejModal');
}

document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'remTurno') {
    carregarTurmasDestino(e.target.value);
  }
});

async function carregarTurmasDestino(turno) {
  const select = document.getElementById('remTurma');
  if (!turno) { select.innerHTML = '<option value="">Selecione o turno primeiro...</option>'; return; }
  select.innerHTML = '<option>Carregando...</option>';

  const { data: turmas, error } = await apiSec(
    `turmas?turno=eq.${encodeURIComponent(turno)}&escola_id=eq.${currentSchoolId}&id=neq.${state.turmaAtual.id}&select=id,nome`
  );

  if (error) { select.innerHTML = '<option value="">Erro ao carregar turmas</option>'; return; }

  select.innerHTML = '<option value="">Selecione...</option>' +
    (turmas || []).map(t => `<option value="${t.id}">${escapeHtml(t.nome)}</option>`).join('');
}

async function confirmarRemanejamento() {
  const turmaDestinoId = val('remTurma');
  if (!turmaDestinoId) { showToast('Selecione a turma de destino', 'warning'); return; }

  const ids = Array.from(state.selecionadosEnt);
  let algumErro = false;

  for (const id of ids) {
    // PATCH direto — mesmo padrão de salvarRemanejamento() do sistema original
    const { error } = await apiSec(`alunos?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ turma_id: turmaDestinoId, escola_id: state.turmaAtual.escola_id })
    });
    if (error) {
      algumErro = true;
      showToast(`Erro no remanejamento: ${error.message}`, 'danger');
    }
  }

  closeModal('remanejModal');
  if (!algumErro) {
    mostrarSucesso('Aluno(s) remanejado(s)!', `${ids.length} aluno(s) remanejado(s) com sucesso.`);
  }
  await carregarAlunosEnturmados();
}

// ============================================================
// DETALHE DO ALUNO (reaproveita modal de conferência, somente leitura)
// ============================================================
function verDetalheAluno(id, isEnturmado = false) {
  const lista = isEnturmado ? state.alunosEnturmados : state.alunosSemTurma;
  const aluno = lista.find(a => a.id === id);
  if (!aluno) return;

  renderConferenciaBody(aluno);
  document.getElementById('btnMarcarConferido').style.display = 'none';
  openModal('modalConferencia');
}

// ============================================================
// SUCESSO
// ============================================================
function mostrarSucesso(titulo, msg) {
  document.getElementById('sucessoTitulo').textContent = titulo;
  document.getElementById('sucessoMsg').textContent = msg;
  openModal('modalSucesso');
}

function fecharSucesso() {
  closeModal('modalSucesso');
}

// ============================================================
// MODAL / SIDEBAR (mesmo padrão de secretaria_dashboard.html e
// turmas_alunos.html — não vem de shared.js, é definido por página)
// ============================================================
function openModal(id) {
  document.getElementById(id).classList.add('open');
}
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.modal-backdrop').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
  });
});

function toggleSidebar() {
  const s = document.getElementById('sidebar');
  const m = document.getElementById('main');
  const o = document.getElementById('sidebar-overlay');
  if (window.innerWidth > 768) {
    s.classList.toggle('collapsed');
    m.classList.toggle('expanded');
  } else {
    s.classList.toggle('open');
    o.classList.toggle('open');
  }
}
