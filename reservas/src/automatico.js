/*
  RESERVA AUTOMÁTICA (Fase 1) · Casa Campo Las Maravillas

  Recorrido: fechas → cotización → datos → retención provisional → pago de la seña → verificación → confirmación.

  1. POST /api/reservas: valida Turnstile, precio y disponibilidad (base propia + proveedor externo). Retiene las noches
     en D1 en UNA transacción (imposible que dos personas retengan la misma noche) y, si hay gestor de canales,
     crea la reserva provisional ahí. Si el gestor no responde o hay dudas, NO se cobra: se informa y se ofrece WhatsApp.
       · Mercado Pago: retención RETENCION_MP_MINUTOS (30); la orden vence antes (margen ORDEN_MARGEN_MIN).
       · Transferencia: retención RETENCION_TRANSFERENCIA_HORAS (48); un dueño verifica la acreditación en el panel.
  2. El huésped sigue todo en su enlace privado (reserva.html#t=…): pagar, estado, comprobante.
  3. Seña acreditada (Mercado Pago verificado o transferencia marcada) → intentarConfirmacion():
       confirma SOLO si: la confirmación automática está autorizada, el proveedor cierra los canales de verdad
       (nunca con iCal), la retención en el gestor existe y una consulta final sale "libre". Si algo falla o hay
       dudas: queda como EXCEPCIÓN, con aviso por Telegram, y no se confirma.
  4. Si el pago falla o vence: se liberan las noches y la retención del gestor (con reintentos y aviso si no se puede).
*/
import {
  json, ErrorUsuario, leerJson, ahora, datosCasa, calendarioPublicado, validarEstadia, validarContacto, calcularPrecio,
  revisarDisponibilidad, claveDePruebaValida, verificarTurnstile, limitar, listaNoches, addDays, evento, generarOrden,
  exigirModoPrueba, enviarTelegram, notificarHuesped, fmtFecha, fmtPesos, numeroSolicitud, claveNoche, mpFetch, fechaValida, esperarIdempotencia
} from './index.js';
import { proveedorPara } from './disponibilidad.js';

const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha256 = async t => hex(await crypto.subtle.digest('SHA-256', enc.encode(t)));
const ACTIVAS = ['bloqueo', 'pendiente_pago', 'pago_en_proceso', 'pago_verificado', 'confirmada'];

// El enlace del huésped se DERIVA del id con un secreto (ACCESO_SECRETO): así una solicitud repetida puede devolver
// el mismo enlace sin guardarlo. En la base solo queda su SHA-256.
async function tokenAcceso(env, id) {
  const s = (env.ACCESO_SECRETO || '').trim();
  if (s.length < 32) throw new ErrorUsuario('sin_configurar', 'El sistema de reservas no está configurado.', 503);
  const k = await crypto.subtle.importKey('raw', enc.encode(s), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', k, enc.encode('acceso:' + id)));
}

export function modoReserva(env, esPrueba) {
  return esPrueba ? 'instantanea' : (env.MODO_RESERVA || 'whatsapp');
}

async function avisarDuenos(env, texto) {
  try { return await enviarTelegram(env, texto); } catch (e) { console.warn('Telegram falló', e && e.message); return { ok: false }; }
}
const etiqueta = r => (r.origen === 'prueba' ? '🧪 PRUEBA · ' : '') + (r.numero || r.id.slice(0, 8));
const panelUrl = env => (env.PANEL_URL || '').trim();

/* ---------- 1) Iniciar reserva ---------- */

export async function iniciarReserva(req, env, ctx, cors) {
  const esPrueba = await claveDePruebaValida(req, env);
  if (!esPrueba) await limitar(env.LIMITE_BLOQUEOS, req);
  const clave = (req.headers.get('idempotency-key') || '').trim();
  if (!/^[A-Za-z0-9-]{16,64}$/.test(clave)) throw new ErrorUsuario('idempotencia', 'Falta el encabezado Idempotency-Key.');
  const body = await leerJson(req);
  const medio = body.medio_pago === 'transferencia' ? 'transferencia' : 'mercadopago';
  console.log('reserva: pedido recibido', JSON.stringify({ prueba: esPrueba, medio, ingreso: body.ingreso, salida: body.salida }));
  if (!esPrueba) {
    if (env.MODO_RESERVA !== 'instantanea') throw new ErrorUsuario('no_habilitado', 'Por ahora las reservas se reciben por WhatsApp.', 403);
    if (medio === 'mercadopago' && env.PAGOS_HABILITADOS !== 'true') throw new ErrorUsuario('no_habilitado', 'El pago con Mercado Pago todavía no está habilitado.', 403);
  }
  // Repetición de la misma solicitud (corte de conexión, doble clic): misma reserva y mismo enlace.
  const previa = await env.DB.prepare('SELECT reserva_id FROM idempotencia WHERE clave = ?').bind(clave).first();
  if (previa) return await respuestaInicio(env, previa.reserva_id, cors, 200);

  const ts = await verificarTurnstile(env, body.turnstile, req.headers.get('cf-connecting-ip'));
  // Un secreto mal configurado NO es culpa del visitante: se informa distinto (y queda en el registro con el código de Cloudflare).
  if (!ts.ok && /invalid-input-secret|missing-input-secret|turnstile_sin_configurar/.test(ts.motivo)) {
    throw new ErrorUsuario('verificacion_no_disponible', 'No pudimos completar la verificación por un problema técnico de nuestro lado. Probá más tarde o escribinos por WhatsApp.', 503);
  }
  if (!ts.ok) throw new ErrorUsuario('verificacion_fallida', 'No pudimos verificar que no seas un robot. Tocá «Reintentar verificación» y probá de nuevo.', 403);
  const casa = await datosCasa(env);
  const e = validarEstadia(body, casa);
  const c = validarContacto(body);
  if (!c.email) throw new ErrorUsuario('email_invalido', 'Completá tu correo: ahí te enviamos el comprobante.');
  const precio = calcularPrecio(casa, e);
  const origen = esPrueba ? 'prueba' : 'web';

  // a) Base propia + copia de Booking/Airbnb publicada.
  const disp = await revisarDisponibilidad(env, casa, e, { incluirPruebas: esPrueba });
  if (!disp.disponible) {
    const misma = await esperarIdempotencia(env, clave); // doble envío simultáneo: misma reserva, no "ocupado"
    if (misma) return await respuestaInicio(env, misma, cors, 200);
    throw new ErrorUsuario('no_disponible', 'Esas fechas ya no están disponibles. Elegí otras fechas.', 409);
  }
  // b) Proveedor externo EN VIVO (iCal o gestor de canales). Ante la duda, no se cobra.
  const prov = proveedorPara(env, { origen });
  const vivo = await prov.consultar({ ingreso: e.ingreso, salida: e.salida });
  if (vivo.estado === 'ocupado') throw new ErrorUsuario('no_disponible', 'Esas fechas acaban de ocuparse en otra plataforma. Elegí otras fechas.', 409);
  if (vivo.estado !== 'libre') throw new ErrorUsuario('disponibilidad_no_verificada', 'No pudimos verificar la disponibilidad en este momento. Probá en unos minutos o escribinos por WhatsApp.', 503);

  const id = crypto.randomUUID(), t = ahora();
  const segPrueba = esPrueba ? Number.parseInt(body.vence_en_segundos, 10) : NaN;
  const ms = Number.isInteger(segPrueba) && segPrueba >= 5 && segPrueba <= 600 ? segPrueba * 1000
    : medio === 'mercadopago' ? Number(env.RETENCION_MP_MINUTOS || 30) * 60e3 : Number(env.RETENCION_TRANSFERENCIA_HORAS || 48) * 3600e3;
  const vence = new Date(Date.now() + ms).toISOString();
  const acceso = await tokenAcceso(env, id);
  let numero = null;
  for (let i = 0; i < 4 && !numero; i++) {
    const n = numeroSolicitud(e.ingreso);
    try {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO reservas (id, creada, actualizada, estado, ingreso, salida, noches, adultos, menores, huespedes, precio_noche, total, sena, saldo,
          moneda, nombre, telefono, email, observaciones, vence_en, origen, numero, acceso_hash, modo, medio_pago, cm_proveedor, cm_estado)
          VALUES (?, ?, ?, 'bloqueo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'instantanea', ?, ?, 'pendiente')`)
          .bind(id, t, t, e.ingreso, e.salida, e.noches, e.adultos, e.menores, e.huespedes, precio.precio_noche, precio.total, precio.sena, precio.saldo,
            precio.moneda, c.nombre, c.telefono, c.email, c.observaciones, vence, origen, n, await sha256(acceso), medio, prov.nombre),
        ...listaNoches(e.ingreso, e.salida).map(f => env.DB.prepare('INSERT INTO noches (fecha, reserva_id) VALUES (?, ?)').bind(claveNoche(f, origen), id)),
        env.DB.prepare('INSERT INTO idempotencia (clave, reserva_id, creada) VALUES (?, ?, ?)').bind(clave, id, t),
        evento(env, id, 'reserva_iniciada', { medio, vence, proveedor: prov.nombre, verificacion: vivo.detalle })
      ]);
      numero = n;
    } catch (err) {
      const msg = String(err && err.message || err);
      if (/reservas\.numero|idx_reservas_numero/i.test(msg)) continue; // número repetido: se genera otro
      if (/UNIQUE|PRIMARY KEY|constraint/i.test(msg)) {
        const otra = await env.DB.prepare('SELECT reserva_id FROM idempotencia WHERE clave = ?').bind(clave).first();
        if (otra) return await respuestaInicio(env, otra.reserva_id, cors, 200);
        throw new ErrorUsuario('no_disponible', 'Otra persona acaba de reservar alguna de esas noches. Elegí otras fechas.', 409);
      }
      throw err;
    }
  }
  if (!numero) throw new Error('No se pudo generar un número de reserva único');
  console.log('reserva: noches retenidas', numero, origen, medio);

  // c) Retención provisional en el gestor de canales (si lo hay). Si no responde, se cancela todo: no se cobra.
  let r = await fila(env, id);
  const ret = await retenerEnGestor(env, r, prov);
  if (ret.estado === 'ocupado') {
    await cancelarInterna(env, id, 'ocupado_en_gestor');
    throw new ErrorUsuario('no_disponible', 'Esas fechas acaban de ocuparse en otra plataforma. Elegí otras fechas.', 409);
  }
  if (ret.estado === 'error') {
    await cancelarInterna(env, id, 'gestor_sin_respuesta');
    throw new ErrorUsuario('gestor_no_disponible', 'No pudimos reservar las fechas en este momento. Probá en unos minutos o escribinos por WhatsApp.', 503);
  }

  // d) Pago. Mercado Pago sigue en modo prueba (doble traba). Si falla, la retención sigue y el huésped reintenta.
  r = await fila(env, id);
  if (medio === 'mercadopago') {
    try { await exigirModoPrueba(env); await generarOrden(env, id); console.log('reserva: orden de Mercado Pago (prueba) creada', numero); }
    catch (err) {
      console.warn('reserva: orden de Mercado Pago NO generada', numero, err && err.codigo || '', String(err && err.message || err).slice(0, 160));
      await evento(env, id, 'orden_no_generada', { error: String(err && err.message || err).slice(0, 200) }).run();
    }
  } else {
    ctx.waitUntil(avisarDuenos(env, [`🏦 ${etiqueta(r)} · Reserva con TRANSFERENCIA pendiente`,
      `${fmtFecha(r.ingreso)} → ${fmtFecha(r.salida)} · ${r.noches} noches · ${r.huespedes} huéspedes`,
      `Seña a verificar: ${fmtPesos(r.sena)} · vence ${new Date(r.vence_en).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`,
      `${r.nombre} · ${r.telefono}`, 'Cuando veas la transferencia acreditada, marcala en el panel: la confirmación sale sola.', panelUrl(env)].filter(Boolean).join('\n')));
  }
  ctx.waitUntil(notificarHuesped(env, medio === 'transferencia' ? 'transferencia_pendiente' : 'reserva_iniciada', { numero, telefono: r.telefono, email: r.email }));
  return await respuestaInicio(env, id, cors, 201);
}

async function respuestaInicio(env, id, cors, status) {
  const r = await fila(env, id);
  if (!r || !r.numero) return json({ error: 'no_encontrado' }, 404, cors);
  const v = await vistaHuesped(env, r);
  return json({ ...v, acceso: await tokenAcceso(env, id) }, status, cors);
}

const fila = (env, id) => env.DB.prepare('SELECT * FROM reservas WHERE id = ?').bind(id).first();

async function retenerEnGestor(env, r, prov) {
  let res = await prov.retener(r);
  if (res.estado === 'error') {
    // Un reintento ante cortes momentáneos. Antes se borra una posible retención creada cuya respuesta se perdió
    // (si no, el reintento la vería como "ocupado" y quedaría una retención huérfana cerrando los canales).
    const limpio = await prov.limpiar(r);
    res = limpio.ok ? await prov.retener(r) : { estado: 'error', detalle: 'no se pudo verificar una retención anterior: ' + limpio.detalle };
  }
  const cm = { retenida: 'retenida', no_aplica: 'no_aplica', ocupado: 'no_aplica', error: 'error_retencion' }[res.estado] || 'error_retencion';
  await env.DB.batch([
    env.DB.prepare('UPDATE reservas SET cm_estado = ?, cm_ref = COALESCE(?, cm_ref), actualizada = ? WHERE id = ?').bind(cm, res.ref || null, ahora(), r.id),
    evento(env, r.id, 'gestor_retencion', { proveedor: prov.nombre, estado: res.estado, ref: res.ref || null, detalle: res.detalle || null })
  ]);
  return res;
}

// Cancela una reserva que todavía no tiene seña acreditada: libera noches y deja pendiente la liberación en el gestor.
async function cancelarInterna(env, id, motivo, estado = 'cancelada') {
  const t = ahora();
  await env.DB.batch([
    env.DB.prepare(`UPDATE reservas SET estado = ?, vence_en = NULL, actualizada = ?,
      cm_estado = CASE cm_estado WHEN 'retenida' THEN 'liberacion_pendiente' ELSE cm_estado END WHERE id = ?`).bind(estado, t, id),
    env.DB.prepare('DELETE FROM noches WHERE reserva_id = ?').bind(id),
    evento(env, id, 'reserva_cancelada', { motivo })
  ]);
  await procesarGestor(env, id);
}

/* ---------- 2) Enlace privado del huésped ---------- */

async function reservaPorAcceso(req, env) {
  const t = (req.headers.get('x-acceso') || '').trim();
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(t)) return null;
  return env.DB.prepare('SELECT * FROM reservas WHERE acceso_hash = ?').bind(await sha256(t)).first();
}

export async function miReserva(req, env, cors) {
  const r = await reservaPorAcceso(req, env);
  if (!r) return json({ error: 'no_encontrado', mensaje: 'No encontramos esa reserva. Revisá el enlace.' }, 404, cors);
  return json(await vistaHuesped(env, r), 200, cors);
}

export async function pagarMiReserva(req, env, cors) {
  const r = await reservaPorAcceso(req, env);
  if (!r) return json({ error: 'no_encontrado' }, 404, cors);
  if (r.medio_pago !== 'mercadopago' || !['bloqueo', 'pendiente_pago'].includes(r.estado)) throw new ErrorUsuario('estado_invalido', 'Esta reserva no admite un pago ahora.', 409);
  if (!(Date.parse(r.vence_en) > Date.now())) throw new ErrorUsuario('vencida', 'El plazo para pagar venció. Volvé a elegir las fechas.', 409);
  if (r.estado === 'bloqueo') { await exigirModoPrueba(env); await generarOrden(env, r.id); }
  return json(await vistaHuesped(env, await fila(env, r.id)), 200, cors);
}

const TEXTO_ESTADO = {
  bloqueo: 'Fechas retenidas · falta pagar la seña',
  pendiente_pago: 'Fechas retenidas · falta pagar la seña',
  pago_en_proceso: 'Mercado Pago está procesando tu pago',
  pago_verificado: 'Recibimos tu seña · terminando las verificaciones',
  confirmada: 'Reserva confirmada',
  vencida: 'El plazo para pagar venció y las fechas se liberaron',
  cancelada: 'Reserva cancelada',
  conflicto: 'Recibimos tu pago, pero hubo un problema de disponibilidad'
};

export async function vistaHuesped(env, r) {
  const casa = await datosCasa(env);
  const vigente = r.vence_en && Date.parse(r.vence_en) > Date.now();
  const rechazado = r.estado === 'pendiente_pago' && (r.mp_estado === 'action_required' || r.mp_estado === 'failed');
  let texto = TEXTO_ESTADO[r.estado] || r.estado;
  if (r.estado === 'bloqueo' && r.medio_pago === 'transferencia') texto = 'Fechas retenidas · esperando tu transferencia';
  if (rechazado) texto = 'Tu pago no se aprobó: podés intentar con otra tarjeta o medio';
  const v = {
    numero: r.numero, estado: r.estado, estado_texto: texto, prueba: r.origen === 'prueba',
    ingreso: r.ingreso, salida: r.salida, noches: r.noches, adultos: r.adultos, menores: r.menores, huespedes: r.huespedes,
    precio_noche: r.precio_noche, total: r.total, sena: r.sena, saldo: r.saldo, pagado: r.pagado, moneda: r.moneda,
    medio_pago: r.medio_pago, vence_en: ['bloqueo', 'pendiente_pago', 'pago_en_proceso'].includes(r.estado) ? r.vence_en : null,
    nombre: r.nombre, horarios: casa.horarios, contacto_whatsapp: casa.contacto && casa.contacto.whatsapp,
    en_revision: r.estado === 'pago_verificado' && !!r.excepcion,
    pago: null, transferencia: null, confirmacion: null
  };
  if (r.medio_pago === 'mercadopago' && ['bloqueo', 'pendiente_pago'].includes(r.estado) && vigente) {
    v.pago = { checkout_url: r.mp_checkout_url || null, rechazado, generar: !r.mp_checkout_url };
  }
  if (r.medio_pago === 'transferencia' && r.estado === 'bloqueo' && vigente && casa.reserva && casa.reserva.pago) {
    v.transferencia = { alias: casa.reserva.pago.alias, titular: casa.reserva.pago.titular, monto: r.sena };
  }
  if (r.estado === 'confirmada') {
    v.confirmacion = { confirmada_en: r.confirmada_en, direccion: casa.ubicacion && casa.ubicacion.direccion, mapa: casa.ubicacion && casa.ubicacion.mapa,
      coordenadas: casa.ubicacion && casa.ubicacion.coordenadas, saldo_al_ingresar: r.saldo };
  }
  return v;
}

/* ---------- 3) Confirmación automática segura ---------- */

async function marcarExcepcion(env, r, motivo, explicacion) {
  const nueva = r.excepcion !== motivo;
  await env.DB.batch([
    env.DB.prepare('UPDATE reservas SET revision_manual = 1, excepcion = ?, excepcion_avisada = 1, actualizada = ? WHERE id = ?').bind(motivo, ahora(), r.id),
    evento(env, r.id, 'excepcion', { motivo, explicacion })
  ]);
  if (nueva || !r.excepcion_avisada) {
    await avisarDuenos(env, [`⚠️ ${etiqueta(r)} · Requiere su revisión`, explicacion,
      `${fmtFecha(r.ingreso)} → ${fmtFecha(r.salida)} · seña ${fmtPesos(r.sena)} · ${r.nombre} · ${r.telefono}`, panelUrl(env)].filter(Boolean).join('\n'));
  }
  return 'excepcion:' + motivo;
}

export async function intentarConfirmacion(env, id) {
  let r = await fila(env, id);
  if (!r || r.estado !== 'pago_verificado') return 'sin_cambios';
  const autorizada = r.origen === 'prueba' ? env.CONFIRMACION_AUTOMATICA_PRUEBAS === 'true' : env.CONFIRMACION_AUTOMATICA === 'true';
  if (!autorizada) return marcarExcepcion(env, r, 'confirmacion_manual', `💰 Seña acreditada. La confirmación automática está apagada: confirmala desde el panel.`);
  const prov = proveedorPara(env, r);
  if (!prov.bloqueaCanales) {
    return marcarExcepcion(env, r, 'sin_gestor_verificado', 'Seña acreditada, pero la disponibilidad depende de calendarios iCal (sin gestor de canales verificado). Revisá Booking y Airbnb, cerrá las fechas y confirmá desde el panel.');
  }
  if (r.cm_estado !== 'retenida' && r.cm_estado !== 'confirmada') {
    // Pago tardío o retención perdida: se intenta volver a retener en el gestor antes de confirmar.
    const ret = await retenerEnGestor(env, r, prov);
    if (ret.estado === 'ocupado') return conflictoPostPago(env, r, 'ocupado_en_gestor');
    if (ret.estado !== 'retenida') return marcarExcepcion(env, r, 'gestor_no_retuvo', `Seña acreditada, pero el gestor de canales no pudo retener las fechas (${ret.detalle || ret.estado}). No se confirmó.`);
    r = await fila(env, id);
  }
  const c = await prov.consultar({ ingreso: r.ingreso, salida: r.salida, excluirRef: r.cm_ref });
  if (c.estado === 'ocupado') return conflictoPostPago(env, r, 'ocupado_en_gestor');
  if (c.estado !== 'libre') return marcarExcepcion(env, r, 'disponibilidad_dudosa', `Seña acreditada, pero no se pudo verificar la disponibilidad (${c.detalle}). No se confirmó automáticamente.`);
  const conf = await prov.confirmar(r);
  if (!conf.ok) return marcarExcepcion(env, r, 'gestor_no_confirmo', `Seña acreditada, pero el gestor de canales no registró la confirmación (${conf.detalle}). Las fechas siguen retenidas como provisionales.`);
  return confirmar(env, r, 'automatica');
}

async function confirmar(env, r, por) {
  const t = ahora();
  const res = await env.DB.prepare(`UPDATE reservas SET estado = 'confirmada', confirmada_en = ?, confirmada_por = ?, revision_manual = 0, excepcion = NULL,
    cm_estado = CASE WHEN cm_estado = 'retenida' THEN 'confirmada' ELSE cm_estado END, actualizada = ? WHERE id = ? AND estado = 'pago_verificado'`).bind(t, por, t, r.id).run();
  if (!res.meta.changes) return 'sin_cambios';
  await evento(env, r.id, 'reserva_confirmada', { por }).run();
  await notificarHuesped(env, 'reserva_confirmada', { numero: r.numero, telefono: r.telefono, email: r.email });
  await avisarDuenos(env, [`✅ ${etiqueta(r)} · Reserva CONFIRMADA ${por === 'automatica' ? 'automáticamente' : 'por ' + por}`,
    `${fmtFecha(r.ingreso)} → ${fmtFecha(r.salida)} · ${r.noches} noches · ${r.huespedes} huéspedes`,
    `Seña ${fmtPesos(r.sena)} (${r.medio_pago === 'transferencia' ? 'transferencia' : 'Mercado Pago'}) · saldo ${fmtPesos(r.saldo)} al ingresar`,
    `${r.nombre} · ${r.telefono}`, 'No hace falta hacer nada.'].join('\n'));
  return 'confirmada';
}

async function conflictoPostPago(env, r, motivo) {
  const t = ahora();
  await env.DB.batch([
    env.DB.prepare(`UPDATE reservas SET estado = 'conflicto', revision_manual = 1, excepcion = ?, vence_en = NULL, actualizada = ?,
      cm_estado = CASE cm_estado WHEN 'retenida' THEN 'liberacion_pendiente' ELSE cm_estado END WHERE id = ?`).bind(motivo, t, r.id),
    env.DB.prepare('DELETE FROM noches WHERE reserva_id = ?').bind(r.id),
    env.DB.prepare(`INSERT INTO devoluciones (reserva_id, mp_order_id, mp_pago_id, monto, motivo, creada) VALUES (?, ?, NULL, ?, ?, ?)
      ON CONFLICT (mp_order_id, motivo) DO NOTHING`).bind(r.id, r.mp_order_id || ('TRANSFERENCIA-' + r.id.slice(0, 8)), r.pagado || r.sena, motivo, t),
    evento(env, r.id, 'conflicto_requiere_devolucion', { motivo })
  ]);
  await procesarGestor(env, r.id);
  await avisarDuenos(env, [`🚨 ${etiqueta(r)} · CONFLICTO de disponibilidad con seña pagada`,
    `${fmtFecha(r.ingreso)} → ${fmtFecha(r.salida)}: las fechas se ocuparon en otro canal.`,
    `Corresponde devolver el 100 % (${fmtPesos(r.pagado || r.sena)}) y avisar a ${r.nombre} · ${r.telefono}.`, panelUrl(env)].filter(Boolean).join('\n'));
  return 'conflicto';
}

// Conflictos detectados al procesar el pago (index.js: importe incorrecto, pago tardío con fechas tomadas, etc.).
export async function avisarConflictoPago(env, id, motivo) {
  const r = await fila(env, id); if (!r) return;
  await env.DB.prepare('UPDATE reservas SET excepcion = ?, excepcion_avisada = 1 WHERE id = ?').bind(motivo, id).run();
  await avisarDuenos(env, [`🚨 ${etiqueta(r)} · Pago recibido con PROBLEMA (${motivo})`,
    `${fmtFecha(r.ingreso)} → ${fmtFecha(r.salida)} · ${r.nombre} · ${r.telefono}`,
    'No se confirmó. Revisá el caso y, si corresponde, devolvé el 100 % de la seña.', panelUrl(env)].filter(Boolean).join('\n'));
}

/* ---------- 4) Liberaciones en el gestor (con reintentos) ---------- */

export async function procesarGestor(env, soloId) {
  const q = soloId
    ? env.DB.prepare("SELECT * FROM reservas WHERE id = ? AND cm_estado IN ('liberacion_pendiente', 'error_retencion')").bind(soloId)
    : env.DB.prepare("SELECT * FROM reservas WHERE cm_estado IN ('liberacion_pendiente', 'error_retencion') AND cm_intentos < 12 ORDER BY actualizada LIMIT 20");
  const { results } = await q.all();
  for (const r of results) {
    const prov = proveedorPara(env, r);
    const res = r.cm_estado === 'error_retencion' ? await prov.limpiar(r) : await prov.liberar(r);
    if (res.ok) {
      await env.DB.batch([env.DB.prepare("UPDATE reservas SET cm_estado = 'liberada' WHERE id = ?").bind(r.id), evento(env, r.id, 'gestor_liberado', { detalle: res.detalle })]);
    } else {
      await env.DB.batch([env.DB.prepare('UPDATE reservas SET cm_intentos = cm_intentos + 1 WHERE id = ?').bind(r.id), evento(env, r.id, 'gestor_liberacion_fallo', { detalle: res.detalle })]);
      if (r.cm_intentos + 1 === 3) {
        await avisarDuenos(env, [`⚠️ ${etiqueta(r)} · No pudimos liberar la retención en el gestor de canales`,
          `${fmtFecha(r.ingreso)} → ${fmtFecha(r.salida)} pueden seguir cerradas en Booking y Airbnb. Se sigue reintentando.`, panelUrl(env)].filter(Boolean).join('\n'));
      }
    }
  }
}

/* ---------- 5) Avisos del gestor de canales (webhook de Smoobu) ---------- */
// URL: /api/webhooks/gestor/<SMOOBU_WEBHOOK_TOKEN>. Smoobu no documenta firma: el token secreto en la URL autentica.
export async function webhookGestor(req, env, token) {
  const esperado = (env.SMOOBU_WEBHOOK_TOKEN || '').trim();
  const a = enc.encode(token || ''), b = enc.encode(esperado);
  if (esperado.length < 32 || a.length !== b.length || !crypto.subtle.timingSafeEqual(a, b)) return new Response(null, { status: 404 });
  let body = {}; try { body = JSON.parse((await req.text()).slice(0, 50000) || '{}'); } catch { return new Response(null, { status: 400 }); }
  const d = body.data || {}, accion = String(body.action || '');
  const apt = Number(env.SMOOBU_APARTAMENTO_ID);
  if (!['newReservation', 'updateReservation', 'cancelReservation', 'deleteReservation'].includes(accion) || (d.apartment && Number(d.apartment.id) !== apt)) return new Response(null, { status: 200 });
  const ref = d.id != null ? String(d.id) : '';
  const nuestra = ref ? await env.DB.prepare('SELECT * FROM reservas WHERE cm_ref = ?').bind(ref).first() : null;
  if (nuestra) {
    // Alguien canceló en el gestor una retención o reserva nuestra todavía activa.
    if ((accion === 'cancelReservation' || accion === 'deleteReservation' || d.type === 'cancellation') && ACTIVAS.includes(nuestra.estado) && nuestra.cm_estado !== 'liberacion_pendiente' && nuestra.cm_estado !== 'liberada') {
      await env.DB.prepare("UPDATE reservas SET cm_estado = 'liberada' WHERE id = ?").bind(nuestra.id).run();
      await marcarExcepcion(env, nuestra, 'gestor_cancelo', 'La retención o reserva fue cancelada en el gestor de canales mientras seguía activa aquí. Revisá si las fechas siguen cerradas.');
    }
    return new Response(null, { status: 200 });
  }
  if (d.type === 'cancellation' || accion === 'cancelReservation' || accion === 'deleteReservation') return new Response(null, { status: 200 });
  if (!fechaValida(d.arrival) || !fechaValida(d.departure)) return new Response(null, { status: 200 });
  // Reserva nueva de otro canal: ¿se superpone con alguna nuestra activa? (no debería, salvo en la ventana de sincronización)
  const { results } = await env.DB.prepare(`SELECT * FROM reservas WHERE estado IN ('bloqueo','pendiente_pago','pago_en_proceso','pago_verificado','confirmada')
    AND (origen <> 'prueba' OR ? = 1) AND ingreso < ? AND salida > ?`).bind(env.PRUEBAS_USAN_PROVEEDOR === 'true' ? 1 : 0, d.departure, d.arrival).all();
  for (const r of results) {
    await evento(env, r.id, 'superposicion_en_gestor', { ref, canal: d.channel && d.channel.name }).run();
    await marcarExcepcion(env, r, 'superposicion_otro_canal', `Entró una reserva de ${(d.channel && d.channel.name) || 'otro canal'} (${d.arrival} → ${d.departure}) que se superpone con esta. Revisá de inmediato.`);
  }
  return new Response(null, { status: 200 });
}

/* ---------- 6) Panel: supervisión de reservas, pagos, calendario y excepciones ---------- */

export async function apiAdminReservas(req, env, url, quien) {
  const p = url.pathname, sinCache = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' };
  if (p === '/api/admin/resumen' && req.method === 'GET') return json(await resumen(env), 200, sinCache);
  if (p === '/api/admin/reservas' && req.method === 'GET') return json(await listarReservas(env, url.searchParams.get('vista') || 'activas'), 200, sinCache);
  let m = p.match(/^\/api\/admin\/reservas\/([0-9a-f-]{36})$/);
  if (m && req.method === 'GET') return json(await detalleReserva(env, m[1]), 200, sinCache);
  m = p.match(/^\/api\/admin\/reservas\/([0-9a-f-]{36})\/(acreditar-transferencia|confirmar|cancelar|resolver)$/);
  if (m && req.method === 'POST') {
    const body = await leerJson(req).catch(() => ({}));
    const acciones = { 'acreditar-transferencia': acreditarTransferencia, confirmar: confirmarManual, cancelar: cancelarPorDueno, resolver: resolverExcepcion };
    return json(await acciones[m[2]](env, m[1], quien, body), 200, sinCache);
  }
  m = p.match(/^\/api\/admin\/devoluciones\/(\d+)\/(realizada|descartada)$/);
  if (m && req.method === 'POST') {
    const r = await env.DB.prepare("UPDATE devoluciones SET estado = ? WHERE id = ? AND estado = 'pendiente_revision' RETURNING reserva_id").bind(m[2], Number(m[1])).first();
    if (!r) throw new ErrorUsuario('no_encontrado', 'Devolución inexistente o ya resuelta.', 404);
    await evento(env, r.reserva_id, 'devolucion_' + m[2], { por: quien }).run();
    return json({ ok: true }, 200, sinCache);
  }
  if (p === '/api/admin/calendario' && req.method === 'GET') return json(await calendario(env, url.searchParams.get('desde'), Number(url.searchParams.get('meses') || 2)), 200, sinCache);
  return null;
}

const COLUMNAS = `id, numero, estado, origen, modo, medio_pago, ingreso, salida, noches, huespedes, total, sena, saldo, pagado, nombre, telefono, email,
  vence_en, creada, mp_estado, cm_proveedor, cm_estado, excepcion, revision_manual, confirmada_en, confirmada_por`;

async function resumen(env) {
  const hoy = new Date().toISOString().slice(0, 10);
  const [exc, pend, prox, devs] = await Promise.all([
    env.DB.prepare(`SELECT ${COLUMNAS} FROM reservas WHERE (revision_manual = 1 OR estado = 'conflicto') AND estado NOT IN ('vencida','cancelada') ORDER BY actualizada DESC LIMIT 50`).all(),
    env.DB.prepare(`SELECT ${COLUMNAS} FROM reservas WHERE estado IN ('bloqueo','pendiente_pago','pago_en_proceso') ORDER BY vence_en LIMIT 50`).all(),
    env.DB.prepare(`SELECT ${COLUMNAS} FROM reservas WHERE estado = 'confirmada' AND salida >= ? ORDER BY ingreso LIMIT 20`).bind(hoy).all(),
    env.DB.prepare(`SELECT d.id, d.reserva_id, d.monto, d.motivo, d.estado, d.creada, r.numero, r.nombre, r.telefono, r.origen FROM devoluciones d
      JOIN reservas r ON r.id = d.reserva_id WHERE d.estado = 'pendiente_revision' ORDER BY d.creada DESC LIMIT 50`).all()
  ]);
  return {
    sistema: {
      modo_reserva: env.MODO_RESERVA || 'whatsapp', proveedor: env.PROVEEDOR_DISPONIBILIDAD || 'ical',
      gestor_bloqueo_verificado: env.SMOOBU_BLOQUEO_VERIFICADO === 'true', pagos_habilitados: env.PAGOS_HABILITADOS === 'true',
      mp_modo: env.MP_MODO || 'prueba', confirmacion_automatica: env.CONFIRMACION_AUTOMATICA === 'true',
      confirmacion_automatica_pruebas: env.CONFIRMACION_AUTOMATICA_PRUEBAS === 'true',
      retencion_mp_min: Number(env.RETENCION_MP_MINUTOS || 30), retencion_transferencia_h: Number(env.RETENCION_TRANSFERENCIA_HORAS || 48),
      telegram: !!(String(env.TELEGRAM_BOT_TOKEN || '').trim() && String(env.TELEGRAM_CHAT_ID || '').trim())
    },
    excepciones: exc.results, pendientes: pend.results, proximas: prox.results, devoluciones: devs.results
  };
}

async function listarReservas(env, vista) {
  const filtros = {
    activas: "estado IN ('bloqueo','pendiente_pago','pago_en_proceso','pago_verificado','confirmada','conflicto')",
    confirmadas: "estado = 'confirmada'", excepciones: "(revision_manual = 1 OR estado = 'conflicto') AND estado NOT IN ('vencida','cancelada')",
    terminadas: "estado IN ('vencida','cancelada')", todas: '1 = 1'
  };
  const { results } = await env.DB.prepare(`SELECT ${COLUMNAS} FROM reservas WHERE ${filtros[vista] || filtros.activas} ORDER BY creada DESC LIMIT 200`).all();
  return { vista, reservas: results };
}

async function detalleReserva(env, id) {
  const r = await env.DB.prepare(`SELECT ${COLUMNAS}, adultos, menores, precio_noche, observaciones, cm_ref, mp_order_id, mp_estado_detalle FROM reservas WHERE id = ?`).bind(id).first();
  if (!r) throw new ErrorUsuario('no_encontrado', 'Reserva inexistente.', 404);
  const [ev, pagos, devs] = await Promise.all([
    env.DB.prepare('SELECT fecha, tipo, detalle FROM eventos WHERE reserva_id = ? ORDER BY id').bind(id).all(),
    env.DB.prepare('SELECT id, monto, estado, estado_detalle, medio, modo_prueba, recibido FROM pagos WHERE reserva_id = ?').bind(id).all(),
    env.DB.prepare('SELECT id, monto, motivo, estado, creada FROM devoluciones WHERE reserva_id = ?').bind(id).all()
  ]);
  return { reserva: r, eventos: ev.results, pagos: pagos.results, devoluciones: devs.results };
}

async function acreditarTransferencia(env, id, quien) {
  const r = await fila(env, id);
  if (!r) throw new ErrorUsuario('no_encontrado', 'Reserva inexistente.', 404);
  if (r.medio_pago !== 'transferencia' || r.estado !== 'bloqueo') throw new ErrorUsuario('estado_invalido', `No corresponde: la reserva está "${r.estado}".`, 409);
  const n = (await env.DB.prepare('SELECT COUNT(*) n FROM noches WHERE reserva_id = ?').bind(id).first()).n;
  if (n !== r.noches) throw new ErrorUsuario('sin_retencion', 'Las fechas ya no están retenidas para esta reserva.', 409);
  const t = ahora();
  await env.DB.batch([
    env.DB.prepare(`UPDATE reservas SET estado = 'pago_verificado', pagado = sena, saldo = total - sena, vence_en = NULL, actualizada = ? WHERE id = ? AND estado = 'bloqueo'`).bind(t, id),
    env.DB.prepare(`INSERT INTO pagos (id, reserva_id, monto, estado, estado_detalle, medio, modo_prueba, recibido) VALUES (?, ?, ?, 'processed', 'acreditada_verificada_por_duenos', 'transferencia', ?, ?)`)
      .bind('TRF-' + crypto.randomUUID(), id, r.sena, r.origen === 'prueba' ? 1 : 0, t),
    evento(env, id, 'transferencia_acreditada', { por: quien, monto: r.sena })
  ]);
  const resultado = await intentarConfirmacion(env, id);
  return { numero: r.numero, resultado, reserva: await fila(env, id).then(x => ({ estado: x.estado, excepcion: x.excepcion })) };
}

async function confirmarManual(env, id, quien) {
  const r = await fila(env, id);
  if (!r) throw new ErrorUsuario('no_encontrado', 'Reserva inexistente.', 404);
  if (r.estado !== 'pago_verificado') throw new ErrorUsuario('estado_invalido', `Solo se confirman reservas con la seña acreditada (está "${r.estado}").`, 409);
  if (r.cm_estado === 'retenida') { const conf = await proveedorPara(env, r).confirmar(r); await evento(env, id, 'gestor_confirmacion_manual', conf).run(); }
  return { numero: r.numero, resultado: await confirmar(env, r, quien) };
}

async function cancelarPorDueno(env, id, quien, body) {
  const r = await fila(env, id);
  if (!r) throw new ErrorUsuario('no_encontrado', 'Reserva inexistente.', 404);
  if (!['bloqueo', 'pendiente_pago'].includes(r.estado)) throw new ErrorUsuario('estado_invalido', `Solo se cancelan reservas sin seña acreditada (está "${r.estado}").`, 409);
  if (r.mp_order_id && r.mp_order_id !== 'creando') {
    const c = await mpFetch(env, `/v1/orders/${encodeURIComponent(r.mp_order_id)}/cancel`, { method: 'POST', idempotencia: `cancelar-${r.mp_order_id}` });
    if (!c.ok && c.status !== 409) throw new ErrorUsuario('mp_error', 'No se pudo cancelar la orden en Mercado Pago. Probá de nuevo.', 502);
  }
  await cancelarInterna(env, id, 'cancelada_por_duenos:' + quien + (body.motivo ? ' · ' + String(body.motivo).slice(0, 200) : ''));
  return { numero: r.numero, estado: 'cancelada' };
}

async function resolverExcepcion(env, id, quien, body) {
  const r = await fila(env, id);
  if (!r) throw new ErrorUsuario('no_encontrado', 'Reserva inexistente.', 404);
  await env.DB.batch([
    env.DB.prepare('UPDATE reservas SET revision_manual = 0, excepcion = NULL, actualizada = ? WHERE id = ?').bind(ahora(), id),
    evento(env, id, 'excepcion_resuelta', { por: quien, nota: String(body.nota || '').slice(0, 300) || null, era: r.excepcion })
  ]);
  return { numero: r.numero, ok: true };
}

async function calendario(env, desde, meses) {
  const ini = fechaValida(desde || '') ? desde : new Date().toISOString().slice(0, 8) + '01';
  const fin = addDays(ini, Math.min(Math.max(meses || 2, 1), 6) * 31);
  const [{ results }, casa, sync] = await Promise.all([
    env.DB.prepare(`SELECT n.fecha, r.numero, r.estado, r.origen, r.nombre FROM noches n JOIN reservas r ON r.id = n.reserva_id`).all(),
    datosCasa(env), calendarioPublicado(env)
  ]);
  const dias = {};
  const poner = (f, item) => { if (f >= ini && f < fin) (dias[f] = dias[f] || []).push(item); };
  for (const x of results) {
    const prueba = x.fecha.startsWith('P:'), f = prueba ? x.fecha.slice(2) : x.fecha;
    poner(f, { tipo: prueba ? 'prueba' : (x.estado === 'confirmada' ? 'confirmada' : 'retenida'), numero: x.numero, estado: x.estado, nombre: x.nombre });
  }
  for (const b of casa.ocupadas || []) if (b && fechaValida(b.desde) && fechaValida(b.hasta)) for (const f of listaNoches(b.desde, b.hasta)) poner(f, { tipo: 'directa_manual' });
  for (const b of (sync && sync.ocupadas) || []) if (fechaValida(b.desde) && fechaValida(b.hasta)) for (const f of listaNoches(b.desde, b.hasta)) poner(f, { tipo: 'externa', fuente: b.fuente || 'plataforma' });
  return { desde: ini, hasta: fin, dias, sincronizado: sync && sync.actualizado };
}
