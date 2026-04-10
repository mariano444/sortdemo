
const SUPABASE_URL = 'https://asokopamdmuvuupywjzt.supabase.co';
// Esta key anon es publica por diseno. Los secretos y reglas sensibles deben vivir en Supabase/RPC/Edge Functions.
const SUPABASE_KEY = 'sb_publishable_zBhxdMJHw_uy_m3uRDj-ng_0yXz42EN';
const CAMPAIGN_SLUG = 'sorteo-moto-tv-dinero';
const MAX_FALLBACK_CHANCES = 5000;
const FUNCTIONS_BASE_URL = `${SUPABASE_URL}/functions/v1`;
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const DEFAULT_SHARE_IMAGE = new URL('./assets/share/share-sorteo.png', window.location.href).toString();
const DEFAULT_SHARE_TITLE = 'Gran Sorteo - Fiat Uno 2014 Impecable';
const DEFAULT_SHARE_DESCRIPTION = 'Participa de este sorteo por un Fiat Uno 2014 impecable. Quedan pocos lugares y puede hacerse antes al agotar chances.';
const DRAW_TARGET_ISO = '2026-07-26T20:00:00-03:00';

let activeCampaign = null;
let packages = [];
let participants = [];
let demoResults = [];
let selectedPkg = null;
let selectedPhotoFile = null;
let selectedPaymentProvider = 'galiopay';
let countdownInterval = null;
let liveFeedTimeout = null;
let drawAnimationTimeout = null;
const fallbackProofMessages = [
  {
    name: 'Mariana',
    city: 'Cordoba',
    message: 'Me dio confianza ver que las participaciones aparecen con fecha y cantidad de chances. Eso hace que el sorteo se sienta mÃƒÂ¡s claro y serio.'
  },
  {
    name: 'Leandro',
    city: 'Rosario',
    message: 'Me gusta que expliquen que mientras mÃƒÂ¡s chances comprÃƒÂ¡s, mÃƒÂ¡s veces participÃƒÂ¡s en la selecciÃƒÂ³n aleatoria. Se entiende rÃƒÂ¡pido y genera seguridad.'
  },
  {
    name: 'Camila',
    city: 'Buenos Aires',
    message: 'Saber que la entrega se coordina directamente con el ganador del Fiat Uno 2014 me transmite mucha mas tranquilidad.'
  },
  {
    name: 'Franco',
    city: 'Mendoza',
    message: 'La opciÃƒÂ³n de aparecer anÃƒÂ³nimo pero seguir participando con registro visible me parece una muy buena forma de combinar privacidad con transparencia.'
  }
];
let latestOrderStatus = null;
let publicCampaignVotes = [];
let myCampaignVote = null;
let voteSubmissionInFlight = false;
const APPROVED_ORDER_REF_STORAGE_KEY = `campaign_vote_paid_ref_${CAMPAIGN_SLUG}`;
const NEXT_DRAW_OPTIONS = [
  {
    key: 'moto',
    badge: 'Opcion A',
    title: 'Moto 110 full',
    description: 'Una opcion agil, muy pedida y pensada para un proximo sorteo de alto interes.',
    image: './assets/premios/moto-azul.png'
  },
  {
    key: 'tv',
    badge: 'Opcion B',
    title: 'Smart TV 50"',
    description: 'Una propuesta fuerte para hogar y tecnologia, ideal para un proximo lanzamiento.',
    image: './assets/premios/tv-premio.png'
  }
];
const expandedParticipantRows = new Set();
const drawShowcaseState = {
  basePool: [],
  cycle: [],
  cyclePosition: 0,
  spotlightPosition: -1,
  round: 0,
  activeParticipantIndex: -1,
  activeEntryNumber: 0,
  activeEntryPosition: 0,
  activeSpotlight: false,
  paused: false,
  historyOpen: false,
  hasStarted: false
};

const COLORS = ['#F5C842','#3B8BFF','#00D46A','#FF6B3B','#BF5FFF','#FF3B7A'];
function colorFor(i){ return COLORS[i % COLORS.length]; }
function initials(name){ return name.split(' ').map(w => w[0]).join('').substring(0,2).toUpperCase(); }
function totalChances(){ return participants.reduce((s, p) => s + (p.chances || 0), 0); }
function currentMaxChances(){ return activeCampaign?.max_entries || MAX_FALLBACK_CHANCES; }
function getBaseChancePrice(){
  const singlePack = packages.find((pkg) => Number(pkg.entries_qty || 0) + Number(pkg.bonus_entries || 0) === 1);
  return Number(singlePack?.price_ars || 0);
}

function getReferralCode(){
  const params = new URLSearchParams(window.location.search);
  const code = params.get('ref');
  if (code) {
    localStorage.setItem('raffle_referral_code', code);
    return code;
  }
  return localStorage.getItem('raffle_referral_code') || '';
}

function getOrderReferenceFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get('order_ref') || '';
}

function clearPaymentQueryState() {
  const url = new URL(window.location.href);
  url.searchParams.delete('payment');
  url.searchParams.delete('order_ref');
  window.history.replaceState({}, '', url.toString());
}

function buildLandingShareUrl(code) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('ref', code);
  return url.toString();
}

function setMetaContent(selector, content) {
  const el = document.querySelector(selector);
  if (el) el.setAttribute('content', content);
}

function updateShareMetadata({ title, description, image, url }) {
  const nextTitle = cleanMojibakeText(title || DEFAULT_SHARE_TITLE);
  const nextDescription = cleanMojibakeText(description || DEFAULT_SHARE_DESCRIPTION);
  const nextImage = image || DEFAULT_SHARE_IMAGE;
  const nextUrl = url || window.location.href;

  document.title = nextTitle;
  setMetaContent('meta[name="description"]', nextDescription);
  setMetaContent('meta[property="og:title"]', nextTitle);
  setMetaContent('meta[property="og:description"]', nextDescription);
  setMetaContent('meta[property="og:image"]', nextImage);
  setMetaContent('meta[name="twitter:title"]', nextTitle);
  setMetaContent('meta[name="twitter:description"]', nextDescription);
  setMetaContent('meta[name="twitter:image"]', nextImage);

  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.setAttribute('rel', 'canonical');
    document.head.appendChild(canonical);
  }
  canonical.setAttribute('href', nextUrl);
}

function buildReferralShareCopy(label, shareUrl) {
  return cleanMojibakeText(`${label} te invita a participar de este sorteo. Quedan pocos lugares y puede hacerse antes al agotar chances. Sumate ahora: ${shareUrl}`);
}

function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = cleanMojibakeText(msg);
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 4500);
}

function looksMojibake(text) {
  return /[ÃÂâð]/.test(text);
}

function decodeLatin1AsUtf8(text) {
  try {
    const bytes = Uint8Array.from(Array.from(text, (char) => char.charCodeAt(0) & 255));
    return new TextDecoder('utf-8').decode(bytes);
  } catch (_) {
    return text;
  }
}

function normalizeBrokenSymbols(text) {
  return text
    .split('\uFFFD').join('')
    .split('Â·').join('·')
    .split('â€”').join('-')
    .split('â€œ').join('"')
    .split('â€\u009d').join('"')
    .split('â€™').join("'")
    .split('â€¢').join('•')
    .split('âœ•').join('×')
    .split('âœ“').join('✓')
    .split('âœ…').join('✓')
    .split('âš¡').join('⚡')
    .split('â–¼').join('▼');
}

function cleanMojibakeText(value) {
  if (value == null) return value;
  let text = String(value);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!looksMojibake(text)) break;
    const decoded = decodeLatin1AsUtf8(text);
    if (!decoded || decoded === text) break;
    text = decoded;
  }

  return normalizeBrokenSymbols(text);
}

function repairDocumentText(root = document) {
  const scope = root instanceof Element ? root : document;
  const textRoot = root.body || root;
  if (textRoot) {
    const walker = document.createTreeWalker(textRoot, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach((node) => {
      node.nodeValue = cleanMojibakeText(node.nodeValue);
    });
  }
  scope.querySelectorAll?.('[placeholder],[title],[aria-label]').forEach((el) => {
    ['placeholder', 'title', 'aria-label'].forEach((attr) => {
      if (el.hasAttribute(attr)) {
        el.setAttribute(attr, cleanMojibakeText(el.getAttribute(attr)));
      }
    });
  });
  document.querySelectorAll('meta[content]').forEach((meta) => {
    meta.setAttribute('content', cleanMojibakeText(meta.getAttribute('content')));
  });
  document.title = cleanMojibakeText(document.title);
}

function updatePhotoPreview(file) {
  const preview = document.getElementById('photoPreview');
  const image = document.getElementById('photoPreviewImage');
  const copy = document.getElementById('photoPreviewCopy');
  if (!file) {
    preview.classList.remove('show');
    image.removeAttribute('src');
    copy.textContent = 'Foto lista para subirse con tu participacion.';
    return;
  }
  const objectUrl = URL.createObjectURL(file);
  image.src = objectUrl;
  copy.textContent = `${file.name} listo para acompaÃƒÂ±ar tu participacion.`;
  preview.classList.add('show');
}

async function uploadParticipantPhoto(file, phone) {
  if (!file) return null;
  const fileExt = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const safePhone = phone.replace(/\D+/g, '') || Date.now().toString();
  const filePath = `landing/${CAMPAIGN_SLUG}/${safePhone}-${Date.now()}.${fileExt}`;
  const { error } = await supabaseClient.storage.from('participant-profiles').upload(filePath, file, {
    cacheControl: '3600',
    upsert: true
  });
  if (error) throw error;
  const { data } = supabaseClient.storage.from('participant-profiles').getPublicUrl(filePath);
  return data?.publicUrl || null;
}

function buildFunctionUrl(name) {
  return `${FUNCTIONS_BASE_URL}/${name}`;
}

function getStoredApprovedOrderReference() {
  try {
    return sessionStorage.getItem(APPROVED_ORDER_REF_STORAGE_KEY) || '';
  } catch (_) {
    return '';
  }
}

function storeApprovedOrderReference(orderRef) {
  try {
    if (orderRef) {
      sessionStorage.setItem(APPROVED_ORDER_REF_STORAGE_KEY, orderRef);
    } else {
      sessionStorage.removeItem(APPROVED_ORDER_REF_STORAGE_KEY);
    }
  } catch (_) {
    // ignore storage errors
  }
}

function getVoteOptionMeta(optionKey) {
  return NEXT_DRAW_OPTIONS.find(option => option.key === optionKey) || NEXT_DRAW_OPTIONS[0];
}

function formatVoteTime(value) {
  if (!value) return 'Hace instantes';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Hace instantes';
  return date.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function renderCampaignVoting() {
  const optionsGrid = document.getElementById('voteOptionsGrid');
  const summaryList = document.getElementById('voteSummaryList');
  const feedList = document.getElementById('voteFeedList');
  const unlockNotice = document.getElementById('voteUnlockNotice');
  const voteStatus = document.getElementById('voteStatus');
  if (!optionsGrid || !summaryList || !feedList || !unlockNotice || !voteStatus) return;

  const isUnlocked = Boolean(getStoredApprovedOrderReference());
  const counts = publicCampaignVotes.reduce((acc, vote) => {
    acc[vote.option_key] = (acc[vote.option_key] || 0) + 1;
    return acc;
  }, {});
  const totalVotes = publicCampaignVotes.length;

  unlockNotice.textContent = isUnlocked
    ? 'Tu pago ya fue aprobado. Elegi una opcion y tu voto quedara publicado al instante.'
    : 'Cuando tu pago quede aprobado se habilita tu voto automaticamente en esta misma seccion.';

  if (myCampaignVote?.option_key) {
    const selectedOption = getVoteOptionMeta(myCampaignVote.option_key);
    voteStatus.textContent = `Tu voto actual: ${selectedOption.title}. Si queres, podes cambiarlo.`;
    voteStatus.classList.remove('hidden');
  } else {
    voteStatus.classList.add('hidden');
    voteStatus.textContent = '';
  }

  optionsGrid.innerHTML = NEXT_DRAW_OPTIONS.map((option) => {
    const votes = counts[option.key] || 0;
    const isSelected = myCampaignVote?.option_key === option.key;
    const disabled = !isUnlocked || voteSubmissionInFlight;
    const buttonLabel = !isUnlocked
      ? 'Se habilita al aprobarse tu pago'
      : voteSubmissionInFlight
        ? 'Guardando voto...'
        : isSelected
          ? 'Voto registrado'
          : 'Votar esta opcion';

    return `
      <article class="vote-option-card${isSelected ? ' selected' : ''}">
        <div class="vote-option-media">
          <img src="${option.image}" alt="${option.title}">
        </div>
        <div class="vote-option-body">
          <div class="vote-option-top">
            <span class="vote-option-badge">${option.badge}</span>
            <span class="vote-option-count">${votes} voto${votes === 1 ? '' : 's'}</span>
          </div>
          <div class="vote-option-name">${option.title}</div>
          <div class="vote-option-desc">${option.description}</div>
          <button class="vote-option-action" type="button" data-vote-option="${option.key}" ${disabled ? 'disabled' : ''}>${buttonLabel}</button>
        </div>
      </article>
    `;
  }).join('');

  summaryList.innerHTML = NEXT_DRAW_OPTIONS.map((option) => {
    const votes = counts[option.key] || 0;
    const percent = totalVotes ? Math.round((votes / totalVotes) * 100) : 0;
    return `
      <div class="vote-summary-row">
        <div class="vote-summary-label">
          <strong>${option.title}</strong>
          <small>${option.badge}</small>
        </div>
        <div class="vote-summary-value">${votes} / ${percent}%</div>
      </div>
    `;
  }).join('');

  if (!publicCampaignVotes.length) {
    feedList.innerHTML = '<div class="vote-empty">Todavia nadie voto. El primer voto puede aparecer apenas se apruebe un pago.</div>';
  } else {
    feedList.innerHTML = publicCampaignVotes.slice(0, 30).map((vote) => `
      <div class="vote-feed-item">
        <div class="vote-feed-name">${vote.display_name || 'Participante'}</div>
        <div class="vote-feed-choice">${vote.option_label || getVoteOptionMeta(vote.option_key).title}</div>
        <div class="vote-feed-time">${formatVoteTime(vote.voted_at)}</div>
      </div>
    `).join('');
  }

  repairDocumentText(document.getElementById('nextDrawVoting'));
}

async function loadPublicCampaignVotes() {
  try {
    const { data, error } = await supabaseClient.rpc('list_public_campaign_votes', {
      p_campaign_slug: CAMPAIGN_SLUG
    });
    if (error) throw error;
    publicCampaignVotes = Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('No se pudieron cargar los votos publicos.', error);
    publicCampaignVotes = [];
  }
  renderCampaignVoting();
}

async function loadMyCampaignVote() {
  const orderRef = getStoredApprovedOrderReference();
  if (!orderRef) {
    myCampaignVote = null;
    renderCampaignVoting();
    return;
  }

  try {
    const { data, error } = await supabaseClient.rpc('get_campaign_vote_for_order', {
      p_external_reference: orderRef
    });
    if (error) throw error;
    myCampaignVote = data || null;
  } catch (error) {
    console.error('No se pudo cargar el voto del participante.', error);
    myCampaignVote = null;
  }
  renderCampaignVoting();
}

async function submitCampaignVote(optionKey) {
  const orderRef = getStoredApprovedOrderReference();
  if (!orderRef) {
    showToast('Tu voto se habilita cuando el pago quede aprobado.');
    return;
  }
  if (voteSubmissionInFlight) return;

  voteSubmissionInFlight = true;
  renderCampaignVoting();

  try {
    const { data, error } = await supabaseClient.rpc('submit_campaign_vote', {
      p_external_reference: orderRef,
      p_option_key: optionKey
    });
    if (error) throw error;
    myCampaignVote = data || null;
    await loadPublicCampaignVotes();
    renderCampaignVoting();
    const option = getVoteOptionMeta(optionKey);
    showToast(`Tu voto por ${option.title} ya quedo registrado.`);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'No se pudo registrar tu voto.');
  } finally {
    voteSubmissionInFlight = false;
    renderCampaignVoting();
  }
}

function showPaymentCard({ kicker, title, copy, shareUrl = '' }) {
  const card = document.getElementById('paymentStatusCard');
  const row = document.getElementById('shareLinkRow');
  document.getElementById('paymentStatusKicker').textContent = kicker;
  document.getElementById('paymentStatusTitle').textContent = title;
  document.getElementById('paymentStatusCopy').textContent = copy;
  document.getElementById('shareLinkInput').value = shareUrl || '';
  row.classList.toggle('hidden', !shareUrl);
  card.classList.add('show', 'visible');
}

async function copyShareLink() {
  const value = document.getElementById('shareLinkInput').value;
  if (!value) return;
  try {
    const label = (document.getElementById('paymentStatusTitle').textContent || 'Te invito').replace(' ya participa del sorteo', '');
    await navigator.clipboard.writeText(buildReferralShareCopy(label, value));
    showToast('Enlace copiado para compartir.');
  } catch (_) {
    showToast('No se pudo copiar el enlace.');
  }
}

async function shareWhatsappLink() {
  const value = document.getElementById('shareLinkInput').value;
  if (!value) return;
  const text = `Te comparto mi enlace del sorteo. Si compras desde acÃƒÂ¡ me regalÃƒÂ¡s 2 chances extra: ${value}`;
  if (navigator.share) {
    try {
      await navigator.share({ text, url: value });
      return;
    } catch (_) {
      // fall through to WhatsApp
    }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
}

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function shuffleList(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function getParticipantChances(participant) {
  return Math.max(1, Number(participant.currentChances || participant.purchasedChances || participant.chances || 0));
}

function buildDrawEntryPoolBase() {
  const pool = [];
  participants.forEach((participant, participantIndex) => {
    if (!participant) return;
    const chances = getParticipantChances(participant);
    for (let chanceNumber = 1; chanceNumber <= chances; chanceNumber += 1) {
      pool.push({
        participantIndex,
        chanceNumber,
        chanceLabel: `${participant.displayName || participant.name} Ã‚Â· chance ${chanceNumber}`
      });
    }
  });
  return pool;
}

function refreshDrawEntryPool() {
  drawShowcaseState.basePool = buildDrawEntryPoolBase();
}

function getDrawNarrative(participant, isSpotlight, cycleProgress) {
  if (isSpotlight) {
    return 'La demostracion alcanzo el punto final de la prueba y deja visible la chance exacta seleccionada dentro de la urna.';
  }
  if (cycleProgress < 0.2) return 'La demostracion comenzo a recorrer la urna completa, incluyendo cada chance activa de cada participante.';
  if (cycleProgress > 0.72) return 'La prueba entra en su tramo final y empieza a acercarse a la chance donde se detendra automaticamente.';
  return 'El sistema sigue recorriendo chances individuales en tiempo real para mostrar una simulacion mas fiel del mecanismo de seleccion.';
}

function getActiveDemoParticipant() {
  if (drawShowcaseState.activeParticipantIndex < 0 || !participants[drawShowcaseState.activeParticipantIndex]) {
    return null;
  }
  return participants[drawShowcaseState.activeParticipantIndex];
}

function renderDemoHistory() {
  const grid = document.getElementById('demoHistoryGrid');
  if (!grid) return;
  if (!demoResults.length) {
    grid.innerHTML = '<div class="demo-history-empty">Todavia no hay resultados de demostracion guardados.</div>';
    return;
  }
  grid.innerHTML = demoResults.map((item) => `
    <div class="demo-history-card">
      <strong>${escapeHtml(item.display_name || item.full_name || 'Participante')}</strong>
      <div class="demo-history-meta">
        <span>${escapeHtml([item.city || '', item.province || ''].filter(Boolean).join(', ') || 'Argentina')}</span>
        <span>${escapeHtml(item.recorded_at_label || '')}</span>
      </div>
      <div class="demo-history-meta">
        <span>${escapeHtml(item.public_code || 'Registro demo')}</span>
        <span>x${Number(item.chances || 0).toLocaleString('es-AR')}</span>
      </div>
    </div>
  `).join('');
}

function toggleDemoHistory() {
  drawShowcaseState.historyOpen = !drawShowcaseState.historyOpen;
  const panel = document.getElementById('demoHistoryPanel');
  const button = document.getElementById('toggleDemoHistoryBtn');
  panel?.classList.toggle('open', drawShowcaseState.historyOpen);
  if (button) {
    button.textContent = drawShowcaseState.historyOpen ? 'Ocultar participantes demo' : 'Participantes demostracion';
  }
}

function toggleDemoShowcase() {
  const showcase = document.getElementById('drawShowcase');
  const button = document.getElementById('toggleDemoBtn');
  if (!showcase || !button) return;
  const willOpen = showcase.classList.contains('collapsed');
  showcase.classList.toggle('collapsed', !willOpen);
  button.textContent = willOpen ? 'Ocultar demostracion' : 'Iniciar demostracion';
}

function updateDrawControls() {
  const showcase = document.getElementById('drawShowcase');
  const startBtn = document.getElementById('drawStartBtn');
  const saveBtn = document.getElementById('saveDemoResultBtn');
  if (!showcase || !startBtn || !saveBtn) return;
  showcase.classList.toggle('paused', drawShowcaseState.paused);
  startBtn.disabled = !participants.length || drawShowcaseState.hasStarted;
  startBtn.style.opacity = startBtn.disabled ? '0.5' : '1';
  saveBtn.disabled = !getActiveDemoParticipant() || !drawShowcaseState.paused || !drawShowcaseState.hasStarted;
  saveBtn.style.opacity = saveBtn.disabled ? '0.5' : '1';
}

function pauseDrawShowcase() {
  drawShowcaseState.paused = true;
  stopDrawShowcase();
  updateDrawControls();
  document.getElementById('drawPhaseLabel').textContent = 'Prueba detenida';
  document.getElementById('drawPhaseName').textContent = 'El software freno en el foco actual';
  document.getElementById('drawPhaseHint').textContent = 'Ahora puedes registrar este resultado de demostracion. Este dato sirve solo como evidencia visual del funcionamiento y no como resultado oficial.';
}

function startDemoTrial() {
  if (!participants.length) {
    renderDrawShowcaseEmpty();
    return;
  }
  drawShowcaseState.hasStarted = true;
  drawShowcaseState.paused = false;
  updateDrawControls();
  if (!drawShowcaseState.cycle.length || drawShowcaseState.cyclePosition >= drawShowcaseState.cycle.length) {
    prepareDrawShowcaseRound();
  }
  document.getElementById('participantsTableScroller')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  tickDrawShowcase();
  document.getElementById('drawPhaseLabel').textContent = 'Prueba en curso';
  document.getElementById('drawPhaseName').textContent = 'El software esta recorriendo participantes en vivo';
  document.getElementById('drawPhaseHint').textContent = 'La prueba se detendra sola en el elegido y luego podras registrar ese resultado.';
}

function syncParticipantTableFocus(activeIndex, isSpotlight) {
  const rows = document.querySelectorAll('.participant-main-row');
  if (!drawShowcaseState.hasStarted) {
    rows.forEach((row) => {
      row.classList.remove('is-draw-active', 'is-draw-spotlight');
    });
    document.getElementById('drawShowcase')?.classList.remove('is-focus-locked');
    return;
  }
  rows.forEach((row) => {
    const rowIndex = Number(row.dataset.participantIndex);
    const isActive = rowIndex === activeIndex;
    row.classList.toggle('is-draw-active', isActive && !isSpotlight);
    row.classList.toggle('is-draw-spotlight', isActive && isSpotlight);
  });

  const activeRow = document.querySelector(`.participant-main-row[data-participant-index="${activeIndex}"]`);
  if (!activeRow) return;

  const scroller = document.getElementById('participantsTableScroller');
  if (!scroller) return;

  const rowTop = activeRow.offsetTop;
  const rowBottom = rowTop + activeRow.offsetHeight;
  const currentTop = scroller.scrollTop;
  const visibleTop = currentTop + 54;
  const visibleBottom = currentTop + scroller.clientHeight - 54;
  const shouldLockView = isSpotlight || !drawShowcaseState.paused;
  if (shouldLockView || rowTop < visibleTop || rowBottom > visibleBottom) {
    const targetTop = Math.max(0, rowTop - (scroller.clientHeight * 0.45));
    scroller.scrollTo({ top: targetTop, behavior: 'smooth' });
  }

  if (shouldLockView) {
    const showcase = document.getElementById('drawShowcase');
    showcase?.classList.add('is-focus-locked');
  }
}

function getDrawDelay(participant, isSpotlight) {
  const chanceWeight = Math.min(getParticipantChances(participant), 12);
  const cycleProgress = drawShowcaseState.cycle.length
    ? drawShowcaseState.cyclePosition / drawShowcaseState.cycle.length
    : 0;
  const introBoost = cycleProgress < 0.18 ? -32 : cycleProgress > 0.72 ? 42 : 0;
  if (isSpotlight) {
    return 2400 + (chanceWeight * 45) + Math.random() * 1200;
  }
  return Math.max(95, 150 + introBoost + (chanceWeight * 4) + (Math.random() * 90));
}

function renderDrawShowcaseEmpty() {
  const rail = document.getElementById('drawRail');
  const card = document.getElementById('drawFeaturedCard');
  document.getElementById('drawShowcase')?.classList.remove('is-focus-locked');
  drawShowcaseState.activeParticipantIndex = -1;
  drawShowcaseState.activeEntryNumber = 0;
  drawShowcaseState.activeEntryPosition = 0;
  drawShowcaseState.activeSpotlight = false;
  drawShowcaseState.hasStarted = false;
  if (card) card.classList.remove('spotlight');
  syncParticipantTableFocus(-1, false);
  document.getElementById('drawRoundCounter').textContent = '0';
  document.getElementById('drawFeaturedAvatar').textContent = '--';
  document.getElementById('drawFeaturedAvatar').style.background = 'rgba(255,255,255,0.06)';
  document.getElementById('drawFeaturedAvatar').style.color = 'var(--text)';
  document.getElementById('drawFeaturedName').textContent = 'La animacion se activara sola';
  document.getElementById('drawFeaturedMeta').innerHTML = '<span class="draw-featured-pill">Sin datos todavia</span>';
  document.getElementById('drawFeaturedScore').textContent = '0';
  document.getElementById('drawPhaseLabel').textContent = 'Prueba disponible';
  document.getElementById('drawPhaseName').textContent = 'Lista para iniciar la demostracion del funcionamiento';
  document.getElementById('drawPhaseHint').textContent = 'Pulsa iniciar prueba, deja que el sistema recorra la lista y luego registra el punto exacto donde freno.';
  document.getElementById('drawIntelFill').style.width = '18%';
  updateDrawControls();
  if (rail) {
    rail.innerHTML = '<div class="draw-rail-empty">Todavia no hay participantes visibles para iniciar el recorrido animado.</div>';
  }
}

async function loadDemoResults() {
  try {
    const { data, error } = await supabaseClient.rpc('list_demo_draw_results', {
      p_campaign_slug: CAMPAIGN_SLUG
    });
    if (error) throw error;
    demoResults = (data || []).map((row) => ({
      ...row,
      recorded_at_label: row.recorded_at
        ? new Date(row.recorded_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : ''
    }));
  } catch (error) {
    console.warn('No se pudo cargar el historial demo.', error);
    demoResults = [];
  }
  renderDemoHistory();
}

async function saveCurrentDemoResult() {
  const participant = getActiveDemoParticipant();
  if (!participant) {
    showToast('Todavia no hay un participante seleccionado donde freno la prueba.');
    return;
  }
  try {
    const { error } = await supabaseClient.rpc('record_demo_draw_result', {
      p_campaign_slug: CAMPAIGN_SLUG,
      p_participant_public_code: participant.publicCode || '',
      p_display_name: participant.displayName || participant.name,
      p_full_name: participant.name || participant.displayName || ''
    });
    if (error) throw error;
    await loadDemoResults();
    if (!drawShowcaseState.historyOpen) {
      toggleDemoHistory();
    }
    showToast(`Resultado registrado donde freno: ${participant.displayName || participant.name}.`);
  } catch (error) {
    console.error(error);
    showToast('No se pudo registrar donde freno la prueba. Revisa la migracion SQL.');
  }
}

function renderDrawShowcase(entry, isSpotlight, delay) {
  if (!participants.length || !entry || typeof entry.participantIndex !== 'number') {
    renderDrawShowcaseEmpty();
    return;
  }

  const activeIndex = entry.participantIndex;
  const participant = participants[activeIndex];
  if (!participant) {
    renderDrawShowcaseEmpty();
    return;
  }
  const activeColor = colorFor(activeIndex);
  drawShowcaseState.activeParticipantIndex = activeIndex;
  drawShowcaseState.activeEntryNumber = entry.chanceNumber;
  drawShowcaseState.activeEntryPosition = drawShowcaseState.cyclePosition + 1;
  drawShowcaseState.activeSpotlight = Boolean(isSpotlight);
  syncParticipantTableFocus(activeIndex, isSpotlight);
  const rail = document.getElementById('drawRail');
  const featuredCard = document.getElementById('drawFeaturedCard');
  const featuredAvatar = document.getElementById('drawFeaturedAvatar');
  const featuredName = document.getElementById('drawFeaturedName');
  const featuredMeta = document.getElementById('drawFeaturedMeta');
  const featuredScore = document.getElementById('drawFeaturedScore');
  const phaseLabel = document.getElementById('drawPhaseLabel');
  const phaseName = document.getElementById('drawPhaseName');
  const phaseHint = document.getElementById('drawPhaseHint');
  const intelFill = document.getElementById('drawIntelFill');
  const cycleProgress = drawShowcaseState.cycle.length
    ? (drawShowcaseState.cyclePosition + 1) / drawShowcaseState.cycle.length
    : 0;
  document.getElementById('drawShowcase')?.classList.toggle('is-focus-locked', Boolean(isSpotlight));

  featuredCard.classList.toggle('spotlight', Boolean(isSpotlight));
  featuredAvatar.textContent = initials(participant.displayName || participant.name);
  featuredAvatar.style.background = `${activeColor}22`;
  featuredAvatar.style.color = activeColor;
  featuredName.textContent = participant.displayName || participant.name;
  featuredMeta.innerHTML = `
    <span class="draw-featured-pill">${escapeHtml(participant.province || 'Argentina')}</span>
    <span class="draw-featured-pill">${escapeHtml(participant.city || 'Sin ciudad')}</span>
    <span class="draw-featured-pill">${escapeHtml(participant.date || 'Hoy')}</span>
    <span class="draw-featured-pill">${participant.publicCode ? escapeHtml(participant.publicCode) : 'Registro visible'}</span>
  `;
  featuredScore.textContent = getParticipantChances(participant).toLocaleString('es-AR');
  document.getElementById('drawRoundCounter').textContent = String(drawShowcaseState.round);

  phaseLabel.textContent = isSpotlight ? 'Pausa aleatoria' : 'Recorrido dinamico';
  phaseName.textContent = isSpotlight
    ? `${participant.displayName || participant.name} quedo seleccionado en la demostracion`
    : 'La lista esta recorriendo participantes en tiempo real';
  phaseHint.textContent = getDrawNarrative(participant, isSpotlight, cycleProgress);
  intelFill.style.width = `${Math.max(16, Math.min(100, cycleProgress * 100))}%`;

  const visibleCards = [];
  const cardCount = Math.min(Math.max(drawShowcaseState.cycle.length, 1), 5);
  for (let offset = 0; offset < cardCount; offset += 1) {
    const cyclePosition = (drawShowcaseState.cyclePosition + offset) % drawShowcaseState.cycle.length;
    const cycleEntry = drawShowcaseState.cycle[cyclePosition];
    if (!cycleEntry || typeof cycleEntry.participantIndex !== 'number') {
      continue;
    }
    const item = participants[cycleEntry.participantIndex];
    if (!item) {
      continue;
    }
    visibleCards.push(`
      <div class="draw-rail-card${offset === 0 ? ' active' : ''}${cyclePosition === drawShowcaseState.spotlightPosition ? ' spotlight' : ''}">
        <span class="draw-rail-name">${escapeHtml(item.displayName || item.name)}</span>
        <div class="draw-rail-meta">
          <span>${escapeHtml(participantLocation(item))}</span>
          <span>Chance ${cycleEntry.chanceNumber}</span>
        </div>
      </div>
    `);
  }
  rail.innerHTML = visibleCards.join('');
}

function stopDrawShowcase() {
  if (drawAnimationTimeout) {
    clearTimeout(drawAnimationTimeout);
    drawAnimationTimeout = null;
  }
}

function prepareDrawShowcaseRound() {
  drawShowcaseState.cycle = shuffleList(drawShowcaseState.basePool);
  drawShowcaseState.cyclePosition = 0;
  drawShowcaseState.spotlightPosition = drawShowcaseState.cycle.length ? Math.floor(Math.random() * drawShowcaseState.cycle.length) : -1;
  drawShowcaseState.round += 1;
}

function tickDrawShowcase() {
  if (!participants.length) {
    stopDrawShowcase();
    renderDrawShowcaseEmpty();
    return;
  }
  if (drawShowcaseState.paused) {
    updateDrawControls();
    return;
  }

  if (!drawShowcaseState.cycle.length || drawShowcaseState.cyclePosition >= drawShowcaseState.cycle.length) {
    prepareDrawShowcaseRound();
  }
  if (!drawShowcaseState.cycle.length) {
    renderDrawShowcaseEmpty();
    return;
  }

  const cyclePosition = drawShowcaseState.cyclePosition;
  const entry = drawShowcaseState.cycle[cyclePosition];
  if (!entry || typeof entry.participantIndex !== 'number' || !participants[entry.participantIndex]) {
    drawShowcaseState.cyclePosition += 1;
    if (drawShowcaseState.cyclePosition >= drawShowcaseState.cycle.length) {
      prepareDrawShowcaseRound();
    }
    tickDrawShowcase();
    return;
  }
  const isSpotlight = cyclePosition === drawShowcaseState.spotlightPosition;
  const participant = participants[entry.participantIndex];
  const delay = getDrawDelay(participant, isSpotlight);
  renderDrawShowcase(entry, isSpotlight, delay);
  drawShowcaseState.cyclePosition += 1;
  if (isSpotlight) {
    drawAnimationTimeout = setTimeout(() => {
      pauseDrawShowcase();
    }, delay);
    return;
  }
  drawAnimationTimeout = setTimeout(() => {
    if (drawShowcaseState.cyclePosition >= drawShowcaseState.cycle.length) {
      prepareDrawShowcaseRound();
    }
    tickDrawShowcase();
  }, delay);
}

function startDrawShowcase() {
  stopDrawShowcase();
  if (!participants.length) {
    renderDrawShowcaseEmpty();
    return;
  }
  drawShowcaseState.paused = true;
  drawShowcaseState.hasStarted = false;
  updateDrawControls();
  prepareDrawShowcaseRound();
  if (!drawShowcaseState.cycle.length) {
    renderDrawShowcaseEmpty();
    return;
  }
  const entry = drawShowcaseState.cycle[drawShowcaseState.cyclePosition];
  if (!entry || typeof entry.participantIndex !== 'number' || !participants[entry.participantIndex]) {
    renderDrawShowcaseEmpty();
    return;
  }
  const participant = participants[entry.participantIndex];
  const delay = getDrawDelay(participant, false);
  renderDrawShowcase(entry, false, delay);
}

async function shareWhatsappLink() {
  const value = document.getElementById('shareLinkInput').value;
  if (!value) return;
  const label = (document.getElementById('paymentStatusTitle').textContent || 'Te invito').replace(' ya participa del sorteo', '');
  const text = buildReferralShareCopy(label, value);
  if (navigator.share) {
    try {
      await navigator.share({ title: DEFAULT_SHARE_TITLE, text, url: value });
      return;
    } catch (_) {
      // fall through to WhatsApp
    }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
}

function getRandomActivityMessage() {
  if (!participants.length) {
    return null;
  }
  const person = randomFrom(participants);
  const template = randomFrom([
    'acaba de reservar chances para el sorteo',
    'se sumo hace instantes',
    'esta participando ahora mismo',
    'confirmo su interes en el sorteo'
  ]);
  return {
    text: `${person.displayName || person.name} de ${participantLocation(person)} ${template}.`,
    sub: person.date
  };
}

function showLiveFeedNotification() {
  const feed = document.getElementById('liveFeed');
  const message = getRandomActivityMessage();
  if (!message) return;
  document.getElementById('liveFeedText').textContent = message.text;
  document.getElementById('liveFeedSub').textContent = message.sub;
  feed.classList.add('show');
  setTimeout(() => feed.classList.remove('show'), 4600);
}

function scheduleLiveFeed() {
  if (!participants.length) return;
  if (liveFeedTimeout) clearTimeout(liveFeedTimeout);
  const delay = 9000 + Math.random() * 11000;
  liveFeedTimeout = setTimeout(() => {
    showLiveFeedNotification();
    scheduleLiveFeed();
  }, delay);
}

function updateStats(){
  return;
}

function renderPackages(){
  const grid = document.getElementById('packagesGrid');
  const tc = totalChances();
  const baseChancePrice = getBaseChancePrice();
  grid.innerHTML = '';

  packages.forEach(pkg => {
    const chances = Number(pkg.entries_qty || 0) + Number(pkg.bonus_entries || 0);
    const totalPrice = Number(pkg.price_ars || 0);
    const fillPct = Math.min(100, Math.round((tc / Math.max(currentMaxChances(), 1)) * 100));
    const perChance = chances > 0 ? (totalPrice / chances).toLocaleString('es-AR', { maximumFractionDigits: 0 }) : '0';
    const theoreticalPrice = baseChancePrice > 0 ? baseChancePrice * chances : 0;
    const savings = theoreticalPrice > totalPrice ? theoreticalPrice - totalPrice : 0;
    const savingsLabel = savings > 0 ? `Ahorras $${savings.toLocaleString('es-AR')}` : '&nbsp;';
    const div = document.createElement('div');
    div.className = 'pkg reveal' + (pkg.featured ? ' featured' : '');
    div.innerHTML = `
      ${pkg.featured ? '<span class="pkg-badge">MEJOR OPCION</span>' : ''}
      <span class="pkg-chances">${chances >= 1000 ? (chances/1000)+'K' : chances}</span>
      <span class="pkg-unit">CHANCE${chances > 1 ? 'S' : ''}</span>
      <div class="pkg-progress"><div class="pkg-progress-fill" style="width:${fillPct}%"></div></div>
      <span class="pkg-price">$${totalPrice.toLocaleString('es-AR')}</span>
      <span class="pkg-price-unit">$${perChance} por chance</span>
      <span class="pkg-saving">${savingsLabel}</span>
      <span class="pkg-price-unit">${chances >= 3 ? 'Con 3 o mas chances se habilita tu link unico y cada referido aprobado te suma 2 chances extra' : '&nbsp;'}</span>
      <button class="pkg-btn" onclick="openModal('${pkg.id}')">Quiero ${chances >= 1000 ? (chances/1000)+'K' : chances} chance${chances > 1 ? 's' : ''}</button>
    `;
    grid.appendChild(div);
  });

  repairDocumentText(grid);
  observeReveal();
}

function renderParticipants(filter=''){
  const body = document.getElementById('participantsBody');
  body.innerHTML = '';
  const normalizedFilter = filter.toLowerCase();
  const filtered = filter
    ? participants.filter(p =>
        (p.displayName || p.name).toLowerCase().includes(normalizedFilter) ||
        p.name.toLowerCase().includes(normalizedFilter) ||
        (p.city || '').toLowerCase().includes(normalizedFilter) ||
        (p.province || '').toLowerCase().includes(normalizedFilter) ||
        (p.publicCode || '').toLowerCase().includes(normalizedFilter)
      )
    : participants;

  filtered.forEach((p) => {
    const sourceIndex = participants.indexOf(p);
    const purchasedChances = Math.max(1, Number(p.currentChances || p.purchasedChances || p.chances || 0));
    const detailId = `${p.publicCode || p.name}-${sourceIndex}-${p.date}`;
    const row = document.createElement('tr');
    row.className = 'participant-main-row';
    row.dataset.detailId = detailId;
    row.dataset.participantIndex = String(sourceIndex);
    const avatarHtml = renderParticipantAvatar(p, p.displayName || p.name, colorFor(sourceIndex));
    row.innerHTML = `
      <td data-col="participant"><div class="td-name-cell">${avatarHtml}<div class="td-name-copy"><div class="td-name">${p.displayName || p.name}</div></div></div></td>
      <td data-col="province"><span style="font-size:0.8rem;color:var(--text2)">${p.province || '-'}</span></td>
      <td data-col="city"><span style="font-size:0.8rem;color:var(--text2)">${p.city || '-'}</span></td>
      <td data-col="entries"><span class="chances-badge">x${purchasedChances.toLocaleString('es-AR')}</span></td>
      <td data-col="date" style="font-size:0.8rem;color:var(--text2)">${p.date}</td>
      <td data-col="message" class="message-cell"><button type="button" class="message-trigger${p.opinionMessage ? '' : ' empty'}" data-opinion="${encodeURIComponent(p.opinionMessage || '')}" data-author="${encodeURIComponent(p.displayName || p.name)}" data-city="${encodeURIComponent(participantLocation(p))}"><span class="message-trigger-icon">MSG</span><span>${p.opinionMessage ? 'Ver mensaje' : 'Sin mensaje'}</span></button></td>
    `;
    body.appendChild(row);

    if (expandedParticipantRows.has(detailId)) {
      Array.from({ length: purchasedChances }, (_, idx) => idx + 1).forEach((chanceNumber) => {
        const detailRow = document.createElement('tr');
        const detailAvatarHtml = renderParticipantAvatar(p, p.detailLabel || p.displayName || p.name, colorFor(sourceIndex));
        detailRow.className = 'participant-detail-row';
        detailRow.innerHTML = `
          <td data-col="participant"><div class="td-name-cell">${detailAvatarHtml}<div class="td-name-copy"><div class="td-name">${p.detailLabel || p.displayName || p.name}</div></div></div></td>
          <td data-col="province"><span style="font-size:0.8rem;color:var(--text2)">${p.province || '-'}</span></td>
          <td data-col="city"><span style="font-size:0.8rem;color:var(--text2)">${p.city || '-'}</span></td>
          <td data-col="entries"><span class="chances-badge">x${chanceNumber}</span></td>
          <td data-col="date" style="font-size:0.8rem;color:var(--text2)">${p.date}</td>
          <td data-col="message" class="message-cell"><button type="button" class="message-trigger${p.opinionMessage ? '' : ' empty'}" data-opinion="${encodeURIComponent(p.opinionMessage || '')}" data-author="${encodeURIComponent(p.displayName || p.name)}" data-city="${encodeURIComponent(participantLocation(p))}"><span class="message-trigger-icon">MSG</span><span>${p.opinionMessage ? 'Ver mensaje' : 'Sin mensaje'}</span></button></td>
        `;
        body.appendChild(detailRow);
      });
    }
  });

  syncParticipantTableFocus(drawShowcaseState.activeParticipantIndex, drawShowcaseState.activeSpotlight);

  body.querySelectorAll('.message-trigger:not(.empty)').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      openOpinionModal({
        message: decodeURIComponent(button.dataset.opinion || ''),
        author: decodeURIComponent(button.dataset.author || 'Participante'),
        city: decodeURIComponent(button.dataset.city || 'Argentina')
      });
    });
  });

  body.querySelectorAll('.participant-main-row').forEach((row) => {
    row.addEventListener('click', () => {
      const { detailId } = row.dataset;
      if (!detailId) return;
      if (expandedParticipantRows.has(detailId)) {
        expandedParticipantRows.delete(detailId);
      } else {
        expandedParticipantRows.add(detailId);
      }
      renderParticipants(document.getElementById('searchInput').value);
    });
  });

  if (!filtered.length) {
    body.innerHTML = '<tr><td colspan="6" style="padding:1rem;color:var(--text2)">Todavia no hay compras aprobadas para mostrar.</td></tr>';
  }

  updateStats();
}

function renderProofMessages() {
  const grid = document.getElementById('proofGrid');
  if (!grid) return;

  const dynamicMessages = participants
    .filter((p) => p.opinionMessage)
    .map((p) => ({
      name: p.displayName || p.name,
      city: participantLocation(p),
      message: p.opinionMessage,
      photoUrl: p.photoUrl || ''
    }));

  const cards = dynamicMessages.length ? dynamicMessages : [];
  grid.innerHTML = cards.map((item, index) => `
    <div class="proof-card reveal" style="transition-delay:${Math.min(index * 0.08, 0.32)}s">
      <div class="proof-head">
        <div class="proof-avatar">${item.photoUrl ? `<img src="${escapeHtml(item.photoUrl)}" alt="${escapeHtml(item.name)}">` : ''}</div>
        <div class="proof-head-copy">
          <span class="proof-name">${escapeHtml(item.name)}</span>
          <span class="proof-city">${escapeHtml(item.city)}</span>
        </div>
      </div>
      <div class="proof-copy">"${escapeHtml(item.message)}"</div>
    </div>
  `).join('');

  observeReveal();
}

function setCountdown(targetIso){
  if (countdownInterval) clearInterval(countdownInterval);
  const target = new Date(DRAW_TARGET_ISO);
  const countdownBar = document.getElementById('countdownBar');

  function tick(){
    const diff = target - Date.now();
    if (diff <= 0) {
      clearInterval(countdownInterval);
      countdownBar.classList.remove('hidden-until-thirty');
      document.getElementById('countdownNote').textContent = 'Se acerca el cierre final. AprovechÃƒÂ¡ antes de que se agoten las chances.';
      return;
    }
    const d = Math.floor(diff / 864e5);
    const h = Math.floor((diff % 864e5) / 36e5);
    const m = Math.floor((diff % 36e5) / 6e4);
    const s = Math.floor((diff % 6e4) / 1e3);
    if (d <= 30) {
      countdownBar.classList.remove('hidden-until-thirty');
    } else {
      countdownBar.classList.add('hidden-until-thirty');
    }
    document.getElementById('cd-d').textContent = String(d).padStart(2,'0');
    document.getElementById('cd-h').textContent = String(h).padStart(2,'0');
    document.getElementById('cd-m').textContent = String(m).padStart(2,'0');
    document.getElementById('cd-s').textContent = String(s).padStart(2,'0');
    const note = document.getElementById('countdownNote');
    if (d <= 3) {
      note.textContent = 'Ultimos dias. Quedan pocos lugares para hacer el sorteo antes.';
    } else if (d <= 10) {
      note.textContent = 'Se viene el cierre. Quedan pocos lugares y puede sortearse antes al agotar chances.';
    } else if (d <= 30) {
      note.textContent = 'Ya comenzo la cuenta regresiva. Quedan pocos lugares para hacer el sorteo antes.';
    } else {
      note.textContent = 'Quedan pocos lugares para hacer el sorteo antes.';
    }
  }

  tick();
  countdownInterval = setInterval(tick, 1000);
}

function createSparks(){
  const container = document.getElementById('sparks');
  for(let i = 0; i < 30; i++){
    const s = document.createElement('div');
    s.className = 'spark';
    const size = Math.random() * 4 + 2;
    s.style.cssText = `
      width:${size}px; height:${size}px;
      left:${Math.random()*100}%;
      background:${Math.random()>0.5?'#F5C842':'#E8192C'};
      animation-duration:${4+Math.random()*8}s;
      animation-delay:${Math.random()*6}s;
    `;
    container.appendChild(s);
  }
}

function openModal(pkgId){
  selectedPkg = packages.find(p => p.id === pkgId);
  if (!selectedPkg) return;
  const totalEntries = Number(selectedPkg.entries_qty || 0) + Number(selectedPkg.bonus_entries || 0);
  document.getElementById('modal-pkg-name').textContent = `${totalEntries} chance${totalEntries > 1 ? 's' : ''}`;
  document.getElementById('modal-pkg-price').textContent = '$' + Number(selectedPkg.price_ars || 0).toLocaleString('es-AR');
  document.getElementById('f-name').value = '';
  document.getElementById('f-phone').value = '';
  document.getElementById('f-province').value = '';
  document.getElementById('f-city').value = '';
  document.getElementById('f-photo').value = '';
  document.getElementById('f-message').value = '';
  document.getElementById('f-anonymous').checked = false;
  selectedPhotoFile = null;
  updatePhotoPreview(null);
  updateMessagePreview();
  selectPaymentProvider('galiopay');
  setModalOpen(true);
}

function setModalOpen(isOpen) {
  document.getElementById('modal').classList.toggle('open', isOpen);
  document.body.classList.toggle('modal-open', isOpen);
}

function selectPaymentProvider(provider) {
  const chip = document.querySelector(`.pm-chip[data-provider="${provider}"]`);
  if (!chip) return;
  document.querySelectorAll('.pm-chip').forEach(c => c.classList.remove('selected'));
  chip.classList.add('selected');
  selectedPaymentProvider = chip.dataset.provider || 'manual';
}

document.getElementById('modalClose').onclick = () => setModalOpen(false);
document.getElementById('modal').onclick = e => { if (e.target === document.getElementById('modal')) setModalOpen(false); };

function selectPM(el){
  document.querySelectorAll('.pm-chip').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  selectedPaymentProvider = el.dataset.provider || 'manual';
}

function updateMessagePreview() {
  const value = document.getElementById('f-message').value.trim();
  const preview = document.getElementById('messagePreview');
  const copy = document.getElementById('messagePreviewCopy');
  copy.textContent = value;
  preview.classList.toggle('show', Boolean(value));
}

document.getElementById('f-message').addEventListener('input', updateMessagePreview);
document.getElementById('f-photo').addEventListener('change', (event) => {
  const [file] = event.target.files || [];
  selectedPhotoFile = file || null;
  updatePhotoPreview(selectedPhotoFile);
});
document.getElementById('opinionModalClose').onclick = () => document.getElementById('opinionModal').classList.remove('open');
document.getElementById('opinionModal').onclick = e => { if (e.target === document.getElementById('opinionModal')) document.getElementById('opinionModal').classList.remove('open'); };

function openOpinionModal({ message, author, city }) {
  document.getElementById('opinionAuthor').textContent = author;
  document.getElementById('opinionMeta').textContent = `${city} Ã‚Â· Mensaje compartido desde el formulario del sorteo.`;
  document.getElementById('opinionModalCopy').textContent = message;
  document.getElementById('opinionModal').classList.add('open');
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderParticipantAvatar(participant, fallbackLabel, color) {
  if (participant.photoUrl) {
    return `<div class="td-avatar"><img src="${escapeHtml(participant.photoUrl)}" alt="${escapeHtml(fallbackLabel)}"></div>`;
  }
  return `<div class="td-avatar" style="background:${color}22;color:${color}">${escapeHtml(initials(fallbackLabel))}</div>`;
}

function participantLocation(participant) {
  const province = participant.province || '';
  const city = participant.city || '';
  return province || city || 'Argentina';
}

function normalizeParticipantLocation(row) {
  const rawProvince = (row.province || '').trim();
  const rawCity = (row.city || '').trim();
  const normalizedCity = rawCity.toLowerCase();
  const hasLegacyLocation = !rawProvince && rawCity && normalizedCity !== 'argentina';
  return {
    province: hasLegacyLocation ? rawCity : rawProvince,
    city: hasLegacyLocation || normalizedCity === 'argentina' ? '' : rawCity
  };
}

async function submitOrder(){
  const name = document.getElementById('f-name').value.trim();
  const phone = document.getElementById('f-phone').value.trim();
  const province = document.getElementById('f-province').value.trim() || 'Argentina';
  const city = document.getElementById('f-city').value.trim() || '';
  const opinionMessage = document.getElementById('f-message').value.trim();
  const wantsAnonymous = document.getElementById('f-anonymous').checked;
  if (!selectedPkg) return showToast('ElegÃƒÂ­ un paquete.');
  if (!name || !phone) return alert('CompletÃƒÂ¡ nombre y WhatsApp');

  const button = document.getElementById('modalConfirm');
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'PROCESANDO...';

  try {
    const photoUrl = await uploadParticipantPhoto(selectedPhotoFile, phone);
    const { data, error } = await supabaseClient.rpc('create_order_from_landing', {
      p_campaign_slug: CAMPAIGN_SLUG,
      p_package_id: selectedPkg.id,
      p_full_name: name,
      p_phone: phone,
      p_province: province,
      p_city: city,
      p_photo_url: photoUrl,
      p_show_public_name: !wantsAnonymous,
      p_payment_provider: selectedPaymentProvider,
      p_referral_code: getReferralCode() || null,
      p_opinion_message: opinionMessage || null
    });

    if (error) throw error;

    if (selectedPaymentProvider === 'galiopay') {
      const response = await fetch(buildFunctionUrl('galiopay-create-payment'), {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8'
        },
        body: JSON.stringify({
          order_id: data.order_id,
          provider: 'galiopay',
          landing_url: window.location.origin + window.location.pathname,
          landing_origin: window.location.origin
        })
      });

      const checkout = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(checkout.error || 'No se pudo generar el link de pago de Galiopay.');
      }

      if (checkout.checkout_url) {
        window.location.href = checkout.checkout_url;
        return;
      }
    }

    setModalOpen(false);
    await loadParticipants();
    renderPackages();
    renderParticipants(document.getElementById('searchInput').value);

    const shareHint = data?.share_unlocked_after_payment
      ? ' Al aprobarse el pago se habilita tu enlace unico para compartir.'
      : '';
    showToast('Reserva creada correctamente.' + shareHint);
    setTimeout(() => document.getElementById('participantes').scrollIntoView({behavior:'smooth'}), 400);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'No se pudo crear la orden.');
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function loadCampaign(){
  let { data, error } = await supabaseClient
    .from('campaigns')
    .select('*')
    .eq('slug', CAMPAIGN_SLUG)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    const fallback = await supabaseClient
      .from('campaigns')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (fallback.error) throw fallback.error;
    data = fallback.data;
  }

  if (!data) throw new Error('No hay una campana activa configurada.');
  activeCampaign = data;
  setCountdown(DRAW_TARGET_ISO);
}

async function loadPackages(){
  const { data, error } = await supabaseClient
    .from('packages')
    .select('*')
    .eq('campaign_id', activeCampaign.id)
    .eq('status', 'active')
    .order('sort_order')
    .order('entries_qty');

  if (error) throw error;
  packages = data || [];
}

async function loadParticipants(){
  const { data, error } = await supabaseClient.rpc('list_public_participants', {
    p_campaign_slug: CAMPAIGN_SLUG
  });

  if (error) throw error;
  participants = (data || []).map((row, index) => {
    const location = normalizeParticipantLocation(row);
    const displayName = row.display_name || row.full_name;
    const fullName = row.full_name || displayName;
    const province = location.province;
    const city = location.city;
    return {
      sourceIndex: index,
      name: fullName,
      displayName,
    detailLabel: row.is_anonymous ? (row.display_name || 'AnÃƒÂ³nimo') : row.full_name,
      isAnonymous: Boolean(row.is_anonymous),
      publicCode: row.public_code || '',
      photoUrl: row.photo_url || '',
      province: location.province,
      city: location.city,
      purchasedChances: Number(row.purchased_entries || row.total_entries || 0),
      chances: Number(row.total_entries || 0),
      currentChances: Math.max(Number(row.purchased_entries || 0), Number(row.total_entries || 0)),
      opinionMessage: (row.opinion_message || '').trim(),
      date: new Date(row.joined_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    };
  });
  renderProofMessages();
  startDrawShowcase();
}

async function loadPublicOrderStatus(orderRef) {
  const { data, error } = await supabaseClient.rpc('get_public_order_status', {
    p_external_reference: orderRef
  });
  if (error) throw error;
  latestOrderStatus = data || null;
  return latestOrderStatus;
}

function renderParticipants(filter=''){
  const body = document.getElementById('participantsBody');
  if (!body) return;
  body.innerHTML = '';

  const normalizedFilter = (filter || '').trim().toLowerCase();
  const filtered = normalizedFilter
    ? participants.filter((participant) => (participant.searchIndex || '').includes(normalizedFilter))
    : participants;

  if (!filtered.length) {
    body.innerHTML = '<tr><td colspan="6" style="padding:1rem;color:var(--text2)">Todavia no hay compras aprobadas para mostrar.</td></tr>';
    updateStats();
    return;
  }

  const fragment = document.createDocumentFragment();
  filtered.forEach((participant) => {
    const sourceIndex = Number.isInteger(participant.sourceIndex) ? participant.sourceIndex : participants.indexOf(participant);
    const purchasedChances = getParticipantChances(participant);
    const detailId = `${participant.publicCode || participant.name}-${sourceIndex}-${participant.date}`;
    const avatarHtml = renderParticipantAvatar(participant, participant.displayName || participant.name, colorFor(sourceIndex));

    const row = document.createElement('tr');
    row.className = 'participant-main-row';
    row.dataset.detailId = detailId;
    row.dataset.participantIndex = String(sourceIndex);
    row.innerHTML = `
      <td data-col="participant"><div class="participant-cell">${avatarHtml}<span class="participant-label">${escapeHtml(participant.displayName || participant.name)}</span></div></td>
      <td data-col="province"><span style="font-size:0.8rem;color:var(--text2)">${escapeHtml(participant.province || '-')}</span></td>
      <td data-col="city"><span style="font-size:0.8rem;color:var(--text2)">${escapeHtml(participant.city || '-')}</span></td>
      <td data-col="entries"><span class="chances-badge">x${purchasedChances.toLocaleString('es-AR')}</span></td>
      <td data-col="date" style="font-size:0.8rem;color:var(--text2)">${escapeHtml(participant.date)}</td>
      <td data-col="message" class="message-cell"><button type="button" class="message-trigger${participant.opinionMessage ? '' : ' empty'}" data-opinion="${encodeURIComponent(participant.opinionMessage || '')}" data-author="${encodeURIComponent(participant.displayName || participant.name)}" data-city="${encodeURIComponent(participantLocation(participant))}"><span class="message-trigger-icon">MSG</span><span>${participant.opinionMessage ? 'Ver mensaje' : 'Sin mensaje'}</span></button></td>
    `;
    fragment.appendChild(row);

    if (expandedParticipantRows.has(detailId)) {
      Array.from({ length: purchasedChances }, (_, idx) => idx + 1).forEach((chanceNumber) => {
        const detailRow = document.createElement('tr');
        detailRow.className = 'participant-detail-row';
        detailRow.innerHTML = `
          <td data-col="participant"><div class="participant-cell">${avatarHtml}<span class="participant-label">${escapeHtml(participant.detailLabel || participant.displayName || participant.name)}</span></div></td>
          <td data-col="province"><span style="font-size:0.8rem;color:var(--text2)">${escapeHtml(participant.province || '-')}</span></td>
          <td data-col="city"><span style="font-size:0.8rem;color:var(--text2)">${escapeHtml(participant.city || '-')}</span></td>
          <td data-col="entries"><span class="chances-badge">x${chanceNumber}</span></td>
          <td data-col="date" style="font-size:0.8rem;color:var(--text2)">${escapeHtml(participant.date)}</td>
          <td data-col="message" class="message-cell"><button type="button" class="message-trigger${participant.opinionMessage ? '' : ' empty'}" data-opinion="${encodeURIComponent(participant.opinionMessage || '')}" data-author="${encodeURIComponent(participant.displayName || participant.name)}" data-city="${encodeURIComponent(participantLocation(participant))}"><span class="message-trigger-icon">MSG</span><span>${participant.opinionMessage ? 'Ver mensaje' : 'Sin mensaje'}</span></button></td>
        `;
        fragment.appendChild(detailRow);
      });
    }
  });

  body.appendChild(fragment);
  repairDocumentText(body);
  syncParticipantTableFocus(drawShowcaseState.activeParticipantIndex, drawShowcaseState.activeSpotlight);

  body.querySelectorAll('.message-trigger:not(.empty)').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      openOpinionModal({
        message: decodeURIComponent(button.dataset.opinion || ''),
        author: decodeURIComponent(button.dataset.author || 'Participante'),
        city: decodeURIComponent(button.dataset.city || 'Argentina')
      });
    });
  });

  body.querySelectorAll('.participant-main-row').forEach((row) => {
    row.addEventListener('click', () => {
      const { detailId } = row.dataset;
      if (!detailId) return;
      if (expandedParticipantRows.has(detailId)) {
        expandedParticipantRows.delete(detailId);
      } else {
        expandedParticipantRows.add(detailId);
      }
      renderParticipants(document.getElementById('searchInput')?.value || '');
    });
  });

  updateStats();
}

async function loadParticipants(){
  const { data, error } = await supabaseClient.rpc('list_public_participants', {
    p_campaign_slug: CAMPAIGN_SLUG
  });

  if (error) throw error;
  participants = (data || []).map((row, index) => {
    const location = normalizeParticipantLocation(row);
    const displayName = row.display_name || row.full_name;
    const fullName = row.full_name || displayName;
    const province = location.province;
    const city = location.city;
    return {
      sourceIndex: index,
      name: fullName,
      displayName,
      detailLabel: row.is_anonymous ? (displayName || 'AnÃƒÆ’Ã‚Â³nimo') : fullName,
      isAnonymous: Boolean(row.is_anonymous),
      publicCode: row.public_code || '',
      photoUrl: row.photo_url || '',
      province,
      city,
      purchasedChances: Number(row.purchased_entries || row.total_entries || 0),
      chances: Number(row.total_entries || 0),
      currentChances: Math.max(Number(row.purchased_entries || 0), Number(row.total_entries || 0)),
      opinionMessage: (row.opinion_message || '').trim(),
      searchIndex: [displayName, fullName, province, city, row.public_code || ''].join(' ').toLowerCase(),
      date: new Date(row.joined_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    };
  });
  refreshDrawEntryPool();
  renderProofMessages();
  startDrawShowcase();
}

async function handleReturnedPayment() {
  const params = new URLSearchParams(window.location.search);
  const paymentState = params.get('payment');
  const orderRef = getOrderReferenceFromQuery();
  if (!paymentState || !orderRef) return;

  if (paymentState === 'failure') {
    showPaymentCard({
      kicker: 'Pago pendiente',
      title: 'El pago no se aprobÃƒÂ³',
      copy: 'PodÃƒÂ©s intentarlo de nuevo con otro medio o volver a elegir tu pack.'
    });
    showToast('El pago no fue aprobado.');
    clearPaymentQueryState();
    return;
  }

  let statusData = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    statusData = await loadPublicOrderStatus(orderRef);
    if (statusData?.status === 'paid') break;
    await new Promise(resolve => setTimeout(resolve, 2500));
  }

  if (!statusData) {
    showToast('No pudimos verificar tu pago todavÃƒÂ­a.');
    return;
  }

  if (statusData.status !== 'paid') {
    showPaymentCard({
      kicker: 'Pago en revisiÃƒÂ³n',
      title: 'Estamos confirmando tu compra',
      copy: 'Cuando el pago se acredite, tu nombre aparecerÃƒÂ¡ en la lista automÃƒÂ¡ticamente.'
    });
    showToast('Tu pago quedÃƒÂ³ en revisiÃƒÂ³n.');
    clearPaymentQueryState();
    return;
  }

  await loadParticipants();
  renderParticipants(document.getElementById('searchInput').value);
  startDrawShowcase();
  scheduleLiveFeed();
  latestOrderStatus = { ...statusData, external_reference: orderRef };
  storeApprovedOrderReference(orderRef);
  await loadMyCampaignVote();
  await loadPublicCampaignVotes();

  const shareUrl = statusData.referral_link_code ? buildLandingShareUrl(statusData.referral_link_code) : '';
  const participantLabel = statusData.participant_name || 'Te invito';
  if (shareUrl) {
    updateShareMetadata({
      title: `${participantLabel} te invita al Gran Sorteo`,
      description: buildReferralShareCopy(participantLabel, shareUrl),
      image: DEFAULT_SHARE_IMAGE,
      url: shareUrl
    });
  }
  showPaymentCard({
    kicker: 'Pago aprobado',
    title: `${participantLabel} ya participa del sorteo`,
    copy: shareUrl
      ? `Tus chances ya estÃƒÂ¡n activas, tu compra quedÃƒÂ³ registrada y tambiÃƒÂ©n se habilitÃƒÂ³ tu enlace ÃƒÂºnico. Cada compra aprobada desde ese enlace te suma 2 chances extra.`
      : `Tus chances ya estÃƒÂ¡n activas, tu compra quedÃƒÂ³ registrada y ya aparecÃƒÂ©s en la lista pÃƒÂºblica de participantes.`,
    shareUrl
  });
  showToast(shareUrl ? 'Pago aprobado. Ya podÃƒÂ©s compartir tu enlace ÃƒÂºnico.' : 'Pago aprobado. Ya aparecÃƒÂ©s en la lista.');
  document.getElementById('nextDrawVoting').scrollIntoView({ behavior: 'smooth', block: 'start' });
  clearPaymentQueryState();
}

document.getElementById('searchInput').addEventListener('input', e => renderParticipants(e.target.value));
document.getElementById('modalConfirm').onclick = submitOrder;
document.getElementById('copyShareBtn').onclick = copyShareLink;
document.getElementById('shareWhatsappBtn').onclick = shareWhatsappLink;
document.getElementById('toggleDemoBtn').onclick = toggleDemoShowcase;
document.getElementById('drawStartBtn').onclick = startDemoTrial;
document.getElementById('saveDemoResultBtn').onclick = saveCurrentDemoResult;
document.getElementById('toggleDemoHistoryBtn').onclick = toggleDemoHistory;
document.getElementById('voteOptionsGrid').addEventListener('click', (event) => {
  const button = event.target.closest('[data-vote-option]');
  if (!button) return;
  submitCampaignVote(button.dataset.voteOption);
});

document.querySelectorAll('.faq-q').forEach(btn => {
  btn.onclick = () => {
    const item = btn.parentElement;
    const wasOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
    if (!wasOpen) item.classList.add('open');
  };
});

function observeReveal(){
  const els = document.querySelectorAll('.reveal:not(.visible)');
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => { if(e.isIntersecting){ e.target.classList.add('visible'); obs.unobserve(e.target); } });
  }, { threshold: 0.12 });
  els.forEach(el => obs.observe(el));
}

async function bootLanding(){
  try {
    repairDocumentText();
    updateShareMetadata({
      title: DEFAULT_SHARE_TITLE,
      description: DEFAULT_SHARE_DESCRIPTION,
      image: DEFAULT_SHARE_IMAGE,
      url: window.location.href
    });
    createSparks();
    await loadCampaign();
    await loadPackages();
    await loadParticipants();
    await loadPublicCampaignVotes();
    await loadMyCampaignVote();
    await loadDemoResults();
    renderPackages();
    renderParticipants();
    renderCampaignVoting();
    repairDocumentText();
    startDrawShowcase();
    observeReveal();
    scheduleLiveFeed();
    await handleReturnedPayment();

    if (getReferralCode()) {
      showToast('Entraste con un enlace referido. Si compras, ese enlace suma 2 chances extra a su titular.');
    }
  } catch (error) {
    console.error(error);
    showToast('No se pudo cargar la landing conectada a Supabase.');
  }
}

bootLanding();

