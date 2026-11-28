/* Casa Campo Las Maravillas · web de reservas directas
   Los datos editables (precios, capacidad, fechas ocupadas) están en data/casa.json */
(function () {
  'use strict';
  // Versión exacta de este archivo (la completa el armado del sitio al publicar).
  const VERSION_WEB = '__VERSION_WEB__';
  // Diagnóstico TEMPORAL, solo en modo prueba: registra errores de JavaScript y solicitudes fallidas (sin datos sensibles).
  const DIAG = { errores: [], fallidas: [] };
  const ENPRUEBA = (() => { try { return location.hash.startsWith('#prueba') || !!sessionStorage.getItem('cc_clave_pruebas'); } catch { return false; } })();
  if (ENPRUEBA) {
    const corta = u => { try { const x = new URL(String(u && u.url || u), location.href); return x.host === location.host ? x.pathname : x.host + x.pathname; } catch { return String(u).slice(0, 60); } };
    window.addEventListener('error', e => DIAG.errores.push(e.message === 'Script error.' && !e.filename
      ? 'aviso dentro de un script externo (Turnstile o Google Maps; el navegador oculta el detalle; no afecta la reserva)'
      : String(e.message || e.type).slice(0, 160) + (e.filename ? ` (${corta(e.filename)}:${e.lineno})` : '')));
    window.addEventListener('unhandledrejection', e => DIAG.errores.push('promesa: ' + String(e.reason && e.reason.message || e.reason).slice(0, 160)));
    const original = window.fetch.bind(window);
    window.fetch = async (...a) => {
      try { const r = await original(...a); if (!r.ok) DIAG.fallidas.push(`${r.status} ${corta(a[0])}`); return r; }
      catch (err) { DIAG.fallidas.push(`sin conexión: ${corta(a[0])}`); throw err; }
    };
  }
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const money = n => '$' + Math.round(n).toLocaleString('es-AR');

  /* ---------- FOTOS ---------- */
  const CATS = [
    ['todas', 'Todas'], ['exterior', 'Exterior'], ['pileta', 'Pileta'], ['parque', 'Parque y asador'],
    ['interior', 'Living y cocina'], ['dormitorios', 'Dormitorios'], ['bano', 'Baño'], ['vistas', 'Vistas']
  ];
  // [número de foto, categoría, descripción] en el orden en que se muestran
  const FOTOS = [
    [21, 'exterior', 'Frente de la casa'], [7, 'pileta', 'Pileta'], [12, 'interior', 'Living comedor'],
    [3, 'parque', 'Mesas largas en el parque'], [31, 'dormitorios', 'Dormitorio con cama doble e individual'],
    [20, 'vistas', 'Vista a las sierras'], [14, 'interior', 'Cocina equipada'], [6, 'pileta', 'Pileta y parque'],
    [15, 'interior', 'Living'], [27, 'parque', 'Mesa de exterior con vista a las sierras'], [23, 'exterior', 'Frente y cochera'],
    [32, 'dormitorios', 'Dormitorio'], [4, 'pileta', 'Parque junto a la pileta'], [29, 'interior', 'Comedor, cocina y living'],
    [18, 'bano', 'Baño'], [5, 'parque', 'Asador y mesas'], [30, 'vistas', 'Vista desde el living'],
    [1, 'exterior', 'Frente de la casa'], [28, 'pileta', 'Sombrilla junto a la pileta'], [13, 'interior', 'Comedor'],
    [26, 'parque', 'Mesa bajo los árboles'], [19, 'vistas', 'Vista al parque y la pileta'], [16, 'interior', 'Living'],
    [8, 'parque', 'Hamaca paraguaya'], [10, 'exterior', 'Balcón de ingreso'], [11, 'interior', 'Comedor y cocina'],
    [9, 'parque', 'Asador'], [17, 'interior', 'Living'], [38, 'exterior', 'Ingreso y escalera a la terraza'],
    [2, 'parque', 'Parque'], [22, 'parque', 'Parque'], [24, 'exterior', 'Tranquera de ingreso'],
    [25, 'exterior', 'Ingreso a la propiedad'], [33, 'dormitorios', 'Placard'], [34, 'dormitorios', 'Vestidor'],
    [35, 'dormitorios', 'Vestidor'], [36, 'bano', 'Ducha'], [37, 'bano', 'Baño']
  ];
  const src = (n, sm) => `img/fotos/foto-${String(n).padStart(2, '0')}${sm ? '-sm' : ''}.jpg`;
  let cat = 'todas', expanded = false, lbList = [], lbIdx = 0;

  function renderFilters() {
    $('#filtros').innerHTML = CATS.map(([k, l]) =>
      `<button type="button" role="tab" data-cat="${k}" aria-selected="${k === cat}">${l}</button>`).join('');
  }
  function renderGrid() {
    const list = FOTOS.filter(f => cat === 'todas' || f[1] === cat);
    const limit = cat === 'todas' && !expanded ? 11 : list.length;
    lbList = list;
    $('#grid').innerHTML = list.slice(0, limit).map((f, i) =>
      `<button type="button" data-i="${i}" class="${i === 0 ? 'big' : ''}" aria-label="Ampliar: ${f[2]}">
         <img src="${src(f[0], i !== 0)}" alt="${f[2]}" loading="lazy"></button>`).join('') +
      (limit < list.length ? `<button type="button" class="btn btn--ghost-dark grid__more" id="ver-mas">Ver las ${list.length} fotos</button>` : '');
  }
  $('#filtros').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    cat = b.dataset.cat; expanded = false; renderFilters(); renderGrid();
  });
  $('#grid').addEventListener('click', e => {
    if (e.target.closest('#ver-mas')) { expanded = true; renderGrid(); return; }
    const b = e.target.closest('button[data-i]'); if (b) openLb(+b.dataset.i);
  });
  function openLb(i) {
    lbIdx = (i + lbList.length) % lbList.length;
    const f = lbList[lbIdx];
    $('#lb-img').src = src(f[0]); $('#lb-img').alt = f[2];
    $('#lb-cap').textContent = `${f[2]} · ${lbIdx + 1} de ${lbList.length}`;
    if ($('#lb').hidden) { lastFocus = document.activeElement; $('#lb').hidden = false; document.body.style.overflow = 'hidden'; $('#lb-x').focus(); }
    [1, -1].forEach(k => { const g = lbList[(lbIdx + k + lbList.length) % lbList.length]; new Image().src = src(g[0]); });
  }
  let lastFocus = null;
  function closeLb() { $('#lb').hidden = true; document.body.style.overflow = ''; if (lastFocus) lastFocus.focus(); }
  $('#lb-x').onclick = closeLb;
  $('#lb-prev').onclick = () => openLb(lbIdx - 1);
  $('#lb-next').onclick = () => openLb(lbIdx + 1);
  $('#lb').addEventListener('click', e => { if (e.target.id === 'lb') closeLb(); });
  document.addEventListener('keydown', e => {
    if ($('#lb').hidden) return;
    if (e.key === 'Escape') closeLb();
    if (e.key === 'ArrowLeft') openLb(lbIdx - 1);
    if (e.key === 'ArrowRight') openLb(lbIdx + 1);
  });
  let tx = null;
  $('#lb').addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
  $('#lb').addEventListener('touchend', e => {
    if (tx === null) return; const dx = e.changedTouches[0].clientX - tx; tx = null;
    if (Math.abs(dx) > 50) openLb(lbIdx + (dx < 0 ? 1 : -1));
  });
  renderFilters(); renderGrid();

  /* ---------- NAV / BARRA MÓVIL ---------- */
  const nav = $('#nav'), mbar = $('#mbar');
  function onScroll() {
    const y = window.scrollY, h = window.innerHeight;
    nav.classList.toggle('is-solid', y > 60);
    const r = $('#reservar').getBoundingClientRect();
    const inBook = r.top < h && r.bottom > 0;
    mbar.classList.toggle('show', y > h * .7 && !inBook);
    $('.fab').classList.toggle('hide', inBook);
  }
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

  /* ---------- RESERVAS ---------- */
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const nightsBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
  const fmtDate = s => parse(s).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  const today = iso(new Date());
  const maxDate = (() => { const d = new Date(); d.setMonth(d.getMonth() + 18); return iso(d); })();
  const st = { in: null, out: null, adultos: 2, menores: 0, view: new Date(new Date().getFullYear(), new Date().getMonth(), 1) };
  let CASA = null, busy = new Set(), MAX = 11, MIN_N = 2, SENA = 50;

  function pricePerNight(g) {
    const t = CASA.tarifas.por_huespedes;
    for (const k of Object.keys(t)) {
      const [a, b] = k.split('-').map(Number);
      if (g >= a && g <= (b || a)) return t[k];
    }
    return null; // sin tarifa: se consulta
  }
  const guests = () => st.adultos + st.menores;
  const firstBusyAfter = s => { let d = addDays(s, 1); while (d <= maxDate) { if (busy.has(d)) return d; d = addDays(d, 1); } return null; };
  const rangeFree = (a, b) => { for (let d = a; d < b; d = addDays(d, 1)) if (busy.has(d)) return false; return true; };

  function setMsg(t) { let m = $('#cal-msg'); if (!m) { m = document.createElement('p'); m.id = 'cal-msg'; m.className = 'cal__msg'; m.setAttribute('role', 'status'); $('#cal').appendChild(m); } m.textContent = t || ''; }

  function renderCal() {
    const wrap = $('#cal-months'); wrap.innerHTML = '';
    const limitOut = st.in && !st.out ? firstBusyAfter(st.in) : null;
    for (let k = 0; k < 2; k++) {
      const first = new Date(st.view.getFullYear(), st.view.getMonth() + k, 1);
      const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      const lead = (first.getDay() + 6) % 7; // lunes primero
      let html = `<div class="month"><p class="month__t">${(m => m[0].toUpperCase() + m.slice(1))(first.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }))}</p>
        <div class="dow">${['lu', 'ma', 'mi', 'ju', 'vi', 'sá', 'do'].map(d => `<span>${d}</span>`).join('')}</div><div class="days">`;
      html += '<span></span>'.repeat(lead);
      for (let d = 1; d <= days; d++) {
        const s = iso(new Date(first.getFullYear(), first.getMonth(), d));
        const isBusy = busy.has(s);
        const cls = ['day']; let dis = s < today || s > maxDate;
        if (isBusy) cls.push('busy');
        if (s === today) cls.push('today');
        if (st.in && !st.out) {
          // eligiendo salida: se puede salir el día que empieza otra reserva
          if (s > st.in && limitOut && s > limitOut) dis = true;
          if (isBusy && s === limitOut) { cls.push('co'); } else if (isBusy) dis = true;
        } else if (isBusy) dis = true;
        if (s === st.in) cls.push('start');
        if (s === st.out) cls.push('end');
        if (st.in && st.out && s > st.in && s < st.out) cls.push('in');
        html += `<button type="button" class="${cls.join(' ')}" data-d="${s}" ${dis ? 'disabled' : ''} aria-label="${fmtDate(s)}${isBusy ? ', ocupado' : ''}"><span class="day__n">${d}</span></button>`;
      }
      wrap.insertAdjacentHTML('beforeend', html + '</div></div>');
    }
    const now = new Date(); $('#cal-prev').disabled = st.view <= new Date(now.getFullYear(), now.getMonth(), 1);
    $('#cal-hint').textContent = !st.in ? 'Elegí la fecha de ingreso' : !st.out ? 'Ahora elegí la fecha de salida' : `${nightsBetween(st.in, st.out)} noches seleccionadas`;
  }

  function pick(s) {
    setMsg('');
    if (!st.in || st.out || s <= st.in) {
      if (busy.has(s)) return;
      st.in = s; st.out = null;
    } else {
      const n = nightsBetween(st.in, s);
      if (!rangeFree(st.in, s)) { setMsg('Hay noches ocupadas en ese rango. Elegí otras fechas.'); return; }
      if (n < MIN_N) { setMsg(`La estadía mínima es de ${MIN_N} noches.`); return; }
      st.out = s;
    }
    renderCal(); renderQuote();
  }

  function renderQuote() {
    const q = $('#quote'), btn = $('#btn-seguir');
    $('#btn-limpiar').hidden = !st.in;
    btn.textContent = textoCta();
    if (!st.in || !st.out) {
      const t = CASA ? CASA.tarifas.por_huespedes : {};
      const inK = k => { const [a, b] = k.split('-').map(Number); return guests() >= a && guests() <= (b || a); };
      const tabla = Object.keys(t).sort((a, b) => parseInt(a) - parseInt(b)).map(k => `<li${inK(k) ? ' class="on"' : ''}><span>${k.includes('-') ? 'Hasta ' + k.split('-')[1] : k} huéspedes</span><b>${money(t[k])}</b></li>`).join('');
      const p = CASA ? pricePerNight(guests()) : null;
      const vacio = `<p class="quote__empty">${st.in ? `Ingreso: <b>${fmtDate(st.in)}</b>. Elegí la fecha de salida.` : 'Elegí la fecha de ingreso y de salida para ver el precio de tu estadía.'}</p>`;
      // Modo actual (WhatsApp): exactamente como hoy. Modos nuevos: la tarifa del grupo elegido destacada y las demás en un desplegable.
      q.innerHTML = modoWeb() === 'whatsapp'
        ? vacio + (tabla ? `<p class="rates__t">Precio por noche · casa completa</p><ul class="rates">${tabla}</ul>` : '')
        : vacio + (p != null ? `<p class="quote__grupo">Para ${guests()} ${guests() === 1 ? 'huésped' : 'huéspedes'}: <b>${money(p)}</b> por noche · casa completa</p>` : '')
          + (tabla ? `<details class="rates__det"><summary>Ver tarifas según cantidad de huéspedes</summary><ul class="rates">${tabla}</ul></details>` : '');
      btn.disabled = true; return;
    }
    const n = nightsBetween(st.in, st.out), g = guests(), p = pricePerNight(g);
    const dates = `<div class="quote__dates"><div><small>Ingreso</small><b>${fmtDate(st.in)}</b></div><div><small>Salida</small><b>${fmtDate(st.out)}</b></div></div>`;
    if (p == null) {
      q.innerHTML = dates + '<p class="quote__empty">Consultá el precio para esta cantidad de huéspedes.</p>';
    } else {
      const total = p * n, sena = total * SENA / 100;
      q.innerHTML = dates + `<div id="quote-filas">${filas(p, n, total, sena, total - sena)}</div>
         ${VERIFICADO || modoWeb() === 'instantanea' ? '' : `<p class="quote__warn">Disponibilidad a confirmar ${modoWeb() === 'solicitud' ? '' : 'por WhatsApp '}antes de pagar la seña.</p>`}
         <p class="quote__srv" id="quote-srv" role="status"></p>`;
    }
    btn.disabled = false;
    verificarServidor();
  }
  function filas(p, n, total, sena, saldo) {
    const g = guests();
    return `<div class="qrow"><span>${money(p)} × ${n} noches</span><span>${money(total)}</span></div>
      <div class="qrow"><span>${g} ${g === 1 ? 'huésped' : 'huéspedes'}</span><span>casa completa</span></div>
      <div class="qrow qrow--total"><span>Total</span><span>${money(total)}</span></div>
      <div class="qrow qrow--sena"><span>Seña ${SENA} % para reservar</span><span>${money(sena)}</span></div>
      <div class="qrow qrow--saldo"><span>Saldo al ingresar</span><span>${money(saldo)}</span></div>`;
  }

  /* ---------- VERIFICACIÓN CON EL SERVIDOR DE RESERVAS (solo cotización) ----------
     El servidor recalcula el precio y revisa disponibilidad (incluye reservas directas y bloqueos).
     No crea reservas ni bloqueos. Si no responde, la web sigue funcionando con WhatsApp. */
  let SRV = null, srvSeq = 0, srvTimer = null;
  const claveSrv = () => `${st.in}|${st.out}|${st.adultos}|${st.menores}`;
  function verificarServidor() {
    const el = $('#quote-srv'); if (!el) return;
    const api = CASA && CASA.cotizacion_en_linea && CASA.api_reservas;
    if (!api) { el.remove(); return; }
    const key = claveSrv();
    if (SRV && SRV.key === key) return mostrarSrv(SRV);
    el.className = 'quote__srv'; el.textContent = 'Verificando precio y disponibilidad…';
    const seq = ++srvSeq;
    clearTimeout(srvTimer);
    srvTimer = setTimeout(async () => {
      const res = { key, data: null, error: null };
      try {
        const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 7000);
        const r = await fetch(api.replace(/\/$/, '') + '/api/cotizar', {
          method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl.signal,
          body: JSON.stringify({ ingreso: st.in, salida: st.out, adultos: st.adultos, menores: st.menores })
        });
        clearTimeout(to);
        res.data = await r.json().catch(() => null);
        if (!r.ok) res.error = r.status === 429 ? 'limite' : (res.data && res.data.mensaje) || 'error';
      } catch { res.error = 'red'; }
      if (seq !== srvSeq || key !== claveSrv()) return; // llegó una respuesta vieja
      SRV = res; mostrarSrv(res);
    }, 350);
  }
  function mostrarSrv({ data, error }) {
    const el = $('#quote-srv'), btn = $('#btn-seguir'); if (!el) return;
    if (error || !data) {
      el.className = 'quote__srv quote__srv--neutral';
      el.textContent = 'Disponibilidad pendiente de confirmación. ' + (error === 'limite'
        ? 'Hiciste muchas consultas seguidas: esperá un minuto o enviá la solicitud y te confirmamos por WhatsApp.'
        : (error && error !== 'red' && error !== 'error' ? error + ' ' : '') + 'No pudimos verificar en este momento: podés enviar la solicitud igual y te confirmamos precio y disponibilidad por WhatsApp.');
      return;
    }
    if (!data.disponible) {
      el.className = 'quote__srv quote__srv--no';
      el.textContent = 'Esas fechas no están disponibles. Elegí otras fechas o consultanos por WhatsApp.';
      btn.disabled = true; return;
    }
    const n = nightsBetween(st.in, st.out), p = pricePerNight(guests());
    if (p == null || data.total !== p * n) $('#quote-filas') && ($('#quote-filas').innerHTML = filas(data.precio_noche, n, data.total, data.sena, data.saldo));
    el.className = 'quote__srv quote__srv--ok';
    el.textContent = modoWeb() === 'instantanea' ? 'Precio y disponibilidad verificados por el sistema.'
      : modoWeb() === 'solicitud' ? 'Precio verificado por el sistema. Te confirmamos la disponibilidad antes de pagar la seña.'
      : 'Precio verificado por el sistema. Te confirmamos la disponibilidad por WhatsApp antes de pagar la seña.';
    actualizarFormulario();
  }

  function renderGuests() {
    $$('.step').forEach(el => {
      const k = el.dataset.k, [minus, plus] = $$('button', el);
      $('output', el).textContent = st[k];
      minus.disabled = st[k] <= (k === 'adultos' ? 1 : 0);
      plus.disabled = guests() >= MAX;
    });
    renderQuote();
  }
  $$('.step').forEach(el => el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    const k = el.dataset.k, isPlus = b === $$('button', el)[1];
    st[k] += isPlus ? 1 : -1; renderGuests();
  }));

  $('#cal-months').addEventListener('click', e => { const b = e.target.closest('.day'); if (b && !b.disabled) pick(b.dataset.d); });
  // Vista previa del rango al pasar el mouse mientras se elige la salida
  $('#cal-months').addEventListener('mouseover', e => {
    const b = e.target.closest('.day'); if (!st.in || st.out) return;
    const h = b && !b.disabled && b.dataset.d > st.in ? b.dataset.d : null;
    $$('.day', $('#cal-months')).forEach(d => d.classList.toggle('hov', !!h && d.dataset.d > st.in && d.dataset.d <= h));
  });
  $('#cal-months').addEventListener('mouseleave', () => $$('.day.hov').forEach(d => d.classList.remove('hov')));
  $('#cal-prev').onclick = () => { st.view = new Date(st.view.getFullYear(), st.view.getMonth() - 1, 1); renderCal(); };
  $('#cal-next').onclick = () => { st.view = new Date(st.view.getFullYear(), st.view.getMonth() + 1, 1); renderCal(); };
  $('#btn-limpiar').onclick = () => { st.in = st.out = null; setMsg(''); $('#form').hidden = true; $('#done').hidden = true; renderCal(); renderQuote(); };
  $('#btn-seguir').onclick = () => { $('#form').hidden = false; $('#done').hidden = true; configurarFormulario(); prepararTurnstile(); $('#form').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('#form [name=nombre]').focus({ preventScroll: true }); };

  /* ---------- MODO DE RESERVA ----------
     whatsapp    (actual): el formulario arma un mensaje de WhatsApp.
     solicitud   : la solicitud se registra en el servidor y los dueños aprueban.
     instantanea : el huésped reserva y paga la seña sin intervención (o en el modo prueba privado).
     Con el servidor caído o sin JavaScript, siempre queda WhatsApp. */
  function modoWeb() {
    if (!CASA || !CASA.api_reservas || !CASA.turnstile_site_key) return 'whatsapp';
    if (clavePrueba() || CASA.modo_reserva === 'instantanea') return 'instantanea';
    return CASA.solicitudes_en_linea ? 'solicitud' : 'whatsapp';
  }
  const textoCta = () => ({ instantanea: 'Reservar estas fechas', solicitud: 'Solicitar estas fechas' })[modoWeb()] || 'Solicitar reserva';
  const montosActuales = () => {
    const srvOk = SRV && SRV.key === claveSrv() && SRV.data && !SRV.error && SRV.data.disponible;
    if (srvOk) return SRV.data;
    const n = nightsBetween(st.in, st.out), p = pricePerNight(guests());
    if (p == null) return null;
    const total = p * n; return { total, sena: total * SENA / 100, saldo: total - total * SENA / 100 };
  };
  const medioElegido = () => ($('#form input[name=medio]:checked') || {}).value || 'mercadopago';
  const TEXTOS_TERMINOS = {
    instantanea: [
      'La <strong>seña es el 50 %</strong> del total. El <strong>50 % restante se paga al ingresar</strong>.',
      'Con <strong>Mercado Pago</strong> (débito, crédito o dinero en cuenta), tus fechas quedan retenidas <strong>30 minutos</strong> mientras pagás. Con <strong>transferencia</strong>, <strong>48 horas</strong> hasta que verifiquemos la acreditación.',
      'La reserva queda <strong>confirmada cuando la seña está acreditada</strong> y se verifica la disponibilidad. Lo ves en tu enlace privado, junto con el comprobante.',
      'Los intereses o costos de financiación del medio de pago que elijas quedan a tu cargo.',
      '<strong>No hay cancelación gratuita:</strong> la seña no es reembolsable. Si por un problema de disponibilidad no podemos confirmar tus fechas, te devolvemos el <strong>100 % de la seña</strong>.',
      'Ingreso de 15:00 a 18:00 · Salida hasta las 11:00.'
    ],
    solicitud: [
      'Enviar la solicitud <strong>no reserva las fechas ni tiene costo</strong>. Revisamos la disponibilidad y te respondemos.',
      'Si aprobamos tu solicitud, te guardamos las fechas <strong>48 horas</strong> para que pagues la <strong>seña del 50 %</strong>. Si no se acredita en ese plazo, las fechas se liberan.',
      'La reserva queda <strong>confirmada cuando la seña está acreditada</strong> y te lo confirmamos. El <strong>50 % restante se paga al ingresar</strong>.',
      '<strong>No hay cancelación gratuita:</strong> la seña no es reembolsable. Si por un problema de disponibilidad no podemos confirmar tus fechas, te devolvemos el <strong>100 % de la seña</strong>.',
      'Ingreso de 15:00 a 18:00 · Salida hasta las 11:00.'
    ]
  };
  let terminosOriginales = null;
  function configurarFormulario() {
    const f = $('#form'), modo = modoWeb(), ul = $('.terms ul', f);
    if (terminosOriginales === null) terminosOriginales = ul.innerHTML;
    ul.innerHTML = TEXTOS_TERMINOS[modo] ? TEXTOS_TERMINOS[modo].map(t => `<li>${t}</li>`).join('') : terminosOriginales;
    // Resumen fijo de la estadía, con la opción de volver a cambiar fechas o huéspedes sin perder los datos cargados.
    let res = $('#form-res');
    if (res) res.hidden = modo === 'whatsapp';
    if (!res && modo !== 'whatsapp') {
      res = document.createElement('div'); res.id = 'form-res'; res.className = 'form__res';
      $('h3', f).after(res);
      res.addEventListener('click', e => { if (e.target.closest('button')) { f.hidden = true; $('#reservar').scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
    }
    // Correo obligatorio y elección del medio de pago solo en la reserva instantánea.
    const email = f.email, lab = email.closest('label');
    email.required = modo === 'instantanea';
    lab.firstChild.textContent = modo === 'instantanea' ? 'Correo electrónico (te enviamos el comprobante) ' : 'Correo electrónico ';
    const small = $('small', lab); if (small) small.hidden = modo === 'instantanea';
    let medios = $('#medios');
    if (modo === 'instantanea' && !medios) {
      medios = document.createElement('fieldset'); medios.id = 'medios'; medios.className = 'medios';
      medios.innerHTML = `<legend>¿Cómo querés pagar la seña?</legend>
        <label class="medio"><input type="radio" name="medio" value="mercadopago" checked><span><b>Mercado Pago</b><small>Débito, crédito o dinero en cuenta · se acredita al instante</small></span></label>
        <label class="medio"><input type="radio" name="medio" value="transferencia"><span><b>Transferencia bancaria</b><small>Retenemos tus fechas 48 h y confirmamos cuando verificamos la acreditación</small></span></label>`;
      f.insertBefore(medios, $('.terms', f));
      medios.addEventListener('change', actualizarFormulario);
    }
    if (medios) medios.hidden = modo !== 'instantanea';
    actualizarFormulario();
  }
  function actualizarFormulario() {
    // El texto del botón se ajusta SIEMPRE al modo (aunque el formulario esté cerrado), para que nunca quede el de WhatsApp en modo automático.
    const f = $('#form'); if (!f) return;
    const hay = !!(st.in && st.out), m = hay ? montosActuales() : null, modo = modoWeb();
    const res = $('#form-res');
    if (res && hay) { const n = nightsBetween(st.in, st.out), g = guests(); res.innerHTML = `<div><b>${fmtDate(st.in)} → ${fmtDate(st.out)}</b><span>${n} noches · ${g} ${g === 1 ? 'huésped' : 'huéspedes'}${m ? ` · Total ${money(m.total)} · Seña ${money(m.sena)}` : ''}</span></div>
      <button type="button" class="link">Cambiar fechas o huéspedes</button>`; }
    const boton = f.querySelector('button[type=submit]');
    if (boton.dataset.enviando) return;
    boton.textContent = modo === 'instantanea'
      ? (medioElegido() === 'transferencia' ? `Reservar y pagar por transferencia${m ? ` (seña ${money(m.sena)})` : ''}` : `Pagar la seña${m ? ` de ${money(m.sena)}` : ''} con Mercado Pago`)
      : modo === 'solicitud' ? 'Enviar solicitud (sin pagar)' : 'Preparar mensaje de WhatsApp';
  }

  /* ---------- RESERVA INSTANTÁNEA ----------
     Retiene las fechas en el servidor y lleva al huésped a su enlace privado (reserva.html), donde paga la seña,
     sigue el estado y, al confirmarse, ve el comprobante. */
  const guardarReserva = (numero, acceso) => { try { const m = JSON.parse(localStorage.getItem('cc_reservas') || '{}'); m[numero] = acceso; localStorage.setItem('cc_reservas', JSON.stringify(m)); } catch { } };
  let idemClave = null, idemDatos = null;
  async function reservarAhora(f, datos) {
    const err = $('#form-err'), boton = f.querySelector('button[type=submit]');
    if (!tsToken) { err.textContent = 'Completá la verificación de seguridad (el recuadro de arriba).'; return; }
    const cuerpo = { ingreso: st.in, salida: st.out, adultos: st.adultos, menores: st.menores, ...datos, medio_pago: medioElegido(), acepto: true };
    if (clavePrueba()) { try { const v = Number(sessionStorage.getItem('cc_vence_prueba')); if (v) cuerpo.vence_en_segundos = v; } catch { } }
    const huella = JSON.stringify({ ...cuerpo });
    if (huella !== idemDatos) { idemDatos = huella; idemClave = crypto.randomUUID(); } // reintento tras un corte: misma clave, misma reserva
    boton.disabled = true; boton.dataset.enviando = '1'; boton.textContent = 'Reservando tus fechas…'; err.textContent = '';
    let d = null, status = 0, falla = '';
    try {
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 30000);
      const r = await fetch(CASA.api_reservas.replace(/\/$/, '') + '/api/reservas', {
        method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', 'idempotency-key': idemClave, ...(clavePrueba() ? { 'x-clave-pruebas': clavePrueba() } : {}) },
        body: JSON.stringify({ ...cuerpo, turnstile: tsToken })
      });
      clearTimeout(to); status = r.status; d = await r.json().catch(() => ({}));
    } catch (e) {
      // Se distingue la causa real: tiempo agotado, solicitud que el navegador no pudo armar, o red/bloqueo.
      status = 0;
      falla = e && e.name === 'AbortError' ? 'tiempo' : /ISO-8859-1|headers|Invalid/i.test(String(e && e.message)) ? 'armado' : 'red';
      DIAG.fallidas.push(`reserva no enviada (${falla}): ${String(e && e.message || e).slice(0, 140)}`);
    }
    if ((status === 200 || status === 201) && d && d.acceso) {
      guardarReserva(d.numero, d.acceso);
      location.href = 'reserva.html#t=' + encodeURIComponent(d.acceso);
      return;
    }
    // El token de Turnstile es de un solo uso: se renueva el desafío y el botón espera la nueva verificación. Los datos quedan.
    delete boton.dataset.enviando; reintentarTurnstile(); actualizarFormulario();
    if (status !== 0) idemDatos = null; // respuesta definitiva: el próximo intento es una reserva nueva
    if (status === 409) { SRV = null; err.textContent = (d && d.mensaje) || 'Esas fechas ya no están disponibles. Elegí otras fechas.'; return; }
    err.textContent = status === 0
      ? (falla === 'tiempo' ? 'El servidor tardó demasiado en responder. Probá de nuevo en un momento: si la reserva se había creado, no se duplica.'
        : falla === 'armado' ? 'Tu navegador no pudo enviar la reserva (dato con caracteres inválidos). Recargá la página e intentá de nuevo.'
        : 'No pudimos conectarnos con el servidor. Revisá tu conexión (o un bloqueador de anuncios) y probá de nuevo: si la reserva se había creado, no se duplica.')
      : (d && d.mensaje) || 'No pudimos completar la reserva. Probá de nuevo o escribinos por WhatsApp.';
  }

  /* ---------- SOLICITUD EN LÍNEA (etapa 1) ----------
     Si está habilitada en casa.json, la solicitud se registra en el servidor (con Turnstile) y el huésped recibe
     un número. NO retiene fechas: los dueños aprueban la disponibilidad. WhatsApp sigue como alternativa. */
  // MODO PRUEBA PRIVADO (solo dueños): abrir la web con #prueba y pegar la clave de pruebas. Las solicitudes quedan
  // marcadas como PRUEBA y no bloquean calendarios. Sin la clave, el servidor las rechaza. Los visitantes no ven nada.
  const CLAVE_SS = 'cc_clave_pruebas';
  // La clave viaja en un encabezado HTTP: solo admite caracteres visibles ASCII. Un carácter invisible pegado sin querer
  // (BOM, espacio de ancho cero, salto) hace que el navegador NO envíe la solicitud ("No pudimos conectarnos"). Se limpia siempre.
  const limpiarClave = s => String(s || '').replace(/[^\x21-\x7E]/g, '');
  const ssGet = () => { try { return limpiarClave(sessionStorage.getItem(CLAVE_SS)); } catch { return ''; } };
  const clavePrueba = () => (CASA && CASA.api_reservas && CASA.turnstile_site_key ? ssGet() : '');
  function activarModoPrueba() { // se llama después de cargar casa.json
    // Solo modo prueba: "#prueba&vence=120" acorta la retención (5 a 600 s) para probar vencimientos. El servidor lo ignora sin la clave.
    const v = Number((location.hash.match(/[#&]vence=(\d+)/) || [])[1]);
    try { if (v >= 5 && v <= 600) sessionStorage.setItem('cc_vence_prueba', String(v)); else if (location.hash.startsWith('#prueba')) sessionStorage.removeItem('cc_vence_prueba'); } catch { }
    if (location.hash.startsWith('#prueba') && clavePrueba() === '' && CASA && CASA.api_reservas && CASA.turnstile_site_key) {
      const k = limpiarClave(window.prompt('Modo prueba (solo dueños). Pegá la clave de pruebas:'));
      if (k.length >= 32) { try { sessionStorage.setItem(CLAVE_SS, k); } catch { } }
      else if (k) window.alert('Esa clave es demasiado corta: el modo prueba no se activó.');
    }
    if (!clavePrueba()) return;
    const b = document.createElement('div');
    b.id = 'prueba-franja';
    b.textContent = '🧪 Modo prueba: las reservas se registran como PRUEBA y no bloquean fechas reales. ';
    const dg = document.createElement('button'); dg.type = 'button'; dg.textContent = 'Diagnóstico'; dg.style.marginRight = '6px';
    dg.onclick = () => { const p = document.getElementById('prueba-diag'); if (p) { p.remove(); return; } mostrarDiagnostico(); };
    const x = document.createElement('button'); x.type = 'button'; x.textContent = 'Salir';
    x.onclick = () => { try { sessionStorage.removeItem(CLAVE_SS); sessionStorage.removeItem('cc_vence_prueba'); } catch { } location.href = location.pathname; };
    b.append(dg, x);
    b.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#964d2c;color:#fff;padding:8px 12px;font:14px system-ui,sans-serif;text-align:center';
    document.body.appendChild(b);
    actualizarFormulario(); // el formulario ya nace con el botón del recorrido automático
  }

  /* ---------- PANEL DE DIAGNÓSTICO (temporal, solo modo prueba; nunca muestra la clave ni datos personales) ---------- */
  async function mostrarDiagnostico() {
    const p = document.createElement('div'); p.id = 'prueba-diag';
    p.style.cssText = 'position:fixed;left:8px;right:8px;bottom:52px;max-height:70vh;overflow:auto;z-index:9999;background:#fff;color:#222;border:2px solid #964d2c;border-radius:12px;padding:12px 14px;font:13px/1.45 system-ui,sans-serif;box-shadow:0 8px 30px #0004';
    p.textContent = 'Revisando…'; document.body.appendChild(p);
    const filas = [], si = (c, a, b) => (c ? '✅ ' + a : '❌ ' + b);
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const fila = (t, v) => filas.push(`<tr><th style="text-align:left;vertical-align:top;padding:3px 8px 3px 0;white-space:nowrap">${esc(t)}</th><td style="padding:3px 0">${v}</td></tr>`);
    // 1) Versión que está ejecutando ESTE navegador y versión publicada ahora
    const tag = document.querySelector('script[src*="js/app.js"]'), src = tag ? tag.getAttribute('src') : '(no encontrado)';
    let publicada = null;
    try { const html = await (await fetch('./?diag=' + Date.now(), { cache: 'no-store' })).text(); publicada = (html.match(/js\/app\.js(\?v=[0-9a-f]+)?/) || [])[0]; } catch { }
    const entrada = tag && performance.getEntriesByName(tag.src)[0];
    fila('Versión de app.js', `${esc(VERSION_WEB)} · cargado como <code>${esc(src)}</code>${entrada ? (entrada.transferSize === 0 ? ' · desde la caché del navegador' : ' · descargado ahora') : ''}`);
    fila('Versión publicada', publicada ? si(publicada === src, `al día (<code>${esc(publicada)}</code>)`, `HAY UNA VERSIÓN MÁS NUEVA: <code>${esc(publicada)}</code>`) : '⚠️ no se pudo consultar');
    // 2) Modo prueba en el navegador
    const clave = ssGet();
    fila('Franja «Modo prueba»', '✅ visible');
    fila('Clave en esta pestaña', clave ? `✅ guardada (${clave.length} caracteres; no se muestra)` : '❌ no hay clave');
    let cruda = ''; try { cruda = sessionStorage.getItem(CLAVE_SS) || ''; } catch { }
    if (cruda && cruda !== clave) fila('Caracteres invisibles', `⚠️ la clave guardada tenía ${cruda.length - clave.length} carácter(es) invisible(s) pegados sin querer; se limpian automáticamente antes de enviar`);
    // 3) ¿El servidor reconoce la clave?
    let servidor = '⚠️ no se pudo consultar';
    try {
      const r = await fetch(CASA.api_reservas.replace(/\/$/, '') + '/api/salud', { headers: { 'x-clave-pruebas': clave }, cache: 'no-store' });
      const s = await r.json();
      servidor = s.modo_reserva === 'instantanea' ? '✅ el servidor RECONOCE la clave (reservas de prueba autorizadas)' : `❌ el servidor NO reconoce la clave (responde modo «${esc(s.modo_reserva)}»): no coincide con CLAVE_PRUEBAS`;
      fila('Servidor (producción)', `pagos reales ${s.pagos_habilitados ? '❗ activados' : 'apagados'} · Mercado Pago «${esc(s.modo_mercado_pago)}» · confirmación automática real ${s.confirmacion_automatica ? '❗ activada' : 'apagada'}`);
    } catch { }
    fila('Clave de pruebas', servidor);
    // 4 y 5) Modo efectivo y condiciones que lo deciden
    const modo = modoWeb();
    fila('Modo de reserva en esta página', { instantanea: '✅ RESERVA AUTOMÁTICA (recorrido nuevo)', solicitud: '⚠️ solicitudes con aprobación', whatsapp: '❌ WhatsApp (formulario anterior)' }[modo]);
    fila('Condiciones', [
      si(!!(CASA && CASA.api_reservas), 'servidor configurado (api_reservas)', 'falta api_reservas en casa.json'),
      si(!!(CASA && CASA.turnstile_site_key), 'clave pública de Turnstile', 'falta turnstile_site_key en casa.json'),
      si(!!clavePrueba(), 'clave de pruebas activa', 'sin clave de pruebas'),
      `casa.json: modo_reserva = ${esc(CASA && CASA.modo_reserva || '(no definido)')}, solicitudes_en_linea = ${esc(CASA && CASA.solicitudes_en_linea)}`,
      'Regla: con api_reservas + Turnstile + clave de pruebas → reserva automática; si falta cualquiera → WhatsApp.'
    ].join('<br>'));
    const bt = $('#form button[type=submit]');
    fila('Lo que se ve ahora', `botón de fechas: «${esc($('#btn-seguir').textContent)}» · botón del formulario: «${esc(bt ? bt.textContent : '')}» · ${$('#form').hidden ? 'formulario cerrado' : 'formulario abierto'}`);
    // Turnstile: estado del widget en esta página y validez del secreto en el servidor (sin mostrar tokens ni claves)
    fila('Turnstile (esta página)', tsWidget === null ? 'sin cargar todavía (se carga al abrir el formulario)' : `${tsToken ? '✅ verificación completa' : '⏳ esperando verificación'}${tsEstado && tsEstado !== 'ok' ? ' · último evento: ' + esc(tsEstado) : ''}`);
    try {
      const t = await (await fetch(CASA.api_reservas.replace(/\/$/, '') + '/api/pruebas/turnstile', { cache: 'no-store' })).json();
      fila('Turnstile (servidor)', !t.configurado ? '❌ TURNSTILE_SECRET no está cargado' : t.secreto_valido ? `✅ Cloudflare acepta el secreto (${t.largo} caracteres)` : `❌ Cloudflare RECHAZA el secreto: ${esc((t.cloudflare || []).join(', '))} (${t.largo} caracteres${t.empieza_con_0x ? '' : ', no empieza con 0x'}${t.espacios_o_saltos ? ', con espacios o saltos' : ''})`);
    } catch { }
    // 6) Errores y solicitudes fallidas
    fila('Errores de JavaScript', DIAG.errores.length ? '❌ ' + DIAG.errores.map(esc).join('<br>') : '✅ ninguno');
    fila('Solicitudes fallidas', DIAG.fallidas.length ? '⚠️ ' + DIAG.fallidas.map(esc).join('<br>') : '✅ ninguna');
    // 7) Almacenamiento y estado anterior
    let ss = [], ls = [], mis = 0;
    try { ss = Object.keys(sessionStorage); ls = Object.keys(localStorage); mis = Object.keys(JSON.parse(localStorage.getItem('cc_reservas') || '{}')).length; } catch { }
    fila('Almacenamiento', `sesión: ${esc(ss.join(', ') || '(vacío)')} · local: ${esc(ls.join(', ') || '(vacío)')}${mis ? ` · ${mis} reserva(s) guardada(s)` : ''}`);
    fila('Navegador', esc(navigator.userAgent.replace(/\s*\(KHTML, like Gecko\)/, '').slice(0, 160)));
    fila('Dirección', esc(location.origin + location.pathname + location.search) + ' · ' + esc(location.hash.split('&')[0]));
    const actualizar = publicada && publicada !== src;
    p.innerHTML = `<b>Diagnóstico del modo prueba</b> <span style="color:#666">(no muestra claves ni datos personales)</span>
      <table style="width:100%;border-collapse:collapse;margin-top:6px">${filas.join('')}</table>
      <p style="margin:8px 0 0">${actualizar ? '<button type="button" id="diag-nueva">Cargar la versión nueva</button> ' : ''}<button type="button" id="diag-copiar">Copiar diagnóstico</button> <button type="button" id="diag-cerrar">Cerrar</button></p>`;
    if (actualizar) $('#diag-nueva').onclick = () => location.replace(location.pathname + '?v=' + Date.now() + '#prueba');
    $('#diag-copiar').onclick = async () => { try { await navigator.clipboard.writeText(p.innerText); $('#diag-copiar').textContent = '¡Copiado!'; } catch { } };
    $('#diag-cerrar').onclick = () => p.remove();
  }
  const enLinea = () => modoWeb() !== 'whatsapp';
  let tsToken = null, tsWidget = null;
  // Turnstile: éxito, error, expiración y tiempo agotado. Mientras no haya un token válido, el botón de pago no avanza.
  // Si algo falla, "Reintentar verificación" renueva el desafío SIN borrar los datos cargados.
  let tsEstado = '';
  const tsMsg = t => { let m = $('#ts-msg'); if (!m) { m = document.createElement('p'); m.id = 'ts-msg'; m.className = 'form__err'; m.setAttribute('role', 'status'); $('#ts').after(m); } m.innerHTML = t || ''; };
  function reintentarTurnstile() { tsToken = null; tsMsg(''); if (window.turnstile && typeof tsWidget === 'string' && tsWidget !== 'cargando') window.turnstile.reset(tsWidget); bloquearPago(); }
  function bloquearPago() {
    const b = $('#form button[type=submit]'); if (!b || !enLinea() || tsWidget === null) return;
    b.disabled = !tsToken; b.style.opacity = tsToken ? '' : '.55';
    if (!tsToken) b.title = 'Completá la verificación de seguridad'; else b.removeAttribute('title');
  }
  document.addEventListener('click', e => { if (e.target && e.target.id === 'ts-reintentar') reintentarTurnstile(); });
  function prepararTurnstile() {
    if (!enLinea() || tsWidget !== null) return;
    const cont = $('#ts'); cont.hidden = false;
    const conReintento = t => tsMsg(t + ' <button type="button" class="link" id="ts-reintentar">Reintentar verificación</button>');
    const render = () => {
      tsWidget = window.turnstile.render(cont, {
        sitekey: CASA.turnstile_site_key, language: 'es', retry: 'auto', 'refresh-expired': 'auto',
        callback: t => { tsToken = t; tsEstado = 'ok'; tsMsg(''); bloquearPago(); },
        'expired-callback': () => { tsToken = null; tsEstado = 'expirado'; bloquearPago(); conReintento('La verificación venció.'); },
        'timeout-callback': () => { tsToken = null; tsEstado = 'tiempo'; bloquearPago(); conReintento('La verificación tardó demasiado.'); },
        'error-callback': codigo => { tsToken = null; tsEstado = 'error ' + codigo; bloquearPago(); DIAG.errores.push('Turnstile error-callback: ' + codigo); conReintento(`No se pudo completar la verificación (código ${String(codigo).replace(/[^\w-]/g, '')}).`); return true; }
      });
      bloquearPago();
    };
    if (window.turnstile) return render();
    tsWidget = 'cargando';
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true;
    s.onload = render; s.onerror = () => { tsWidget = null; cont.hidden = true; tsMsg('No se pudo cargar la verificación de seguridad. Revisá tu conexión o escribinos por WhatsApp.'); };
    document.head.appendChild(s);
  }
  async function enviarSolicitud(datos) {
    if (!enLinea() || !tsToken) return { error: 'sin_verificacion' };
    try {
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 12000);
      const r = await fetch(CASA.api_reservas.replace(/\/$/, '') + '/api/solicitudes', {
        method: 'POST', headers: { 'content-type': 'application/json', ...(clavePrueba() ? { 'x-clave-pruebas': clavePrueba() } : {}) }, signal: ctl.signal,
        body: JSON.stringify({ ingreso: st.in, salida: st.out, adultos: st.adultos, menores: st.menores, ...datos, acepto: true, turnstile: tsToken })
      });
      clearTimeout(to);
      const d = await r.json().catch(() => ({}));
      return r.ok ? d : { error: d.mensaje || 'error' };
    } catch { return { error: 'sin_conexion' }; }
    finally { tsToken = null; if (window.turnstile && typeof tsWidget === 'string' && tsWidget !== 'cargando') window.turnstile.reset(tsWidget); }
  }

  /* ---------- FORMULARIO → (SOLICITUD EN LÍNEA) + WHATSAPP ---------- */
  $('#form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, err = $('#form-err');
    const nombre = f.nombre.value.trim(), tel = f.telefono.value.trim(), email = f.email.value.trim(), obs = f.obs.value.trim();
    f.nombre.setAttribute('aria-invalid', !nombre); f.telefono.setAttribute('aria-invalid', tel.replace(/\D/g, '').length < 8);
    if (!nombre) return err.textContent = 'Completá tu nombre y apellido.';
    if (tel.replace(/\D/g, '').length < 8) return err.textContent = 'Completá un teléfono válido.';
    if (!f.acepto.checked) return err.textContent = 'Para continuar tenés que aceptar las condiciones de la reserva.';
    if (modoWeb() === 'instantanea') {
      f.email.setAttribute('aria-invalid', !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email));
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err.textContent = 'Completá un correo válido: ahí te enviamos el comprobante.';
      return reservarAhora(f, { nombre, telefono: tel, email, observaciones: obs });
    }
    if (enLinea() && tsWidget !== null && !tsToken) return err.textContent = 'Completá la verificación de seguridad (el recuadro de arriba).';
    err.textContent = '';
    let sol = null;
    if (enLinea() && tsWidget !== null) {
      const boton = f.querySelector('button[type=submit]'), txt = boton.textContent;
      boton.disabled = true; boton.textContent = 'Enviando solicitud…';
      sol = await enviarSolicitud({ nombre, telefono: tel, email, observaciones: obs });
      boton.disabled = false; boton.textContent = txt;
    }
    const num = $('#sol-num'), enviada = !!(sol && sol.numero);
    // Solicitud registrada: WhatsApp pasa a ser opcional y los datos de pago aparecen recién cuando se aprueba.
    $('#done h3').textContent = enviada ? 'Solicitud enviada' : 'Revisá tu mensaje y envialo';
    $('#done .pay').hidden = enviada;
    $('#wa-msg').hidden = enviada; $('#wa-msg').previousElementSibling.hidden = enviada;
    $('#wa-link').textContent = enviada ? 'Escribinos por WhatsApp (opcional)' : 'Enviar solicitud por WhatsApp';
    $('#wa-link').classList.toggle('btn--ghost-dark', enviada); $('#wa-link').classList.toggle('btn--wa', !enviada);
    if (enviada) {
      num.hidden = false; num.className = 'done__num';
      num.innerHTML = `Tu número de solicitud es <b>${sol.numero}</b>. <strong>Todavía no está reservada:</strong> revisamos la disponibilidad y te respondemos. No tenés que hacer nada más.`;
    } else if (sol && sol.error) {
      num.hidden = false; num.className = 'done__num done__num--aviso';
      num.textContent = 'No pudimos registrar la solicitud en línea. Enviala por WhatsApp con el botón de abajo.';
    } else num.hidden = true;
    const n = nightsBetween(st.in, st.out), g = guests();
    // Si el servidor verificó estas mismas fechas y huéspedes, se usan sus montos.
    const srvOk = SRV && SRV.key === claveSrv() && SRV.data && !SRV.error && SRV.data.disponible;
    const p = srvOk ? SRV.data.precio_noche : pricePerNight(g);
    const lines = [
      'Hola! Quiero solicitar una reserva en Casa Campo Las Maravillas.' + (sol && sol.numero ? ` (Solicitud N° ${sol.numero})` : ''), '',
      `• Ingreso: ${fmtDate(st.in)} (de 15 a 18 h)`,
      `• Salida: ${fmtDate(st.out)} (hasta las 11 h)`,
      `• Noches: ${n}`,
      `• Huéspedes: ${g} (${st.adultos} ${st.adultos === 1 ? 'adulto' : 'adultos'}${st.menores ? ` y ${st.menores} ${st.menores === 1 ? 'menor' : 'menores'}` : ''})`
    ];
    if (p != null) {
      const total = p * n;
      lines.push(`• Total: ${money(total)} (${money(p)} por noche)`, `• Seña ${SENA} %: ${money(total * SENA / 100)}`);
      $('#pay-amount').textContent = money(total * SENA / 100);
    } else { lines.push('• Precio: a consultar'); $('#pay-amount').textContent = 'el 50 % del total'; }
    lines.push('', `Nombre: ${nombre}`, `Teléfono: ${tel}`);
    if (email) lines.push(`Correo: ${email}`);
    if (obs) lines.push(`Comentario: ${obs}`);
    lines.push('', 'Leí y acepto las condiciones de la reserva.');
    $('#wa-msg').value = lines.join('\n'); updateWa();
    f.hidden = true; $('#done').hidden = false;
    $('#done').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  function updateWa() { $('#wa-link').href = `https://wa.me/${CASA ? CASA.contacto.whatsapp : '5492664546558'}?text=${encodeURIComponent($('#wa-msg').value)}`; }
  $('#wa-msg').addEventListener('input', updateWa);
  $('#btn-volver').onclick = () => { $('#done').hidden = true; $('#form').hidden = false; $('#form').scrollIntoView({ behavior: 'smooth' }); };
  $('#copy-alias').onclick = async () => {
    const t = $('#alias').textContent, b = $('#copy-alias');
    try { await navigator.clipboard.writeText(t); } catch {
      const r = document.createRange(); r.selectNodeContents($('#alias')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.execCommand('copy');
    }
    b.textContent = '¡Copiado!'; setTimeout(() => { b.textContent = 'Copiar alias'; }, 2000);
  };

  /* ---------- VERIFICACIÓN DE LA SINCRONIZACIÓN ----------
     Un calendario vacío NO significa que no haya reservas: solo se considera
     verificado si todas las fuentes esperadas respondieron bien y hace poco. */
  let VERIFICADO = false;
  const nombreFuente = n => ({ booking: 'Booking', airbnb: 'Airbnb', vrbo: 'Vrbo' })[n] || n;
  function estadoSync(data, sync) {
    const p = [], esperadas = data.fuentes_esperadas || [], maxH = data.sync_max_horas || 26;
    if (!sync || !sync.actualizado) p.push('no pudimos comprobar la sincronización con las plataformas');
    else {
      const fuentes = sync.fuentes || {};
      if (!Object.keys(fuentes).length) p.push('no hay calendarios de plataformas conectados');
      else esperadas.forEach(n => { if (!fuentes[n]) p.push(`el calendario de ${nombreFuente(n)} no está conectado`); });
      Object.entries(fuentes).forEach(([n, f]) => { if (!f.ok) p.push(`no pudimos actualizar el calendario de ${nombreFuente(n)}`); });
      const horas = (Date.now() - new Date(sync.actualizado)) / 36e5;
      if (!(horas <= maxH)) p.push(`la última sincronización fue hace más de ${maxH} horas`);
    }
    if (!data.calendario_actualizado) p.push('las reservas directas todavía no están todas cargadas');
    if (![...busy].some(d => d >= today)) p.push('el calendario no muestra ninguna fecha ocupada');
    return p;
  }

  /* ---------- CARGA DE DATOS ---------- */
  const getJson = u => fetch(u, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  Promise.all([getJson('data/casa.json'), getJson('data/ocupadas-sync.json').catch(() => null)]).then(([data, sync]) => {
    CASA = data;
    MAX = data.capacidad_maxima || 11;
    MIN_N = data.tarifas.estadia_minima_noches || 2;
    SENA = data.reserva.sena_porcentaje || 50;
    busy = new Set();
    const bloques = [...(data.ocupadas || []), ...((sync && sync.ocupadas) || [])];
    const valido = b => b && /^\d{4}-\d{2}-\d{2}$/.test(b.desde) && /^\d{4}-\d{2}-\d{2}$/.test(b.hasta) && b.hasta > b.desde;
    bloques.filter(valido).forEach(b => { for (let d = b.desde; d < b.hasta; d = addDays(d, 1)) busy.add(d); });
    const problemas = estadoSync(data, sync);
    VERIFICADO = !problemas.length;
    if (VERIFICADO) {
      $('#aviso-cal').hidden = true;
      const mins = Math.max(1, Math.round((Date.now() - new Date(sync.actualizado)) / 6e4));
      const hace = mins < 60 ? `hace ${mins} min` : mins < 1440 ? `hace ${Math.round(mins / 60)} h` : (d => `hace ${d} ${d === 1 ? 'día' : 'días'}`)(Math.round(mins / 1440));
      const p = document.createElement('p'); p.className = 'cal__sync';
      p.textContent = `Sincronizado con ${Object.keys(sync.fuentes).map(nombreFuente).join(', ')} · actualizado ${hace}`;
      $('#cal').appendChild(p);
    } else {
      const t = problemas.join('; ');
      $('#aviso-cal').textContent = modoWeb() === 'instantanea'
        ? `Calendario con demora: ${t}. Antes de cobrar la seña, el sistema verifica la disponibilidad en vivo.`
        : `Disponibilidad a confirmar: ${t}. Antes de reservar te confirmamos las fechas${modoWeb() === 'solicitud' ? '' : ' por WhatsApp'}.`;
      $('#aviso-cal').hidden = false;
    }
    $('#alias').textContent = data.reserva.pago.alias;
    if (data.contacto.tiktok_url) $('#tiktok').href = data.contacto.tiktok_url;
    const min = Math.min(...Object.values(data.tarifas.por_huespedes));
    $('#mbar-price').textContent = 'Desde ' + money(min);
    // El modo prueba se activa ANTES de dibujar: así el botón y la cotización ya nacen en el modo correcto
    // (antes, la primera vez que se ingresaba la clave, se dibujaban en modo WhatsApp).
    activarModoPrueba();
    renderCal(); renderGuests();
  }).catch(() => {
    $('#cal-months').innerHTML = '<p>No pudimos cargar el calendario. Escribinos por WhatsApp y te pasamos disponibilidad y precio.</p>';
  });
})();
