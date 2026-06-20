'use strict';

const MUSIC_PRESETS = {
  'instrumental-romantico': { title: 'Trilha do casal', subtitle: 'Instrumental romântico', notes: [261.63, 329.63, 392, 523.25], speed: 1.8 },
  'piano-calmo': { title: 'Piano calmo', subtitle: 'Clima delicado e intimista', notes: [220, 277.18, 329.63, 440], speed: 2.1 },
  'serenata-suave': { title: 'Serenata suave', subtitle: 'Leve e acolhedora', notes: [196, 246.94, 293.66, 392], speed: 1.9 },
  'calmaria-dourada': { title: 'Calmaria dourada', subtitle: 'Fundo calmo e sofisticado', notes: [174.61, 261.63, 349.23, 392], speed: 2.3 },
  'brisa-do-jardim': { title: 'Brisa do jardim', subtitle: 'Trilha delicada para navegação', notes: [293.66, 349.23, 440, 523.25], speed: 2 },
  'luz-do-entardecer': { title: 'Luz do entardecer', subtitle: 'Ambiente romântico e tranquilo', notes: [233.08, 293.66, 349.23, 466.16], speed: 2.2 }
};

const state = {
  config: null,
  invites: [],
  messages: [],
  gallery: [],
  qrInstance: null,
  giftQrInstance: null,
  selectedGiftIndex: null,
  adminPassword: sessionStorage.getItem('adminPassword') || '',
  adminLoaded: false,
  giftModalOpen: false,
  audioContext: null,
  generatedMusicTimer: null,
  generatedMusicGain: null,
  lastGuestLookup: ''
};

const q = selector => document.querySelector(selector);
const qa = selector => Array.from(document.querySelectorAll(selector));
const clone = value => JSON.parse(JSON.stringify(value));

function assertServerMode() {
  if (window.location.protocol === 'file:') {
    throw new Error('Este site precisa ser executado via servidor local. Rode `python server.py` e acesse http://localhost:8000.');
  }
}

async function fetchJson(url, options = {}) {
  assertServerMode();
  const response = await fetch(url, options);
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    data = { message: text || 'Resposta inválida do servidor.' };
  }
  if (!response.ok) {
    throw new Error(data.message || 'Erro ao processar a requisição.');
  }
  return data;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function currency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function currentInviteHtmlUrl() {
  const url = new URL(window.location.href);
  if (!url.pathname.endsWith('/index.html')) {
    url.pathname = url.pathname.endsWith('/') ? `${url.pathname}index.html` : `${url.pathname}/index.html`;
  }
  return url.toString();
}

function normalizeGuestNamesInput(value) {
  return String(value || '')
    .split(/\n|,|;/)
    .map(item => item.trim())
    .filter(Boolean);
}

function guestNamesSummary(row) {
  const names = Array.isArray(row?.guestNames) ? row.guestNames.filter(Boolean) : [];
  return names.length ? names.join(', ') : 'Nenhum acompanhante cadastrado';
}

function totalPeopleOnInvite(row) {
  const companions = Array.isArray(row?.guestNames) ? row.guestNames.filter(Boolean).length : 0;
  return Math.max(1, companions + 1);
}

function showToast(message, type = 'pending') {
  const toast = document.createElement('div');
  toast.className = `status-pill ${type}`;
  toast.style.position = 'fixed';
  toast.style.left = '50%';
  toast.style.bottom = '24px';
  toast.style.transform = 'translateX(-50%)';
  toast.style.zIndex = '3000';
  toast.style.padding = '0.8rem 1rem';
  toast.style.boxShadow = '0 16px 30px rgba(0,0,0,.12)';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 180ms ease';
    setTimeout(() => toast.remove(), 200);
  }, 2600);
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  // save previously focused element to restore focus on close
  state._previousActiveElement = document.activeElement;

  // mark main content inert (if supported) so assistive tech and focus skip it
  const main = document.querySelector('main');
  if (main) {
    if ('inert' in main) main.inert = true;
    else main.setAttribute('aria-hidden', 'true');
  }

  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');

  // focus dialog for keyboard users
  const dialog = modal.querySelector('.modal-dialog');
  if (dialog) {
    dialog.setAttribute('tabindex', '-1');
    try { dialog.focus(); } catch (e) {}
  }
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  // restore focus to previously focused element before hiding the modal
  try {
    const prev = state._previousActiveElement || document.body;
    if (prev && typeof prev.focus === 'function') prev.focus();
  } catch (e) {}

  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');

  // unmark main content inert/aria-hidden
  const main = document.querySelector('main');
  if (main) {
    if ('inert' in main) main.inert = false;
    else main.removeAttribute('aria-hidden');
  }

  if (!document.querySelector('.modal.show')) {
    document.body.classList.remove('modal-open');
  }
  // cleanup
  delete state._previousActiveElement;
}

function setupModals() {
  qa('[data-close-modal]').forEach(el => el.addEventListener('click', () => closeModal('guestModal')));
  qa('[data-close-ticket]').forEach(el => el.addEventListener('click', () => closeModal('ticketModal')));
  qa('[data-close-gift]').forEach(el => el.addEventListener('click', () => closeModal('giftModal')));
  qa('[data-close-upload]').forEach(el => el.addEventListener('click', () => closeModal('uploadModal')));
  qa('[data-close-admin-login]').forEach(el => el.addEventListener('click', () => closeModal('adminLoginModal')));
  qa('[data-close-admin-panel]').forEach(el => el.addEventListener('click', () => closeModal('adminPanelModal')));

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      qa('.modal.show').forEach(modal => closeModal(modal.id));
    }
  });
}

function setupNavigation() {
  const nav = q('#main-nav');
  const navToggle = q('#navToggle');
  const navLinks = q('#navLinks');
  navToggle?.addEventListener('click', () => navLinks.classList.toggle('open'));
  qa('#navLinks a').forEach(link => link.addEventListener('click', () => navLinks.classList.remove('open')));
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 18);
    q('#backToTop')?.classList.toggle('show', window.scrollY > 420);
  });
  q('#backToTop')?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

function setupAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('animate-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  qa('.animate-fade-in, .animate-slide-in').forEach(el => observer.observe(el));
}

function createPetals() {
  const container = q('#petals-container');
  if (!container) return;
  if (state.config?.animation?.enabled === false) {
    container.innerHTML = '';
    return;
  }
  const configured = Number(state.config?.animation?.density || 24);
  const total = window.innerWidth < 768 ? Math.max(6, Math.round(configured * 0.6)) : configured;
  const symbol = state.config?.animation?.symbol || '❦';
  container.innerHTML = '';
  for (let index = 0; index < total; index += 1) {
    const petal = document.createElement('span');
    petal.textContent = symbol;
    petal.style.left = `${Math.random() * 100}%`;
    petal.style.fontSize = `${Math.random() * 18 + 14}px`;
    petal.style.animationDuration = `${Math.random() * 10 + 8}s`;
    petal.style.animationDelay = `${Math.random() * 8}s`;
    petal.style.opacity = `${Math.random() * 0.8 + 0.1}`;
    container.appendChild(petal);
  }
}

function setText(selector, value) {
  const el = q(selector);
  if (el) el.textContent = value || '';
}

function setValue(selector, value) {
  const el = q(selector);
  if (el) el.value = value ?? '';
}

function setChecked(selector, value) {
  const el = q(selector);
  if (el) el.checked = Boolean(value);
}

function applyTheme() {
  const theme = state.config?.theme;
  const branding = state.config?.branding;
  if (!theme) return;
  const root = document.documentElement;
  const map = {
    bg: '--bg',
    bgSoft: '--bg-soft',
    paper: '--paper',
    paperStrong: '--paper-strong',
    text: '--text',
    textSoft: '--text-soft',
    accent: '--accent',
    accentDark: '--accent-dark',
    accentDeep: '--accent-deep',
    accentSoft: '--accent-soft',
    goldSoft: '--gold-soft'
  };
  Object.entries(map).forEach(([key, cssVar]) => {
    if (theme[key]) root.style.setProperty(cssVar, theme[key]);
  });
  const hero = q('.hero');
  if (hero) hero.style.background = `linear-gradient(135deg, ${theme.heroGradientStart} 0%, ${theme.heroGradientMiddle} 42%, ${theme.heroGradientEnd} 100%)`;
  const overlay = q('#heroOverlay');
  if (overlay && branding?.heroBackgroundUrl) overlay.style.backgroundImage = `url("${branding.heroBackgroundUrl}")`;
}

function renderBrandSlot(slot, compact = false) {
  if (!slot || !state.config) return;
  const branding = state.config.branding || {};
  const initials = escapeHtml((branding.monogramInitials || 'IF').toUpperCase());
  const subtitle = escapeHtml(branding.logoSubtitle || '');
  if (branding.logoMode === 'image' && branding.logoUrl) {
    slot.innerHTML = `<img class="brand-logo ${compact ? 'compact-logo' : ''}" src="${escapeHtml(branding.logoUrl)}" alt="Logo do evento" />`;
    return;
  }
  slot.innerHTML = `
    <div class="monogram-logo ${escapeHtml(branding.monogramTemplate || 'luxury-script')}" style="--logo-primary:${escapeHtml(branding.logoPrimaryColor || '#111')};--logo-accent:${escapeHtml(branding.logoAccentColor || '#3f8a17')};--logo-bg:${escapeHtml(branding.logoBackgroundColor || '#fff')}">
      <strong>${initials}</strong>
      ${compact ? '' : `<small>${subtitle}</small>`}
    </div>`;
}

function renderBranding() {
  renderBrandSlot(q('#navBrandSlot'), true);
  renderBrandSlot(q('#heroBrandSlot'));
  renderBrandSlot(q('#footerBrandSlot'));
  renderBrandSlot(q('#ticketBrandSlot'), true);
  setText('#navBrandText', state.config?.branding?.monogramInitials || 'I & F');
}

function renderTimeline() {
  const host = q('#timelineContainer');
  const items = state.config?.story?.items || [];
  if (!host) return;
  host.innerHTML = items.map((item, index) => `
    <article class="timeline-item ${index % 2 ? 'right' : ''} animate-fade-in">
      <div class="timeline-img-wrap"><img src="${escapeHtml(item.imageUrl || '')}" alt="${escapeHtml(item.title || 'Momento da história')}" loading="lazy" /></div>
      <div class="timeline-content">
        <span>${escapeHtml(item.year || '')}</span>
        <h3>${escapeHtml(item.title || '')}</h3>
        <p>${escapeHtml(item.description || '')}</p>
      </div>
    </article>`).join('');
  setupAnimations();
}

function renderCouple() {
  const couple = state.config?.couple || {};
  setText('#fernandaNameLabel', couple.fernandaName);
  setText('#fernandaRoleLabel', couple.fernandaRole);
  setText('#fernandaBioLabel', couple.fernandaBio);
  setText('#igoNameLabel', couple.igoName);
  setText('#igoRoleLabel', couple.igoRole);
  setText('#igoBioLabel', couple.igoBio);
  if (q('#fernandaPhoto')) q('#fernandaPhoto').src = couple.fernandaImageUrl || 'images/fernanda.jpg';
  if (q('#igoPhoto')) q('#igoPhoto').src = couple.igoImageUrl || 'images/igo.jpeg';
}

function stopGeneratedMusic() {
  if (state.generatedMusicTimer) clearInterval(state.generatedMusicTimer);
  state.generatedMusicTimer = null;
  if (state.generatedMusicGain) {
    state.generatedMusicGain.gain.setTargetAtTime(0, state.audioContext?.currentTime || 0, 0.04);
    state.generatedMusicGain = null;
  }
}

function stopSiteMusic() {
  const audio = q('#siteMusic');
  if (audio) audio.pause();
  stopGeneratedMusic();
  q('#musicToggleBtn i')?.classList.replace('fa-pause', 'fa-play');
}

function playGeneratedPreset() {
  const media = state.config?.media || {};
  const preset = MUSIC_PRESETS[media.preset] || MUSIC_PRESETS['instrumental-romantico'];
  state.audioContext = state.audioContext || new (window.AudioContext || window.webkitAudioContext)();
  const ctx = state.audioContext;
  stopGeneratedMusic();
  const gain = ctx.createGain();
  gain.gain.value = Math.max(0.3, Math.min(1.0, Number(media.volume || 0.6))) * 6.0;
  gain.connect(ctx.destination);
  state.generatedMusicGain = gain;
  let index = 0;
  const playNote = () => {
    const osc = ctx.createOscillator();
    const noteGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = preset.notes[index % preset.notes.length];
    noteGain.gain.setValueAtTime(0, ctx.currentTime);
    noteGain.gain.linearRampToValueAtTime(1.0, ctx.currentTime + 0.08);
    noteGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + preset.speed * 0.9);
    osc.connect(noteGain).connect(gain);
    osc.start();
    osc.stop(ctx.currentTime + preset.speed);
    index += 1;
  };
  playNote();
  state.generatedMusicTimer = setInterval(playNote, preset.speed * 1000);
  q('#musicToggleBtn i')?.classList.replace('fa-play', 'fa-pause');
}

async function playSiteMusic() {
  const media = state.config?.media || {};
  if (!media.enabled) return;
  const audio = q('#siteMusic');
  stopGeneratedMusic();
  if (media.mode === 'file' && media.audioUrl && audio) {
    audio.src = media.audioUrl;
    audio.volume = Math.max(0, Math.min(1, Number(media.volume || 0.6)));
    await audio.play();
    q('#musicToggleBtn i')?.classList.replace('fa-play', 'fa-pause');
    return;
  }
  playGeneratedPreset();
}

function applyMedia() {
  const media = state.config?.media || {};
  const preset = MUSIC_PRESETS[media.preset] || {};
  const widget = q('#musicWidget');
  if (widget) widget.hidden = !media.enabled;
  setText('#musicTitleLabel', media.title || preset.title || 'Trilha do casal');
  setText('#musicSubtitleLabel', media.subtitle || preset.subtitle || 'Instrumental romântico');
  const audio = q('#siteMusic');
  if (audio) {
    audio.loop = true;
    audio.volume = Math.max(0, Math.min(1, Number(media.volume || 0.6)));
    audio.src = media.mode === 'file' ? (media.audioUrl || '') : '';
  }
  if (media.enabled && media.autoplay && !window.__musicAutoplayArmed) {
    window.__musicAutoplayArmed = true;
    const startAfterInteraction = async () => {
      document.removeEventListener('pointerdown', startAfterInteraction);
      document.removeEventListener('keydown', startAfterInteraction);
      try {
        await playSiteMusic();
      } catch (error) {
        q('#musicToggleBtn i')?.classList.replace('fa-pause', 'fa-play');
      }
    };
    document.addEventListener('pointerdown', startAfterInteraction, { once: true });
    document.addEventListener('keydown', startAfterInteraction, { once: true });
  }
}

function applyConfig() {
  if (!state.config) return;
  const { event, payment, gifts } = state.config;
  applyTheme();
  renderBranding();
  q('#heroPre').textContent = event.heroPre;
  q('#heroCoupleNames').innerHTML = escapeHtml(event.coupleNames).replace('&amp;', '&').replace('&', '<span class="heart-amp">&amp;</span>');
  q('#heroDateLabel').textContent = event.dateDisplay;
  q('#heroLocationLabel').textContent = event.locationAddress;
  q('#ceremonyAddress').textContent = event.locationName;
  q('#ceremonyTime').innerHTML = '<i class="fas fa-clock"></i> ' + escapeHtml(event.dateDisplay.split(' às ')[1] || event.dateDisplay);
  q('#ceremonyFullAddress').textContent = event.locationAddress;
  q('#dressCodeLabel').textContent = event.dressCode;
  q('#locationName').textContent = event.locationName;
  q('#locationAddress').textContent = event.locationAddress;
  q('#mapsButtonLink').href = event.mapsUrl;
  q('#mapFrame').src = event.mapEmbedUrl;
  q('#ticketCoupleName').textContent = event.coupleNames;
  q('#ticketDateTimeLabel').textContent = event.dateDisplay;
  q('#ticketLocationLabel').textContent = event.locationAddress;
  q('#ticketFooterText').textContent = event.footerText;
  setText('#heroNote', event.heroNote);
  setText('#storyPre', event.storyPre);
  setText('#storyTitle', event.storyTitle);
  setText('#storyIntro', event.storyIntro);
  setText('#ceremonyPre', event.ceremonyPre);
  setText('#ceremonyTitle', event.ceremonyTitle);
  setText('#locationPre', event.locationPre);
  setText('#locationTitle', event.locationTitle);
  setText('#giftsPre', event.giftsPre);
  setText('#giftsTitle', event.giftsTitle);
  setText('#giftsDescription', event.giftsDescription);
  setText('#galleryPre', event.galleryPre);
  setText('#galleryTitle', event.galleryTitle);
  setText('#galleryDescription', event.galleryDescription);
  setText('#messagesPre', event.messagesPre);
  setText('#messagesTitle', event.messagesTitle);
  setText('#messagesDescription', event.messagesDescription);
  setText('#footerQuote', event.footerQuote);
  setText('#dressCodeHintLabel', event.dressCodeHint);
  renderCouple();
  renderTimeline();
  renderGiftHighlights(gifts);
  renderGiftOptions(gifts, payment);
  applyMedia();
  createPetals();
  startCountdown(event.eventDateIso);
  // aplicar textos fixos customizados, se houver
  applyFixedTexts();
}

function renderGiftHighlights(gifts) {
  const host = q('#giftHighlights');
  if (!host) return;
  host.innerHTML = gifts.slice(0, 8).map((gift, index) => `
    <div class="gift-mini-item" data-gift-index="${index}">
      ${gift.imageUrl ? `<img class="gift-mini-thumb" src="${escapeHtml(gift.imageUrl)}" alt="${escapeHtml(gift.title)}" loading="lazy" />` : `<span class="gift-mini-icon"><i class="fas ${escapeHtml(gift.icon || 'fa-gift')}"></i></span>`}
      <div class="gift-mini-info">
        <strong>${escapeHtml(gift.title)}</strong>
        <span class="gift-mini-price">${currency(gift.price)}</span>
      </div>
    </div>
  `).join('');

  // abrir o modal do presente ao clicar no item resumido
  host.querySelectorAll('.gift-mini-item').forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      const idx = Number(el.dataset.giftIndex || 0);
      state.selectedGiftIndex = idx;
      state.giftModalIsolated = true; // abrir modal apenas com o presente selecionado
      renderGiftOptions(state.config.gifts);
      renderGiftPayment();
      openModal('giftModal');
    });
  });
}


function renderGiftOptions(gifts) {
  const host = q('#giftOptions');
  if (!host) return;
  // se estiver em modo isolado (abrir a partir da lista principal), renderizar apenas o presente selecionado
  if (state.giftModalIsolated && Number.isFinite(state.selectedGiftIndex) && gifts[state.selectedGiftIndex]) {
    const gift = gifts[state.selectedGiftIndex];
    host.innerHTML = `
      <div class="gift-single-view">
        <button class="btn btn-soft" type="button" id="giftBackBtn"><i class="fas fa-arrow-left"></i> Voltar</button>
        <div class="gift-single-card">
          ${gift.imageUrl ? `<img class="gift-single-thumb" src="${escapeHtml(gift.imageUrl)}" alt="${escapeHtml(gift.title)}" loading="lazy" />` : `<span class="gift-single-icon"><i class="fas ${escapeHtml(gift.icon || 'fa-gift')} fa-2x"></i></span>`}
          <div class="gift-single-body">
            <h3>${escapeHtml(gift.title)}</h3>
            <p>${escapeHtml(gift.description)}</p>
            <div class="gift-price">${currency(gift.price)}</div>
          </div>
        </div>
      </div>
    `;
    const back = q('#giftBackBtn');
    if (back) back.addEventListener('click', () => {
      // fechar modal e voltar para a seção de presentes na página principal
      closeModal('giftModal');
      // limpar estado isolado
      state.giftModalIsolated = false;
      state.selectedGiftIndex = null;
      // navegar para a seção de presentes
      const target = q('#presentes');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // atualizar hash para #presentes
      try { history.replaceState(null, '', location.pathname + location.search + '#presentes'); } catch (e) {}
    });
  } else {
    host.innerHTML = gifts.map((gift, index) => `
      <button class="gift-option ${state.selectedGiftIndex === index ? 'active' : ''}" type="button" data-gift-index="${index}">
        ${gift.imageUrl ? `<img class="gift-option-thumb" src="${escapeHtml(gift.imageUrl)}" alt="" loading="lazy" />` : `<span class="gift-option-icon"><i class="fas ${escapeHtml(gift.icon || 'fa-gift')}'></i></span>`}
        <div class="gift-option-header">
          <div>
            <h4>${escapeHtml(gift.title)}</h4>
            <p>${escapeHtml(gift.description)}</p>
          </div>
          <span class="gift-price">${currency(gift.price)}</span>
        </div>
      </button>
    `).join('');
  }

  qa('.gift-option').forEach(button => {
    button.addEventListener('click', () => {
      state.selectedGiftIndex = Number(button.dataset.giftIndex);
      renderGiftOptions(state.config.gifts);
      renderGiftPayment();
    });
  });

  renderGiftPayment();
}

function renderGiftPayment() {
  const panel = q('#giftPaymentPanel');
  if (!panel || !state.config) return;
  const gift = state.config.gifts[state.selectedGiftIndex];
  if (!gift) {
    panel.innerHTML = `
      <div class="empty-state compact">
        <i class="fas fa-gift"></i>
        <p>Selecione um presente para visualizar os detalhes de pagamento.</p>
      </div>`;
    return;
  }
  const payment = state.config.payment || {};
  const cardLink = (gift.mercadoPagoLink?.trim() || payment?.mercadoPagoLink?.trim() || '');
  panel.innerHTML = `
    <div class="payment-card">
      <div class="payment-gift-image-container">
        ${gift.imageUrl ? `<img class="payment-gift-image" src="${escapeHtml(gift.imageUrl)}" alt="${escapeHtml(gift.title)}" />` : `<div class="payment-gift-image-fallback"><div class="brand-slot-large" id="paymentCardBrandSlot"></div></div>`}
      </div>
      <span class="gift-badge">Presente selecionado</span>
      <h3>${escapeHtml(gift.title)}</h3>
      <p class="gift-description">${escapeHtml(gift.description)}</p>
      <div class="gift-price-highlight">${currency(gift.price)}</div>
      <div class="payment-actions">
        <button class="btn btn-primary btn-full ${cardLink ? '' : 'disabled'}" type="button" id="payWithCardBtn" ${cardLink ? '' : 'disabled'}>
          <i class="fas fa-credit-card"></i> Pagar com Cartão
        </button>
        <button class="btn btn-pix btn-full" type="button" id="payWithPixBtn">
          <i class="fas fa-barcode"></i> Pagar com PIX
        </button>
      </div>
      <!-- payment details removed: Pix key, card link and QR preview are intentionally hidden; buttons above handle actions -->
    </div>
  `;
  if (!gift.imageUrl) {
    renderBrandSlot(q('#paymentCardBrandSlot'));
  }
  q('#payWithCardBtn')?.addEventListener('click', () => {
    if (!cardLink) {
      showToast('Cadastre o link do cartão para este presente.', 'declined');
      return;
    }
    window.open(cardLink, '_blank', 'noopener,noreferrer');
  });
  q('#payWithPixBtn')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(payment.pixKey || '');
      showToast('Chave Pix atual copiada com sucesso.', 'confirmed');
    } catch (error) {
      showToast('Não foi possível copiar automaticamente a chave Pix.', 'declined');
    }
  });
  // payment details removed — QR rendering skipped (buttons handle actions)
}

function renderPixQr(gift) {
  const holder = q('#pixQrPreview');
  if (!holder || !state.config) return;
  holder.innerHTML = '';
  const payment = state.config.payment || {};
  const payload = (payment.pixPayload || '').trim() || `Chave Pix: ${payment.pixKey}\nValor: ${currency(gift.price)}\nPresente: ${gift.title}`;
  if (state.giftQrInstance) state.giftQrInstance = null;
  state.giftQrInstance = new QRCode(holder, {
    text: payload,
    width: 150,
    height: 150,
    colorDark: '#31402c',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.H
  });
}

function renderGallery() {
  const host = q('#galleryGrid');
  if (!host) return;
  const allItems = [...state.gallery];
  q('#galleryCounter').textContent = `${allItems.length} arquivos compartilhados`;
  if (!allItems.length) {
    host.innerHTML = '<div class="empty-state"><i class="fas fa-image"></i><p>Nenhum arquivo compartilhado ainda.</p></div>';
    return;
  }
  host.innerHTML = allItems.map(item => {
    const badge = escapeHtml(item.uploader || 'Convidado');
    const typeIcon = item.type === 'video' ? 'fa-video' : 'fa-image';
    if (item.type === 'video') {
      return `
        <article class="gallery-item animate-fade-in">
          <video controls preload="metadata" src="${escapeHtml(item.url)}"></video>
          <span class="gallery-type"><i class="fas ${typeIcon}"></i></span>
          <span class="gallery-badge">${badge}</span>
        </article>`;
    }
    return `
      <article class="gallery-item animate-fade-in">
        <img src="${escapeHtml(item.url)}" alt="Registro compartilhado por ${badge}" loading="lazy" />
        <span class="gallery-type"><i class="fas ${typeIcon}"></i></span>
        <span class="gallery-badge">${badge}</span>
      </article>`;
  }).join('');
  setupAnimations();
}

function renderGalleryAdminPreview() {
  const host = q('#galleryAdminPreview');
  if (!host) return;
  if (!state.gallery.length) {
    host.innerHTML = '<div class="empty-state"><i class="fas fa-image"></i><p>Nenhuma foto adicionada à galeria ainda.</p></div>';
    return;
  }
  host.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
      <label style="font-weight:600"><input type="checkbox" id="gallerySelectAllCheckbox" /> Selecionar tudo</label>
      <small style="color:var(--muted);">Marque os itens que deseja incluir no ZIP</small>
    </div>
  ` + state.gallery.map(item => {
    const badge = escapeHtml(item.uploader || 'Administrador');
    const checkbox = `<input type="checkbox" class="gallery-select-checkbox" data-gallery-id="${escapeHtml(item.id)}" />`;
    if (item.type === 'video') {
      return `
        <div class="gallery-admin-card">
          <div class="gallery-admin-select">${checkbox}</div>
          <video controls preload="metadata" src="${escapeHtml(item.url)}"></video>
          <button type="button" class="gallery-admin-delete" data-gallery-action="delete" data-gallery-id="${escapeHtml(item.id)}" title="Excluir item"><i class="fas fa-trash"></i></button>
          <span class="gallery-admin-badge">${badge}</span>
        </div>`;
    }
    return `
      <div class="gallery-admin-card">
        <div class="gallery-admin-select">${checkbox}</div>
        <img src="${escapeHtml(item.url)}" alt="Foto da galeria" loading="lazy" />
        <button type="button" class="gallery-admin-delete" data-gallery-action="delete" data-gallery-id="${escapeHtml(item.id)}" title="Excluir foto"><i class="fas fa-trash"></i></button>
        <span class="gallery-admin-badge">${badge}</span>
      </div>`;
  }).join('');
}

// handler: selecionar tudo na pré-visualização admin
document.addEventListener('change', event => {
  const el = event.target;
  if (el && el.id === 'gallerySelectAllCheckbox') {
    const checked = Boolean(el.checked);
    Array.from(document.querySelectorAll('.gallery-select-checkbox')).forEach(cb => cb.checked = checked);
  }
});

q('#cfgGalleryDownloadSelectedBtn')?.addEventListener('click', async () => {
  try {
    if (!state.adminPassword) {
      showToast('Digite a senha do administrador e entre no painel antes de baixar.', 'declined');
      return;
    }
    const selected = Array.from(document.querySelectorAll('.gallery-select-checkbox:checked')).map(cb => cb.dataset.galleryId).filter(Boolean);
    if (!selected.length) {
      showToast('Nenhum item selecionado.', 'declined');
      return;
    }
    const res = await fetch('/api/admin/gallery/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Password': state.adminPassword },
      body: JSON.stringify({ ids: selected }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt || 'Falha ao gerar o arquivo ZIP.');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'galeria-selecionada.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Download iniciado.', 'confirmed');
  } catch (error) {
    showToast(error.message || 'Erro ao baixar seleção.', 'declined');
  }
});

function renderMessages() {
  const host = q('#messagesList');
  if (!host) return;
  if (!state.messages.length) {
    host.innerHTML = '<div class="empty-state"><i class="fas fa-heart"></i><p>Nenhuma mensagem enviada ainda.</p></div>';
    return;
  }
  host.innerHTML = state.messages.map(message => `
    <article class="message-item animate-fade-in">
      <h4>${escapeHtml(message.name)}</h4>
      <p>${escapeHtml(message.message)}</p>
      <div class="message-meta">${escapeHtml(formatDate(message.createdAt))}</div>
    </article>
  `).join('');
  setupAnimations();
}

function renderMessagesAdminList() {
  const host = q('#messagesAdminList');
  if (!host) return;
  if (!state.messages.length) {
    host.innerHTML = '<div class="empty-state"><i class="fas fa-envelope"></i><p>Nenhuma mensagem disponível para editar.</p></div>';
    return;
  }
  host.innerHTML = state.messages.map((message, index) => `
    <article class="stack-item" data-message-id="${escapeHtml(message.id || String(index))}">
      <div class="stack-item-head">
        <strong>Recado ${index + 1}</strong>
        <button class="icon-btn" type="button" data-message-action="delete" title="Excluir mensagem"><i class="fas fa-trash"></i></button>
      </div>
      <div class="admin-form-grid two-columns">
        <label>Nome do remetente<input data-message-field="name" type="text" value="${escapeHtml(message.name)}" /></label>
        <label>Data<input type="text" value="${escapeHtml(formatDate(message.createdAt))}" readonly /></label>
        <label class="full-span">Mensagem<textarea data-message-field="message" rows="4">${escapeHtml(message.message)}</textarea></label>
      </div>
    </article>
  `).join('');
}

function startCountdown(dateIso) {
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return;

  const tick = () => {
    const diff = date.getTime() - Date.now();
    const total = Math.max(0, diff);
    const seconds = Math.floor(total / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    q('#days').textContent = String(days).padStart(2, '0');
    q('#hours').textContent = String(hours).padStart(2, '0');
    q('#minutes').textContent = String(minutes).padStart(2, '0');
  };
  tick();
  if (window.__countdownTimer) clearInterval(window.__countdownTimer);
  window.__countdownTimer = setInterval(tick, 1000);
}

function buildStatusPill(status) {
  const map = {
    pendente: { className: 'pending', icon: 'fa-hourglass-half', label: 'Aguardando resposta' },
    confirmado: { className: 'confirmed', icon: 'fa-circle-check', label: 'Confirmado' },
    recusado: { className: 'declined', icon: 'fa-heart-crack', label: 'Não confirmado' }
  };
  const current = map[status] || map.pendente;
  return `<span class="status-pill ${current.className}"><i class="fas ${current.icon}"></i>${current.label}</span>`;
}

function buildLookupResult(row) {
  const isConfirmed = row.confirmation === 'confirmado';
  const canOpen = isConfirmed;
  const guestNamesValue = Array.isArray(row.guestNames) ? row.guestNames.join('\n') : '';
  // codificar JSON do convite em base64 para evitar problemas de parsing/escape no HTML
  let encoded = '';
  try {
    encoded = typeof window.btoa === 'function' ? btoa(unescape(encodeURIComponent(JSON.stringify(row)))) : '';
  } catch (e) {
    encoded = '';
  }

  return `
    <div class="result-card" data-invite-code="${escapeHtml(row.inviteCode)}" data-registered-by="${escapeHtml(row.registeredBy || row.name || '')}" data-confirmed="${isConfirmed ? '1' : '0'}">
      <div>
        <h3>${escapeHtml(row.registeredBy || row.name || 'Convidado')}</h3>
        <p>Encontramos o convite. Informe os nomes dos acompanhantes para salvar e gerar o convite.</p>
      </div>
      <div class="result-meta">
        <div class="meta-box"><span>Nome localizado</span><strong>${escapeHtml(row.name || 'Convidado')}</strong></div>
        <div class="meta-box"><span>Quantidade de Convidados</span>
          <div class="qty-control">
            <button type="button" class="qty-btn qty-decrease" ${isConfirmed ? 'disabled' : ''}>−</button>
            <input type="number" class="lookup-count-input" data-attending-count min="1" max="30" value="${escapeHtml(String(row.attendingCount || totalPeopleOnInvite(row)))}" ${isConfirmed ? 'disabled' : ''} />
            <button type="button" class="qty-btn qty-increase" ${isConfirmed ? 'disabled' : ''}>+</button>
          </div>
        </div>
        <div class="meta-box"><span>Status</span><strong>${row.confirmation === 'confirmado' ? 'Presença confirmada' : row.confirmation === 'recusado' ? 'Ausência informada' : 'Aguardando resposta'}</strong></div>
      </div>
      <label class="lookup-guests-label">
        <span>Nomes dos convidados acompanhantes</span>
        <div class="lookup-names-list" data-guest-names-list></div>
        <textarea class="lookup-guests-input" data-guest-names rows="4" placeholder="Ou digite um nome por linha (alternativa)">${escapeHtml(guestNamesValue)}</textarea>
      </label>
      
      ${isConfirmed ? `<div class="lookup-contact-note">Se precisar alterar convidados ou cancelar, entre em contato com Igo ou Fernanda.</div>` : ''}
      <div>${buildStatusPill(row.confirmation)}</div>
      <div class="result-actions">
      <button class="btn btn-primary" type="button" data-result-action="confirm" ${isConfirmed ? 'disabled' : ''}><i class="fas fa-circle-check"></i> Confirmar presença</button>
        <button class="btn btn-soft" type="button" data-result-action="decline" ${isConfirmed ? 'disabled' : ''}><i class="fas fa-heart-crack"></i> Não poderei ir</button>
        ${canOpen ? '<button class="btn btn-soft" type="button" data-result-action="open-ticket"><i class="fas fa-id-card"></i> Abrir convite</button>' : ''}
      </div>
      <script type="application/json" class="invite-json" data-enc="${encoded}"></script>
    </div>`;
}

function setupGuestNameInputs(card) {
  if (!card) return;
  const countInput = card.querySelector('[data-attending-count]');
  const namesContainer = card.querySelector('[data-guest-names-list]');
  const textarea = card.querySelector('[data-guest-names]');
  if (!countInput || !namesContainer) return;
  const count = Math.max(1, Math.min(30, Number(countInput.value || 1)));
  const existing = Array.from(card.querySelectorAll('[data-guest-name-input]')).map(el => el.value.trim()).filter(Boolean);
  let html = '';
  for (let i = 0; i < count; i += 1) {
    const value = escapeHtml(existing[i] || (i === 0 ? (card.querySelector('h3')?.textContent || '') : ''));
    const disabled = card.dataset && card.dataset.confirmed === '1' ? 'disabled' : '';
    html += `<label class="mini-name-input"><span>Nome ${i + 1}</span><input type="text" data-guest-name-input data-guest-name-index="${i}" value="${value}" maxlength="80" ${disabled} /></label>`;
  }
  namesContainer.innerHTML = html;
  textarea.style.display = 'none';
  // substituir handler para evitar múltiplas ligações
  countInput.oninput = () => {
    setupGuestNameInputs(card);
  };
  // botões de aumentar/diminuir quantidade
  const decBtn = card.querySelector('.qty-decrease');
  const incBtn = card.querySelector('.qty-increase');
  if (decBtn) {
    decBtn.onclick = () => {
      if (countInput.disabled) return;
      const v = Math.max(1, Number(countInput.value || 1) - 1);
      countInput.value = v;
      countInput.oninput && countInput.oninput();
    };
  }
  if (incBtn) {
    incBtn.onclick = () => {
      if (countInput.disabled) return;
      const v = Math.min(30, Number(countInput.value || 1) + 1);
      countInput.value = v;
      countInput.oninput && countInput.oninput();
    };
  }
  if (card.dataset && card.dataset.confirmed === '1') {
    countInput.disabled = true;
  }
}

async function lookupInvite(nameQuery, target) {
  const query = nameQuery.trim();
  if (!query) {
    target.innerHTML = '<div class="empty-state compact"><i class="fas fa-circle-exclamation"></i><p>Digite o seu primeiro nome para localizar o convite.</p></div>';
    return;
  }
  state.lastGuestLookup = query;
  target.innerHTML = '<div class="empty-state compact"><i class="fas fa-spinner fa-spin"></i><p>Localizando nome do convidado...</p></div>';
  try {
    const result = await fetchJson(`/api/invite-search/${encodeURIComponent(query)}`);
    const matches = Array.isArray(result.matches) ? result.matches : [];
    if (!matches.length) {
      // fallback: se o usuário digitou apenas dígitos, tentar localizar por código do convite
      if (/^\d+$/.test(query)) {
        try {
          const byCode = await fetchJson(`/api/invite/${encodeURIComponent(query)}`);
          if (byCode && byCode.invite) {
            target.innerHTML = buildLookupResult(byCode.invite);
            Array.from(target.querySelectorAll('.result-card')).forEach(card => setupGuestNameInputs(card));
            return;
          }
        } catch (e) {
          // continuar para exibir mensagem padrão
        }
      }
      target.innerHTML = '<div class="empty-state compact"><i class="fas fa-circle-exclamation"></i><p>Nome do convidado não encontrado. Digite o seu primeiro nome.</p></div>';
      return;
    }
    target.innerHTML = matches.map(buildLookupResult).join('');
    // inicializar inputs de nomes para cada cartão retornado
    Array.from(target.querySelectorAll('.result-card')).forEach(card => setupGuestNameInputs(card));
  } catch (error) {
    target.innerHTML = `<div class="empty-state compact"><i class="fas fa-circle-exclamation"></i><p>${escapeHtml(error.message)}</p></div>`;
  }
}

async function respondRsvp(code, response, card) {
  // coletar nomes a partir dos inputs individuais, ou fallback para textarea
  let guestNames = [];
  const nameInputs = card ? Array.from(card.querySelectorAll('[data-guest-name-input]')) : [];
  if (nameInputs && nameInputs.length) {
    guestNames = nameInputs.map(i => String(i.value || '').trim()).filter(Boolean);
  } else {
    guestNames = normalizeGuestNamesInput(card?.querySelector('[data-guest-names]')?.value || '');
  }
  const attendingCount = Number(card?.querySelector('[data-attending-count]')?.value || (guestNames.length + 1));
  const result = await fetchJson('/api/rsvp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      inviteCode: code,
      response,
      guestNames,
      attendingCount,
      registeredBy: state.lastGuestLookup || card?.querySelector('h3')?.textContent || '',
      contact: card?.querySelector('[data-contact-input]')?.value?.trim() || (card?.querySelector('h3')?.textContent ? '' : '')
    })
  });
  showToast(result.message || 'Resposta registrada com sucesso.', response === 'confirmado' ? 'confirmed' : 'pending');
  try {
    result.invite.attendingCount = attendingCount;
    // também refletir a quantidade informada no campo visível para o admin / preview
    result.invite.guestCount = attendingCount;
  } catch (e) {}
  // se confirmado, guardar o inviteCode para permitir reabrir o convite posteriormente
  try {
    if (result.invite && result.invite.confirmation === 'confirmado' && result.invite.inviteCode) {
      // manter apenas registro, sem criar botão redundante (abrir convite já disponível no fluxo)
      sessionStorage.setItem('lastInviteCode', String(result.invite.inviteCode));
    }
  } catch (e) {}
  // se o painel admin estiver aberto nesta sessão, atualizar o estado local e tabela
  try {
    if (state.adminLoaded && Array.isArray(state.invites) && result.invite) {
      const idx = state.invites.findIndex(item => (item.id && result.invite.id && item.id === result.invite.id) || (item.inviteCode && result.invite.inviteCode && item.inviteCode === result.invite.inviteCode));
      if (idx >= 0) {
        state.invites[idx] = clone(result.invite);
      } else {
        // fallback: procurar por id se não houver inviteCode
        state.invites = state.invites.map(item => (item.id === result.invite.id ? clone(result.invite) : item));
      }
      renderInviteTable();
    }
  } catch (e) {}
  if (q('#lookupResult')) {
    q('#lookupResult').innerHTML = buildLookupResult(result.invite);
    // recriar inputs no resultado atualizado
    const card = q('#lookupResult').querySelector('.result-card');
    if (card) setupGuestNameInputs(card);
  }
  // mostrar resultado no espaço de feedback do modal
  const guestFeedbackHost = q('#guestModalFeedback');
  if (guestFeedbackHost) {
    guestFeedbackHost.innerHTML = buildLookupResult(result.invite);
    const fbCard = guestFeedbackHost.querySelector('.result-card');
    if (fbCard) setupGuestNameInputs(fbCard);
  }
  if (result.invite.confirmation === 'confirmado') {
    openTicket(result.invite);
  }
  // se recusado, mostrar mensagem de agradecimento temporária no feedback do modal
  if (response === 'recusado') {
    const message = `Que pena, ficamos tristes, mas compreendemos. Agradecemos seu carinho e queremos que saiba que você é muito especial para nós. ❤️`;
    const bannerHtml = `<div class="declined-banner" style="background:#fdecea;color:#6b1414;border:1px solid #f5c2c7;padding:14px;border-radius:10px;margin:10px 0;font-weight:600">${escapeHtml(message)}</div>`;
    try {
      if (guestFeedbackHost) {
        // inserir banner no topo apenas no host de feedback do modal
        guestFeedbackHost.insertAdjacentHTML('afterbegin', bannerHtml);
        // remover o banner automaticamente após alguns segundos
        setTimeout(() => {
          try {
            const b = guestFeedbackHost.querySelector('.declined-banner');
            if (b) b.remove();
          } catch (e) {}
        }, 6000);
      }
    } catch (e) {}
  }
}

function openTicket(row) {
  if (!state.config) return;
  q('#cardGuestName').textContent = row.registeredBy || row.name || 'Convidado';
  // colocar nomes um por linha no convite
  const names = Array.isArray(row.guestNames) && row.guestNames.length ? row.guestNames : [];
  q('#cardInviteCode').innerHTML = names.length ? names.map(n => escapeHtml(n)).join('<br/>') : guestNamesSummary(row);
  const totalCount = Number(row.attendingCount || totalPeopleOnInvite(row));
  q('#cardGuestCount').textContent = String(totalCount);
  const tableNumber = (row.tableNumber || '').trim();
  q('#cardTableNumber').textContent = tableNumber || '—';
  q('#cardTableNumberRow').style.display = tableNumber ? 'block' : 'none';
  q('#cardPasswords').innerHTML = (row.passwords || []).map(item => `<span>${escapeHtml(item.label)} - ${escapeHtml(item.code)}</span>`).join('');
  const qrContainer = q('#ticketQrCode');
  qrContainer.innerHTML = '';
  const payload = JSON.stringify({
    casal: state.config.event.coupleNames,
    codigoInterno: row.inviteCode,
    convidado: row.registeredBy || row.name,
    acompanhantes: Array.isArray(row.guestNames) ? row.guestNames : [],
    totalPessoas: totalCount,
    status: row.confirmation,
    senhas: (row.passwords || []).map(item => item.code)
  });
  state.qrInstance = new QRCode(qrContainer, {
    text: payload,
    width: 180,
    height: 180,
    colorDark: '#31402c',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.H
  });
  // atualizar badge de status no modal
  const statusBadge = q('.ticket-card .status-badge') || q('.status-badge');
  if (statusBadge) {
    statusBadge.className = 'status-badge ' + (row.confirmation === 'confirmado' ? 'success' : (row.confirmation === 'recusado' ? 'declined' : 'pending'));
    statusBadge.textContent = row.confirmation === 'confirmado' ? 'Presença confirmada' : row.confirmation === 'recusado' ? 'Ausência informada' : 'Aguardando resposta';
  }
  // aviso de contato para alterações de última hora
  const footer = q('#ticketFooterText');
  if (footer) footer.textContent = state.config.event.footerText || '';
  let note = q('#ticketContactNote');
  if (!note) {
    note = document.createElement('p');
    note.id = 'ticketContactNote';
    note.className = 'ticket-contact-note';
    footer.parentNode.appendChild(note);
  }
  note.textContent = row.confirmation === 'confirmado' ? 'Se precisar alterar convidados ou cancelar após a confirmação, entre em contato com Igo ou Fernanda.' : '';
  openModal('ticketModal');
}

async function downloadTicketPdf() {
  const card = q('#printableCard');
  const { jsPDF } = window.jspdf;
  const canvas = await html2canvas(card, { scale: 2, backgroundColor: '#fffdf8' });
  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const ratio = Math.min((pageWidth - 16) / canvas.width, (pageHeight - 16) / canvas.height);
  const width = canvas.width * ratio;
  const height = canvas.height * ratio;
  pdf.addImage(imgData, 'PNG', 8, 8, width, height);
  pdf.save('convite-igo-fernanda.pdf');
}

function wirePublicActions() {
  q('#openGuestLookupBtn')?.addEventListener('click', () => openModal('guestModal'));
  q('#openGiftModalBtn')?.addEventListener('click', () => openModal('giftModal'));
  qa('#openUploadModalBtn, #openUploadModalBtnSecondary').forEach(button => button.addEventListener('click', () => openModal('uploadModal')));
  q('#openAdminLoginBtn')?.addEventListener('click', () => openModal('adminLoginModal'));
  q('#musicToggleBtn')?.addEventListener('click', async () => {
    const audio = q('#siteMusic');
    const isGeneratedPlaying = Boolean(state.generatedMusicTimer);
    const isFilePlaying = audio && !audio.paused;
    if (isGeneratedPlaying || isFilePlaying) {
      stopSiteMusic();
      return;
    }
    try {
      await playSiteMusic();
    } catch (error) {
      showToast('Não foi possível tocar o áudio. Verifique o arquivo ou tente outro modelo.', 'declined');
    }
  });

  q('#audioStopBtn')?.addEventListener('click', () => {
    stopSiteMusic();
    showToast('Áudio parado.', 'confirmed');
  });

  q('#lookupForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    await lookupInvite(q('#lookupCode').value, q('#lookupResult'));
  });
  q('#guestModalForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    await lookupInvite(q('#guestModalCode').value, q('#guestModalFeedback'));
  });

  // Unificado: tratar ações de resultado (confirm, decline, open-ticket) em um único handler
  document.addEventListener('click', async event => {
    const actionButton = event.target.closest('[data-result-action]');
    if (!actionButton) return;
    const action = actionButton.dataset.resultAction;
    const card = actionButton.closest('.result-card');
    const inviteCode = card?.dataset.inviteCode;

    try {
      if (action === 'confirm') {
        await respondRsvp(inviteCode, 'confirmado', card);
        return;
      }
      if (action === 'decline') {
        await respondRsvp(inviteCode, 'recusado', card);
        return;
      }
      if (action === 'open-ticket') {
        if (inviteCode) {
          const result = await fetchJson(`/api/invite/${encodeURIComponent(inviteCode)}`);
          openTicket(result.invite);
          return;
        }
        // fallback: usar JSON embutido no cartão
        if (!card) {
          showToast('Convite não encontrado.', 'declined');
          return;
        }
        const script = card.querySelector('.invite-json');
        if (script) {
          let payload = null;
          // tentar decodificar payload embutido em base64 (data-enc)
          try {
            const enc = script.dataset && script.dataset.enc ? script.dataset.enc : '';
            if (enc) {
              const raw = atob(enc);
              const json = decodeURIComponent(Array.prototype.map.call(raw, c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
              payload = JSON.parse(json);
            }
          } catch (e) {
            payload = null;
          }
          if (!payload) {
            try {
              payload = JSON.parse(script.textContent || script.innerText || '{}');
            } catch (e) {
              payload = null;
            }
          }
          if (payload) {
            openTicket(payload);
          } else {
            showToast('Não foi possível abrir o convite.', 'declined');
          }
        } else {
          showToast('Convite não disponível para abrir.', 'declined');
        }
      }
    } catch (error) {
      showToast(error.message || 'Erro ao processar ação.', 'declined');
    }
  });

  q('#closeTicketBtn')?.addEventListener('click', () => closeModal('ticketModal'));
  q('#downloadPdfBtn')?.addEventListener('click', downloadTicketPdf);

  q('#messageText')?.addEventListener('input', event => {
    q('#charCount').textContent = `${event.target.value.length} / 500`;
  });

  q('#messageForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const name = q('#senderName').value.trim();
    const message = q('#messageText').value.trim();
    if (!name || !message) {
      showToast('Preencha seu nome e a mensagem.', 'declined');
      return;
    }
    const button = q('#submitBtn');
    button.disabled = true;
    try {
      await fetchJson('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, message })
      });
      q('#messageForm').reset();
      q('#charCount').textContent = '0 / 500';
      q('#formSuccess').hidden = false;
      setTimeout(() => { q('#formSuccess').hidden = true; }, 2400);
      await loadPublicData();
    } catch (error) {
      showToast(error.message, 'declined');
    } finally {
      button.disabled = false;
    }
  });

  q('#uploadForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const filesInput = q('#galleryFiles');
    const files = filesInput.files;
    if (!files || !files.length) {
      q('#uploadStatus').textContent = 'Selecione ao menos um arquivo.';
      return;
    }
    const formData = new FormData();
    formData.append('uploader', q('#uploaderName').value.trim() || 'Convidado');
    Array.from(files).forEach(file => formData.append('files', file));
    q('#uploadStatus').textContent = 'Enviando arquivos...';
    q('#uploadSubmitBtn').disabled = true;
    try {
      const result = await fetchJson('/api/gallery/upload', {
        method: 'POST',
        body: formData
      });
      q('#uploadStatus').textContent = result.message || 'Arquivos enviados com sucesso.';
      q('#uploadForm').reset();
      await loadPublicData();
      showToast('Arquivos adicionados à galeria.', 'confirmed');
    } catch (error) {
      q('#uploadStatus').textContent = error.message;
    } finally {
      q('#uploadSubmitBtn').disabled = false;
    }
  });
}

// removed renderOpenLastInviteButton() and openLastInvite() to avoid duplicate "Abrir meu convite" button

function createDefaultRow(index) {
  return {
    id: index,
    inviteCode: '',
    name: '',
    guestCount: 1,
    contact: '',
    tableNumber: '',
    passwords: [],
    guestNames: [],
    registeredBy: '',
    confirmation: 'pendente',
    confirmationAt: null,
    declinedAt: null
  };
}

function isRowActive(row) {
  return Boolean((row.name || '').trim() || (row.contact || '').trim() || (row.tableNumber || '').trim() || Number(row.guestCount || 1) !== 1 || row.inviteCode || (row.passwords || []).length);
}

function generateRandomDigits(length) {
  let result = '';
  while (result.length < length) result += Math.floor(Math.random() * 10);
  return result.slice(0, length);
}

function looksSequential(code) {
  const asc = '01234567890123456789';
  const desc = '98765432109876543210';
  return asc.includes(code) || desc.includes(code) || /^([0-9])\1+$/.test(code);
}

function createInviteCode(exceptId = null) {
  const used = new Set(state.invites.filter(row => row.id !== exceptId && row.inviteCode).map(row => row.inviteCode));
  let code = '';
  do {
    code = generateRandomDigits(8);
  } while (used.has(code) || looksSequential(code));
  return code;
}

function createPasswords(quantity) {
  const used = new Set();
  const total = Math.max(1, Math.min(30, Number(quantity || 1)));
  return Array.from({ length: total }, (_, index) => {
    let code = '';
    do {
      code = generateRandomDigits(5);
    } while (used.has(code) || looksSequential(code));
    used.add(code);
    return { label: `Senha ${String(index + 1).padStart(2, '0')}`, code };
  });
}

function renderAdminConfig() {
  if (!state.config) return;
  const { event, payment, branding, theme, media, animation, couple } = state.config;
  setValue('#cfgLogoMode', branding.logoMode);
  setValue('#cfgLogoUrl', branding.logoUrl);
  setValue('#cfgMonogramInitials', branding.monogramInitials);
  setValue('#cfgLogoSubtitle', branding.logoSubtitle);
  setValue('#cfgLogoPrimaryColor', branding.logoPrimaryColor);
  setValue('#cfgLogoAccentColor', branding.logoAccentColor);
  setValue('#cfgLogoBackgroundColor', branding.logoBackgroundColor);
  setValue('#cfgHeroBackgroundUrl', branding.heroBackgroundUrl);
  qa('input[name="logoTemplate"]').forEach(input => { input.checked = input.value === branding.monogramTemplate; });
  setValue('#cfgThemeBg', theme.bg);
  setValue('#cfgThemeText', theme.text);
  setValue('#cfgThemeTextSoft', theme.textSoft);
  setValue('#cfgThemeAccent', theme.accent);
  setValue('#cfgThemeAccentDark', theme.accentDark);
  setValue('#cfgThemeGold', theme.goldSoft);
  setValue('#cfgHeroGradientStart', theme.heroGradientStart);
  setValue('#cfgHeroGradientMiddle', theme.heroGradientMiddle);
  setValue('#cfgHeroGradientEnd', theme.heroGradientEnd);
  setValue('#cfgHeroPre', event.heroPre);
  setValue('#cfgHeroNote', event.heroNote);
  setValue('#cfgCoupleNames', event.coupleNames);
  setValue('#cfgEventDateIso', event.eventDateIso.slice(0, 16));
  setValue('#cfgDateDisplay', event.dateDisplay);
  setValue('#cfgLocationName', event.locationName);
  setValue('#cfgLocationAddress', event.locationAddress);
  setValue('#cfgMapsUrl', event.mapsUrl);
  setValue('#cfgMapEmbedUrl', event.mapEmbedUrl);
  setValue('#cfgDressCode', event.dressCode);
  setValue('#cfgDressCodeHint', event.dressCodeHint);
  setValue('#cfgFooterText', event.footerText);
  setValue('#cfgFooterQuote', event.footerQuote);
  setValue('#cfgAdminPassword', state.config.adminPassword);
  setChecked('#cfgMusicEnabled', media.enabled);
  setChecked('#cfgMusicAutoplay', media.autoplay);
  setValue('#cfgMusicMode', media.mode);
  setValue('#cfgMusicVolume', media.volume);
  setValue('#cfgMusicTitle', media.title);
  setValue('#cfgMusicSubtitle', media.subtitle);
  setValue('#cfgMusicUrl', media.audioUrl);
  setChecked('#cfgAnimationEnabled', animation.enabled);
  setValue('#cfgAnimationSymbol', animation.symbol);
  setValue('#cfgAnimationDensity', animation.density);
  qa('[data-music-preset]').forEach(button => button.classList.toggle('active', button.dataset.musicPreset === media.preset));
  setValue('#cfgFernandaImageUrl', couple.fernandaImageUrl);
  setValue('#cfgIgoImageUrl', couple.igoImageUrl);
  setValue('#cfgFernandaName', couple.fernandaName);
  setValue('#cfgFernandaRole', couple.fernandaRole);
  setValue('#cfgFernandaBio', couple.fernandaBio);
  setValue('#cfgIgoName', couple.igoName);
  setValue('#cfgIgoRole', couple.igoRole);
  setValue('#cfgIgoBio', couple.igoBio);
  setValue('#cfgGalleryPre', event.galleryPre);
  setValue('#cfgGalleryTitle', event.galleryTitle);
  setValue('#cfgGalleryDescription', event.galleryDescription);
  setValue('#cfgGalleryUploader', 'Administrador');
  renderGalleryAdminPreview();
  renderMessagesAdminList();
  setValue('#cfgPixKey', payment.pixKey);
  setValue('#cfgInviteHtmlLink', currentInviteHtmlUrl());
  updateTemplatePreviews();
  renderStoryAdminList();
  renderGiftAdminList();
  renderFixedTextsEditor();
}

function renderFixedTextsEditor() {
  if (!state.config) return;
  const host = q('#fixedTextsEditor');
  if (!host) return;
  // coletar chaves candidatas a textos fixos
  const keysSet = new Set();
  Object.keys(state.config.uiTexts || {}).forEach(k => keysSet.add(k));
  Object.keys(state.config.event || {}).forEach(k => keysSet.add(k));
  Object.keys(state.config.couple || {}).forEach(k => keysSet.add(k));
  // adicionar chaves específicas úteis
  ['giftsPre','giftsTitle','giftsDescription','galleryPre','galleryTitle','galleryDescription','messagesPre','messagesTitle','messagesDescription'].forEach(k => keysSet.add(k));
  const keys = Array.from(keysSet).sort();
  const fixed = state.config.fixedTexts || {};
  host.innerHTML = keys.map(key => {
    const entry = fixed[key] || {};
    const textVal = entry.text ?? (state.config.uiTexts && state.config.uiTexts[key]) ?? (state.config.event && state.config.event[key]) ?? '';
    const colorVal = entry.color || '';
    const fontVal = entry.font || '';
    return `
      <label class="full-span fixed-text-row" data-fixed-row="${escapeHtml(key)}">
        <strong>${escapeHtml(key)}</strong>
        <textarea data-fixed-key="${escapeHtml(key)}" rows="2" placeholder="Texto">${escapeHtml(textVal)}</textarea>
        <div class="fixed-text-controls">
          <label>Cor <input type="color" data-fixed-key-color="${escapeHtml(key)}" value="${escapeHtml(colorVal)}" /></label>
          <label>Fonte
            <select data-fixed-key-font="${escapeHtml(key)}">
              <option value="">(padrão)</option>
              <option value="Arial, Helvetica, sans-serif">Arial</option>
              <option value="Georgia, serif">Georgia</option>
              <option value="'Times New Roman', Times, serif">Times New Roman</option>
              <option value="'Pacifico', cursive">Pacifico</option>
              <option value="'Playfair Display', serif">Playfair Display</option>
            </select>
          </label>
        </div>
      </label>
    `;
  }).join('');
  // setar valores de fontes selecionadas após inserir HTML
  keys.forEach(key => {
    const entry = fixed[key] || {};
    if (entry.font) {
      const sel = host.querySelector(`[data-fixed-key-font="${key}"]`);
      if (sel) sel.value = entry.font;
    }
  });
}

function applyFixedTexts() {
  if (!state.config) return;
  const fixed = state.config.fixedTexts || {};
  Object.keys(fixed).forEach(key => {
    const entry = fixed[key] || {};
    // encontrar elemento por id ou por atributo data-fixed-text
    const elById = document.getElementById(key);
    const el = elById || document.querySelector(`[data-fixed-text="${CSS.escape(key)}"]`);
    if (!el) return;
    if (typeof entry.text === 'string') {
      el.textContent = entry.text;
    }
    if (entry.color) el.style.color = entry.color;
    if (entry.font) el.style.fontFamily = entry.font;
  });
}

function updateTemplatePreviews() {
  const initials = (q('#cfgMonogramInitials')?.value || state.config?.branding?.monogramInitials || 'IF').toUpperCase();
  qa('[data-template-preview]').forEach(el => { el.textContent = initials; });
}

function renderStoryAdminList() {
  const host = q('#storyAdminList');
  const items = state.config?.story?.items || [];
  if (!host) return;
  host.innerHTML = items.map((item, index) => `
    <article class="stack-item" data-story-index="${index}">
      <div class="stack-item-head"><strong>Etapa ${index + 1}</strong><button class="icon-btn" type="button" data-story-action="remove" title="Remover etapa"><i class="fas fa-trash"></i></button></div>
      <div class="admin-form-grid two-columns">
        <label>Ano<input data-story-field="year" type="text" value="${escapeHtml(item.year || '')}" /></label>
        <label>Título<input data-story-field="title" type="text" value="${escapeHtml(item.title || '')}" /></label>
        <label class="full-span">Descrição<textarea data-story-field="description" rows="3">${escapeHtml(item.description || '')}</textarea></label>
        <label class="full-span">Imagem<div class="input-with-action"><input data-story-field="imageUrl" type="text" value="${escapeHtml(item.imageUrl || '')}" /><label class="mini-upload-btn"><i class="fas fa-image"></i><input type="file" data-upload-input data-upload-target-story="${index}" data-upload-slot="story-${index + 1}" accept="image/*" hidden /></label></div></label>
      </div>
    </article>`).join('') + '<button class="btn btn-soft" type="button" id="addStoryItemBtn"><i class="fas fa-plus"></i> Nova etapa</button>';
}

function renderGiftAdminList() {
  const host = q('#giftAdminList');
  const gifts = state.config?.gifts || [];
  if (!host) return;
  host.innerHTML = gifts.map((gift, index) => `
    <article class="stack-item" data-gift-index="${index}">
      <div class="stack-item-head"><strong>${escapeHtml(gift.title || `Presente ${index + 1}`)}</strong><button class="icon-btn" type="button" data-gift-action="remove" title="Remover presente"><i class="fas fa-trash"></i></button></div>
      <div class="admin-form-grid two-columns">
        <label>Título<input data-gift-field="title" type="text" value="${escapeHtml(gift.title || '')}" /></label>
        <label>Valor<input data-gift-field="price" type="number" min="0" step="1" value="${Number(gift.price || 0)}" /></label>
        <label>Ícone Font Awesome<input data-gift-field="icon" type="text" value="${escapeHtml(gift.icon || 'fa-gift')}" placeholder="fa-gift" /></label>
        <label>Link do Pagamento com Cartão<input data-gift-field="mercadoPagoLink" type="url" value="${escapeHtml(gift.mercadoPagoLink || '')}" placeholder="https://www.mercadopago.com.br/" /></label>
        <label>Tema para buscar imagem<input data-gift-field="imageQuery" type="text" value="${escapeHtml(gift.imageQuery || '')}" /></label>
        <label class="full-span">Descrição<textarea data-gift-field="description" rows="3">${escapeHtml(gift.description || '')}</textarea></label>
        <label class="full-span">Imagem<div class="input-with-action"><input data-gift-field="imageUrl" type="text" value="${escapeHtml(gift.imageUrl || '')}" /><label class="mini-upload-btn"><i class="fas fa-image"></i><input type="file" data-upload-input data-upload-target-gift="${index}" data-upload-slot="gift-${index + 1}" accept="image/*" hidden /></label></div></label>
      </div>
    </article>`).join('');
}

function renderAdminStats() {
  const active = state.invites.filter(isRowActive);
  const totalPasswords = active.reduce((sum, row) => sum + (row.passwords || []).length, 0);
  // Use all invites to compute confirmed/declined counts so confirmed guests are counted even if the row
  // isn't considered "active" by the isRowActive filter (e.g., default rows).
  const all = Array.isArray(state.invites) ? state.invites : [];
  const confirmed = all.filter(row => row.confirmation === 'confirmado').length;
  const declined = all.filter(row => row.confirmation === 'recusado').length;
  q('#statActiveInvites').textContent = String(active.length);
  q('#statTotalPasswords').textContent = String(totalPasswords);
  q('#statConfirmed').textContent = String(confirmed);
  q('#statDeclined').textContent = String(declined);
  // calcular total de pessoas que confirmaram (soma de attendingCount ou guestCount para confirmados)
  const confirmedRows = all.filter(row => row.confirmation === 'confirmado');
  const totalPeopleConfirmed = confirmedRows.reduce((sum, row) => {
    const n = Number(row.attendingCount ?? row.guestCount ?? totalPeopleOnInvite(row));
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
  // total incluído nos convites (soma de guestCount em convites ativos)
  const totalIncluded = active.reduce((sum, row) => sum + (Number(row.guestCount || 0)), 0);
  if (q('#statTotalPeople')) q('#statTotalPeople').textContent = String(totalPeopleConfirmed);
  if (q('#statTotalIncluded')) q('#statTotalIncluded').textContent = String(totalIncluded);
  renderConfirmedGuestsList(confirmedRows);
}

function renderConfirmedGuestsList(confirmedRows) {
  const host = q('#confirmedGuestsHost');
  if (!host) return;
  if (!Array.isArray(confirmedRows)) confirmedRows = state.invites.filter(row => row.confirmation === 'confirmado');
  if (!confirmedRows.length) {
    host.innerHTML = '<div class="empty-state compact"><p>Nenhum convite confirmado ainda.</p></div>';
    return;
  }
  // construir lista de convidados confirmados com nomes e quantidade
  const items = confirmedRows.map(row => {
    const main = escapeHtml(row.registeredBy || row.name || 'Convidado');
    const names = Array.isArray(row.guestNames) && row.guestNames.length ? row.guestNames.map(n => escapeHtml(n)).join(', ') : '';
    const total = Number(row.attendingCount ?? row.guestCount ?? totalPeopleOnInvite(row));
    return `<article class="stack-item"><div class="stack-item-head"><strong>${main} <small style="margin-left:8px">(${total} pessoa${total>1?'s':''})</small></strong></div><div class="stack-item-body"><small>${names || 'Sem acompanhantes listados'}</small></div></article>`;
  }).join('');
  host.innerHTML = items;
}

function renderPasswordsCell(row) {
  if (!row.passwords?.length) return '<div class="password-list empty"><span>Gere o painel para criar as senhas.</span></div>';
  const items = row.passwords.map((item, idx) => `
    <div class="admin-password-item">
      <input type="text" data-pass-input data-row-id="${row.id}" data-pass-index="${idx}" value="${escapeHtml(item.code)}" maxlength="10" />
      <button type="button" class="icon-btn" data-password-action="delete" data-row-id="${row.id}" data-pass-index="${idx}" title="Excluir senha"><i class="fas fa-trash"></i></button>
    </div>`).join('');
  return `<div class="password-list">${items}</div><div class="password-actions"><button class="btn btn-soft" type="button" data-password-action="clear" data-row-id="${row.id}">Limpar senhas</button></div>`;
}

function renderInviteTable() {
  const tbody = q('#inviteTableBody');
  if (!tbody) return;
  tbody.innerHTML = state.invites.map(row => `
    <tr data-row-id="${row.id}">
      <td><strong>${String(row.id).padStart(2, '0')}</strong></td>
      <td>${row.inviteCode ? `<span class="code-pill"><i class="fas fa-hashtag"></i>${escapeHtml(row.inviteCode)}</span>` : '<small>Código ainda não gerado</small>'}</td>
      <td><input data-field="name" type="text" value="${escapeHtml(row.name)}" placeholder="Nome do convidado" /></td>
      <td><input data-field="guestCount" type="number" min="1" max="30" value="${Math.max(1, Number(row.guestCount || 1))}" /></td>
      <td><input data-field="contact" type="text" value="${escapeHtml(row.contact)}" placeholder="Telefone / contato" /></td>
      <td><input data-field="guestLimit" type="number" min="0" max="30" value="${Number(row.guestLimit || 0)}" title="0 = sem limite" /></td>
      <td><input data-field="tableNumber" type="text" value="${escapeHtml(row.tableNumber || '')}" placeholder="Número da mesa" /></td>
      <td>
        <div class="registered-guest-block">
          <input data-field="registeredBy" type="text" value="${escapeHtml(row.registeredBy || row.name || '')}" placeholder="Nome que registrou" />
          <small>${escapeHtml(guestNamesSummary(row))}</small>
        </div>
      </td>
      <td>${renderPasswordsCell(row)}</td>
      <td>${buildStatusPill(row.confirmation)}</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" type="button" data-action="regen-code" title="Regenerar código interno"><i class="fas fa-arrows-rotate"></i></button>
          <button class="icon-btn" type="button" data-action="regen-passwords" title="Regenerar senhas"><i class="fas fa-key"></i></button>
          <button class="icon-btn" type="button" data-action="view-card" title="Abrir convite"><i class="fas fa-id-card"></i></button>
        </div>
      </td>
    </tr>`).join('');
  renderAdminStats();
}

function syncConfigFromInputs() {
  if (!state.config) return;
  state.config.branding.logoMode = q('#cfgLogoMode').value;
  state.config.branding.logoUrl = q('#cfgLogoUrl').value.trim();
  state.config.branding.monogramInitials = q('#cfgMonogramInitials').value.trim() || 'IF';
  state.config.branding.logoSubtitle = q('#cfgLogoSubtitle').value.trim();
  state.config.branding.logoPrimaryColor = q('#cfgLogoPrimaryColor').value;
  state.config.branding.logoAccentColor = q('#cfgLogoAccentColor').value;
  state.config.branding.logoBackgroundColor = q('#cfgLogoBackgroundColor').value;
  state.config.branding.heroBackgroundUrl = q('#cfgHeroBackgroundUrl').value.trim();
  state.config.branding.monogramTemplate = q('input[name="logoTemplate"]:checked')?.value || state.config.branding.monogramTemplate;
  state.config.theme.bg = q('#cfgThemeBg').value;
  state.config.theme.text = q('#cfgThemeText').value;
  state.config.theme.textSoft = q('#cfgThemeTextSoft').value;
  state.config.theme.accent = q('#cfgThemeAccent').value;
  state.config.theme.accentDark = q('#cfgThemeAccentDark').value;
  state.config.theme.goldSoft = q('#cfgThemeGold').value;
  state.config.theme.heroGradientStart = q('#cfgHeroGradientStart').value;
  state.config.theme.heroGradientMiddle = q('#cfgHeroGradientMiddle').value;
  state.config.theme.heroGradientEnd = q('#cfgHeroGradientEnd').value;
  state.config.event.heroPre = q('#cfgHeroPre').value.trim();
  state.config.event.heroNote = q('#cfgHeroNote').value.trim();
  state.config.event.coupleNames = q('#cfgCoupleNames').value.trim();
  state.config.event.eventDateIso = q('#cfgEventDateIso').value.trim();
  state.config.event.dateDisplay = q('#cfgDateDisplay').value.trim();
  state.config.event.locationName = q('#cfgLocationName').value.trim();
  state.config.event.locationAddress = q('#cfgLocationAddress').value.trim();
  state.config.event.mapsUrl = q('#cfgMapsUrl').value.trim();
  state.config.event.mapEmbedUrl = q('#cfgMapEmbedUrl').value.trim();
  state.config.event.dressCode = q('#cfgDressCode').value.trim();
  state.config.event.dressCodeHint = q('#cfgDressCodeHint').value.trim();
  state.config.event.footerText = q('#cfgFooterText').value.trim();
  state.config.event.footerQuote = q('#cfgFooterQuote').value.trim();
  state.config.event.galleryPre = q('#cfgGalleryPre').value.trim();
  state.config.event.galleryTitle = q('#cfgGalleryTitle').value.trim();
  state.config.event.galleryDescription = q('#cfgGalleryDescription').value.trim();
  state.config.media.enabled = q('#cfgMusicEnabled').checked;
  state.config.media.autoplay = q('#cfgMusicAutoplay').checked;
  state.config.media.mode = q('#cfgMusicMode').value;
  state.config.media.volume = Number(q('#cfgMusicVolume').value || 0.28);
  state.config.media.title = q('#cfgMusicTitle').value.trim();
  state.config.media.subtitle = q('#cfgMusicSubtitle').value.trim();
  state.config.media.audioUrl = q('#cfgMusicUrl').value.trim();
  state.config.animation.enabled = q('#cfgAnimationEnabled').checked;
  state.config.animation.symbol = q('#cfgAnimationSymbol').value;
  state.config.animation.density = Number(q('#cfgAnimationDensity').value || 24);
  state.config.couple.fernandaImageUrl = q('#cfgFernandaImageUrl').value.trim();
  state.config.couple.igoImageUrl = q('#cfgIgoImageUrl').value.trim();
  state.config.couple.fernandaName = q('#cfgFernandaName').value.trim();
  state.config.couple.fernandaRole = q('#cfgFernandaRole').value.trim();
  state.config.couple.fernandaBio = q('#cfgFernandaBio').value.trim();
  state.config.couple.igoName = q('#cfgIgoName').value.trim();
  state.config.couple.igoRole = q('#cfgIgoRole').value.trim();
  state.config.couple.igoBio = q('#cfgIgoBio').value.trim();
  state.config.payment.pixKey = q('#cfgPixKey').value.trim();
  state.config.adminPassword = q('#cfgAdminPassword').value.trim();
  // sincronizar textos fixos do editor
  const fixed = {};
  qa('[data-fixed-key]').forEach(input => {
    const key = input.dataset.fixedKey;
    if (!key) return;
    const text = input.value.trim();
    const colorEl = document.querySelector(`[data-fixed-key-color="${key}"]`);
    const fontEl = document.querySelector(`[data-fixed-key-font="${key}"]`);
    const color = colorEl ? colorEl.value : '';
    const font = fontEl ? fontEl.value : '';
    if (text || color || font) fixed[key] = { text, color, font };
  });
  state.config.fixedTexts = fixed;
}

async function loadAdminState() {
  if (!state.adminPassword) {
    openModal('adminLoginModal');
    return;
  }
  const data = await fetchJson('/api/admin/state', {
    headers: { 'X-Admin-Password': state.adminPassword }
  });
  state.config = clone(data.config);
  state.invites = clone(data.invites);
  state.gallery = clone(data.gallery || state.gallery);
  state.messages = clone(data.messages || state.messages);
  state.adminLoaded = true;
  renderAdminConfig();
  renderInviteTable();
  openModal('adminPanelModal');
}

function wireAdminActions() {
  q('#adminLoginForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const password = q('#adminPassword').value.trim();
    const feedback = q('#adminLoginFeedback');
    feedback.textContent = 'Validando acesso...';
    try {
      await fetchJson('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      state.adminPassword = password;
      sessionStorage.setItem('adminPassword', password);
      feedback.textContent = '';
      closeModal('adminLoginModal');
      await loadAdminState();
    } catch (error) {
      feedback.textContent = error.message;
    }
  });

  q('#adminRefreshBtn')?.addEventListener('click', loadAdminState);
  q('#openInviteHtmlBtn')?.addEventListener('click', () => {
    window.open(currentInviteHtmlUrl(), '_blank', 'noopener,noreferrer');
  });
  qa('[data-admin-tab]').forEach(button => {
    button.addEventListener('click', () => {
      const target = button.dataset.adminTab;
      qa('[data-admin-tab]').forEach(item => item.classList.toggle('active', item === button));
      qa('[data-admin-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.adminPanel === target));
    });
  });

  q('#cfgMonogramInitials')?.addEventListener('input', updateTemplatePreviews);
  qa('input[name="logoTemplate"]').forEach(input => {
    input.addEventListener('change', () => {
      qa('[data-template-card]').forEach(card => card.classList.toggle('active', card.dataset.templateCard === input.value));
    });
  });
  qa('[data-music-preset]').forEach(button => {
    button.addEventListener('click', () => {
      state.config.media.preset = button.dataset.musicPreset;
      const preset = MUSIC_PRESETS[state.config.media.preset];
      if (preset) {
        setValue('#cfgMusicTitle', preset.title);
        setValue('#cfgMusicSubtitle', preset.subtitle);
      }
      qa('[data-music-preset]').forEach(item => item.classList.toggle('active', item === button));
    });
  });

  q('#adminPreviewMusicBtn')?.addEventListener('click', async () => {
    try {
      syncConfigFromInputs();
      applyMedia();
      await playSiteMusic();
      setText('#musicStatusHint', 'Som tocando. Ajuste o volume ou pare quando quiser.');
    } catch (error) {
      setText('#musicStatusHint', 'Não foi possível tocar este áudio. Envie outro arquivo ou use um modelo pronto.');
    }
  });
  q('#adminStopMusicBtn')?.addEventListener('click', () => {
    stopSiteMusic();
    setText('#musicStatusHint', 'Som pausado.');
  });

  q('#adminSaveBtn')?.addEventListener('click', async () => {
    try {
      syncConfigFromInputs();
      const payload = { config: state.config, invites: state.invites, messages: state.messages };
      await fetchJson('/api/admin/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Password': state.adminPassword
        },
        body: JSON.stringify(payload)
      });
      sessionStorage.setItem('adminPassword', state.config.adminPassword);
      state.adminPassword = state.config.adminPassword;
      showToast('Painel salvo com sucesso.', 'confirmed');
      await loadPublicData();
    } catch (error) {
      showToast(error.message, 'declined');
    }
  });

  q('#cfgGalleryUploadBtn')?.addEventListener('click', async () => {
    const filesInput = q('#cfgGalleryFiles');
    const uploader = q('#cfgGalleryUploader')?.value.trim() || 'Administrador';
    if (!filesInput || !filesInput.files.length) {
      showToast('Selecione ao menos uma imagem para enviar.', 'declined');
      return;
    }
    const form = new FormData();
    Array.from(filesInput.files).forEach(file => form.append('files', file));
    form.append('uploader', uploader);
    try {
      const result = await fetchJson('/api/gallery/upload', {
        method: 'POST',
        body: form,
      });
      state.gallery = [...result.items, ...state.gallery];
      filesInput.value = '';
      renderGalleryAdminPreview();
      renderGallery();
      showToast(result.message || 'Fotos enviadas com sucesso.', 'confirmed');
    } catch (error) {
      showToast(error.message, 'declined');
    }
  });

  q('#cfgGalleryDownloadBtn')?.addEventListener('click', async () => {
    try {
      if (!state.adminPassword) {
        showToast('Digite a senha do administrador e entre no painel antes de baixar.', 'declined');
        return;
      }
      const res = await fetch('/api/admin/gallery/download', {
        method: 'GET',
        headers: { 'X-Admin-Password': state.adminPassword }
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || 'Falha ao gerar o arquivo ZIP.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'galeria-convidados.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('Download iniciado.', 'confirmed');
    } catch (error) {
      showToast(error.message || 'Erro ao baixar galeria.', 'declined');
    }
  });

  q('#saveMessagesBtn')?.addEventListener('click', async () => {
    try {
      await fetchJson('/api/admin/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Password': state.adminPassword,
        },
        body: JSON.stringify({ config: state.config, invites: state.invites, messages: state.messages }),
      });
      showToast('Mensagens salvas com sucesso.', 'confirmed');
      await loadPublicData();
      renderMessagesAdminList();
    } catch (error) {
      showToast(error.message, 'declined');
    }
  });

  q('#messagesAdminList')?.addEventListener('input', event => {
    const itemEl = event.target.closest('[data-message-id]');
    const field = event.target.dataset.messageField;
    if (!itemEl || !field) return;
    const message = state.messages.find(item => item.id === itemEl.dataset.messageId);
    if (!message) return;
    message[field] = event.target.value;
  });

  q('#messagesAdminList')?.addEventListener('click', event => {
    const button = event.target.closest('[data-message-action="delete"]');
    if (!button) return;
    const itemEl = button.closest('[data-message-id]');
    const id = itemEl?.dataset.messageId;
    if (!id || !confirm('Deseja excluir essa mensagem?')) return;
    state.messages = state.messages.filter(item => item.id !== id);
    renderMessagesAdminList();
  });

  document.addEventListener('click', async event => {
    const deleteBtn = event.target.closest('[data-gallery-action="delete"]');
    if (!deleteBtn) return;
    const id = deleteBtn.dataset.galleryId;
    if (!id) return;
    if (!confirm('Excluir esta foto da galeria?')) return;
    try {
      await fetchJson('/api/admin/gallery/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Password': state.adminPassword,
        },
        body: JSON.stringify({ id }),
      });
      state.gallery = state.gallery.filter(item => item.id !== id);
      renderGalleryAdminPreview();
      renderGallery();
      if (state.adminLoaded) {
        await loadPublicData();
      }
      showToast('Foto removida da galeria.', 'confirmed');
    } catch (error) {
      showToast(error.message, 'declined');
    }
  });

  q('#generateInvitesBtn')?.addEventListener('click', () => {
    let processed = 0;
    state.invites.forEach(row => {
      if (!isRowActive(row)) return;
      if (!row.inviteCode) row.inviteCode = createInviteCode(row.id);
      row.passwords = createPasswords(row.guestCount);
      processed += 1;
    });
    renderInviteTable();
    showToast(processed ? `Painel gerado para ${processed} convite(s).` : 'Preencha ao menos uma linha para gerar convites.');
  });

  q('#addRowsBtn')?.addEventListener('click', () => {
    const start = state.invites.length + 1;
    for (let i = 0; i < 20; i += 1) state.invites.push(createDefaultRow(start + i));
    renderInviteTable();
  });

  q('#resetDataBtn')?.addEventListener('click', () => {
    if (!window.confirm('Deseja limpar o painel e voltar para 100 linhas vazias?')) return;
    state.invites = Array.from({ length: 100 }, (_, index) => createDefaultRow(index + 1));
    renderInviteTable();
  });

  q('#adminExportBtn')?.addEventListener('click', () => {
    syncConfigFromInputs();
    const blob = new Blob([JSON.stringify({ config: state.config, invites: state.invites }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'painel-igo-fernanda.json';
    link.click();
    URL.revokeObjectURL(url);
  });

  q('#adminImportInput')?.addEventListener('change', async event => {
    const [file] = event.target.files || [];
    if (!file) return;
    const text = await file.text();
    const parsed = JSON.parse(text);
    state.config = clone(parsed.config);
    state.invites = clone(parsed.invites);
    renderAdminConfig();
    renderInviteTable();
    showToast('Backup importado para o painel.');
  });

  document.addEventListener('change', async event => {
    const input = event.target.closest('[data-upload-input]');
    if (!input) return;
    const [file] = input.files || [];
    if (!file || !state.adminPassword) return;
    const formData = new FormData();
    formData.append('slot', input.dataset.uploadSlot || 'asset');
    formData.append('file', file);
    try {
      showToast('Enviando arquivo...');
      const result = await fetchJson('/api/admin/upload-asset', {
        method: 'POST',
        headers: { 'X-Admin-Password': state.adminPassword },
        body: formData
      });
      const directTarget = input.dataset.uploadTarget;
      if (directTarget) setValue(`#${directTarget}`, result.url);
      if (input.dataset.uploadTargetStory) {
        const item = state.config.story.items[Number(input.dataset.uploadTargetStory)];
        if (item) item.imageUrl = result.url;
        renderStoryAdminList();
      }
      if (input.dataset.uploadTargetGift) {
        const gift = state.config.gifts[Number(input.dataset.uploadTargetGift)];
        if (gift) gift.imageUrl = result.url;
        renderGiftAdminList();
      }
      showToast('Arquivo enviado e aplicado no campo.', 'confirmed');
    } catch (error) {
      showToast(error.message, 'declined');
    } finally {
      input.value = '';
    }
  });

  q('#storyAdminList')?.addEventListener('input', event => {
    const itemEl = event.target.closest('[data-story-index]');
    const field = event.target.dataset.storyField;
    if (!itemEl || !field) return;
    state.config.story.items[Number(itemEl.dataset.storyIndex)][field] = event.target.value;
  });

  q('#storyAdminList')?.addEventListener('click', event => {
    const remove = event.target.closest('[data-story-action="remove"]');
    if (remove) {
      const itemEl = remove.closest('[data-story-index]');
      state.config.story.items.splice(Number(itemEl.dataset.storyIndex), 1);
      renderStoryAdminList();
      return;
    }
    if (event.target.closest('#addStoryItemBtn')) {
      state.config.story.items.push({ year: '', title: 'Nova etapa', description: '', imageUrl: '' });
      renderStoryAdminList();
    }
  });

  q('#giftAdminList')?.addEventListener('input', event => {
    const itemEl = event.target.closest('[data-gift-index]');
    const field = event.target.dataset.giftField;
    if (!itemEl || !field) return;
    const gift = state.config.gifts[Number(itemEl.dataset.giftIndex)];
    gift[field] = field === 'price' ? Number(event.target.value || 0) : event.target.value;
  });

  q('#giftAdminList')?.addEventListener('click', event => {
    const remove = event.target.closest('[data-gift-action="remove"]');
    if (!remove) return;
    const itemEl = remove.closest('[data-gift-index]');
    state.config.gifts.splice(Number(itemEl.dataset.giftIndex), 1);
    renderGiftAdminList();
  });

  q('#addGiftBtn')?.addEventListener('click', () => {
    state.config.gifts.push({ title: 'Novo presente', price: 0, description: '', imageUrl: '', imageQuery: '', icon: 'fa-gift', mercadoPagoLink: '' });
    renderGiftAdminList();
  });

  q('#inviteTableBody')?.addEventListener('input', event => {
    // tratar edição de campos normais e edição inline de senhas
    const passInput = event.target.closest('[data-pass-input]');
    if (passInput) {
      const rowId = Number(passInput.dataset.rowId || -1);
      const idx = Number(passInput.dataset.passIndex || -1);
      const row = state.invites.find(item => item.id === rowId);
      if (!row || !row.passwords || !Number.isFinite(idx)) return;
      row.passwords[idx].code = String(passInput.value || '').trim().slice(0, 10);
      // não re-render completo para não perder foco; apenas atualizar stats
      renderAdminStats();
      return;
    }

    const rowEl = event.target.closest('tr');
    if (!rowEl) return;
    const row = state.invites.find(item => item.id === Number(rowEl.dataset.rowId));
    if (!row) return;
    const field = event.target.dataset.field;
    if (field === 'guestCount') {
      row.guestCount = Math.max(1, Math.min(30, Number(event.target.value || 1)));
    } else if (field === 'guestLimit') {
      row.guestLimit = Math.max(0, Math.min(30, Number(event.target.value || 0)));
      // opcional: garantir que guestCount não exceda o limite visível
      if (row.guestLimit > 0 && Number(row.guestCount || 1) > row.guestLimit) {
        row.guestCount = row.guestLimit;
      }
    } else if (field === 'registeredBy') {
      row.registeredBy = event.target.value;
    } else if (field === 'name' || field === 'contact' || field === 'tableNumber') {
      row[field] = event.target.value;
      if (field === 'name' && !row.registeredBy) row.registeredBy = event.target.value;
    }
    renderAdminStats();
  });

  q('#inviteTableBody')?.addEventListener('click', async event => {
    // tratar tanto ações de linha quanto ações de senha
    const actionButton = event.target.closest('[data-action], [data-password-action]');
    if (!actionButton) return;
    const rowEl = actionButton.closest('tr');
    if (!rowEl) return;
    const row = state.invites.find(item => item.id === Number(rowEl.dataset.rowId));
    if (!row) return;
    const action = actionButton.dataset.action;
    const passAction = actionButton.dataset.passwordAction;
    if (action === 'regen-code') {
      row.inviteCode = createInviteCode(row.id);
      renderInviteTable();
      return;
    }
    if (action === 'regen-passwords') {
      row.passwords = createPasswords(row.guestCount);
      renderInviteTable();
      return;
    }
    if (action === 'view-card') {
      if (!row.inviteCode) row.inviteCode = createInviteCode(row.id);
      if (!row.passwords?.length) row.passwords = createPasswords(row.guestCount);
      row.confirmation = row.confirmation === 'pendente' ? 'confirmado' : row.confirmation;
      if (!row.registeredBy) row.registeredBy = row.name;
      openTicket(row);
      return;
    }
    if (passAction === 'delete') {
      const idx = Number(actionButton.dataset.passIndex);
      if (!Number.isFinite(idx)) return;
      if (!confirm('Excluir esta senha do convite?')) return;
      row.passwords = (row.passwords || []).filter((_, i) => i !== idx);
      renderInviteTable();
      return;
    }
    if (passAction === 'clear') {
      if (!confirm('Deseja limpar todas as senhas deste convite?')) return;
      row.passwords = [];
      renderInviteTable();
      return;
    }
  });
}

async function loadPublicData() {
  let data = null;
  try {
    data = await fetchJson('/api/site-data');
  } catch (err) {
    console.warn('Falha em /api/site-data, carregando _data estático como fallback:', err);
    async function loadJson(path) {
      try {
        const resp = await fetch(path);
        if (!resp.ok) return null;
        return await resp.json();
      } catch (e) {
        return null;
      }
    }
    const cfg = await loadJson('/_data/config.json') || {};
    const msgs = await loadJson('/_data/messages.json') || [];
    const gal = await loadJson('/_data/gallery.json') || [];
    // invites não são necessários para a maior parte do público; manter estado local
    data = { config: cfg, messages: msgs, gallery: gal, invites: [] };
  }
  state.config = clone(data.config);
  state.gallery = clone(data.gallery || []);
  state.messages = clone(data.messages || []);
  applyConfig();
  renderGallery();
  renderMessages();
  if (state.adminLoaded) {
    state.invites = clone(data.invites || state.invites);
    renderInviteTable();
  }
}

async function init() {
  createPetals();
  setupNavigation();
  setupAnimations();
  setupModals();
  wirePublicActions();
  wireAdminActions();
  await loadPublicData();
  // renderizar botão de reabrir convite se houver um código salvo nesta sessão
  // renderOpenLastInviteButton removed to avoid duplicate 'Abrir meu convite' button
}

window.addEventListener('resize', createPetals);
window.addEventListener('DOMContentLoaded', () => {
  init().catch(error => {
    console.error(error);
    showToast('Não foi possível carregar o site completo.', 'declined');
  });
});
