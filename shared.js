// ============================================================
// shared.js — infraestrutura comum entre as páginas da secretaria
// (autenticação, acesso ao banco, utilitários de exibição)
//
// Toda página que usar este arquivo precisa ter no HTML:
//   - um elemento <div id="toast"> (para showToast)
//   - <script src="shared.js"></script> antes do script da página
//
// Padrão de navegação entre páginas: SEM router/SPA.
// Cada página é um .html separado; dados são passados por query string,
// ex: lista_aluno.html?turma_id=123
// ============================================================

// ===== CONFIG SUPABASE =====
const SUPABASE_URL = 'https://biocjxggjjfeqmpuysik.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJpb2NqeGdnampmZXFtcHV5c2lrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxODUwOTQsImV4cCI6MjA4OTc2MTA5NH0.3bL3dKqiWGoHROE6vSzf-7Orp0GLcLpn4mHtUSwC0dU';

// ===== ESTADO GLOBAL (por página — não persiste entre páginas) =====
let currentUser = null;
let currentSchoolId = null;
let currentSchoolData = null;
let userSchools = [];
let abandonoLimit = 25; // padrão; admin configura por escola
let singleSchool = true; // se o secretario for de 1 escola só

// ===== DISCIPLINAS =====
const DISCIPLINAS_FI = ['LÍNGUA PORTUGUESA','MATEMÁTICA','CIÊNCIAS','GEOGRAFIA','HISTÓRIA','EDUCAÇÃO FÍSICA','ARTE'];
const DISCIPLINAS_FII = [...DISCIPLINAS_FI,'LÍNGUA INGLESA','ENSINO RELIGIOSO'];

function getDisciplinas(nivel){
  if(!nivel) return DISCIPLINAS_FII;
  if(nivel.includes('INICIAIS') || nivel.includes('INICIAL')) return DISCIPLINAS_FI;
  return DISCIPLINAS_FII;
}

// ===== API REST (Supabase/PostgREST) =====
async function apiSec(path, opts = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  try {
    const defaultPrefer = 'return=representation';
    const customPrefer = opts.headers?.Prefer || opts.headers?.prefer;
    const prefer = customPrefer ? `${defaultPrefer},${customPrefer}` : defaultPrefer;

    const res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        ...opts.headers,
        'Prefer': prefer
      },
      ...opts
    });

    if (!res.ok && res.status !== 204) {
      const e = await res.json().catch(() => ({}));
      console.error(`[API ERROR] ${path}:`, e);
      return { data: null, error: { message: e.message || 'Erro na requisição', code: e.code }, count: 0 };
    }

    if (res.status === 204) return { data: null, error: null, count: 0 };
    const data = await res.json();

    // Extrair count do Content-Range se disponível (usado com count=exact)
    const contentRange = res.headers.get('content-range');
    let countNum = 0;
    if (contentRange) {
      const parts = contentRange.split('/');
      if (parts.length > 1) {
        countNum = parseInt(parts[1]) || 0;
      }
    } else if (Array.isArray(data)) {
      countNum = data.length;
    }

    console.log(`[API SUCCESS] ${path}:`, Array.isArray(data) ? `${data.length} items` : '1 item', `(Count: ${countNum})`);
    return { data, error: null, count: countNum };
  } catch (err) {
    console.error(`[FETCH ERROR] ${path}:`, err);
    return { data: null, error: { message: err.message }, count: 0 };
  }
}

// Shim do db.from() — traduz chamadas encadeadas para REST
function dbFrom(table) {
  let _filters = [], _select = '*', _order = null, _limit = null, _single = false, _upsert = false, _upsertConflict = null;
  const obj = {
    select(cols, opts) { _select = cols || '*'; if (opts?.count) _select = 'id'; return obj; },
    eq(col, val) { _filters.push(`${col}=eq.${encodeURIComponent(val)}`); return obj; },
    neq(col, val) { _filters.push(`${col}=neq.${encodeURIComponent(val)}`); return obj; },
    gte(col, val) { _filters.push(`${col}=gte.${encodeURIComponent(val)}`); return obj; },
    lte(col, val) { _filters.push(`${col}=lte.${encodeURIComponent(val)}`); return obj; },
    order(col, opts) { _order = `order=${col}.${opts?.ascending === false ? 'desc' : 'asc'}`; return obj; },
    limit(n) { _limit = `limit=${n}`; return obj; },
    single() { _single = true; return obj; },
    upsert(body, opts) {
      _upsert = true; _upsertConflict = opts?.onConflict || null;
      return obj._execute('POST', body);
    },
    insert(body) { return obj._execute('POST', body); },
    update(body) { return obj._execute('PATCH', body); },
    delete() { return obj._execute('DELETE'); },
    async _execute(method, body) {
      // Limpar select para evitar erros de espaços no PostgREST
      const cleanSelect = _select.replace(/\s+/g, '');
      let qs = [`select=${cleanSelect}`, ..._filters];
      if (_order) qs.push(_order);
      if (_limit) qs.push(_limit);
      if (_upsert && _upsertConflict) qs.push(`on_conflict=${_upsertConflict}`);

      const headers = {};
      if (_upsert) headers['Prefer'] = `resolution=merge-duplicates,return=representation`;

      const url = `${table}?${qs.join('&')}`;
      const res = await apiSec(url, { method: method || 'GET', body: body ? JSON.stringify(body) : undefined, headers });

      if (res.error) {
        console.error(`[DB ERROR] Table ${table}:`, res.error);
      }

      if (_single && Array.isArray(res.data)) res.data = res.data[0] || null;
      // count shim
      if (Array.isArray(res.data)) res.count = res.data.length;
      return res;
    },
    then(resolve, reject) { return obj._execute('GET').then(resolve, reject); }
  };
  return obj;
}

// Substituir db por nosso shim
const db = { from: dbFrom, auth: { getSession: async () => ({ data: { session: null } }), signOut: async () => {} } };

// ===== SESSÃO / AUTENTICAÇÃO =====
// Cada página deve chamar checkSession() no início (ex: dentro de window.onload).
// Redireciona para index.html se não houver sessão válida de secretaria.
async function checkSession(){
  const session = JSON.parse(sessionStorage.getItem('ded_user') || 'null');
  if (!session || session.role !== 'secretaria') {
    showToast('Sessão não encontrada. Faça login.', 'warning');
    setTimeout(() => { window.location.href = 'index.html'; }, 1500);
    return;
  }
  currentUser = session;
  await loadUserProfile();
}

async function loadUserProfile(){
  if (!currentUser) return;
  console.log('[DEBUG] Loading profile for:', currentUser.id);

  try {
    const { data, error } = await apiSec(`users?id=eq.${currentUser.id}&select=*`);

    if (error || !data || data.length === 0) {
      console.warn('[DEBUG] Could not fetch profile from DB, using session data');
    }

    const secretario = (data && data[0]) || currentUser;
    console.log('[DEBUG] User profile data:', secretario);

    const nome = secretario.nome || secretario.login || 'Secretário(a)';
    const nameEl = document.getElementById('sidebarUserName');
    const avatarEl = document.getElementById('sidebarAvatarInitials');
    if (nameEl) nameEl.textContent = nome;
    if (avatarEl) avatarEl.textContent = nome.charAt(0).toUpperCase();

    const tipo = secretario.tipo_secretaria || 'escola';
    const roleEl = document.getElementById('sidebarUserRole');
    if (roleEl) {
      roleEl.textContent =
        tipo === 'estadual' ? 'Secretaria Estadual' :
        tipo === 'municipal' ? 'Secretaria Municipal' : 'Secretaria Escolar';
    }

    await loadUserSchools(secretario);
  } catch (err) {
    console.error('[DEBUG] Error loading profile:', err);
    showToast('Erro ao carregar perfil', 'danger');
  }
}

// Carrega as escolas do secretário e define currentSchoolId/currentSchoolData.
// NÃO dispara os loads de dados da página (isso cada página faz por conta própria,
// dentro de onSchoolsReady, se essa função global existir).
async function loadUserSchools(secretario){
  const tipo = secretario.tipo_secretaria || 'escola';

  const escolaId = secretario.escola_id || currentUser.escola_id;
  console.log('[DEBUG] escolaId para secretaria:', escolaId, '| tipo:', tipo);

  let qs = 'escolas?select=*';
  if (tipo === 'estadual') {
    qs += '&tipo=eq.Estadual';
  } else if (tipo === 'municipal') {
    qs += '&tipo=eq.Municipal';
  } else if (secretario.escolas_ids && Array.isArray(secretario.escolas_ids) && secretario.escolas_ids.length > 0) {
    qs += `&id=in.(${secretario.escolas_ids.join(',')})`;
  } else if (escolaId) {
    qs += `&id=eq.${escolaId}`;
  }

  console.log('[DEBUG] Fetching schools with QS:', qs);
  const { data: escolas, error } = await apiSec(qs);

  if (error) console.error('[DEBUG] Error fetching schools:', error);

  userSchools = escolas || [];
  console.log('[DEBUG] Schools found:', userSchools.length, userSchools.map(e => e.id));

  const nameEl = document.getElementById('currentSchoolName');

  if (userSchools.length === 0 && escolaId) {
    console.warn('[DEBUG] Escola não retornada pela query (possível RLS). Usando escola_id diretamente.');
    currentSchoolId = escolaId;
    currentSchoolData = { id: escolaId, nome: 'Escola' };
    if (nameEl) nameEl.textContent = 'Escola';
  } else if (userSchools.length > 0) {
    currentSchoolId = escolaId || userSchools[0].id;
    currentSchoolData = userSchools.find(e => e.id === currentSchoolId) || userSchools[0];
    if (!userSchools.find(e => e.id === currentSchoolId)) {
      currentSchoolId = userSchools[0].id;
      currentSchoolData = userSchools[0];
    }
    if (nameEl) nameEl.textContent = currentSchoolData?.nome || 'Escola';

    if (userSchools.length > 1) {
      const switcher = document.getElementById('schoolSwitcher');
      if (switcher) switcher.style.display = 'flex';
      singleSchool = false;
    } else {
      singleSchool = true;
    }
  } else {
    console.error('[DEBUG] Nenhuma escola encontrada e sem escola_id. Verifique o cadastro do secretário.');
    showToast('Escola não encontrada. Verifique o cadastro.', 'danger');
    return;
  }

  console.log('[DEBUG] Final currentSchoolId:', currentSchoolId);

  if (currentSchoolData) {
    abandonoLimit = currentSchoolData.limite_faltas_abandono || 25;
  }

  // Cada página define sua própria função global onSchoolsReady()
  // com os loads específicos dela (loadAlunos, loadTurmas, etc).
  if (typeof onSchoolsReady === 'function') {
    await onSchoolsReady();
  }
}

function handleLogout(){
  sessionStorage.clear();
  showToast('Sessão encerrada.', 'info');
  setTimeout(() => { window.location.href = 'index.html'; }, 1000);
}

// ===== UI / TOAST =====
function showToast(msg, type='info'){
  const t = document.getElementById('toast');
  if (!t) { console.log(`[TOAST ${type}]`, msg); return; }
  const colors = { success:'#38A169', danger:'#E53E3E', warning:'#ECC94B', info:'#3182CE' };
  const icons = { success:'check-circle', danger:'times-circle', warning:'exclamation-triangle', info:'info-circle' };
  t.style.background = colors[type] || colors.info;
  t.style.color = type === 'warning' ? '#744210' : '#fff';
  t.innerHTML = `<i class="fas fa-${icons[type]||'info-circle'}"></i> ${msg}`;
  t.style.display = 'flex';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.style.display = 'none', 3500);
}

// ===== UTILS GERAIS =====
function val(id){ return document.getElementById(id)?.value || ''; }

// Cor de badge por turno, tolerante a maiúscula/minúscula.
function corTurno(turno){
  const s = String(turno || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  if(s.includes('manha')) return 'success';
  if(s.includes('tarde')) return 'warning';
  if(s.includes('integral')) return 'info';
  if(s.includes('noite')) return 'gray';
  return 'gray';
}

// Cor de status tolerante a maiúscula/minúscula e variações de escrita.
function corStatus(situacao){
  const s = String(situacao || 'Ativo').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  if(s.includes('ativo')) return 'success';
  if(s.includes('transferid')) return 'warning';
  if(s.includes('abandon')) return 'danger';
  if(s.includes('concluid')) return 'info';
  return 'gray';
}

function formatDate(d){
  if(!d) return '—';
  try { return new Date(d+'T12:00:00').toLocaleDateString('pt-BR'); } catch{ return d; }
}
function formatFaltas(f){ return f ? `${f}:00` : '00:00'; }
function formatJustTipo(t){
  const m = {atestado_medico:'Atestado Médico',declaracao:'Declaração',luto:'Luto',judicial:'Judicial',evento_esportivo:'Evento',outro:'Outro'};
  return m[t] || t || '—';
}
function escapeHtml(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function setupDateDefaults(){
  const today = new Date().toISOString().split('T')[0];
  document.querySelectorAll('input[type="date"]').forEach(el => {
    if(!el.value) el.value = today;
  });
}
