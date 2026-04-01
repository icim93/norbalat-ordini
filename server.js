/**
 * Norbalat Ordini — Backend v2 (PostgreSQL)
 * Node.js + Express + pg
 *
 * Avvio:
 *   npm install
 *   node server.js
 *
 * Crea il DB prima:
 *   createdb norbalat          (oppure via pgAdmin / psql)
 *
 * Configura la connessione in .env oppure cambia DATABASE_URL qui sotto.
 */

const express = require('express');
const { Pool } = require('pg');
const bcrypt   = require('bcrypt');
const jwt      = require('jsonwebtoken');
const cors     = require('cors');
const nodemailer = require('nodemailer');
const { z } = require('zod');
const path     = require('path');
const fs = require('fs');

function stripEnvQuotes(v = '') {
  const s = String(v).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function loadLocalEnvFiles() {
  const files = [path.join(__dirname, '.env'), path.join(__dirname, '.env.local')];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    for (const raw of lines) {
      const line = String(raw || '').trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      const value = stripEnvQuotes(line.slice(eq + 1));
      if (!key) continue;
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

loadLocalEnvFiles();

const PORT        = process.env.PORT       || 3000;
const JWT_SECRET  = process.env.JWT_SECRET || 'norbalat-secret-change-in-production-2026';
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/norbalat';
const DATABASE_SSL_MODE = String(process.env.DATABASE_SSL_MODE || '').trim().toLowerCase();
const SALT_ROUNDS = 10;
const PIVA_LOOKUP_URL = process.env.PIVA_LOOKUP_URL || '';
const PIVA_LOOKUP_TOKEN = process.env.PIVA_LOOKUP_TOKEN || '';
const PIVA_LOOKUP_AUTH_HEADER = process.env.PIVA_LOOKUP_AUTH_HEADER || 'Authorization';
const PIVA_LOOKUP_TOKEN_PREFIX = process.env.PIVA_LOOKUP_TOKEN_PREFIX || 'Bearer ';
const PIVA_LOOKUP_EXTRA_HEADERS = process.env.PIVA_LOOKUP_EXTRA_HEADERS || '';
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_SECURE = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
const SMTP_TLS_REJECT_UNAUTHORIZED = String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED || 'true').toLowerCase() === 'true';
const SMTP_TLS_SERVERNAME = process.env.SMTP_TLS_SERVERNAME || '';
const SMTP_FROM = process.env.SMTP_FROM || '';
const SMTP_FROM_NAME = process.env.SMTP_FROM_NAME || 'Norbalat Ordini';
const NOTIFY_EMAIL_TO = process.env.NOTIFY_EMAIL_TO || '';
const NOTIFY_TIMEZONE = process.env.NOTIFY_TIMEZONE || 'Europe/Rome';
const EXPERIMENTAL_SOURCE_URL = process.env.EXPERIMENTAL_SOURCE_URL || '';
const CLAL_BURRO_ZANGOLATO_URL = 'https://www.clal.it/index.php?section=burro_milano#zangolato';
const EXPERIMENTAL_CLAL_SOURCE_KEY = 'burro_milano_zangolato';
const EXPERIMENTAL_TIMEZONE = process.env.EXPERIMENTAL_TIMEZONE || 'Europe/Rome';
const EXPERIMENTAL_AUTO_IMPORT_CHECK_MS = Math.max(5 * 60 * 1000, Number(process.env.EXPERIMENTAL_AUTO_IMPORT_CHECK_MS || 15 * 60 * 1000));

const app  = express();
const isRemoteDatabase = /^postgres(ql)?:\/\//i.test(DATABASE_URL) && !/localhost|127\.0\.0\.1/i.test(DATABASE_URL);
const shouldUseDatabaseSsl = ['require', 'true', '1', 'render'].includes(DATABASE_SSL_MODE) || (!DATABASE_SSL_MODE && isRemoteDatabase);
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: shouldUseDatabaseSsl ? { rejectUnauthorized: false } : undefined,
});
const TENTATA_VENDITA_CLIENT_NAME = 'TENTATA VENDITA';
const TENTATA_VENDITA_CLIENT_CLASS = 'cliente_tecnico_tentata';

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Helper query
const q = (text, params) => pool.query(text, params);

function normalizeOrdineUm(raw) {
  const src = String(raw || '').trim().toLowerCase();
  if (!src) return 'base';
  if (['pedana', 'pedane'].includes(src)) return 'pedana';
  if (['cartone', 'cartoni'].includes(src)) return 'cartoni';
  if (['kg', 'chilogrammi', 'chilogrammo'].includes(src)) return 'kg';
  if (['lt', 'litri', 'litro'].includes(src)) return 'lt';
  if (['pz', 'pezzi', 'pezzo'].includes(src)) return 'pz';
  return src;
}

function getDatePartsInTimezone(date = new Date(), timeZone = 'Europe/Rome') {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour || 0),
    minute: Number(parts.minute || 0),
  };
}

function getNextBusinessDateFromDateString(dateStr) {
  const base = String(dateStr || '').slice(0, 10);
  const d = new Date(`${base}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getNextDayOrderCutoffState(now = new Date(), timeZone = NOTIFY_TIMEZONE || 'Europe/Rome') {
  const { date, hour, minute } = getDatePartsInTimezone(now, timeZone);
  const minutes = (hour * 60) + minute;
  return {
    today: date,
    nextBusinessDate: getNextBusinessDateFromDateString(date),
    afterCutoff: minutes >= (13 * 60 + 30),
    currentMinutes: minutes,
  };
}

function isNextDayOrderCutoffLocked(targetDate, now = new Date(), timeZone = NOTIFY_TIMEZONE || 'Europe/Rome') {
  const normalizedTargetDate = String(targetDate || '').slice(0, 10);
  if (!normalizedTargetDate) return false;
  const state = getNextDayOrderCutoffState(now, timeZone);
  return state.afterCutoff && normalizedTargetDate === state.nextBusinessDate;
}

function buildOrderCommercialSignature(lines = []) {
  return JSON.stringify(
    (Array.isArray(lines) ? lines : [])
      .map(line => ({
        prodotto_id: line?.prodotto_id ? Number.parseInt(line.prodotto_id, 10) : null,
        prodotto_nome_libero: String(line?.prodotto_nome_libero || '').trim().toLowerCase(),
        qty: Number(line?.qty || 0),
        unita_misura: normalizeOrdineUm(line?.unita_misura || 'pezzi'),
        is_pedana: !!line?.is_pedana,
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'it', { sensitivity: 'base' }))
  );
}

function buildStoredOrderCommercialSignature(lines = []) {
  return JSON.stringify(
    (Array.isArray(lines) ? lines : [])
      .map(line => ({
        prodotto_id: line?.prodotto_id ? Number.parseInt(line.prodotto_id, 10) : null,
        prodotto_nome_libero: String(line?.prodotto_nome_libero || '').trim().toLowerCase(),
        qty: Number(line?.qty || 0),
        unita_misura: normalizeOrdineUm(line?.unita_misura || 'pezzi'),
        is_pedana: !!line?.is_pedana,
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'it', { sensitivity: 'base' }))
  );
}

function nextDayOrderCutoffError(targetDate) {
  return {
    status: 403,
    payload: {
      error: `Dopo le 13:30 non si possono piu aggiungere ordini per il ${String(targetDate || '').slice(0, 10)}. Solo un admin puo sbloccare il caso.`,
      code: 'NEXT_DAY_ORDER_CUTOFF',
      target_date: String(targetDate || '').slice(0, 10),
      cutoff_time: '13:30',
      override_role: 'admin',
    },
  };
}

function normalizeProdottoConversioni(raw = {}) {
  const cartoniAttivi = !!raw.cartoni_attivi;
  const pedaneAttive = !!raw.pedane_attive;
  const pesoMedioPezzoKgRaw = raw.peso_medio_pezzo_kg;
  const pezziPerCartoneRaw = raw.pezzi_per_cartone;
  const unitaPerCartoneRaw = raw.unita_per_cartone;
  const cartoniPerPedanaRaw = raw.cartoni_per_pedana;
  const pesoCartoneKgRaw = raw.peso_cartone_kg;
  const pesoMedioPezzoKg = pesoMedioPezzoKgRaw !== '' && pesoMedioPezzoKgRaw !== null && pesoMedioPezzoKgRaw !== undefined
    ? Number(pesoMedioPezzoKgRaw)
    : null;
  const pezziPerCartone = pezziPerCartoneRaw !== '' && pezziPerCartoneRaw !== null && pezziPerCartoneRaw !== undefined
    ? Number(pezziPerCartoneRaw)
    : null;
  const unitaPerCartone = cartoniAttivi && unitaPerCartoneRaw !== '' && unitaPerCartoneRaw !== null && unitaPerCartoneRaw !== undefined
    ? Number(unitaPerCartoneRaw)
    : null;
  const cartoniPerPedana = pedaneAttive && cartoniPerPedanaRaw !== '' && cartoniPerPedanaRaw !== null && cartoniPerPedanaRaw !== undefined
    ? Number(cartoniPerPedanaRaw)
    : null;
  const pesoCartoneKg = pesoCartoneKgRaw !== '' && pesoCartoneKgRaw !== null && pesoCartoneKgRaw !== undefined
    ? Number(pesoCartoneKgRaw)
    : null;
  if (pesoMedioPezzoKg !== null && (!Number.isFinite(pesoMedioPezzoKg) || pesoMedioPezzoKg <= 0)) {
    throw new Error('Peso medio pezzo non valido');
  }
  if (pezziPerCartone !== null && (!Number.isFinite(pezziPerCartone) || pezziPerCartone <= 0)) {
    throw new Error('Pezzi per cartone non validi');
  }
  const unitaPerCartoneDerived = unitaPerCartone !== null
    ? unitaPerCartone
    : (cartoniAttivi && pesoMedioPezzoKg !== null && pezziPerCartone !== null ? (pesoMedioPezzoKg * pezziPerCartone) : null);
  const pesoCartoneKgDerived = pesoCartoneKg !== null
    ? pesoCartoneKg
    : (pesoMedioPezzoKg !== null && pezziPerCartone !== null ? (pesoMedioPezzoKg * pezziPerCartone) : null);
  if (cartoniAttivi && (!Number.isFinite(unitaPerCartoneDerived) || unitaPerCartoneDerived <= 0)) {
    throw new Error('Unità per cartone non valide');
  }
  if (!cartoniAttivi && pedaneAttive) {
    throw new Error('Le pedane richiedono i cartoni attivi');
  }
  if (pedaneAttive && (!Number.isFinite(cartoniPerPedana) || cartoniPerPedana <= 0)) {
    throw new Error('Cartoni per pedana non validi');
  }
  if (pesoCartoneKgDerived !== null && (!Number.isFinite(pesoCartoneKgDerived) || pesoCartoneKgDerived <= 0)) {
    throw new Error('Peso cartone logistico non valido');
  }
  return {
    cartoniAttivi,
    pesoMedioPezzoKg,
    pezziPerCartone: cartoniAttivi ? pezziPerCartone : null,
    unitaPerCartone: cartoniAttivi ? unitaPerCartoneDerived : null,
    pedaneAttive: cartoniAttivi ? pedaneAttive : false,
    cartoniPerPedana: cartoniAttivi && pedaneAttive ? cartoniPerPedana : null,
    pesoCartoneKg: cartoniAttivi ? pesoCartoneKgDerived : null,
  };
}

function calcolaQtyBaseRiga({ qty, unitaMisura, prodotto }) {
  const qtyNum = Number(qty || 0);
  if (!Number.isFinite(qtyNum) || qtyNum <= 0 || !prodotto) return null;
  const umOrdine = normalizeOrdineUm(unitaMisura);
  const umBase = normalizeOrdineUm(prodotto.um);
  if (umOrdine === 'pz' && umBase === 'kg' && Number.isFinite(Number(prodotto.peso_medio_pezzo_kg)) && Number(prodotto.peso_medio_pezzo_kg) > 0) {
    return qtyNum * Number(prodotto.peso_medio_pezzo_kg);
  }
  if (umOrdine === 'pedana') {
    if (!prodotto.pedane_attive || !Number.isFinite(Number(prodotto.cartoni_per_pedana)) || !Number.isFinite(Number(prodotto.unita_per_cartone))) return null;
    return qtyNum * Number(prodotto.cartoni_per_pedana) * Number(prodotto.unita_per_cartone);
  }
  if (umOrdine === 'cartoni') {
    if (!prodotto.cartoni_attivi || !Number.isFinite(Number(prodotto.unita_per_cartone))) return null;
    return qtyNum * Number(prodotto.unita_per_cartone);
  }
  if (umOrdine === umBase || umOrdine === 'base') return qtyNum;
  return qtyNum;
}

function buildTentataVenditaClienteName(user = null) {
  const suffix = String(user?.cognome || user?.nome || '').trim().toUpperCase();
  return suffix ? `${TENTATA_VENDITA_CLIENT_NAME} ${suffix}` : TENTATA_VENDITA_CLIENT_NAME;
}

function isTentataVenditaClienteRecord(cliente = null) {
  if (!cliente) return false;
  const nome = String(cliente.nome || '').trim().toUpperCase();
  const classificazione = String(cliente.classificazione || '').trim().toLowerCase();
  return classificazione === TENTATA_VENDITA_CLIENT_CLASS || nome.startsWith(TENTATA_VENDITA_CLIENT_NAME);
}

async function ensureTentataVenditaCliente(client = null, userId = null) {
  const db = client || pool;
  let user = null;
  let giro = 'variabile';
  const normalizedUserId = Number.parseInt(userId, 10);
  if (Number.isFinite(normalizedUserId) && normalizedUserId > 0) {
    const userRes = await db.query(
      `SELECT id, nome, cognome, giri_consegna
         FROM utenti
        WHERE id=$1
        LIMIT 1`,
      [normalizedUserId]
    );
    if (userRes.rows.length) {
      user = userRes.rows[0];
      const giri = Array.isArray(user.giri_consegna)
        ? user.giri_consegna
        : (user.giri_consegna ? JSON.parse(user.giri_consegna) : []);
      giro = String(giri[0] || 'variabile').trim() || 'variabile';
    }
  }
  const nomeCliente = buildTentataVenditaClienteName(user);
  const existing = user
    ? await db.query(
      `SELECT id
         FROM clienti
        WHERE classificazione = $1
          AND autista_di_giro = $2
        ORDER BY id
        LIMIT 1`,
      [TENTATA_VENDITA_CLIENT_CLASS, user.id]
    )
    : await db.query(
      `SELECT id
         FROM clienti
        WHERE UPPER(TRIM(nome)) = UPPER(TRIM($1))
        ORDER BY id
        LIMIT 1`,
      [TENTATA_VENDITA_CLIENT_NAME]
    );
  if (existing.rows.length) {
    const updated = await db.query(
      `UPDATE clienti
         SET nome = $1,
             localita = COALESCE(NULLIF(localita, ''), 'SISTEMA'),
             giro = COALESCE(NULLIF(giro, ''), $2),
             autista_di_giro = COALESCE($3, autista_di_giro),
             note = CASE
                      WHEN COALESCE(note, '') = '' THEN 'Cliente tecnico generato automaticamente per le tentate vendite'
                      ELSE note
                    END,
             piva = '',
             classificazione = $4,
             onboarding_stato = 'approvato',
             sbloccato = TRUE
         WHERE id = $5
         RETURNING *`,
      [nomeCliente, giro, user?.id || null, TENTATA_VENDITA_CLIENT_CLASS, existing.rows[0].id]
    );
    return updated.rows?.[0] || { id: existing.rows[0].id, nome: nomeCliente, autista_di_giro: user?.id || null, classificazione: TENTATA_VENDITA_CLIENT_CLASS };
  }
  const inserted = await db.query(
    `INSERT INTO clienti (
        nome, alias, localita, giro, agente_id, autista_di_giro, note, piva,
        codice_fiscale, codice_univoco, pec, cond_pagamento, e_fornitore,
        classificazione, onboarding_stato, onboarding_checklist, fido, sbloccato
      ) VALUES (
        $1, '', 'SISTEMA', $2, NULL, $3, 'Cliente tecnico generato automaticamente per le tentate vendite',
        '', '', '', '', '', FALSE, $4, 'approvato', $5::jsonb, 0, TRUE
      )
      RETURNING *`,
    [nomeCliente, giro, user?.id || null, TENTATA_VENDITA_CLIENT_CLASS, JSON.stringify({})]
  );
  return inserted.rows[0];
}

function normalizePiva(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function parseExtraHeaders() {
  if (!PIVA_LOOKUP_EXTRA_HEADERS) return {};
  try {
    const parsed = JSON.parse(PIVA_LOOKUP_EXTRA_HEADERS);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (_) {}
  return {};
}

function pickFirst(obj, keys) {
  if (!obj || typeof obj !== 'object') return '';
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && String(obj[key]).trim() !== '') {
      return String(obj[key]).trim();
    }
  }
  return '';
}

function extractLookupFields(payload, piva) {
  const source = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const nested = [
    source,
    source?.impresa,
    source?.azienda,
    source?.company,
    source?.result,
    source?.results?.[0],
  ].filter(Boolean);
  const merged = Object.assign({}, ...nested.reverse());
  const nome = pickFirst(merged, ['denominazione', 'ragione_sociale', 'company_name', 'name', 'nome']) || '';
  const localita = pickFirst(merged, ['localita', 'comune', 'sede_comune', 'city', 'indirizzo_comune']) || '';
  const codiceFiscale = pickFirst(merged, ['codice_fiscale', 'codiceFiscale', 'cf', 'tax_code']) || '';
  const codiceUnivoco = pickFirst(merged, ['codice_univoco', 'codiceUnivoco', 'sdi', 'codice_destinatario']) || '';
  const pec = pickFirst(merged, ['pec', 'indirizzo_pec', 'email_pec']) || '';
  return {
    nome,
    localita,
    piva: pickFirst(merged, ['piva', 'partita_iva', 'vat_code', 'vatNumber']) || piva,
    codice_fiscale: codiceFiscale,
    codice_univoco: codiceUnivoco,
    pec,
    raw: payload,
  };
}

let smtpTransporter = null;
let lastDailySummaryKey = null;

function parseEmailList(raw) {
  return String(raw || '')
    .split(/[;,]/)
    .map(x => x.trim())
    .filter(Boolean);
}

function getSmtpMissingFields() {
  const missing = [];
  if (!SMTP_HOST) missing.push('SMTP_HOST');
  if (!SMTP_PORT) missing.push('SMTP_PORT');
  if (!SMTP_FROM) missing.push('SMTP_FROM');
  return missing;
}

function getDefaultEmailNotificationSettings() {
  return {
    enabled: !!(SMTP_HOST && SMTP_FROM && parseEmailList(NOTIFY_EMAIL_TO).length),
    recipients: parseEmailList(NOTIFY_EMAIL_TO),
    on_new_client: true,
    daily_summary: true,
    daily_summary_hour: 18,
    last_daily_sent_key: '',
  };
}

async function getEmailNotificationSettings() {
  const defaults = getDefaultEmailNotificationSettings();
  try {
    const { rows } = await q('SELECT value FROM app_settings WHERE key=$1', ['email_notifications']);
    if (!rows.length) return defaults;
    const saved = rows[0].value && typeof rows[0].value === 'object' ? rows[0].value : {};
    const merged = { ...defaults, ...saved };
    merged.recipients = Array.isArray(merged.recipients) ? merged.recipients.filter(Boolean) : defaults.recipients;
    merged.daily_summary_hour = Math.min(23, Math.max(0, Number(merged.daily_summary_hour || 18)));
    merged.enabled = !!merged.enabled;
    merged.on_new_client = !!merged.on_new_client;
    merged.daily_summary = !!merged.daily_summary;
    merged.last_daily_sent_key = String(merged.last_daily_sent_key || '');
    return merged;
  } catch (_) {
    return defaults;
  }
}

async function saveEmailNotificationSettings(next) {
  const payload = {
    enabled: !!next.enabled,
    recipients: Array.isArray(next.recipients) ? next.recipients.filter(Boolean) : [],
    on_new_client: !!next.on_new_client,
    daily_summary: !!next.daily_summary,
    daily_summary_hour: Math.min(23, Math.max(0, Number(next.daily_summary_hour || 18))),
    last_daily_sent_key: String(next.last_daily_sent_key || ''),
  };
  await q(
    `INSERT INTO app_settings (key,value,updated_at)
     VALUES ($1,$2::jsonb,NOW())
     ON CONFLICT (key)
     DO UPDATE SET value=$2::jsonb, updated_at=NOW()`,
    ['email_notifications', JSON.stringify(payload)]
  );
  return payload;
}

async function getTentataVenditaSettings() {
  try {
    const { rows } = await q('SELECT value FROM app_settings WHERE key=$1', ['tentata_vendita_config']);
    const value = rows[0]?.value;
    const carichi = Array.isArray(value?.carichi) ? value.carichi : [];
    return {
      carichi: carichi.map(entry => ({
        userId: Number(entry?.userId),
        templates: (() => {
          const rawTemplates = Array.isArray(entry?.templates) && entry.templates.length
            ? entry.templates
            : [{
                id: `default-${Number(entry?.userId) || 'x'}`,
                nome: 'Predefinita',
                giorni: [],
                linee: Array.isArray(entry?.linee) ? entry.linee : [],
              }];
          return rawTemplates.map(template => ({
            id: String(template?.id || `tpl-${Date.now()}`),
            nome: String(template?.nome || 'Profilo TV').trim() || 'Profilo TV',
            giorni: Array.isArray(template?.giorni)
              ? template.giorni.map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6)
              : [],
            linee: Array.isArray(template?.linee) ? template.linee.map(line => ({
              prodId: Number(line?.prodId),
              qty: Number(line?.qty || 0),
              unitaMisura: String(line?.unitaMisura || line?.unita_misura || 'pezzi').trim() || 'pezzi',
            })).filter(line => Number.isFinite(line.prodId) && Number.isFinite(line.qty) && line.qty > 0) : [],
          }));
        })(),
        assegnazioni: (entry?.assegnazioni && typeof entry.assegnazioni === 'object')
          ? Object.fromEntries(Object.entries(entry.assegnazioni).map(([date, templateId]) => [String(date).slice(0, 10), String(templateId || '')]).filter(([, templateId]) => templateId))
          : {},
      })).filter(entry => Number.isFinite(entry.userId)),
    };
  } catch (_) {
    return { carichi: [] };
  }
}

async function saveTentataVenditaSettings(next) {
  const payload = {
    carichi: Array.isArray(next?.carichi) ? next.carichi.map(entry => ({
      userId: Number(entry?.userId),
      templates: Array.isArray(entry?.templates) ? entry.templates.map(template => ({
        id: String(template?.id || `tpl-${Date.now()}`),
        nome: String(template?.nome || 'Profilo TV').trim() || 'Profilo TV',
        giorni: Array.isArray(template?.giorni)
          ? template.giorni.map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6)
          : [],
        linee: Array.isArray(template?.linee) ? template.linee.map(line => ({
          prodId: Number(line?.prodId),
          qty: Number(line?.qty || 0),
          unitaMisura: String(line?.unitaMisura || line?.unita_misura || 'pezzi').trim() || 'pezzi',
        })).filter(line => Number.isFinite(line.prodId) && Number.isFinite(line.qty) && line.qty > 0) : [],
      })).filter(template => template.id) : [],
      assegnazioni: (entry?.assegnazioni && typeof entry.assegnazioni === 'object')
        ? Object.fromEntries(Object.entries(entry.assegnazioni).map(([date, templateId]) => [String(date).slice(0, 10), String(templateId || '')]).filter(([, templateId]) => templateId))
        : {},
    })).filter(entry => Number.isFinite(entry.userId)) : [],
  };
  await q(
    `INSERT INTO app_settings (key,value,updated_at)
     VALUES ($1,$2::jsonb,NOW())
     ON CONFLICT (key)
     DO UPDATE SET value=$2::jsonb, updated_at=NOW()`,
    ['tentata_vendita_config', JSON.stringify(payload)]
  );
  return payload;
}

function getExperimentalAutomationDefaults() {
  return {
    source_url: CLAL_BURRO_ZANGOLATO_URL,
    bulletin_week_key: '',
    last_attempt_at: '',
    last_success_at: '',
  };
}

async function getExperimentalAutomationSettings() {
  const defaults = getExperimentalAutomationDefaults();
  try {
    const { rows } = await q('SELECT value FROM app_settings WHERE key=$1', ['experimental_automation']);
    if (!rows.length) return defaults;
    const saved = rows[0].value && typeof rows[0].value === 'object' ? rows[0].value : {};
    return { ...defaults, ...saved };
  } catch (_) {
    return defaults;
  }
}

async function saveExperimentalAutomationSettings(next) {
  const merged = { ...(await getExperimentalAutomationSettings()), ...next };
  await q(
    `INSERT INTO app_settings (key,value,updated_at)
     VALUES ($1,$2::jsonb,NOW())
     ON CONFLICT (key)
     DO UPDATE SET value=$2::jsonb, updated_at=NOW()`,
    ['experimental_automation', JSON.stringify(merged)]
  );
  return merged;
}

function isSmtpConfigured() {
  return getSmtpMissingFields().length === 0;
}

function getSmtpTransporter() {
  if (!isSmtpConfigured()) return null;
  if (!smtpTransporter) {
    smtpTransporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
      tls: {
        rejectUnauthorized: SMTP_TLS_REJECT_UNAUTHORIZED,
        ...(SMTP_TLS_SERVERNAME ? { servername: SMTP_TLS_SERVERNAME } : {}),
      },
    });
  }
  return smtpTransporter;
}

async function sendManagedEmail({ to, subject, text, html }) {
  const transporter = getSmtpTransporter();
  if (!transporter) return { ok: false, skipped: true, reason: 'smtp_not_configured' };
  if (!to || !to.length) return { ok: false, skipped: true, reason: 'no_recipients' };
  await transporter.sendMail({
    from: SMTP_FROM_NAME ? `"${SMTP_FROM_NAME}" <${SMTP_FROM}>` : SMTP_FROM,
    to: to.join(', '),
    subject,
    text,
    html,
  });
  return { ok: true };
}

async function getPendingClientiStatsToday() {
  const sql = `
    SELECT
      COUNT(*) FILTER (
        WHERE onboarding_stato = 'in_attesa'
          AND sbloccato = FALSE
          AND (created_at AT TIME ZONE $1) >= date_trunc('day', NOW() AT TIME ZONE $1)
          AND (created_at AT TIME ZONE $1) <  date_trunc('day', NOW() AT TIME ZONE $1) + INTERVAL '1 day'
      )::int AS created_today_pending,
      COUNT(*) FILTER (
        WHERE onboarding_stato = 'in_attesa'
          AND sbloccato = FALSE
      )::int AS total_pending
    FROM clienti
  `;
  const { rows } = await q(sql, [NOTIFY_TIMEZONE]);
  return {
    createdTodayPending: rows[0]?.created_today_pending || 0,
    totalPending: rows[0]?.total_pending || 0,
  };
}

function notifyLog(...args) {
  console.log('[notifiche-email]', ...args);
}

async function notifyNewClientePendingApproval(clienteNome, createdByName = 'Sistema') {
  try {
    const cfg = await getEmailNotificationSettings();
    if (!cfg.enabled || !cfg.on_new_client) return;
    const stats = await getPendingClientiStatsToday();
    const subject = `Nuovo cliente in attesa approvazione (${stats.createdTodayPending} oggi)`;
    const text = [
      `Nuovo cliente inserito: ${clienteNome}`,
      `Inserito da: ${createdByName}`,
      `In attesa inseriti oggi: ${stats.createdTodayPending}`,
      `Totale in attesa approvazione: ${stats.totalPending}`,
    ].join('\n');
    const html = `
      <div style="font-family:Arial,sans-serif;color:#102a43;line-height:1.5;">
        <h2 style="margin:0 0 10px;">Nuovo cliente in attesa approvazione</h2>
        <p style="margin:0 0 8px;"><b>Cliente:</b> ${clienteNome}</p>
        <p style="margin:0 0 8px;"><b>Inserito da:</b> ${createdByName}</p>
        <p style="margin:0 0 6px;"><b>In attesa inseriti oggi:</b> ${stats.createdTodayPending}</p>
        <p style="margin:0;"><b>Totale in attesa:</b> ${stats.totalPending}</p>
      </div>
    `;
    const r = await sendManagedEmail({ to: cfg.recipients, subject, text, html });
    if (!r.ok && !r.skipped) notifyLog('invio fallito su nuovo cliente', clienteNome);
  } catch (e) {
    notifyLog('errore nuovo cliente:', e.message);
  }
}

async function maybeSendDailyPendingSummary() {
  try {
    const cfg = await getEmailNotificationSettings();
    if (!cfg.enabled || !cfg.daily_summary) return;
    const nowRome = new Date(new Date().toLocaleString('en-US', { timeZone: NOTIFY_TIMEZONE }));
    if (nowRome.getMinutes() !== 0 || nowRome.getHours() !== Number(cfg.daily_summary_hour)) return;
    const dayKey = nowRome.toISOString().slice(0, 10);
    if (cfg.last_daily_sent_key === dayKey || lastDailySummaryKey === dayKey) return;

    const stats = await getPendingClientiStatsToday();
    const subject = `Riepilogo onboarding clienti - ${dayKey}`;
    const text = [
      `Data: ${dayKey}`,
      `Nuovi clienti in attesa oggi: ${stats.createdTodayPending}`,
      `Totale clienti in attesa approvazione: ${stats.totalPending}`,
    ].join('\n');
    const html = `
      <div style="font-family:Arial,sans-serif;color:#102a43;line-height:1.5;">
        <h2 style="margin:0 0 10px;">Riepilogo onboarding clienti</h2>
        <p style="margin:0 0 6px;"><b>Data:</b> ${dayKey}</p>
        <p style="margin:0 0 6px;"><b>Nuovi in attesa oggi:</b> ${stats.createdTodayPending}</p>
        <p style="margin:0;"><b>Totale in attesa approvazione:</b> ${stats.totalPending}</p>
      </div>
    `;
    const sent = await sendManagedEmail({ to: cfg.recipients, subject, text, html });
    if (sent.ok) {
      lastDailySummaryKey = dayKey;
      await saveEmailNotificationSettings({ ...cfg, last_daily_sent_key: dayKey });
      notifyLog('riepilogo giornaliero inviato', dayKey);
    }
  } catch (e) {
    notifyLog('errore riepilogo giornaliero:', e.message);
  }
}

function startEmailNotificationsScheduler() {
  setInterval(() => {
    maybeSendDailyPendingSummary().catch(() => {});
  }, 60 * 1000);
}

function getRomeWeekWindowInfo(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: EXPERIMENTAL_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  const hour = Number(map.hour);
  const minute = Number(map.minute);
  const weekday = String(map.weekday || '').toLowerCase();
  const mondayWindow = weekday.startsWith('mon') && hour >= 15 && hour < 17;
  const mondayDate = `${map.year}-${map.month}-${map.day}`;
  const weekKey = `${mondayDate}`;
  return { year, month, day, hour, minute, weekday, mondayWindow, mondayDate, weekKey };
}

function getNextClalBulletinWindow(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: EXPERIMENTAL_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  const weekdayMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const currentDow = weekdayMap[String(map.weekday || '').toLowerCase().slice(0, 3)] ?? 0;
  const currentMinutes = (Number(map.hour) * 60) + Number(map.minute);
  let addDays = (1 - currentDow + 7) % 7;
  if (addDays === 0 && currentMinutes >= (17 * 60)) addDays = 7;
  const base = new Date(Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + addDays);
  const y = base.getUTCFullYear();
  const m = String(base.getUTCMonth() + 1).padStart(2, '0');
  const d = String(base.getUTCDate()).padStart(2, '0');
  return {
    date_iso: `${y}-${m}-${d}`,
    label: `lunedi ${d}/${m}/${y} 15:00-16:59`,
    timezone: EXPERIMENTAL_TIMEZONE,
  };
}

async function autoImportClalZangolato() {
  try {
    const result = await fetchClalZangolatoSnapshot({
      sourceUrl: CLAL_BURRO_ZANGOLATO_URL,
      persist: true,
      userId: null,
    });
    console.log(`[experimental] CLAL zangolato aggiornato: ${result.rows_count} righe, nuovi snapshot ${result.inserted_count}`);
  } catch (e) {
    console.warn(`[experimental] auto import CLAL fallito: ${e.message}`);
  }
}

async function maybeAutoImportClalZangolato() {
  const now = new Date();
  const info = getRomeWeekWindowInfo(now);
  if (!info.mondayWindow) return;
  const state = await getExperimentalAutomationSettings();
  if (String(state.bulletin_week_key || '') === info.weekKey) return;

  await saveExperimentalAutomationSettings({
    source_url: CLAL_BURRO_ZANGOLATO_URL,
    bulletin_week_key: info.weekKey,
    last_attempt_at: now.toISOString(),
  });

  try {
    const result = await fetchClalZangolatoSnapshot({
      sourceUrl: CLAL_BURRO_ZANGOLATO_URL,
      persist: true,
      userId: null,
    });
    await saveExperimentalAutomationSettings({
      source_url: CLAL_BURRO_ZANGOLATO_URL,
      bulletin_week_key: info.weekKey,
      last_attempt_at: now.toISOString(),
      last_success_at: new Date().toISOString(),
    });
    console.log(`[experimental] bollettino CLAL importato (${info.weekKey}): ${result.rows_count} righe, nuovi snapshot ${result.inserted_count}`);
  } catch (e) {
    await saveExperimentalAutomationSettings({
      source_url: CLAL_BURRO_ZANGOLATO_URL,
      bulletin_week_key: '',
      last_attempt_at: now.toISOString(),
    });
    console.warn(`[experimental] import bollettino CLAL fallito (${info.weekKey}): ${e.message}`);
  }
}

function startExperimentalScheduler() {
  maybeAutoImportClalZangolato().catch(() => {});
  setInterval(() => {
    maybeAutoImportClalZangolato().catch(() => {});
  }, EXPERIMENTAL_AUTO_IMPORT_CHECK_MS);
}

// ─── SCHEMA ──────────────────────────────────────────────────────
async function createSchema() {
  await q(`
    CREATE TABLE IF NOT EXISTS utenti (
      id             SERIAL PRIMARY KEY,
      nome           TEXT NOT NULL,
      cognome        TEXT DEFAULT '',
      username       TEXT NOT NULL UNIQUE,
      password       TEXT NOT NULL,
      ruolo          TEXT NOT NULL CHECK(ruolo IN ('admin','autista','magazzino','direzione','amministrazione')),
      tipo_utente    TEXT DEFAULT '',
      giri_consegna  JSONB DEFAULT '[]',
      is_agente      BOOLEAN DEFAULT FALSE
    );

    CREATE TABLE IF NOT EXISTS clienti (
      id               SERIAL PRIMARY KEY,
      nome             TEXT NOT NULL,
      crm_tipo         TEXT NOT NULL DEFAULT 'cliente',
      alias            TEXT DEFAULT '',
      contatto_nome    TEXT DEFAULT '',
      telefono         TEXT DEFAULT '',
      localita         TEXT DEFAULT '',
      giro             TEXT DEFAULT '',
      agente_id        INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
      autista_di_giro  INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
      note             TEXT DEFAULT '',
      piva             TEXT DEFAULT '',
      codice_fiscale   TEXT DEFAULT '',
      codice_univoco   TEXT DEFAULT '',
      pec              TEXT DEFAULT '',
      cond_pagamento   TEXT DEFAULT '',
      e_fornitore      BOOLEAN DEFAULT FALSE,
      classificazione  TEXT DEFAULT '',
      onboarding_contatto_tipo TEXT DEFAULT '',
      onboarding_stato TEXT DEFAULT 'in_attesa',
      onboarding_checklist JSONB DEFAULT '{}'::jsonb,
      fido             NUMERIC DEFAULT 0,
      sbloccato        BOOLEAN DEFAULT FALSE,
      onboarding_approvato_da TEXT,
      onboarding_approvato_at TIMESTAMPTZ,
      crm_convertito_at TIMESTAMPTZ,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS prodotti (
      id          SERIAL PRIMARY KEY,
      codice      TEXT NOT NULL UNIQUE,
      nome        TEXT NOT NULL,
      categoria   TEXT NOT NULL,
      um          TEXT NOT NULL,
      packaging   TEXT DEFAULT '',
      peso_fisso  BOOLEAN DEFAULT FALSE,
      gestione_giacenza BOOLEAN DEFAULT TRUE,
      punto_riordino NUMERIC,
      cartoni_attivi BOOLEAN DEFAULT FALSE,
      peso_medio_pezzo_kg NUMERIC,
      pezzi_per_cartone NUMERIC,
      unita_per_cartone NUMERIC,
      pedane_attive BOOLEAN DEFAULT FALSE,
      cartoni_per_pedana NUMERIC,
      peso_cartone_kg NUMERIC,
      assortimento_stato TEXT NOT NULL DEFAULT 'attivo',
      ultimo_riordino_qta NUMERIC,
      ultimo_riordino_at TIMESTAMPTZ,
      ultimo_riordino_utente_id INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
      ultimo_riordino_utente_nome TEXT DEFAULT '',
      auto_anagrafato BOOLEAN DEFAULT FALSE,
      auto_anagrafato_at TIMESTAMPTZ,
      note        TEXT DEFAULT '',
      scheda_tecnica_nome TEXT DEFAULT '',
      scheda_tecnica_mime TEXT DEFAULT '',
      scheda_tecnica_data BYTEA,
      scheda_tecnica_uploaded_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS ordini (
      id               SERIAL PRIMARY KEY,
      cliente_id       INTEGER NOT NULL REFERENCES clienti(id),
      agente_id        INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
      autista_di_giro  INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
      inserted_by      INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
      data             DATE NOT NULL,
      stato            TEXT NOT NULL DEFAULT 'attesa'
                         CHECK(stato IN ('attesa','sospeso','preparazione','preparato','consegnato','annullato')),
      note             TEXT DEFAULT '',
      data_non_certa   BOOLEAN DEFAULT FALSE,
      stef             BOOLEAN DEFAULT FALSE,
      altro_vettore    BOOLEAN DEFAULT FALSE,
      giro_override    TEXT DEFAULT '',
      inserted_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at       TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ordine_linee (
      id              SERIAL PRIMARY KEY,
      ordine_id       INTEGER NOT NULL REFERENCES ordini(id) ON DELETE CASCADE,
      prodotto_id     INTEGER REFERENCES prodotti(id),
      prodotto_nome_libero TEXT DEFAULT '',
      qty             NUMERIC NOT NULL DEFAULT 1,
      qty_base        NUMERIC,
      colli_effettivi NUMERIC,
      prezzo_unitario NUMERIC,
      peso_effettivo  NUMERIC,
      is_pedana       BOOLEAN DEFAULT FALSE,
      nota_riga       TEXT DEFAULT '',
      preparato       BOOLEAN DEFAULT FALSE,
      lotto           TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS camions (
      id              SERIAL PRIMARY KEY,
      targa           TEXT NOT NULL UNIQUE,
      nome            TEXT NOT NULL,
      layout          TEXT NOT NULL DEFAULT 'asym8',
      num_pedane      INTEGER NOT NULL DEFAULT 8,
      autista_in_uso  INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
      confermato      BOOLEAN DEFAULT FALSE,
      confermato_da   TEXT,
      confermato_at   TIMESTAMPTZ,
      last_update     TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS pedane (
      id         SERIAL PRIMARY KEY,
      camion_id  INTEGER NOT NULL REFERENCES camions(id) ON DELETE CASCADE,
      piano_data DATE NOT NULL DEFAULT CURRENT_DATE,
      numero     INTEGER NOT NULL,
      nota       TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS giri_calendario (
      id      SERIAL PRIMARY KEY,
      giro    TEXT NOT NULL UNIQUE,
      giorni  JSONB NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
      user_name  TEXT NOT NULL,
      action     TEXT NOT NULL,
      detail     TEXT DEFAULT '',
      ts         TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS messaggi_interni (
      id                SERIAL PRIMARY KEY,
      mittente_id       INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
      mittente_nome     TEXT NOT NULL,
      conversation_id   INTEGER,
      destinatario_tipo TEXT NOT NULL CHECK(destinatario_tipo IN ('user','role')),
      destinatario_user_id INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
      destinatario_ruolo TEXT,
      oggetto           TEXT DEFAULT '',
      testo             TEXT NOT NULL,
      ordine_id         INTEGER REFERENCES ordini(id) ON DELETE SET NULL,
      cliente_id        INTEGER REFERENCES clienti(id) ON DELETE SET NULL,
      letto_at          TIMESTAMPTZ,
      created_at        TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS messaggi_conversazioni (
      id                  SERIAL PRIMARY KEY,
      created_by          INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
      created_by_name     TEXT NOT NULL DEFAULT 'Utente',
      destinatario_tipo   TEXT NOT NULL CHECK(destinatario_tipo IN ('user','role')),
      destinatario_user_id INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
      destinatario_ruolo  TEXT,
      oggetto             TEXT DEFAULT '',
      stato               TEXT NOT NULL DEFAULT 'nuovo' CHECK (stato IN ('nuovo','preso_in_carico','in_attesa','chiuso')),
      priorita            TEXT NOT NULL DEFAULT 'media' CHECK (priorita IN ('bassa','media','alta','urgente')),
      assegnato_user_id   INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
      cliente_id          INTEGER REFERENCES clienti(id) ON DELETE SET NULL,
      ordine_id           INTEGER REFERENCES ordini(id) ON DELETE SET NULL,
      last_message_at     TIMESTAMPTZ DEFAULT NOW(),
      closed_at           TIMESTAMPTZ,
      created_at          TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS messaggi_conversazione_letture (
      conversation_id      INTEGER NOT NULL REFERENCES messaggi_conversazioni(id) ON DELETE CASCADE,
      user_id              INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
      last_read_message_id INTEGER REFERENCES messaggi_interni(id) ON DELETE SET NULL,
      last_read_at         TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (conversation_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS clienti_onboarding_log (
      id          SERIAL PRIMARY KEY,
      cliente_id  INTEGER NOT NULL REFERENCES clienti(id) ON DELETE CASCADE,
      user_id     INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
      user_name   TEXT NOT NULL,
      old_stato   TEXT,
      new_stato   TEXT,
      old_fido    NUMERIC,
      new_fido    NUMERIC,
      note        TEXT DEFAULT '',
      ts          TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS clienti_crm_eventi (
      id          SERIAL PRIMARY KEY,
      cliente_id  INTEGER NOT NULL REFERENCES clienti(id) ON DELETE CASCADE,
      tipo        TEXT NOT NULL DEFAULT 'richiesta',
      contatto_tipo TEXT DEFAULT '',
      esito       TEXT DEFAULT '',
      stato_cliente TEXT DEFAULT '',
      contatto_nome TEXT DEFAULT '',
      telefono    TEXT DEFAULT '',
      incaricato_user_id INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
      incaricato_user_name TEXT DEFAULT '',
      richiesta   TEXT DEFAULT '',
      offerta     TEXT DEFAULT '',
      motivo      TEXT DEFAULT '',
      note        TEXT DEFAULT '',
      followup_date DATE,
      followup_repeat_value INTEGER,
      followup_repeat_unit TEXT DEFAULT '',
      priorita    TEXT DEFAULT 'media',
      user_id     INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
      user_name   TEXT NOT NULL DEFAULT 'Sistema',
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS listini (
      id          SERIAL PRIMARY KEY,
      prodotto_id INTEGER NOT NULL REFERENCES prodotti(id) ON DELETE CASCADE,
      cliente_id  INTEGER REFERENCES clienti(id) ON DELETE CASCADE,
      giro        TEXT DEFAULT '',
      scope       TEXT NOT NULL DEFAULT 'all',
      mode        TEXT NOT NULL DEFAULT 'final_price',
      prezzo      NUMERIC,
      base_price  NUMERIC,
      markup_pct  NUMERIC DEFAULT 0,
      discount_pct NUMERIC DEFAULT 0,
      final_price NUMERIC,
      excluded_client_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      valido_dal  DATE NOT NULL DEFAULT CURRENT_DATE,
      valido_al   DATE,
      note        TEXT DEFAULT '',
      created_by  INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS rese_fornitori (
      id             SERIAL PRIMARY KEY,
      fornitore_id   INTEGER NOT NULL REFERENCES clienti(id),
      clal_value     NUMERIC,
      buyer_code     TEXT DEFAULT 'viga',
      quantita       NUMERIC NOT NULL DEFAULT 0,
      prezzo_pagato  NUMERIC NOT NULL DEFAULT 0,
      lotto          TEXT DEFAULT '',
      resa_pct       NUMERIC NOT NULL DEFAULT 100,
      prezzo_venduto NUMERIC,
      created_by     INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      updated_at     TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key         TEXT PRIMARY KEY,
      value       JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS doc_folders (
      id            SERIAL PRIMARY KEY,
      name          TEXT NOT NULL,
      parent_id     INTEGER REFERENCES doc_folders(id) ON DELETE CASCADE,
      allowed_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_by    INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS doc_files (
      id          SERIAL PRIMARY KEY,
      folder_id   INTEGER NOT NULL REFERENCES doc_folders(id) ON DELETE CASCADE,
      file_name   TEXT NOT NULL,
      mime_type   TEXT NOT NULL DEFAULT 'application/octet-stream',
      size_bytes  INTEGER NOT NULL DEFAULT 0,
      file_data   BYTEA NOT NULL,
      created_by  INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS scorte_magazzino (
      id                  SERIAL PRIMARY KEY,
      prodotto_id         INTEGER REFERENCES prodotti(id) ON DELETE SET NULL,
      prodotto_nome       TEXT NOT NULL,
      quantita_rimanente  NUMERIC NOT NULL DEFAULT 0,
      unita_misura        TEXT DEFAULT '',
      kg_stimati          NUMERIC,
      note                TEXT DEFAULT '',
      stato               TEXT NOT NULL DEFAULT 'attiva' CHECK (stato IN ('attiva','ripristinata')),
      created_by          INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
      updated_by          INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
      created_at          TIMESTAMPTZ DEFAULT NOW(),
      updated_at          TIMESTAMPTZ DEFAULT NOW(),
      ripristinata_at     TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS magazzino_chiusure_giornata (
      id                SERIAL PRIMARY KEY,
      data              DATE NOT NULL,
      giro              TEXT DEFAULT '',
      confermata_da     INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
      confermata_nome   TEXT DEFAULT '',
      confermata_at     TIMESTAMPTZ DEFAULT NOW(),
      esito             TEXT DEFAULT '',
      dettagli          JSONB DEFAULT '{}'::jsonb
    );

    CREATE TABLE IF NOT EXISTS giro_chiusure_giornata (
      id                SERIAL PRIMARY KEY,
      data              DATE NOT NULL,
      giro              TEXT DEFAULT '',
      autista_id        INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
      autista_nome      TEXT DEFAULT '',
      confermata_da     INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
      confermata_nome   TEXT DEFAULT '',
      confermata_at     TIMESTAMPTZ DEFAULT NOW(),
      esito             TEXT DEFAULT '',
      dettagli          JSONB DEFAULT '{}'::jsonb
    );

    CREATE TABLE IF NOT EXISTS azienda_chiusure_giornata (
      id                SERIAL PRIMARY KEY,
      data              DATE NOT NULL,
      confermata_da     INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
      confermata_nome   TEXT DEFAULT '',
      confermata_at     TIMESTAMPTZ DEFAULT NOW(),
      esito             TEXT DEFAULT '',
      dettagli          JSONB DEFAULT '{}'::jsonb
    );

    CREATE TABLE IF NOT EXISTS experimental_clal_quotes (
      id                BIGSERIAL PRIMARY KEY,
      source_key        TEXT NOT NULL DEFAULT 'burro_milano_zangolato',
      source_url        TEXT NOT NULL,
      fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ref_date          DATE,
      date_raw          TEXT DEFAULT '',
      min_price         NUMERIC,
      max_price         NUMERIC,
      payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by        INTEGER REFERENCES utenti(id) ON DELETE SET NULL
    );

    ALTER TABLE messaggi_interni ADD COLUMN IF NOT EXISTS conversation_id INTEGER REFERENCES messaggi_conversazioni(id) ON DELETE CASCADE;
    ALTER TABLE messaggi_conversazioni ADD COLUMN IF NOT EXISTS conversation_kind TEXT NOT NULL DEFAULT 'direct';
    ALTER TABLE messaggi_conversazioni ADD COLUMN IF NOT EXISTS nome_chat TEXT DEFAULT '';
    ALTER TABLE messaggi_conversazioni ADD COLUMN IF NOT EXISTS partecipanti_user_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

    CREATE INDEX IF NOT EXISTS idx_ordini_data    ON ordini(data);
    CREATE INDEX IF NOT EXISTS idx_ordini_stato   ON ordini(stato);
    CREATE INDEX IF NOT EXISTS idx_ordini_agente  ON ordini(agente_id);
    CREATE INDEX IF NOT EXISTS idx_ordini_cliente ON ordini(cliente_id);
    CREATE INDEX IF NOT EXISTS idx_linee_ordine   ON ordine_linee(ordine_id);
    CREATE INDEX IF NOT EXISTS idx_activity_ts    ON activity_log(ts);
    CREATE INDEX IF NOT EXISTS idx_messaggi_dest_user_created ON messaggi_interni(destinatario_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messaggi_dest_role_created ON messaggi_interni(destinatario_ruolo, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messaggi_letto ON messaggi_interni(letto_at, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messaggi_conversation_created ON messaggi_interni(conversation_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_msg_conv_dest_user_last ON messaggi_conversazioni(destinatario_user_id, last_message_at DESC);
    CREATE INDEX IF NOT EXISTS idx_msg_conv_dest_role_last ON messaggi_conversazioni(destinatario_ruolo, last_message_at DESC);
    CREATE INDEX IF NOT EXISTS idx_msg_conv_created_by_last ON messaggi_conversazioni(created_by, last_message_at DESC);
    CREATE INDEX IF NOT EXISTS idx_msg_conv_assigned_last ON messaggi_conversazioni(assegnato_user_id, last_message_at DESC);
    CREATE INDEX IF NOT EXISTS idx_msg_conv_kind_last ON messaggi_conversazioni(conversation_kind, last_message_at DESC);
    CREATE INDEX IF NOT EXISTS idx_listini_prod_cliente ON listini(prodotto_id,cliente_id);
    CREATE INDEX IF NOT EXISTS idx_listini_validita ON listini(valido_dal,valido_al);
    CREATE INDEX IF NOT EXISTS idx_rese_fornitore_created ON rese_fornitori(fornitore_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_crm_cliente_created ON clienti_crm_eventi(cliente_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_doc_folders_parent ON doc_folders(parent_id);
    CREATE INDEX IF NOT EXISTS idx_doc_files_folder ON doc_files(folder_id);
    CREATE INDEX IF NOT EXISTS idx_scorte_stato ON scorte_magazzino(stato, prodotto_id);
    CREATE INDEX IF NOT EXISTS idx_magazzino_chiusure_data_giro ON magazzino_chiusure_giornata(data, giro);
    CREATE INDEX IF NOT EXISTS idx_giro_chiusure_data_giro_autista ON giro_chiusure_giornata(data, giro, autista_id);
    CREATE INDEX IF NOT EXISTS idx_azienda_chiusure_data ON azienda_chiusure_giornata(data);
    CREATE INDEX IF NOT EXISTS idx_utenti_username_lower ON utenti (LOWER(username));
    CREATE INDEX IF NOT EXISTS idx_exp_clal_source_fetched ON experimental_clal_quotes(source_key, fetched_at DESC);

    -- Migrazioni safe per DB esistenti
    ALTER TABLE clienti     ADD COLUMN IF NOT EXISTS classificazione TEXT DEFAULT '';
    ALTER TABLE clienti     ADD COLUMN IF NOT EXISTS crm_tipo         TEXT NOT NULL DEFAULT 'cliente';
    ALTER TABLE clienti     ADD COLUMN IF NOT EXISTS contatto_nome   TEXT DEFAULT '';
    ALTER TABLE clienti     ADD COLUMN IF NOT EXISTS telefono        TEXT DEFAULT '';
    ALTER TABLE clienti     ADD COLUMN IF NOT EXISTS onboarding_stato TEXT DEFAULT 'in_attesa';
    ALTER TABLE clienti     ADD COLUMN IF NOT EXISTS onboarding_checklist JSONB DEFAULT '{}'::jsonb;
    ALTER TABLE clienti     ADD COLUMN IF NOT EXISTS fido             NUMERIC DEFAULT 0;
    ALTER TABLE clienti     ADD COLUMN IF NOT EXISTS sbloccato        BOOLEAN DEFAULT FALSE;
    ALTER TABLE clienti     ADD COLUMN IF NOT EXISTS onboarding_approvato_da TEXT;
    ALTER TABLE clienti     ADD COLUMN IF NOT EXISTS onboarding_approvato_at TIMESTAMPTZ;
    ALTER TABLE clienti     ADD COLUMN IF NOT EXISTS crm_convertito_at TIMESTAMPTZ;
    ALTER TABLE clienti     ADD COLUMN IF NOT EXISTS codice_fiscale   TEXT DEFAULT '';
    ALTER TABLE clienti     ADD COLUMN IF NOT EXISTS codice_univoco   TEXT DEFAULT '';
    ALTER TABLE clienti     ADD COLUMN IF NOT EXISTS pec              TEXT DEFAULT '';
    ALTER TABLE clienti     ADD COLUMN IF NOT EXISTS created_at       TIMESTAMPTZ DEFAULT NOW();
    ALTER TABLE ordine_linee ADD COLUMN IF NOT EXISTS is_pedana      BOOLEAN DEFAULT FALSE;
    ALTER TABLE ordine_linee ADD COLUMN IF NOT EXISTS nota_riga      TEXT DEFAULT '';
    ALTER TABLE ordine_linee ADD COLUMN IF NOT EXISTS unita_misura   TEXT DEFAULT 'pezzi';
    ALTER TABLE ordine_linee ADD COLUMN IF NOT EXISTS qty_base       NUMERIC;
    ALTER TABLE ordine_linee ADD COLUMN IF NOT EXISTS colli_effettivi NUMERIC;
    ALTER TABLE ordine_linee ADD COLUMN IF NOT EXISTS prezzo_unitario NUMERIC;
    ALTER TABLE ordine_linee ADD COLUMN IF NOT EXISTS prodotto_nome_libero TEXT DEFAULT '';
    ALTER TABLE ordine_linee ADD COLUMN IF NOT EXISTS preparato      BOOLEAN DEFAULT FALSE;
    ALTER TABLE ordine_linee ADD COLUMN IF NOT EXISTS lotto          TEXT DEFAULT '';
    ALTER TABLE ordine_linee ALTER COLUMN prodotto_id DROP NOT NULL;
    ALTER TABLE ordini ADD COLUMN IF NOT EXISTS altro_vettore BOOLEAN DEFAULT FALSE;
    ALTER TABLE ordini ADD COLUMN IF NOT EXISTS giro_override TEXT DEFAULT '';
    ALTER TABLE pedane ADD COLUMN IF NOT EXISTS piano_data DATE DEFAULT CURRENT_DATE;
    UPDATE pedane SET piano_data = CURRENT_DATE WHERE piano_data IS NULL;
    ALTER TABLE pedane ALTER COLUMN piano_data SET NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_pedane_camion_data_numero ON pedane(camion_id,piano_data,numero);
    ALTER TABLE listini     ADD COLUMN IF NOT EXISTS giro            TEXT DEFAULT '';
    ALTER TABLE listini     ADD COLUMN IF NOT EXISTS scope           TEXT NOT NULL DEFAULT 'all';
    ALTER TABLE listini     ADD COLUMN IF NOT EXISTS mode            TEXT NOT NULL DEFAULT 'final_price';
    ALTER TABLE listini     ADD COLUMN IF NOT EXISTS base_price      NUMERIC;
    ALTER TABLE listini     ADD COLUMN IF NOT EXISTS markup_pct      NUMERIC DEFAULT 0;
    ALTER TABLE listini     ADD COLUMN IF NOT EXISTS discount_pct    NUMERIC DEFAULT 0;
    ALTER TABLE listini     ADD COLUMN IF NOT EXISTS final_price     NUMERIC;
    ALTER TABLE listini     ADD COLUMN IF NOT EXISTS excluded_client_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE rese_fornitori ADD COLUMN IF NOT EXISTS lotto TEXT DEFAULT '';
    ALTER TABLE rese_fornitori ADD COLUMN IF NOT EXISTS resa_pct NUMERIC NOT NULL DEFAULT 100;
    ALTER TABLE rese_fornitori ADD COLUMN IF NOT EXISTS prezzo_venduto NUMERIC;
    ALTER TABLE rese_fornitori ADD COLUMN IF NOT EXISTS clal_value NUMERIC;
    ALTER TABLE rese_fornitori ADD COLUMN IF NOT EXISTS buyer_code TEXT DEFAULT 'viga';
    ALTER TABLE rese_fornitori ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES utenti(id) ON DELETE SET NULL;
    ALTER TABLE rese_fornitori ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
    ALTER TABLE rese_fornitori ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    ALTER TABLE doc_folders ADD COLUMN IF NOT EXISTS allowed_roles JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE doc_folders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    ALTER TABLE ferie_dipendenti ADD COLUMN IF NOT EXISTS titolo TEXT DEFAULT '';
    ALTER TABLE ferie_dipendenti ADD COLUMN IF NOT EXISTS ora_inizio TEXT DEFAULT '';
    ALTER TABLE ferie_dipendenti ADD COLUMN IF NOT EXISTS ora_fine TEXT DEFAULT '';
    ALTER TABLE ferie_dipendenti ADD COLUMN IF NOT EXISTS presenza_stato TEXT NOT NULL DEFAULT 'non_richiesta';
    ALTER TABLE ferie_dipendenti ADD COLUMN IF NOT EXISTS presenza_note TEXT DEFAULT '';
    ALTER TABLE ferie_dipendenti ADD COLUMN IF NOT EXISTS presenza_updated_at TIMESTAMPTZ;
    ALTER TABLE ferie_dipendenti ADD COLUMN IF NOT EXISTS visibilita_ruoli JSONB NOT NULL DEFAULT '["admin","amministrazione","direzione"]'::jsonb;
    ALTER TABLE ferie_dipendenti ADD COLUMN IF NOT EXISTS visibilita_utenti JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE ferie_dipendenti ADD COLUMN IF NOT EXISTS visibilita_solo_creator BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE doc_files   ADD COLUMN IF NOT EXISTS mime_type TEXT NOT NULL DEFAULT 'application/octet-stream';
    ALTER TABLE doc_files   ADD COLUMN IF NOT EXISTS size_bytes INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE clienti_crm_eventi ADD COLUMN IF NOT EXISTS stato_cliente TEXT DEFAULT '';
    ALTER TABLE clienti_crm_eventi ADD COLUMN IF NOT EXISTS contatto_tipo TEXT DEFAULT '';
    ALTER TABLE clienti_crm_eventi ADD COLUMN IF NOT EXISTS contatto_nome TEXT DEFAULT '';
    ALTER TABLE clienti_crm_eventi ADD COLUMN IF NOT EXISTS telefono TEXT DEFAULT '';
    ALTER TABLE clienti_crm_eventi ADD COLUMN IF NOT EXISTS incaricato_user_id INTEGER REFERENCES utenti(id) ON DELETE SET NULL;
    ALTER TABLE clienti_crm_eventi ADD COLUMN IF NOT EXISTS incaricato_user_name TEXT DEFAULT '';
    ALTER TABLE clienti_crm_eventi ADD COLUMN IF NOT EXISTS followup_date DATE;
    ALTER TABLE clienti_crm_eventi ADD COLUMN IF NOT EXISTS followup_repeat_value INTEGER;
    ALTER TABLE clienti_crm_eventi ADD COLUMN IF NOT EXISTS followup_repeat_unit TEXT DEFAULT '';
    ALTER TABLE clienti_crm_eventi ADD COLUMN IF NOT EXISTS priorita TEXT DEFAULT 'media';
    ALTER TABLE clienti_crm_eventi ADD COLUMN IF NOT EXISTS offerta TEXT DEFAULT '';
    ALTER TABLE clienti ADD COLUMN IF NOT EXISTS onboarding_contatto_tipo TEXT DEFAULT '';
    ALTER TABLE prodotti ADD COLUMN IF NOT EXISTS scheda_tecnica_nome TEXT DEFAULT '';
    ALTER TABLE prodotti ADD COLUMN IF NOT EXISTS scheda_tecnica_mime TEXT DEFAULT '';
    ALTER TABLE prodotti ADD COLUMN IF NOT EXISTS scheda_tecnica_data BYTEA;
    ALTER TABLE prodotti ADD COLUMN IF NOT EXISTS scheda_tecnica_uploaded_at TIMESTAMPTZ;
    ALTER TABLE prodotti ADD COLUMN IF NOT EXISTS gestione_giacenza BOOLEAN DEFAULT TRUE;
    ALTER TABLE prodotti ADD COLUMN IF NOT EXISTS punto_riordino NUMERIC;
    ALTER TABLE prodotti ADD COLUMN IF NOT EXISTS cartoni_attivi BOOLEAN DEFAULT FALSE;
    ALTER TABLE prodotti ADD COLUMN IF NOT EXISTS peso_medio_pezzo_kg NUMERIC;
    ALTER TABLE prodotti ADD COLUMN IF NOT EXISTS pezzi_per_cartone NUMERIC;
    ALTER TABLE prodotti ADD COLUMN IF NOT EXISTS unita_per_cartone NUMERIC;
    ALTER TABLE prodotti ADD COLUMN IF NOT EXISTS pedane_attive BOOLEAN DEFAULT FALSE;
    ALTER TABLE prodotti ADD COLUMN IF NOT EXISTS cartoni_per_pedana NUMERIC;
    ALTER TABLE prodotti ADD COLUMN IF NOT EXISTS peso_cartone_kg NUMERIC;
    ALTER TABLE prodotti ADD COLUMN IF NOT EXISTS assortimento_stato TEXT NOT NULL DEFAULT 'attivo';
    ALTER TABLE prodotti ADD COLUMN IF NOT EXISTS ultimo_riordino_qta NUMERIC;
    ALTER TABLE prodotti ADD COLUMN IF NOT EXISTS ultimo_riordino_at TIMESTAMPTZ;
    ALTER TABLE prodotti ADD COLUMN IF NOT EXISTS ultimo_riordino_utente_id INTEGER REFERENCES utenti(id) ON DELETE SET NULL;
    ALTER TABLE prodotti ADD COLUMN IF NOT EXISTS ultimo_riordino_utente_nome TEXT DEFAULT '';
    ALTER TABLE prodotti ADD COLUMN IF NOT EXISTS auto_anagrafato BOOLEAN DEFAULT FALSE;
    ALTER TABLE prodotti ADD COLUMN IF NOT EXISTS auto_anagrafato_at TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS idx_crm_followup ON clienti_crm_eventi(followup_date);
    UPDATE clienti_crm_eventi SET priorita = 'media' WHERE priorita IS NULL OR priorita = '';
    UPDATE clienti SET crm_tipo = 'cliente' WHERE crm_tipo IS NULL OR crm_tipo = '';
    ALTER TABLE listini     ALTER COLUMN prezzo DROP NOT NULL;
    UPDATE listini SET scope = CASE WHEN cliente_id IS NULL THEN 'all' ELSE 'cliente' END WHERE scope IS NULL OR scope = '';
    UPDATE listini SET mode = 'final_price' WHERE mode IS NULL OR mode = '';
    UPDATE listini SET final_price = COALESCE(final_price, prezzo) WHERE mode = 'final_price';
    UPDATE clienti SET created_at = NOW() WHERE created_at IS NULL;

    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'utenti_ruolo_check'
          AND conrelid = 'utenti'::regclass
      ) THEN
        ALTER TABLE utenti DROP CONSTRAINT utenti_ruolo_check;
      END IF;
    ALTER TABLE utenti
      ADD CONSTRAINT utenti_ruolo_check
      CHECK (ruolo IN ('admin','autista','magazzino','direzione','amministrazione'));
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END $$;

  ALTER TABLE clienti ADD COLUMN IF NOT EXISTS alias TEXT DEFAULT '';

    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ordini_stato_check'
          AND conrelid = 'ordini'::regclass
      ) THEN
        ALTER TABLE ordini DROP CONSTRAINT ordini_stato_check;
      END IF;
      ALTER TABLE ordini
        ADD CONSTRAINT ordini_stato_check
        CHECK (stato IN ('attesa','sospeso','preparazione','preparato','consegnato','annullato'));
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;

    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'clienti_crm_tipo_check'
          AND conrelid = 'clienti'::regclass
      ) THEN
        ALTER TABLE clienti DROP CONSTRAINT clienti_crm_tipo_check;
      END IF;
      ALTER TABLE clienti
        ADD CONSTRAINT clienti_crm_tipo_check
        CHECK (crm_tipo IN ('cliente','prospect'));
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;

    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'clienti_onboarding_stato_check'
          AND conrelid = 'clienti'::regclass
      ) THEN
        ALTER TABLE clienti DROP CONSTRAINT clienti_onboarding_stato_check;
      END IF;
      ALTER TABLE clienti
        ADD CONSTRAINT clienti_onboarding_stato_check
        CHECK (onboarding_stato IN ('bozza','in_attesa','in_verifica','approvato','rifiutato','sospeso'));
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;

    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'listini_scope_check'
          AND conrelid = 'listini'::regclass
      ) THEN
        ALTER TABLE listini DROP CONSTRAINT listini_scope_check;
      END IF;
      ALTER TABLE listini
        ADD CONSTRAINT listini_scope_check
        CHECK (scope IN ('all','giro','cliente','giro_cliente'));
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;

    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'listini_mode_check'
          AND conrelid = 'listini'::regclass
      ) THEN
        ALTER TABLE listini DROP CONSTRAINT listini_mode_check;
      END IF;
      ALTER TABLE listini
        ADD CONSTRAINT listini_mode_check
        CHECK (mode IN ('base_markup','discount_pct','final_price'));
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;

    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'prodotti_assortimento_stato_check'
          AND conrelid = 'prodotti'::regclass
      ) THEN
        ALTER TABLE prodotti DROP CONSTRAINT prodotti_assortimento_stato_check;
      END IF;
      ALTER TABLE prodotti
        ADD CONSTRAINT prodotti_assortimento_stato_check
        CHECK (assortimento_stato IN ('attivo','fuori_assortimento','su_ordinazione'));
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;

    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM clienti)
         AND NOT EXISTS (SELECT 1 FROM clienti WHERE onboarding_stato = 'approvato') THEN
        UPDATE clienti
        SET onboarding_stato = 'approvato',
            onboarding_checklist = COALESCE(onboarding_checklist, '{}'::jsonb),
            sbloccato = TRUE,
            fido = COALESCE(fido, 0);
      END IF;
    END $$;

    UPDATE utenti
    SET ruolo = 'amministrazione'
    WHERE ruolo = 'direzione'
      AND LOWER(REPLACE(COALESCE(tipo_utente, ''), 'à', 'a')) IN ('amministrazione', 'contabilita');
  `);

  // ─── GIACENZE ────────────────────────────────────────────────────
  await q(`
    CREATE TABLE IF NOT EXISTS giacenze (
      id            SERIAL PRIMARY KEY,
      prodotto_id   INTEGER NOT NULL REFERENCES prodotti(id) ON DELETE CASCADE,
      lotto         TEXT NOT NULL DEFAULT '',
      scadenza      DATE,
      quantita      NUMERIC NOT NULL DEFAULT 0,
      note          TEXT DEFAULT '',
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS movimenti_giacenza (
      id              SERIAL PRIMARY KEY,
      giacenza_id     INTEGER REFERENCES giacenze(id) ON DELETE SET NULL,
      prodotto_id     INTEGER REFERENCES prodotti(id) ON DELETE SET NULL,
      lotto           TEXT NOT NULL DEFAULT '',
      tipo            TEXT NOT NULL CHECK(tipo IN ('carico','scarico_ordine','scarico_manuale','reso','rettifica','tentata_vendita')),
      quantita        NUMERIC NOT NULL,
      quantita_prima  NUMERIC,
      quantita_dopo   NUMERIC,
      ordine_id       INTEGER REFERENCES ordini(id) ON DELETE SET NULL,
      ordine_linea_id INTEGER REFERENCES ordine_linee(id) ON DELETE SET NULL,
      utente_id       INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
      utente_nome     TEXT DEFAULT '',
      note            TEXT DEFAULT '',
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE prodotti ADD COLUMN IF NOT EXISTS soglia_minima NUMERIC;

    CREATE INDEX IF NOT EXISTS idx_giacenze_prodotto ON giacenze(prodotto_id);
    CREATE INDEX IF NOT EXISTS idx_movimenti_giacenza_prodotto ON movimenti_giacenza(prodotto_id);
    CREATE INDEX IF NOT EXISTS idx_movimenti_giacenza_created ON movimenti_giacenza(created_at DESC);
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS ferie_dipendenti (
      id              SERIAL PRIMARY KEY,
      utente_id       INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
      data_inizio     DATE NOT NULL,
      data_fine       DATE NOT NULL,
      titolo          TEXT DEFAULT '',
      ora_inizio      TEXT DEFAULT '',
      ora_fine        TEXT DEFAULT '',
      tipo            TEXT NOT NULL DEFAULT 'ferie',
      stato           TEXT NOT NULL DEFAULT 'programmata',
      presenza_stato  TEXT NOT NULL DEFAULT 'non_richiesta',
      presenza_note   TEXT DEFAULT '',
      presenza_updated_at TIMESTAMPTZ,
      note            TEXT DEFAULT '',
      visibilita_ruoli JSONB NOT NULL DEFAULT '["admin","amministrazione","direzione"]'::jsonb,
      visibilita_utenti JSONB NOT NULL DEFAULT '[]'::jsonb,
      visibilita_solo_creator BOOLEAN NOT NULL DEFAULT FALSE,
      created_by      INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_ferie_utente_periodo ON ferie_dipendenti(utente_id, data_inizio, data_fine);
  `);

  const categoriaDefaultsKey = 'prodotti_categoria_defaults_v1';
  const categoriaDefaultsApplied = await q('SELECT key FROM app_settings WHERE key=$1 LIMIT 1', [categoriaDefaultsKey]);
  if (!categoriaDefaultsApplied.rows.length) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE prodotti
         SET gestione_giacenza = FALSE
         WHERE categoria = 'CAGLIATA'`
      );
      await client.query(
        `UPDATE prodotti
         SET gestione_giacenza = TRUE,
             punto_riordino = 500
         WHERE categoria = 'PANNA UHT'`
      );
      await client.query(
        `UPDATE prodotti
         SET gestione_giacenza = TRUE,
             punto_riordino = 50
         WHERE categoria = 'FORMAGGI'`
      );
      await client.query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (key) DO NOTHING`,
        [categoriaDefaultsKey, JSON.stringify({ applied_at: new Date().toISOString() })]
      );
      await client.query('COMMIT');
      client.release();
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      client.release();
      throw e;
    }
  }

  console.log('✅ Schema OK');
}

// ─── SEED ────────────────────────────────────────────────────────
async function seed() {
  const { rows } = await q('SELECT COUNT(*) as n FROM utenti');
  if (parseInt(rows[0].n) > 0) return;
  console.log('🌱 Seed database...');

  const users = [
    ['Francesco','Chiarappa', 'francescoc', 'direzione', 'CEO',            [''],                                              true],
    ['Gianvito', 'Chiarappa', 'gianvito',  'direzione', 'Commerciale',    [''],                                              true],
    ['Marica',   'Chiarappa', 'marica',    'amministrazione', 'Amministrazione', [''],                                        false],
    ['Marco',    'Palmisano', 'marco',     'admin',     'Operazioni',     [''],                                              true],
    ['Mariella', 'Lacatena',  'mariella',  'amministrazione', 'Contabilità', [''],                                           false],
    ['Gaston',   'Casas',     'gaston',    'magazzino', 'Magazziniere',   [''],                                              false],
    ['Franco',   'Laricchiuta','franco',   'magazzino', 'Magazziniere',   [''],                                              false],
    ['Francesco','Avossa',    'francescoa','autista',   'Autista',        ['bari nord','lecce','calabria'],                   true],
    ['Emanuele', 'Fornaro',   'emanuele',  'autista',   'Autista',        ['bari/foggia','taranto','lecce est','valle itria','murgia'], true],
  ];
  for (const [nome, cognome, username, ruolo, tipo_utente, giri, is_agente] of users) {
    const hash = await bcrypt.hash('1234', SALT_ROUNDS);
    await q(
      `INSERT INTO utenti (nome,cognome,username,password,ruolo,tipo_utente,giri_consegna,is_agente)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
      [nome, cognome, username, hash, ruolo, tipo_utente, JSON.stringify(giri.filter(Boolean)), is_agente]
    );
  }

  const clienti = [
    ['CASEIFICIO ALTAMURA DI PIETRO ALTAMURA','MOLFETTA','bari nord'],
    ['CASEIFICIO MAGGIORE SRL','MATERA','murgia'],
    ['LA MASSERIA di CEDRO FRANCESCO','MONTESCAGLIOSO','murgia'],
    ['CAS. MASSIMINO di DE VINCENZO Carmine','MOTTOLA','taranto'],
    ['CAS. SAPORI GENUINI S.R.L.S.','FERRANDINA','murgia'],
    ['ARCUDI ANTONELLA AZIENDA AGRICOLA','SOLETO','lecce'],
    ["BONTA' BIANCA SRL",'CONVERSANO','diretto'],
    ['CALIANDRO COSIMO az. Agr."FRAGNITE"','CEGLIE MESSAPICA','valle itria'],
    ['I SAPORI DEL CASARO SRL','MOTTOLA','taranto'],
    ['CASEIFICIO IL CESTINO DEL CASARO','MONTALTO UFFUGO','calabria'],
    ['MP S.A.S. DI PERILLI DOMENICO & C.','BITRITTO','taranto'],
    ['DELIZIE CASEARIE SRL','CORATO','bari nord'],
    ['CASEIFICIO MONGELLI MARZIO PAOLO SRL','MOTTOLA','taranto'],
    ['CASEIFICIO SAN PARDO DI SCARABAGGIO VITO','MATERA','murgia'],
    ['CAVALERA MAILA S.R.L.S.','GALATONE','lecce'],
    ['TRADE ERREGI SRL','MONTALTO UFFUGO','calabria'],
    ['CASEIFICIO SACRO CUORE DI LORUSSO RICCAR','ANDRIA','bari nord'],
    ['CASEIFICIO FUSCO LEONARDINA DI','LUCERA','foggia'],
    ['MADDALENA ARCANGELO AZ. AGRICOLA','LATERZA','taranto'],
    ["LA BONTA' DEL LATTE DI LOIUDICE ANGELO R",'ALTAMURA','murgia'],
    ['CASEIFICIO CONSOLI SRL','LOCOROTONDO','valle itria'],
    ['CAS. OLANDA RICCARDO','ANDRIA','bari nord'],
    ['BRIGANTI STELLA','MANDURIA','taranto'],
    ['CASEIFICIO ACQUAVIVA','GRAVINA IN PUGLIA','murgia'],
    ['PELLEGRINO GIOVANNI','BARI','taranto'],
    ['FAILLACE ANTONIO','SAN LORENZO DEL VALLO','calabria'],
    ['TAMBONE SRL','BISCEGLIE','bari nord'],
    ["CASEIFICIO L'ARTIGIANO DEL LATTE",'GIOVINAZZO','bari nord'],
    ['CASEIFICIO TIMAN SRL','ALEZIO','lecce'],
    ['PICCOLI PIACERI SRL','BARLETTA','bari nord'],
    ['LA PAMPANELLA','BRINDISI','lecce'],
    ['CASEIFICIO BIANCO LATTE SRL','TRANI','bari nord'],
    ['BIANCA OSTUNI DI ORLANDINO GIOVANNI SAS','OSTUNI','valle itria'],
    ['CASEIFICIO I SAPORI DEL LATTE DI','CASTELLANA GROTTE','diretto'],
    ['CASEIFICIO SEMERARO S.R.L.','FASANO/MONTALBANO','valle itria'],
    ["CASEIFICIO L'ARTE DEL CASARO SRL",'MATERA','murgia'],
    ['CASEIFICIO F.LLI PAPA DI PAPA PAOLO & C.','LUCERA','foggia'],
    ['CASEIFICIO DI GALATINA DI GIANNOTTA ROSA','GALATINA','lecce'],
    ['CASEIFICIO ALFARANO DI ALFARANO EGIDIO','UGENTO','lecce'],
    ["CASEIFICIO D'ANZI MICHELE",'CAROSINO','taranto'],
    ['MASSERIA AIA ANTICA SRL','OSTUNI','valle itria'],
    ['CI.DIS. SRL','OSTUNI','valle itria'],
    ['CASEIFICIO SAN GIORGIO DI BATTISTA LUIGI','SAN GIORGIO IONICO','taranto'],
    ['CASEIFICIO FORTE S.A.S. di Forte Michele','ALTAMURA','murgia'],
    ['SURIANO FRANCESCO','ANDRIA','bari nord'],
    ['CASEIFICIO CONTE TOMMASO','ALTAMURA','murgia'],
    ['CASEIFICIO DOLCE LATTE DI MAURO GIANNI','MINERVINO DI LECCE','lecce'],
    ['FRAS SRLS','BARLETTA','bari nord'],
    ['CASEIFICIO F.LLI SIMONE S.R.L.','ANDRIA','bari nord'],
    ['CASEIFICIO ARCANO di FILIPPO & ANGELO','CASTELLANETA','taranto'],
    ['CARMELO FIOCCO S.R.L.','GIOIA DEL COLLE','calabria'],
    ['CASEIFICIO EUROPA F.lli ARUANNO','ANDRIA','bari nord'],
    ['ANTONAZZO SAMUELE','MELENDUGNO','lecce'],
    ['LA MOZZARELLERIA DI PASTORE NUNZIO','BARLETTA','bari nord'],
    ['ADRIALATTE SNC DI FIORENTINO F.&C.','GIOVINAZZO','bari nord'],
    ["AZ. AGRICOLA SIDERO GIUSEPPE","CASSANO ALL'IONIO",'calabria'],
    ['CASEIFICIO QUARATO SEBASTIANO','TURI',''],
    ['CASEIFICIO GRAN GOURMET IEVA S.A.S. DI','ANDRIA','bari nord'],
    ['IL BOCCONCINO SRL','BARLETTA','bari nord'],
    ['LE GOURMET FOOD srls','TRIGGIANO','diretto'],
    ['ALIMILK INDUSTRIA CASEARIA','TAVIANO','lecce'],
    ['CAS. GIAGNOTTI SNC DI NICOLA E FABRIZIO','BARLETTA','bari nord'],
    ['GALATA 2 S.R.L.','PRESICCE-ACQUARICA','lecce'],
    ['CASEIFICIO ANDRIESE LOMBARDI AGOSTINO','BARI','bari nord'],
    ["CASEIFICIO ARTIGIANALE LE BONTA' DEL LAT",'LECCE','lecce'],
    ['INGROSSO FORMAGGI PABA RAFFAELE','BIRORI','diretto'],
    ["CASEIFICIO D'AMICO SRL",'SAN VITO DEI NORMANNI','valle itria'],
    ['CASEIFICIO CASSANO DI CASSANO ANTONIO','GRAVINA IN PUGLIA','murgia'],
    ['PRIMIZIE DEL LATTE DI GAGLIARDI MICHELE','CORATO','bari nord'],
    ['BURRIFICIO TRE RONDINI SRL','EBOLI','diretto'],
    ['CAS. PRIMO LATTE S.R.L.','ANDRIA','bari nord'],
    ['MALCANGI GIOVANNI','GRAVINA IN PUGLIA','murgia'],
    ['CASEIFICIO NUZZI di NUZZI FRANCESCO','ALTAMURA','murgia'],
    ['CASEIFICIO MARZULLI MARTINO DI','TARANTO','taranto'],
    ['CASEIFICIO ALBERTI di Lucia Cisternino','CAROVIGNO',''],
    ['CASEIFICIO ARTIGIANALE S.R.L.','OSTUNI','valle itria'],
    ['CASEIFICIO LIPPOLIS S.R.L.C.R.','MOTTOLA',''],
    ['CAPITANATA LATTE SRL','SAN SEVERO','foggia'],
    ['LA MOZZARELLA SRLS','TAVIANO','lecce'],
    ['CASEIFICIO MARINUZZI DI GALATONE NATALIO','PALAGIANELLO','taranto'],
    ['LANZILLOTTI ORONZA LATTICINI','SAN VITO DEI NORMANNI','valle itria'],
    ['CASEIFICIO PALADINO GIACINTO',"CASSANO ALL'IONIO",'calabria'],
    ['SFIZI DI LATTE SRLS','GROTTAGLIE','taranto'],
    ['LE PRELIBATEZZE CASEARIE S.R.L.S.','ANDRIA','bari nord'],
    ['CASEIFICIO DONNA CELESTE DI ROCIOLA ELEO','BARLETTA','bari nord'],
    ['CASEIFICIO PAPARELLA di ANGELO PETRONE','RUVO DI PUGLIA','bari nord'],
    ['LE MAGIE DEL CASARO S.R.L.U.','LECCE','lecce'],
    ['CASEIFICIO FLORA S.R.L.','LECCE','lecce'],
    ['CASEIFICIO LARGO PORTAGRANDE DI PALAZZO','CASTELLANA GROTTE','diretto'],
    ['CASEIFICIO PARADISO DI FLACE NICOLA','SANTERAMO IN COLLE','diretto'],
    ['S.I.P.A. SRL','CAVALLINO','lecce'],
    ['LATTICINI GIGANTE MARIA','ALBEROBELLO','valle itria'],
    ['LABORATORIO MAGNIFICA DI PAMELA RUGGIERO','MESAGNE','lecce'],
  ];
  for (const [nome, localita, giro] of clienti) {
    await q(
      `INSERT INTO clienti (nome,localita,giro,onboarding_stato,sbloccato,fido)
       VALUES ($1,$2,$3,'approvato',TRUE,0) ON CONFLICT DO NOTHING`,
      [nome, localita, giro]
    );
  }

  const prodotti = [
    ['500008','SODA CAUSTICA','ALTRO','kg','1',true],
    ['ACIDOC','ACIDO CITRICO','ALTRO','kg','1sacco=25kg',true],
    ['ALB23','ALBERTI','PANNA UHT','lt','1ct=10lt',true],
    ['BAD','BAD','CAGLIATA','kg','1pz=15kg',false],
    ['BRIE','BRIE','FORMAGGI','kg','1pz=1Kg',true],
    ['BUR125N','BURRO 125','ALTRO','pz','1ct=40pz',true],
    ['BUR250N','BURRO 250','ALTRO','pz','1ct=20pz',true],
    ['CACIO','CACIO PICCANTE','FORMAGGI','kg','1pz=1,5kg circa',false],
    ['CACIOC','CACIO DOLCE','FORMAGGI','kg','1pz=1,5kg circa',false],
    ['CAJ','CAJOLA','RICOTTA','kg','1pz=1,5kg circa',false],
    ['CAM35DEL','S/LATTOSIO','PANNA UHT','lt','1ct=6lt',true],
    ['CAPCAP','CAPRICCIO DI CAPRA','FORMAGGI','kg','1pz=3kg circa',false],
    ['CLT2710','CLT27%','PANNA UHT','lt','1ct=10lt',true],
    ['CLT405','CLT40%','PANNA UHT','lt','1ct=5lt',true],
    ['CONT','CONTADINO','FORMAGGI','kg','1pz=2,5kg circa',false],
    ['CRIMIS','CACIORICOTTA MISTO','RICOTTA','kg','1pz=0,400kg circa',false],
    ['DORBLU','DOR BLU','FORMAGGI','kg','1pz=2,5kg circa',false],
    ['EPI','EPIIM 45','CAGLIATA','kg','1pz=15kg',false],
    ['EPI40','EPIIM 40','CAGLIATA','kg','1pz=15kg',false],
    ['EXI','EXIMO','CAGLIATA','kg','1pz=15kg',false],
    ['FINESV','FINE DEL MONDO SV','FORMAGGI','kg','1pz=5kg circa',false],
    ['FORBLU','FILATO','FORMAGGI','kg','1ct=10kg circa',false],
    ['GSAL','SALE','ALTRO','kg','1 sacco=25kg',true],
    ['JUN','JUNCO','FORMAGGI','kg','1pz=5kg circa',false],
    ['MIC2010','MICCA 20%','PANNA UHT','lt','1ct=10lt',true],
    ['MOLIT','MOLITERNO','FORMAGGI','kg','1pz=5kg circa',false],
    ['MOZBUF','MOZZARELLA DI BUFALA','ALTRO','kg','1ct=3kg',true],
    ['PAMG','PAMIGO GRANDE','FORMAGGI','kg','1rete=2 forme=5 kg circa',false],
    ['PAMP','PAMIGO PICCOLO','FORMAGGI','kg','1 rete=5forme= 8 kg circa',false],
    ['PEPER','PEPERONCINO','FORMAGGI','kg','1 forma=0,500kg circa',false],
    ['RICFNEU','RICOTTA FORTE','RICOTTA','kg','1 secchio= 5 kg',true],
    ['RICTOSSV','TOSCANELLA','RICOTTA','kg','1FORMA=3 KG CIRCA',false],
    ['SPALMA','SPALMABILE','FORMAGGI','pz','1SECCHIO=1,5KG',true],
    ['SPOM','SPOMLEK','CAGLIATA','kg','1PEZZO=15KG CIRCA',false],
    ['STRAC','STRACCHINATO','FORMAGGI','kg','',false],
    ['VIR36','VIRGILIO','PANNA UHT','lt','1ct=12lt',true],
    ['YSPI231','YSPIRA 23% LT 1','PANNA UHT','lt','1ct=12lt',true],
    ['YSPI2310','YSPIRA 23% LT 10','PANNA UHT','lt','1ct=10lt',true],
    ['YSPI261','YSPIRA 26% LT 1','PANNA UHT','lt','1ct=12lt',true],
    ['YSPI2610','YSPIRA 26% LT 10','PANNA UHT','lt','1ct=10lt',true],
  ];
  for (const [codice, nome, categoria, um, packaging, peso_fisso] of prodotti) {
    await q(
      `INSERT INTO prodotti (codice,nome,categoria,um,packaging,peso_fisso)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [codice, nome, categoria, um, packaging, peso_fisso]
    );
  }

  // Camion con pedane
  const camions = [
    ['FT747BN','Furgone 100q FT747BN','asym8', 8],
    ['FM249VA','Furgone 100q FM249VA','asym8', 8],
    ['FV671ZL','Furgone 72q FV671ZL', 'asym8', 8],
    ['FT748BN','Furgone 150q FT748BN','sym12',12],
    ['GC808NZ','Ford GC808NZ',        'ford5', 5],
  ];
  for (const [targa, nome, layout, num_pedane] of camions) {
    const res = await q(
      `INSERT INTO camions (targa,nome,layout,num_pedane) VALUES ($1,$2,$3,$4)
       ON CONFLICT DO NOTHING RETURNING id`,
      [targa, nome, layout, num_pedane]
    );
    if (res.rows.length) {
      const cid = res.rows[0].id;
      for (let i = 1; i <= num_pedane; i++) {
        await q(`INSERT INTO pedane (camion_id,numero,nota) VALUES ($1,$2,'')`, [cid, i]);
      }
    }
  }

  // Giri calendario
  const giri = [
    ['bari nord',[3,5]], ['bari/foggia',[1]], ['calabria',[2]],
    ['diretto',[2]],     ['lecce',[1,4]],     ['lecce est',[3]],
    ['murgia',[5]],      ['stef',[]],          ['taranto',[2]],
    ['valle itria',[4]], ['variabile',[]],     ['foggia',[]],
  ];
  for (const [giro, giorni] of giri) {
    await q(
      `INSERT INTO giri_calendario (giro,giorni) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [giro, JSON.stringify(giorni)]
    );
  }

  console.log('✅ Seed completato');
}

// ─── HELPERS ─────────────────────────────────────────────────────
function parseUtente(u) {
  if (!u) return null;
  const gc = u.giri_consegna;
  return {
    ...u,
    giri_consegna: Array.isArray(gc) ? gc : (gc ? JSON.parse(gc) : []),
  };
}

async function logDB(userId, userName, action, detail = '') {
  try {
    await q(
      `INSERT INTO activity_log (user_id,user_name,action,detail) VALUES ($1,$2,$3,$4)`,
      [userId || null, userName || 'Sistema', action, detail]
    );
  } catch(e) { /* non bloccare */ }
}

function getMessaggiInboxWhere(reqUser, startIndex = 1) {
  return {
    clause: `(
      EXISTS (
        SELECT 1
          FROM jsonb_array_elements_text(COALESCE(m.partecipanti_user_ids, '[]'::jsonb)) pid(value)
         WHERE pid.value::int = $${startIndex}
      )
      OR (${startIndex ? `m.destinatario_tipo='user' AND m.destinatario_user_id=$${startIndex}` : 'FALSE'})
      OR (m.destinatario_tipo='role' AND m.destinatario_ruolo=$${startIndex + 1})
      OR (m.assegnato_user_id=$${startIndex})
    )`,
    params: [reqUser.id || null, String(reqUser.ruolo || '')],
  };
}

function getMessaggiAccessWhere(reqUser, startIndex = 1) {
  const inbox = getMessaggiInboxWhere(reqUser, startIndex);
  return {
    clause: `(${inbox.clause} OR m.created_by=$${startIndex})`,
    params: inbox.params,
  };
}

function normalizeMessaggioRow(row = {}) {
  return {
    id: row.id,
    conversation_id: row.conversation_id || null,
    mittente_id: row.mittente_id || null,
    mittente_nome: row.mittente_nome || '',
    testo: row.testo || '',
    created_at: row.created_at || null,
  };
}

function normalizeMessaggioConversationRow(row = {}) {
  return {
    id: row.id,
    created_by: row.created_by || null,
    created_by_name: row.created_by_name || '',
    conversation_kind: row.conversation_kind || 'direct',
    nome_chat: row.nome_chat || '',
    partecipanti_user_ids: Array.isArray(row.partecipanti_user_ids)
      ? row.partecipanti_user_ids.map(v => parseInt(v, 10)).filter(v => Number.isInteger(v) && v > 0)
      : [],
    partecipanti_nomi: Array.isArray(row.partecipanti_nomi)
      ? row.partecipanti_nomi.map(v => String(v || '').trim()).filter(Boolean)
      : [],
    destinatario_tipo: row.destinatario_tipo || 'user',
    destinatario_user_id: row.destinatario_user_id || null,
    destinatario_ruolo: row.destinatario_ruolo || '',
    destinatario_nome: row.destinatario_nome || '',
    oggetto: row.oggetto || '',
    stato: row.stato || 'nuovo',
    priorita: row.priorita || 'media',
    assegnato_user_id: row.assegnato_user_id || null,
    assegnato_nome: row.assegnato_nome || '',
    cliente_id: row.cliente_id || null,
    cliente_nome: row.cliente_nome || '',
    ordine_id: row.ordine_id || null,
    last_message_id: row.last_message_id || null,
    last_message_text: row.last_message_text || '',
    last_message_sender: row.last_message_sender || '',
    last_message_at: row.last_message_at || row.created_at || null,
    created_at: row.created_at || null,
    closed_at: row.closed_at || null,
    unread: !!row.unread,
    message_count: Number(row.message_count || 0),
  };
}

const zMessaggioPriority = z.enum(['bassa', 'media', 'alta', 'urgente']);
const zMessaggioStatus = z.enum(['nuovo', 'preso_in_carico', 'in_attesa', 'chiuso']);

const zMessaggioCreate = z.object({
  destinatario_tipo: z.enum(['user', 'role', 'self', 'group']),
  destinatario_user_id: z.coerce.number().int().positive().optional().nullable(),
  destinatario_user_ids: z.array(z.coerce.number().int().positive()).optional().default([]),
  destinatario_ruolo: z.string().trim().optional().nullable(),
  nome_chat: z.string().trim().max(120).optional().default(''),
  oggetto: z.string().trim().max(120).optional().default(''),
  testo: z.string().trim().min(1).max(4000),
  ordine_id: z.coerce.number().int().positive().optional().nullable(),
  cliente_id: z.coerce.number().int().positive().optional().nullable(),
  priorita: zMessaggioPriority.optional().default('media'),
});

const zMessaggioReply = z.object({
  testo: z.string().trim().min(1).max(4000),
});

const zMessaggioConversationUpdate = z.object({
  stato: zMessaggioStatus.optional(),
  priorita: zMessaggioPriority.optional(),
  assegnato_user_id: z.coerce.number().int().positive().optional().nullable(),
});

// ─── AUTH ────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const h = req.headers['authorization'];
  if (!h) return res.status(401).json({ error: 'Token mancante' });
  try {
    req.user = jwt.verify(h.replace('Bearer ', ''), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token non valido o scaduto' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.ruolo))
      return res.status(403).json({ error: 'Permesso negato' });
    next();
  };
}

const PERMISSIONS = {
  'clienti:create': ['admin', 'amministrazione', 'direzione', 'autista', 'magazzino'],
  'clienti:update': ['admin', 'amministrazione', 'direzione'],
  'clienti:delete': ['admin'],
  'documenti:view': ['admin', 'amministrazione', 'direzione', 'autista', 'magazzino'],
  'documenti:manage': ['admin', 'amministrazione', 'direzione'],
  'prodotti:manage': ['admin', 'direzione'],
  'listini:view': ['admin', 'amministrazione', 'direzione', 'autista', 'magazzino'],
  'listini:manage': ['admin', 'direzione'],
  'rese:view': ['admin', 'direzione'],
  'rese:manage': ['admin', 'direzione'],
  'onboarding:manage': ['admin', 'amministrazione'],
  'ordini:create': ['admin', 'amministrazione', 'direzione', 'autista', 'magazzino'],
  'ordini:update': ['admin', 'amministrazione', 'direzione', 'autista', 'magazzino'],
  'ordini:delete': ['admin', 'amministrazione', 'direzione', 'autista', 'magazzino'],
  'ordini:stato': ['admin', 'autista', 'magazzino', 'amministrazione', 'direzione'],
  'scorte:view': ['admin', 'amministrazione', 'direzione', 'autista', 'magazzino'],
  'scorte:manage': ['admin', 'magazzino'],
};

function hasPermission(role, permission) {
  const allowed = PERMISSIONS[permission] || [];
  return allowed.includes(role);
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!hasPermission(req.user.ruolo, permission)) {
      return res.status(403).json({ error: `Permesso negato: ${permission}` });
    }
    next();
  };
}

const APP_ROLES = ['admin', 'amministrazione', 'direzione', 'autista', 'magazzino'];
const DOCS_FULL_ACCESS_ROLES = ['admin', 'amministrazione', 'direzione'];

function hasFullDocumentAccess(role) {
  return DOCS_FULL_ACCESS_ROLES.includes(String(role || ''));
}

function normalizeAllowedRoles(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return [...new Set(arr.map(r => String(r || '').trim()).filter(r => APP_ROLES.includes(r)))];
}

function normalizeAllowedUserIds(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return [...new Set(arr.map(v => Number.parseInt(v, 10)).filter(v => Number.isInteger(v) && v > 0))];
}

function normalizeConversationParticipantIds(raw) {
  return [...new Set((Array.isArray(raw) ? raw : []).map(v => Number.parseInt(v, 10)).filter(v => Number.isInteger(v) && v > 0))].sort((a, b) => a - b);
}

function normalizeCalendarEventType(raw) {
  const value = String(raw || 'evento').trim().toLowerCase();
  if (['ferie', 'attivita', 'evento'].includes(value)) return value;
  if (['permesso', 'rol', 'recupero'].includes(value)) return 'ferie';
  return 'evento';
}

function normalizeCalendarEventStatus(raw) {
  const value = String(raw || 'programmata').trim().toLowerCase();
  return ['programmata', 'confermata', 'da_approvare', 'respinta'].includes(value) ? value : 'programmata';
}

function canApproveCalendarFerie(reqUser) {
  const role = String(reqUser?.ruolo || '').trim();
  return role === 'admin' || role === 'direzione';
}

function normalizeCalendarVisibility(raw = {}) {
  const creatorOnly = !!raw.visibilita_solo_creator;
  const allowedRoles = creatorOnly ? [] : normalizeAllowedRoles(raw.visibilita_ruoli);
  const allowedUsers = creatorOnly ? [] : normalizeAllowedUserIds(raw.visibilita_utenti);
  if (creatorOnly || (!allowedRoles.length && !allowedUsers.length)) {
    return { visibilita_solo_creator: true, visibilita_ruoli: [], visibilita_utenti: [] };
  }
  return {
    visibilita_solo_creator: false,
    visibilita_ruoli: allowedRoles,
    visibilita_utenti: allowedUsers,
  };
}

function userCanViewCalendarEvent(reqUser, row = {}) {
  const currentUserId = Number.parseInt(reqUser?.id, 10);
  if (Number.isInteger(currentUserId) && currentUserId > 0 && currentUserId === Number.parseInt(row.created_by, 10)) return true;
  if (!!row.visibilita_solo_creator) return false;
  const allowedRoles = normalizeAllowedRoles(row.visibilita_ruoli);
  if (allowedRoles.includes(String(reqUser?.ruolo || '').trim())) return true;
  const allowedUsers = normalizeAllowedUserIds(row.visibilita_utenti);
  return Number.isInteger(currentUserId) && allowedUsers.includes(currentUserId);
}

function userCanManageCalendarEvent(reqUser, row = {}) {
  const role = String(reqUser?.ruolo || '').trim();
  if (['admin', 'amministrazione', 'direzione'].includes(role)) return true;
  const currentUserId = Number.parseInt(reqUser?.id, 10);
  return Number.isInteger(currentUserId) && currentUserId > 0 && currentUserId === Number.parseInt(row.created_by, 10);
}

function buildMessaggiConversationListSql(whereClause, userIdPlaceholder, limitPlaceholder) {
  return `
    WITH last_messages AS (
      SELECT DISTINCT ON (m.conversation_id)
             m.conversation_id,
             m.id AS last_message_id,
             m.mittente_nome AS last_message_sender,
             m.testo AS last_message_text,
             m.created_at AS last_message_at
        FROM messaggi_interni m
       WHERE m.conversation_id IS NOT NULL
       ORDER BY m.conversation_id, m.created_at DESC, m.id DESC
    ),
    message_counts AS (
      SELECT conversation_id, COUNT(*)::int AS message_count
        FROM messaggi_interni
       WHERE conversation_id IS NOT NULL
       GROUP BY conversation_id
    ),
    participant_names AS (
      SELECT m.id AS conversation_id,
             COALESCE(
               jsonb_agg(TRIM(COALESCE(u.nome, '') || ' ' || COALESCE(u.cognome, '')) ORDER BY TRIM(COALESCE(u.nome, '') || ' ' || COALESCE(u.cognome, '')))
               FILTER (WHERE u.id IS NOT NULL),
               '[]'::jsonb
             ) AS partecipanti_nomi
        FROM messaggi_conversazioni m
        LEFT JOIN LATERAL jsonb_array_elements_text(COALESCE(m.partecipanti_user_ids, '[]'::jsonb)) pid(value) ON TRUE
        LEFT JOIN utenti u ON u.id = pid.value::int
       GROUP BY m.id
    )
    SELECT m.*,
           c.nome AS cliente_nome,
           COALESCE(du.nome || ' ' || COALESCE(du.cognome,''), '') AS destinatario_nome,
           COALESCE(au.nome || ' ' || COALESCE(au.cognome,''), '') AS assegnato_nome,
           pn.partecipanti_nomi,
           lm.last_message_id,
           lm.last_message_sender,
           lm.last_message_text,
           lm.last_message_at,
           COALESCE(mc.message_count, 0) AS message_count,
           CASE
             WHEN lm.last_message_id IS NULL THEN FALSE
             WHEN ml.last_read_message_id IS NULL THEN TRUE
             ELSE ml.last_read_message_id < lm.last_message_id
           END AS unread
      FROM messaggi_conversazioni m
      LEFT JOIN clienti c ON c.id = m.cliente_id
      LEFT JOIN utenti du ON du.id = m.destinatario_user_id
      LEFT JOIN utenti au ON au.id = m.assegnato_user_id
      LEFT JOIN participant_names pn ON pn.conversation_id = m.id
      LEFT JOIN last_messages lm ON lm.conversation_id = m.id
      LEFT JOIN message_counts mc ON mc.conversation_id = m.id
      LEFT JOIN messaggi_conversazione_letture ml
        ON ml.conversation_id = m.id
       AND ml.user_id = $${userIdPlaceholder}
     WHERE ${whereClause}
     ORDER BY COALESCE(lm.last_message_at, m.last_message_at, m.created_at) DESC, m.id DESC
     LIMIT $${limitPlaceholder}`;
}

async function getMessaggioConversationSummaryById(id, reqUser) {
  const access = getMessaggiAccessWhere(reqUser, 2);
  const sql = `
    WITH last_messages AS (
      SELECT DISTINCT ON (mi.conversation_id)
             mi.conversation_id,
             mi.id AS last_message_id,
             mi.mittente_nome AS last_message_sender,
             mi.testo AS last_message_text,
             mi.created_at AS last_message_at
        FROM messaggi_interni mi
       WHERE mi.conversation_id IS NOT NULL
       ORDER BY mi.conversation_id, mi.created_at DESC, mi.id DESC
    ),
    message_counts AS (
      SELECT conversation_id, COUNT(*)::int AS message_count
        FROM messaggi_interni
       WHERE conversation_id IS NOT NULL
       GROUP BY conversation_id
    ),
    participant_names AS (
      SELECT m.id AS conversation_id,
             COALESCE(
               jsonb_agg(TRIM(COALESCE(u.nome, '') || ' ' || COALESCE(u.cognome, '')) ORDER BY TRIM(COALESCE(u.nome, '') || ' ' || COALESCE(u.cognome, '')))
               FILTER (WHERE u.id IS NOT NULL),
               '[]'::jsonb
             ) AS partecipanti_nomi
        FROM messaggi_conversazioni m
        LEFT JOIN LATERAL jsonb_array_elements_text(COALESCE(m.partecipanti_user_ids, '[]'::jsonb)) pid(value) ON TRUE
        LEFT JOIN utenti u ON u.id = pid.value::int
       GROUP BY m.id
    )
    SELECT m.*,
           c.nome AS cliente_nome,
           COALESCE(du.nome || ' ' || COALESCE(du.cognome,''), '') AS destinatario_nome,
           COALESCE(au.nome || ' ' || COALESCE(au.cognome,''), '') AS assegnato_nome,
           pn.partecipanti_nomi,
           lm.last_message_id,
           lm.last_message_sender,
           lm.last_message_text,
           lm.last_message_at,
           COALESCE(mc.message_count, 0) AS message_count,
           CASE
             WHEN lm.last_message_id IS NULL THEN FALSE
             WHEN ml.last_read_message_id IS NULL THEN TRUE
             ELSE ml.last_read_message_id < lm.last_message_id
           END AS unread
      FROM messaggi_conversazioni m
      LEFT JOIN clienti c ON c.id = m.cliente_id
      LEFT JOIN utenti du ON du.id = m.destinatario_user_id
      LEFT JOIN utenti au ON au.id = m.assegnato_user_id
      LEFT JOIN participant_names pn ON pn.conversation_id = m.id
      LEFT JOIN last_messages lm ON lm.conversation_id = m.id
      LEFT JOIN message_counts mc ON mc.conversation_id = m.id
      LEFT JOIN messaggi_conversazione_letture ml
        ON ml.conversation_id = m.id
       AND ml.user_id = $2
     WHERE m.id = $1
       AND ${access.clause}
     LIMIT 1`;
  const { rows } = await q(sql, [id, ...access.params]);
  return rows[0] ? normalizeMessaggioConversationRow(rows[0]) : null;
}

async function markConversationReadForUser(conversationId, userId) {
  const { rows } = await q(
    `SELECT id
       FROM messaggi_interni
      WHERE conversation_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [conversationId]
  );
  const lastMessageId = rows[0]?.id || null;
  if (!lastMessageId) return null;
  await q(
    `INSERT INTO messaggi_conversazione_letture (conversation_id, user_id, last_read_message_id, last_read_at)
     VALUES ($1,$2,$3,NOW())
     ON CONFLICT (conversation_id, user_id)
     DO UPDATE SET last_read_message_id = EXCLUDED.last_read_message_id,
                   last_read_at = EXCLUDED.last_read_at`,
    [conversationId, userId, lastMessageId]
  );
  return lastMessageId;
}

async function createInternalConversation({
  senderUser,
  destinatarioUserId,
  oggetto,
  testo,
  clienteId = null,
  ordineId = null,
  priorita = 'media',
}) {
  const userId = parseInt(destinatarioUserId, 10);
  if (!userId) return null;
  const mittenteNome = `${senderUser?.nome || ''} ${senderUser?.cognome || ''}`.trim() || 'Sistema';
  const { rows: userRows } = await q(
    `SELECT id, nome, cognome
       FROM utenti
      WHERE id = $1
      LIMIT 1`,
    [userId]
  );
  if (!userRows.length) return null;
  const conv = await q(
    `INSERT INTO messaggi_conversazioni
      (created_by, created_by_name, conversation_kind, partecipanti_user_ids, destinatario_tipo, destinatario_user_id, destinatario_ruolo, oggetto, stato, priorita, cliente_id, ordine_id, last_message_at)
     VALUES ($1,$2,'direct',$3::jsonb,'user',$4,NULL,$5,'nuovo',$6,$7,$8,NOW())
     RETURNING id`,
    [
      senderUser?.id || null,
      mittenteNome,
      JSON.stringify(normalizeConversationParticipantIds([senderUser?.id, userId])),
      userId,
      String(oggetto || '').trim(),
      String(priorita || 'media').trim() || 'media',
      clienteId || null,
      ordineId || null,
    ]
  );
  const conversationId = conv.rows[0]?.id || null;
  if (!conversationId) return null;
  await q(
    `INSERT INTO messaggi_interni
       (conversation_id, mittente_id, mittente_nome, destinatario_tipo, destinatario_user_id, destinatario_ruolo, oggetto, testo, ordine_id, cliente_id)
     VALUES ($1,$2,$3,'user',$4,NULL,$5,$6,$7,$8)`,
    [
      conversationId,
      senderUser?.id || null,
      mittenteNome,
      userId,
      String(oggetto || '').trim(),
      String(testo || '').trim(),
      ordineId || null,
      clienteId || null,
    ]
  );
  if (senderUser?.id) {
    await markConversationReadForUser(conversationId, senderUser.id).catch(() => {});
  }
  return conversationId;
}

async function migrateLegacyMessaggiToConversations() {
  const { rows } = await q(
    `SELECT *
       FROM messaggi_interni
      WHERE conversation_id IS NULL
      ORDER BY id ASC`
  );
  for (const row of rows) {
    const inserted = await q(
      `INSERT INTO messaggi_conversazioni
        (created_by, created_by_name, destinatario_tipo, destinatario_user_id, destinatario_ruolo, oggetto, stato, priorita, cliente_id, ordine_id, last_message_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'nuovo','media',$7,$8,$9,$10)
       RETURNING id`,
      [
        row.mittente_id || null,
        row.mittente_nome || 'Utente',
        row.destinatario_tipo || 'user',
        row.destinatario_user_id || null,
        row.destinatario_ruolo || null,
        row.oggetto || '',
        row.cliente_id || null,
        row.ordine_id || null,
        row.created_at || new Date().toISOString(),
        row.created_at || new Date().toISOString(),
      ]
    );
    const conversationId = inserted.rows[0].id;
    await q(`UPDATE messaggi_interni SET conversation_id=$1 WHERE id=$2`, [conversationId, row.id]);
    if (row.letto_at && row.destinatario_user_id) {
      await q(
        `INSERT INTO messaggi_conversazione_letture (conversation_id, user_id, last_read_message_id, last_read_at)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (conversation_id, user_id)
         DO UPDATE SET last_read_message_id = EXCLUDED.last_read_message_id,
                       last_read_at = EXCLUDED.last_read_at`,
        [conversationId, row.destinatario_user_id, row.id, row.letto_at]
      );
    }
  }
  await q(
    `UPDATE messaggi_conversazioni
        SET conversation_kind = CASE
              WHEN destinatario_tipo = 'role' THEN 'role'
              WHEN created_by IS NOT NULL AND created_by = destinatario_user_id THEN 'self'
              ELSE 'direct'
            END,
            partecipanti_user_ids = CASE
              WHEN jsonb_array_length(COALESCE(partecipanti_user_ids, '[]'::jsonb)) > 0 THEN partecipanti_user_ids
              WHEN destinatario_tipo = 'role' THEN to_jsonb(ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[created_by]) AS x WHERE x IS NOT NULL))
              ELSE to_jsonb(ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[created_by, destinatario_user_id]) AS x WHERE x IS NOT NULL))
            END
      WHERE TRUE`
  );
}

function userCanViewDocFolder(userRole, allowedRolesRaw) {
  if (hasFullDocumentAccess(userRole)) return true;
  const allowed = normalizeAllowedRoles(allowedRolesRaw);
  if (!allowed.length) return true;
  return allowed.includes(String(userRole || ''));
}

function decodeBase64Payload(raw) {
  const str = String(raw || '').trim();
  if (!str) return Buffer.alloc(0);
  const match = str.match(/^data:[^;]+;base64,(.+)$/i);
  const base = match ? match[1] : str;
  return Buffer.from(base, 'base64');
}

async function logOnboardingChange({ clienteId, reqUser, oldStato, newStato, oldFido, newFido, note = '' }) {
  const userName = `${reqUser.nome} ${reqUser.cognome || ''}`.trim();
  await q(
    `INSERT INTO clienti_onboarding_log (cliente_id,user_id,user_name,old_stato,new_stato,old_fido,new_fido,note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [clienteId, reqUser.id || null, userName || 'Sistema', oldStato || null, newStato || null, oldFido ?? null, newFido ?? null, note || '']
  );
}

function asNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function asIntArray(v) {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map(x => parseInt(x, 10)).filter(Number.isFinite))];
}

const RESA_BUYER_SPREADS = {
  viga: 1.40,
  ital_butter: 1.25,
};

function computePrezzoVenduto(clalValue, buyerCode, resaPct) {
  const clal = asNum(clalValue);
  const resa = asNum(resaPct);
  const spread = asNum(RESA_BUYER_SPREADS[String(buyerCode || '')]);
  if (clal === null || resa === null || spread === null || resa <= 0) return null;
  return Math.round((((clal + spread) / 82) * resa) * 100) / 100;
}

function validationError(res, parsed) {
  return res.status(400).json({
    error: 'Payload non valido',
    details: parsed.error.issues.map(i => ({
      path: i.path.join('.'),
      message: i.message,
    })),
  });
}

const zListinoPayload = z.object({
  prodotto_id: z.coerce.number().int().positive().optional(),
  prodotto_ids: z.array(z.coerce.number().int().positive()).optional(),
  cliente_id: z.coerce.number().int().positive().nullable().optional(),
  cliente_ids: z.array(z.coerce.number().int().positive()).optional(),
  giro: z.string().max(120).optional().default(''),
  scope: z.enum(['all', 'giro', 'cliente', 'giro_cliente']).optional().default('all'),
  mode: z.enum(['base_markup', 'discount_pct', 'final_price']).optional().default('final_price'),
  prezzo: z.coerce.number().nullable().optional(),
  base_price: z.coerce.number().nullable().optional(),
  markup_pct: z.coerce.number().optional().default(0),
  discount_pct: z.coerce.number().optional().default(0),
  final_price: z.coerce.number().nullable().optional(),
  excluded_client_ids: z.array(z.coerce.number().int().positive()).optional().default([]),
  valido_dal: z.string().min(1),
  valido_al: z.string().nullable().optional(),
  note: z.string().max(3000).optional().default(''),
});

const zResaPayload = z.object({
  fornitore_id: z.coerce.number().int().positive(),
  clal_value: z.coerce.number().nonnegative(),
  buyer_code: z.enum(['viga', 'ital_butter']),
  quantita: z.coerce.number().positive(),
  prezzo_pagato: z.coerce.number().nonnegative(),
  lotto: z.string().max(120).optional().default(''),
  resa_pct: z.coerce.number().positive().max(100),
});

const zCrmEventoPayload = z.object({
  tipo: z.string().min(1).max(80).optional().default('richiesta'),
  contatto_tipo: z.string().max(120).optional().default(''),
  esito: z.string().max(300).optional().default(''),
  stato_cliente: z.string().max(80).optional().default(''),
  richiesta: z.string().max(2000).optional().default(''),
  offerta: z.string().max(2000).optional().default(''),
  motivo: z.string().max(2000).optional().default(''),
  note: z.string().max(3000).optional().default(''),
  contatto_nome: z.string().max(180).optional().default(''),
  telefono: z.string().max(80).optional().default(''),
  incaricato_user_id: z.coerce.number().int().positive().nullable().optional().default(null),
  invia_messaggio: z.coerce.boolean().optional().default(false),
  followup_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  followup_repeat_value: z.coerce.number().int().positive().nullable().optional().default(null),
  followup_repeat_unit: z.enum(['giorni', 'mesi']).nullable().optional().default(null),
  priorita: z.string().max(20).optional().default('media'),
});

const zClienteConversionPayload = z.object({
  nome: z.string().trim().min(1).max(160),
  alias: z.string().trim().max(160).optional().default(''),
  localita: z.string().trim().max(160).optional().default(''),
  giro: z.string().trim().max(120).optional().default(''),
  agente_id: z.coerce.number().int().positive().nullable().optional().default(null),
  autista_di_giro: z.coerce.number().int().positive().nullable().optional().default(null),
  note: z.string().trim().max(2000).optional().default(''),
  piva: z.string().trim().min(1).max(32),
  codice_fiscale: z.string().trim().max(32).optional().default(''),
  codice_univoco: z.string().trim().max(32).optional().default(''),
  pec: z.string().trim().max(160).optional().default(''),
  cond_pagamento: z.string().trim().max(200).optional().default(''),
  e_fornitore: z.coerce.boolean().optional().default(false),
  classificazione: z.string().trim().max(120).optional().default(''),
  contatto_nome: z.string().trim().max(120).optional().default(''),
  telefono: z.string().trim().max(60).optional().default(''),
});

const zConsegnaParzialePayload = z.object({
  delivered: z.record(z.coerce.number()).optional().default({}),
  note: z.string().max(2000).optional().default(''),
  preferred_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

const zPreparazioneLineaPayload = z.object({
  preparato: z.boolean().optional(),
  peso_effettivo: z.coerce.number().nullable().optional(),
  qty_base: z.coerce.number().nonnegative().nullable().optional(),
  colli_effettivi: z.coerce.number().nullable().optional(),
  lotto: z.string().max(120).optional(),
});

const zOrdineLineaCreatePayload = z.object({
  prodotto_id: z.coerce.number().int().positive().nullable().optional().default(null),
  prodotto_nome_libero: z.string().max(255).optional().default(''),
  qty: z.coerce.number().positive(),
  qty_base: z.coerce.number().positive().nullable().optional().default(null),
  prezzo_unitario: z.coerce.number().nullable().optional().default(null),
  is_pedana: z.coerce.boolean().optional().default(false),
  nota_riga: z.string().max(1000).optional().default(''),
  unita_misura: z.string().max(40).optional().default('pezzi'),
  lotto: z.string().max(120).optional().default(''),
});

const zChiudiGiornataPayload = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  giro: z.string().max(120).optional().default(''),
  action_if_incomplete: z.enum(['continue', 'back']).optional(),
  action_if_residual: z.enum(['reload', 'delete']).optional(),
});

const zGiroCalendarioPayload = z.object({
  giro: z.string().trim().min(1).max(120),
  giorni: z.array(z.coerce.number().int().min(0).max(6)).optional().default([]),
});

const zScortaPayload = z.object({
  prodotto_id: z.coerce.number().int().positive().nullable().optional().default(null),
  prodotto_nome: z.string().min(2).max(160),
  quantita_rimanente: z.coerce.number().nonnegative(),
  unita_misura: z.string().max(40).optional().default(''),
  kg_stimati: z.coerce.number().nonnegative().nullable().optional().default(null),
  note: z.string().max(1000).optional().default(''),
});

async function getNextDeliveryDate(giro, fromDateStr = null) {
  const start = fromDateStr ? new Date(fromDateStr) : new Date();
  const { rows } = await q('SELECT giorni FROM giri_calendario WHERE giro=$1 LIMIT 1', [String(giro || '').trim()]);
  const giorni = Array.isArray(rows[0]?.giorni) ? rows[0].giorni : [];
  if (!giorni.length) {
    const d = new Date(start);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  for (let delta = 1; delta <= 14; delta++) {
    const d = new Date(start);
    d.setDate(start.getDate() + delta);
    if (giorni.includes(d.getDay())) return d.toISOString().slice(0, 10);
  }
  const fb = new Date(start);
  fb.setDate(fb.getDate() + 1);
  return fb.toISOString().slice(0, 10);
}

async function getOrdineGiroEffettivoRow(ordineId, client = null) {
  const db = client || pool;
  const { rows } = await db.query(
    `SELECT COALESCE(NULLIF(o.giro_override,''), c.giro, '') AS giro_effettivo
     FROM ordini o
     JOIN clienti c ON c.id = o.cliente_id
     WHERE o.id = $1
     LIMIT 1`,
    [ordineId]
  );
  return String(rows[0]?.giro_effettivo || '').trim();
}

async function listOrdiniApertiByDateGiro({ data, giro = '', client = null }) {
  const db = client || pool;
  const params = [data];
  let giroWhere = '';
  if (String(giro || '').trim()) {
    params.push(String(giro || '').trim());
    giroWhere = `AND COALESCE(NULLIF(o.giro_override,''), c.giro, '') = $2`;
  }
  const { rows } = await db.query(
    `SELECT o.id, o.cliente_id, c.nome AS cliente_nome, o.agente_id, o.autista_di_giro, o.inserted_by, o.data, o.stato, o.note,
            o.data_non_certa, o.stef, o.altro_vettore, o.giro_override,
            c.giro AS cliente_giro,
            COALESCE(NULLIF(o.giro_override,''), c.giro, '') AS giro_effettivo
     FROM ordini o
     JOIN clienti c ON c.id = o.cliente_id
     WHERE o.data = $1
       AND o.stato <> 'annullato'
       ${giroWhere}
     ORDER BY o.id`,
    params
  );
  return rows;
}

async function buildDailyClosureSummary({ data, client = null }) {
  const run = client ? ((sql, params) => client.query(sql, params)) : q;
  const { rows: orders } = await run(
    `SELECT o.id, o.stato, o.autista_di_giro,
            COALESCE(NULLIF(o.giro_override,''), c.giro, '') AS giro_effettivo,
            COALESCE(au.nome || ' ' || COALESCE(au.cognome,''), '') AS autista_nome
     FROM ordini o
     JOIN clienti c ON c.id = o.cliente_id
     LEFT JOIN utenti au ON au.id = o.autista_di_giro
     WHERE o.data = $1`,
    [data]
  );
  const { rows: magRows } = await run(
    `SELECT id, giro, confermata_nome, confermata_at, esito
     FROM magazzino_chiusure_giornata
     WHERE data = $1
     ORDER BY confermata_at DESC`,
    [data]
  );
  const { rows: giroRows } = await run(
    `SELECT id, giro, autista_id, autista_nome, confermata_nome, confermata_at, esito
     FROM giro_chiusure_giornata
     WHERE data = $1
     ORDER BY confermata_at DESC`,
    [data]
  );
  const { rows: aziendaRows } = await run(
    `SELECT id, confermata_nome, confermata_at, esito
     FROM azienda_chiusure_giornata
     WHERE data = $1
     ORDER BY confermata_at DESC
     LIMIT 1`,
    [data]
  );

  const statusCounts = {
    attesa: 0,
    preparazione: 0,
    preparato: 0,
    consegnato: 0,
    sospeso: 0,
    annullato: 0,
  };
  orders.forEach(o => { if (statusCounts[o.stato] !== undefined) statusCounts[o.stato]++; });
  const openOrders = orders.filter(o => ['attesa', 'preparazione', 'preparato'].includes(String(o.stato || '')));
  const expectedDrivers = new Map();
  orders.forEach(o => {
    if (!o.autista_di_giro) return;
    const key = `${o.autista_di_giro}__${String(o.giro_effettivo || '').trim()}`;
    if (!expectedDrivers.has(key)) {
      expectedDrivers.set(key, {
        autista_id: o.autista_di_giro,
        autista_nome: String(o.autista_nome || '').trim(),
        giro: String(o.giro_effettivo || '').trim(),
      });
    }
  });
  const closedDriverKeys = new Set(
    giroRows.map(r => `${r.autista_id || ''}__${String(r.giro || '').trim()}`)
  );
  const closedDriverAll = new Set(
    giroRows.filter(r => !String(r.giro || '').trim()).map(r => String(r.autista_id || ''))
  );
  const pendingDriverClosures = [...expectedDrivers.values()].filter(item => {
    if (closedDriverAll.has(String(item.autista_id || ''))) return false;
    return !closedDriverKeys.has(`${item.autista_id}__${item.giro}`);
  });

  return {
    data,
    orders: {
      total: orders.length,
      open: openOrders.length,
      counts: statusCounts,
    },
    magazzino: {
      closed: magRows.length > 0,
      count: magRows.length,
      items: magRows,
    },
    giro: {
      expected_count: expectedDrivers.size,
      closed_count: closedDriverKeys.size,
      items: giroRows,
      pending: pendingDriverClosures,
    },
    azienda: {
      closed: aziendaRows.length > 0,
      item: aziendaRows[0] || null,
    },
  };
}

function formatResidualValue(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  if (Math.abs(num - Math.round(num)) < 0.000001) return String(Math.round(num));
  return String(Math.round(num * 1000) / 1000);
}

function getResidualLineLabel(line) {
  return String(line.prodotto_nome || line.prodotto_nome_libero || `Prodotto #${line.prodotto_id || 'N/D'}`).trim();
}

function buildResidualLineSnapshot(line) {
  return {
    linea_id: line.id,
    prodotto_id: line.prodotto_id || null,
    prodotto: getResidualLineLabel(line),
    qty_ordinata: Number(line.qty || 0),
    qty_base: line.qty_base === null || line.qty_base === undefined ? null : Number(line.qty_base),
    unita_misura: line.unita_misura || 'pezzi',
    preparato: !!line.preparato,
    colli_effettivi: line.colli_effettivi === null || line.colli_effettivi === undefined ? null : Number(line.colli_effettivi),
    peso_effettivo: line.peso_effettivo === null || line.peso_effettivo === undefined ? null : Number(line.peso_effettivo),
    lotto: String(line.lotto || '').trim(),
  };
}

function buildResidualTriggerText(line) {
  const ordered = `${formatResidualValue(line.qty)} ${line.unita_misura || 'pezzi'}`.trim();
  const parts = [`non preparato`, `ordinato ${ordered}`];
  if (line.colli_effettivi !== null && line.colli_effettivi !== undefined) {
    parts.push(`colli scaricati ${formatResidualValue(line.colli_effettivi)}`);
  }
  if (line.peso_effettivo !== null && line.peso_effettivo !== undefined) {
    parts.push(`peso scaricato ${formatResidualValue(line.peso_effettivo)} kg`);
  }
  if (String(line.lotto || '').trim()) {
    parts.push(`lotto ${String(line.lotto).trim()}`);
  }
  return `${getResidualLineLabel(line)}: ${parts.join(', ')}`;
}

async function restoreOrderInventory({ ordineId, client, reqUser, note = 'Rientro ordine', restoreRatios = null, resetPreparation = false }) {
  const userName = `${reqUser?.nome || ''} ${reqUser?.cognome || ''}`.trim() || reqUser?.username || 'Sistema';
  const { rows: movRows } = await client.query(
    `SELECT DISTINCT ON (m.ordine_linea_id)
            m.id, m.ordine_linea_id, m.giacenza_id, m.prodotto_id, m.lotto, m.quantita,
            ol.qty AS line_qty
       FROM movimenti_giacenza m
       JOIN ordine_linee ol ON ol.id = m.ordine_linea_id
      WHERE ol.ordine_id = $1
        AND m.tipo = 'scarico_ordine'
      ORDER BY m.ordine_linea_id, m.id DESC`,
    [ordineId]
  );
  for (const mov of movRows) {
    if (!mov.giacenza_id) continue;
    const ratioRaw = restoreRatios && restoreRatios[mov.ordine_linea_id] !== undefined
      ? Number(restoreRatios[mov.ordine_linea_id])
      : 1;
    const ratio = Math.max(0, Math.min(1, ratioRaw));
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    const qtyRestore = Math.abs(Number(mov.quantita || 0)) * ratio;
    if (!Number.isFinite(qtyRestore) || qtyRestore <= 0) continue;
    const { rows: giacRows } = await client.query('SELECT quantita FROM giacenze WHERE id=$1 LIMIT 1', [mov.giacenza_id]);
    if (!giacRows.length) continue;
    const qtyBefore = Number(giacRows[0].quantita || 0);
    const qtyAfter = qtyBefore + qtyRestore;
    await client.query('UPDATE giacenze SET quantita=$1, updated_at=NOW() WHERE id=$2', [qtyAfter, mov.giacenza_id]);
    await client.query(
      `INSERT INTO movimenti_giacenza
        (giacenza_id,prodotto_id,lotto,tipo,quantita,quantita_prima,quantita_dopo,ordine_id,ordine_linea_id,utente_id,utente_nome,note)
       VALUES ($1,$2,$3,'rettifica',$4,$5,$6,$7,$8,$9,$10,$11)`,
      [mov.giacenza_id, mov.prodotto_id, mov.lotto || '', qtyRestore, qtyBefore, qtyAfter, ordineId, mov.ordine_linea_id, reqUser?.id || null, userName, note]
    );
  }
  if (resetPreparation) {
    await client.query(`UPDATE ordine_linee SET preparato=FALSE WHERE ordine_id=$1`, [ordineId]);
  }
}

function applyListinoRule(currentPrice, rule) {
  const mode = rule.mode || 'final_price';
  if (mode === 'final_price') {
    const fp = asNum(rule.final_price ?? rule.prezzo);
    return fp !== null ? fp : currentPrice;
  }
  if (mode === 'base_markup') {
    const base = asNum(rule.base_price ?? currentPrice);
    const markup = asNum(rule.markup_pct) ?? 0;
    if (base === null) return currentPrice;
    return base * (1 + markup / 100);
  }
  if (mode === 'discount_pct') {
    const d = asNum(rule.discount_pct);
    if (d === null || currentPrice === null) return currentPrice;
    return currentPrice * (1 - d / 100);
  }
  return currentPrice;
}

async function resolvePrezzoUnitario({ prodottoId, clienteId, data, client = null }) {
  const run = client ? client.query.bind(client) : q;
  const c = await run('SELECT id, giro FROM clienti WHERE id=$1', [clienteId]);
  if (!c.rows.length) return null;
  const giro = c.rows[0].giro || '';
  const sql = `
    SELECT *
    FROM listini
    WHERE prodotto_id = $1
      AND valido_dal <= $2::date
      AND (valido_al IS NULL OR valido_al >= $2::date)
      AND (
        scope = 'all'
        OR (scope = 'giro' AND giro = $3)
        OR (scope = 'cliente' AND cliente_id = $4)
        OR (scope = 'giro_cliente' AND giro = $3 AND cliente_id = $4)
      )
    ORDER BY valido_dal DESC, id DESC
  `;
  const { rows } = await run(sql, [prodottoId, data, giro, clienteId]);
  if (!rows.length) return null;
  const filtered = rows.filter(r => {
    const excluded = Array.isArray(r.excluded_client_ids) ? r.excluded_client_ids : [];
    return !excluded.includes(Number(clienteId));
  });
  if (!filtered.length) return null;
  const best = {};
  for (const r of filtered) {
    const key = r.scope || 'all';
    if (!best[key]) best[key] = r;
  }
  const chain = ['all', 'giro', 'cliente', 'giro_cliente'];
  let price = null;
  for (const key of chain) {
    if (!best[key]) continue;
    price = applyListinoRule(price, best[key]);
  }
  const out = asNum(price);
  return out === null ? null : Math.round(out * 100) / 100;
}

// ─── AUTH ROUTES ─────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Dati mancanti' });
    const uname = String(username || '').trim();
    const { rows } = await q('SELECT * FROM utenti WHERE LOWER(username)=LOWER($1) LIMIT 1', [uname]);
    const u = rows[0];
    if (!u || !(await bcrypt.compare(password, u.password)))
      return res.status(401).json({ error: 'Username o password errati' });
    const payload = {
      id: u.id, username: u.username, nome: u.nome, cognome: u.cognome || '',
      ruolo: u.ruolo, tipo_utente: u.tipo_utente || '',
      giri_consegna: Array.isArray(u.giri_consegna) ? u.giri_consegna : [],
      is_agente: !!u.is_agente,
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, user: parseUtente(u) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── UTENTI ──────────────────────────────────────────────────────
app.get('/api/utenti', authMiddleware, async (req, res) => {
  try {
    const { rows } = await q('SELECT * FROM utenti ORDER BY nome');
    res.json(rows.map(parseUtente));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/utenti', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { nome, cognome='', username, password, ruolo,
            tipo_utente='', giri_consegna=[], is_agente=false } = req.body;
    if (!nome||!username||!password||!ruolo)
      return res.status(400).json({ error: 'Campi mancanti' });
    const uname = String(username || '').trim();
    const dup = await q('SELECT id FROM utenti WHERE LOWER(username)=LOWER($1)', [uname]);
    if (dup.rows.length) return res.status(409).json({ error: 'Username già esistente' });
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const r = await q(
      `INSERT INTO utenti (nome,cognome,username,password,ruolo,tipo_utente,giri_consegna,is_agente)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [nome, cognome, uname, hash, ruolo, tipo_utente, JSON.stringify(giri_consegna), is_agente]
    );
    res.json(parseUtente(r.rows[0]));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/utenti/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { nome, cognome='', username, password, ruolo,
            tipo_utente='', giri_consegna=[], is_agente=false } = req.body;
    if (!nome||!username) return res.status(400).json({ error: 'Campi mancanti' });
    const uname = String(username || '').trim();
    const dup = await q('SELECT id FROM utenti WHERE LOWER(username)=LOWER($1) AND id!=$2', [uname, id]);
    if (dup.rows.length) return res.status(409).json({ error: 'Username già in uso' });
    if (password) {
      const hash = await bcrypt.hash(password, SALT_ROUNDS);
      await q(
        `UPDATE utenti SET nome=$1,cognome=$2,username=$3,password=$4,ruolo=$5,
         tipo_utente=$6,giri_consegna=$7,is_agente=$8 WHERE id=$9`,
        [nome, cognome, uname, hash, ruolo, tipo_utente, JSON.stringify(giri_consegna), is_agente, id]
      );
    } else {
      await q(
        `UPDATE utenti SET nome=$1,cognome=$2,username=$3,ruolo=$4,
         tipo_utente=$5,giri_consegna=$6,is_agente=$7 WHERE id=$8`,
        [nome, cognome, uname, ruolo, tipo_utente, JSON.stringify(giri_consegna), is_agente, id]
      );
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/utenti/:id/profilo — ogni utente può modificare il proprio profilo
app.patch('/api/utenti/:id/profilo', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    // Solo l'utente stesso o un admin può modificare il profilo
    if (req.user.id !== id && req.user.ruolo !== 'admin') {
      return res.status(403).json({ error: 'Non autorizzato' });
    }
    const { nome, cognome='', username, password, current_password } = req.body;
    if (!nome || !username) return res.status(400).json({ error: 'Nome e username obbligatori' });

    // Verifica password attuale (skip se admin modifica altro utente)
    if (req.user.id === id) {
      if (!current_password) return res.status(400).json({ error: 'Password attuale obbligatoria' });
      const { rows: [user] } = await q('SELECT password FROM utenti WHERE id=$1', [id]);
      if (!user) return res.status(404).json({ error: 'Utente non trovato' });
      const bcrypt = require('bcrypt');
      const ok = await bcrypt.compare(current_password, user.password);
      if (!ok) return res.status(400).json({ error: 'Password attuale errata' });
    }

    // Check username univoco
    const uname = String(username || '').trim();
    const { rows: dup } = await q('SELECT id FROM utenti WHERE LOWER(username)=LOWER($1) AND id!=$2', [uname, id]);
    if (dup.length) return res.status(400).json({ error: 'Username già in uso' });

    if (password) {
      const bcrypt = require('bcrypt');
      const hash = await bcrypt.hash(password, 10);
      await q('UPDATE utenti SET nome=$1,cognome=$2,username=$3,password=$4 WHERE id=$5',
        [nome, cognome, uname, hash, id]);
    } else {
      await q('UPDATE utenti SET nome=$1,cognome=$2,username=$3 WHERE id=$4',
        [nome, cognome, uname, id]);
    }
    res.json({ ok: true, nome, cognome, username: uname });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


app.delete('/api/utenti/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (id === req.user.id) return res.status(400).json({ error: 'Non puoi eliminare te stesso' });
    await q('DELETE FROM utenti WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── CLIENTI ────────────────────────────────────────────────────
app.get('/api/ferie', authMiddleware, async (req, res) => {
  try {
    const { rows } = await q(
      `SELECT f.*, u.nome, u.cognome, u.ruolo,
              c.nome AS created_by_nome, c.cognome AS created_by_cognome, c.ruolo AS created_by_ruolo
       FROM ferie_dipendenti f
       JOIN utenti u ON u.id = f.utente_id
       LEFT JOIN utenti c ON c.id = f.created_by
       ORDER BY f.data_inizio DESC, f.id DESC`
    );
    res.json(rows.filter(row => userCanViewCalendarEvent(req.user, row)));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ferie', authMiddleware, async (req, res) => {
  try {
    const utenteId = Number(req.body?.utente_id);
    const dataInizio = String(req.body?.data_inizio || '').trim();
    const dataFine = String(req.body?.data_fine || '').trim();
    const titolo = String(req.body?.titolo || '').trim();
    const oraInizio = String(req.body?.ora_inizio || '').trim();
    const oraFine = String(req.body?.ora_fine || '').trim();
    const tipo = normalizeCalendarEventType(req.body?.tipo);
    const requestedStatus = normalizeCalendarEventStatus(req.body?.stato);
    const note = String(req.body?.note || '').trim();
    const visibility = normalizeCalendarVisibility(req.body || {});
    const stato = tipo === 'ferie' ? 'da_approvare' : requestedStatus;
    const presenzaStato = tipo === 'evento' ? 'in_attesa' : 'non_richiesta';
    if (!Number.isFinite(utenteId) || utenteId <= 0) return res.status(400).json({ error: 'Referente non valido' });
    if (!titolo) return res.status(400).json({ error: 'Titolo obbligatorio' });
    if (!dataInizio || !dataFine) return res.status(400).json({ error: 'Periodo obbligatorio' });
    if (dataFine < dataInizio) return res.status(400).json({ error: 'La data fine non puo essere precedente alla data inizio' });
    if ((oraInizio && !/^\d{2}:\d{2}$/.test(oraInizio)) || (oraFine && !/^\d{2}:\d{2}$/.test(oraFine))) return res.status(400).json({ error: 'Orario non valido' });
    if (oraInizio && oraFine && oraFine < oraInizio) return res.status(400).json({ error: 'L\'orario fine non puo essere precedente all\'orario inizio' });
    const { rows: userRows } = await q('SELECT id FROM utenti WHERE id=$1 LIMIT 1', [utenteId]);
    if (!userRows.length) return res.status(404).json({ error: 'Referente non trovato' });
    const allowedUsers = visibility.visibilita_utenti;
    if (allowedUsers.length) {
      const existingUsers = await q('SELECT id FROM utenti WHERE id = ANY($1::int[])', [allowedUsers]);
      if (existingUsers.rows.length !== allowedUsers.length) return res.status(400).json({ error: 'Uno o piu utenti visibili non sono validi' });
    }
    const { rows } = await q(
      `INSERT INTO ferie_dipendenti (
         utente_id, data_inizio, data_fine, titolo, ora_inizio, ora_fine, tipo, stato, presenza_stato, note,
         visibilita_ruoli, visibilita_utenti, visibilita_solo_creator, created_by, updated_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,NOW())
       RETURNING *`,
      [
        utenteId,
        dataInizio,
        dataFine,
        titolo,
        oraInizio,
        oraFine,
        tipo,
        stato,
        presenzaStato,
        note,
        JSON.stringify(visibility.visibilita_ruoli),
        JSON.stringify(visibility.visibilita_utenti),
        visibility.visibilita_solo_creator,
        req.user.id || null,
      ]
    );
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/ferie/:id', authMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const utenteId = Number(req.body?.utente_id);
    const dataInizio = String(req.body?.data_inizio || '').trim();
    const dataFine = String(req.body?.data_fine || '').trim();
    const titolo = String(req.body?.titolo || '').trim();
    const oraInizio = String(req.body?.ora_inizio || '').trim();
    const oraFine = String(req.body?.ora_fine || '').trim();
    const tipo = normalizeCalendarEventType(req.body?.tipo);
    const requestedStatus = normalizeCalendarEventStatus(req.body?.stato);
    const note = String(req.body?.note || '').trim();
    const visibility = normalizeCalendarVisibility(req.body || {});
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'ID non valido' });
    if (!Number.isFinite(utenteId) || utenteId <= 0) return res.status(400).json({ error: 'Referente non valido' });
    if (!titolo) return res.status(400).json({ error: 'Titolo obbligatorio' });
    if (!dataInizio || !dataFine) return res.status(400).json({ error: 'Periodo obbligatorio' });
    if (dataFine < dataInizio) return res.status(400).json({ error: 'La data fine non puo essere precedente alla data inizio' });
    if ((oraInizio && !/^\d{2}:\d{2}$/.test(oraInizio)) || (oraFine && !/^\d{2}:\d{2}$/.test(oraFine))) return res.status(400).json({ error: 'Orario non valido' });
    if (oraInizio && oraFine && oraFine < oraInizio) return res.status(400).json({ error: 'L\'orario fine non puo essere precedente all\'orario inizio' });
    const current = await q('SELECT * FROM ferie_dipendenti WHERE id=$1 LIMIT 1', [id]);
    if (!current.rows.length) return res.status(404).json({ error: 'Evento non trovato' });
    if (!userCanManageCalendarEvent(req.user, current.rows[0])) return res.status(403).json({ error: 'Permesso negato' });
    const currentRow = current.rows[0];
    let stato = requestedStatus;
    if (tipo === 'ferie' && !canApproveCalendarFerie(req.user)) {
      stato = currentRow.stato === 'confermata' ? 'confermata' : 'da_approvare';
    }
    let presenzaStato = String(currentRow.presenza_stato || 'non_richiesta');
    if (tipo === 'evento') {
      if (!['presente', 'assente'].includes(presenzaStato)) presenzaStato = 'in_attesa';
    } else {
      presenzaStato = 'non_richiesta';
    }
    const { rows: userRows } = await q('SELECT id FROM utenti WHERE id=$1 LIMIT 1', [utenteId]);
    if (!userRows.length) return res.status(404).json({ error: 'Referente non trovato' });
    const allowedUsers = visibility.visibilita_utenti;
    if (allowedUsers.length) {
      const existingUsers = await q('SELECT id FROM utenti WHERE id = ANY($1::int[])', [allowedUsers]);
      if (existingUsers.rows.length !== allowedUsers.length) return res.status(400).json({ error: 'Uno o piu utenti visibili non sono validi' });
    }
    const { rows } = await q(
      `UPDATE ferie_dipendenti
       SET utente_id=$1, data_inizio=$2, data_fine=$3, titolo=$4, ora_inizio=$5, ora_fine=$6, tipo=$7, stato=$8, presenza_stato=$9, note=$10,
           visibilita_ruoli=$11::jsonb, visibilita_utenti=$12::jsonb, visibilita_solo_creator=$13, updated_at=NOW()
       WHERE id=$14
       RETURNING *`,
      [
        utenteId,
        dataInizio,
        dataFine,
        titolo,
        oraInizio,
        oraFine,
        tipo,
        stato,
        presenzaStato,
        note,
        JSON.stringify(visibility.visibilita_ruoli),
        JSON.stringify(visibility.visibilita_utenti),
        visibility.visibilita_solo_creator,
        id,
      ]
    );
    if (tipo === 'ferie' && ['confermata', 'respinta'].includes(stato) && String(currentRow.stato || '') !== stato) {
      await createInternalConversation({
        senderUser: req.user,
        destinatarioUserId: utenteId,
        oggetto: `Ferie ${stato === 'confermata' ? 'confermate' : 'respinte'}`,
        testo: stato === 'confermata'
          ? `Le ferie sono state confermate.\nPeriodo: ${dataInizio} - ${dataFine}\nTitolo: ${titolo}`
          : `Le ferie sono state respinte.\nPeriodo: ${dataInizio} - ${dataFine}\nTitolo: ${titolo}`,
        priorita: 'media',
      }).catch(() => {});
    }
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/ferie/:id', authMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'ID non valido' });
    const current = await q('SELECT * FROM ferie_dipendenti WHERE id=$1 LIMIT 1', [id]);
    if (!current.rows.length) return res.status(404).json({ error: 'Evento non trovato' });
    if (!userCanManageCalendarEvent(req.user, current.rows[0])) return res.status(403).json({ error: 'Permesso negato' });
    await q('DELETE FROM ferie_dipendenti WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/ferie/:id/presenza', authMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const presenzaStato = String(req.body?.presenza_stato || '').trim().toLowerCase();
    const presenzaNote = String(req.body?.presenza_note || '').trim();
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'ID non valido' });
    if (!['presente', 'assente'].includes(presenzaStato)) return res.status(400).json({ error: 'Stato presenza non valido' });
    const current = await q('SELECT * FROM ferie_dipendenti WHERE id=$1 LIMIT 1', [id]);
    if (!current.rows.length) return res.status(404).json({ error: 'Evento non trovato' });
    const row = current.rows[0];
    if (normalizeCalendarEventType(row.tipo) !== 'evento') return res.status(400).json({ error: 'La conferma presenza vale solo per gli eventi' });
    const canRespond = Number(row.utente_id) === Number(req.user.id) || canApproveCalendarFerie(req.user);
    if (!canRespond) return res.status(403).json({ error: 'Permesso negato' });
    const { rows } = await q(
      `UPDATE ferie_dipendenti
       SET presenza_stato=$1, presenza_note=$2, presenza_updated_at=NOW(), updated_at=NOW()
       WHERE id=$3
       RETURNING *`,
      [presenzaStato, presenzaNote, id]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/clienti', authMiddleware, async (req, res) => {
  try {
    await ensureTentataVenditaCliente();
    const { rows } = await q(`
      SELECT c.*, u.nome as agente_nome,
             a.nome||' '||COALESCE(a.cognome,'') as autista_nome
      FROM clienti c
      LEFT JOIN utenti u ON c.agente_id = u.id
      LEFT JOIN utenti a ON c.autista_di_giro = a.id
      ORDER BY c.nome`);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/clienti/lookup-piva', authMiddleware, requirePermission('clienti:create'), async (req, res) => {
  try {
    const pivaInput = normalizePiva(req.body?.piva || '');
    if (!pivaInput) return res.status(400).json({ error: 'Partita IVA obbligatoria' });

    if (!PIVA_LOOKUP_URL) {
      return res.status(503).json({
        error: 'Lookup P.IVA non configurato sul server',
        details: 'Imposta PIVA_LOOKUP_URL e PIVA_LOOKUP_TOKEN nel file .env',
      });
    }

    const endpoint = PIVA_LOOKUP_URL.includes('{piva}')
      ? PIVA_LOOKUP_URL.replace('{piva}', encodeURIComponent(pivaInput))
      : `${PIVA_LOOKUP_URL}${PIVA_LOOKUP_URL.includes('?') ? '&' : '?'}piva=${encodeURIComponent(pivaInput)}`;

    const headers = { Accept: 'application/json', ...parseExtraHeaders() };
    if (PIVA_LOOKUP_TOKEN) {
      headers[PIVA_LOOKUP_AUTH_HEADER] = `${PIVA_LOOKUP_TOKEN_PREFIX}${PIVA_LOOKUP_TOKEN}`;
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    let extRes;
    try {
      extRes = await fetch(endpoint, { method: 'GET', headers, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }

    const contentType = extRes.headers.get('content-type') || '';
    const raw = contentType.includes('application/json')
      ? await extRes.json()
      : { text: await extRes.text() };
    if (!extRes.ok) {
      return res.status(502).json({
        error: 'Errore servizio lookup P.IVA',
        status: extRes.status,
        provider_message: raw?.error || raw?.message || '',
      });
    }

    const mapped = extractLookupFields(raw, pivaInput);
    const found = !!(mapped.nome || mapped.localita || mapped.codice_fiscale || mapped.pec || mapped.codice_univoco);
    res.json({
      ok: true,
      found,
      piva: pivaInput,
      data: {
        nome: mapped.nome,
        localita: mapped.localita,
        piva: mapped.piva,
        codice_fiscale: mapped.codice_fiscale,
        codice_univoco: mapped.codice_univoco,
        pec: mapped.pec,
      },
      provider: 'configured',
    });
  } catch (e) {
    const msg = e.name === 'AbortError'
      ? 'Timeout servizio lookup P.IVA'
      : e.message;
    res.status(500).json({ error: msg });
  }
});

  app.post('/api/clienti', authMiddleware, requirePermission('clienti:create'), async (req, res) => {
    try {
    const { nome, alias='', localita='', giro='', agente_id=null, autista_di_giro=null,
            note='', piva='', codice_fiscale='', codice_univoco='', pec='',
            cond_pagamento='', e_fornitore=false, classificazione='',
            contatto_nome='', telefono='' } = req.body;
      if (!nome) return res.status(400).json({ error: 'Nome obbligatorio' });
      if (!String(piva || '').trim()) return res.status(400).json({ error: 'Partita IVA obbligatoria' });
      const r = await q(
      `INSERT INTO clienti (nome,crm_tipo,alias,localita,giro,agente_id,autista_di_giro,note,piva,codice_fiscale,codice_univoco,pec,cond_pagamento,e_fornitore,classificazione,contatto_nome,telefono,onboarding_stato,onboarding_checklist,fido,sbloccato)
         VALUES ($1,'cliente',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'in_attesa',$17::jsonb,0,FALSE)
         RETURNING id,nome,crm_tipo,alias,localita,giro,piva,codice_fiscale,codice_univoco,pec,classificazione,cond_pagamento,e_fornitore,contatto_nome,telefono,onboarding_contatto_tipo,onboarding_stato,fido,sbloccato,created_at,crm_convertito_at`,
      [nome, alias, localita, giro, agente_id||null, autista_di_giro||null, note, piva, codice_fiscale, codice_univoco, pec, cond_pagamento, e_fornitore, classificazione, contatto_nome, telefono, JSON.stringify({})]
      );
    const u = req.user;
    const creator = `${u.nome} ${u.cognome||''}`.trim();
    await logDB(u.id, creator, 'Nuovo cliente', nome);
    notifyNewClientePendingApproval(nome, creator).catch(() => {});
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/clienti/:id', authMiddleware, requirePermission('clienti:update'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { nome, alias='', localita='', giro='', agente_id=null, autista_di_giro=null,
              note='', piva='', codice_fiscale='', codice_univoco='', pec='',
              cond_pagamento='', e_fornitore=false, classificazione='',
              contatto_nome='', telefono='' } = req.body;
      if (!nome) return res.status(400).json({ error: 'Nome obbligatorio' });
      await q(
      `UPDATE clienti SET nome=$1,alias=$2,localita=$3,giro=$4,agente_id=$5,autista_di_giro=$6,
         note=$7,piva=$8,codice_fiscale=$9,codice_univoco=$10,pec=$11,cond_pagamento=$12,e_fornitore=$13,classificazione=$14,contatto_nome=$15,telefono=$16 WHERE id=$17`,
      [nome, alias, localita, giro, agente_id||null, autista_di_giro||null, note, piva, codice_fiscale, codice_univoco, pec, cond_pagamento, e_fornitore, classificazione, contatto_nome, telefono, id]
      );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/clienti/:id/converti-da-crm', authMiddleware, requirePermission('clienti:update'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'ID non valido' });
    const parsed = zClienteConversionPayload.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);
    const current = await q('SELECT id, nome, crm_tipo FROM clienti WHERE id=$1 LIMIT 1', [id]);
    if (!current.rows.length) return res.status(404).json({ error: 'Lead CRM non trovato' });
    if (String(current.rows[0].crm_tipo || 'cliente') !== 'prospect') {
      return res.status(400).json({ error: 'Il record selezionato non è un prospect CRM' });
    }
    const {
      nome, alias, localita, giro, agente_id, autista_di_giro, note, piva,
      codice_fiscale, codice_univoco, pec, cond_pagamento, e_fornitore,
      classificazione, contatto_nome, telefono,
    } = parsed.data;
    const r = await q(
      `UPDATE clienti
          SET nome=$1,
              crm_tipo='cliente',
              alias=$2,
              localita=$3,
              giro=$4,
              agente_id=$5,
              autista_di_giro=$6,
              note=$7,
              piva=$8,
              codice_fiscale=$9,
              codice_univoco=$10,
              pec=$11,
              cond_pagamento=$12,
              e_fornitore=$13,
              classificazione=$14,
              contatto_nome=$15,
              telefono=$16,
              onboarding_contatto_tipo=COALESCE(NULLIF(onboarding_contatto_tipo, ''), onboarding_contatto_tipo),
              onboarding_stato='in_attesa',
              onboarding_checklist=COALESCE(onboarding_checklist, '{}'::jsonb),
              crm_convertito_at=COALESCE(crm_convertito_at, NOW())
        WHERE id=$17
        RETURNING *`,
      [
        nome, alias, localita, giro, agente_id || null, autista_di_giro || null, note, piva,
        codice_fiscale, codice_univoco, pec, cond_pagamento, !!e_fornitore,
        classificazione, contatto_nome, telefono, id,
      ]
    );
    const actor = `${req.user.nome} ${req.user.cognome || ''}`.trim();
    await logDB(req.user.id, actor, 'Conversione CRM', `${current.rows[0].nome} -> ${nome}`);
    notifyNewClientePendingApproval(nome, actor).catch(() => {});
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/clienti/tentata/:userId', authMiddleware, async (req, res) => {
  try {
    const userId = Number.parseInt(req.params.userId, 10);
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'Autista non valido' });
    const cliente = await ensureTentataVenditaCliente(null, userId);
    res.json(cliente);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/clienti/:id/onboarding', authMiddleware, requirePermission('onboarding:manage'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { stato, fido: fidoRaw, checklist = null, note = '' } = req.body || {};
    const allowedStates = ['bozza','in_attesa','in_verifica','approvato','rifiutato','sospeso'];
    const { rows: oldRows } = await q(
      `SELECT id,nome,onboarding_stato,fido,sbloccato,onboarding_checklist
       FROM clienti WHERE id=$1`, [id]
    );
    if (!oldRows.length) return res.status(404).json({ error: 'Cliente non trovato' });
    const old = oldRows[0];

    const newStato = (stato || old.onboarding_stato || 'in_attesa').toLowerCase();
    if (!allowedStates.includes(newStato)) {
      return res.status(400).json({ error: 'Stato onboarding non valido' });
    }

    let newFido = Number(old.fido || 0);
    if (fidoRaw !== undefined && fidoRaw !== null && fidoRaw !== '') {
      const parsed = Number(fidoRaw);
      if (!Number.isFinite(parsed) || parsed < 0) return res.status(400).json({ error: 'Fido non valido' });
      newFido = parsed;
    }
    const checklistObj = (checklist && typeof checklist === 'object') ? checklist : (old.onboarding_checklist || {});
    const isApproved = newStato === 'approvato';
    const approvatore = `${req.user.nome} ${req.user.cognome||''}`.trim();
    const r = await q(
      `UPDATE clienti
       SET fido=$1,
           sbloccato=$2,
           onboarding_stato=$3,
           onboarding_checklist=$4::jsonb,
           onboarding_approvato_da=CASE WHEN $2 THEN $5 ELSE onboarding_approvato_da END,
           onboarding_approvato_at=CASE WHEN $2 THEN NOW() ELSE onboarding_approvato_at END
       WHERE id=$6
       RETURNING id,nome,fido,sbloccato,onboarding_stato,onboarding_checklist,onboarding_approvato_da,onboarding_approvato_at`,
      [newFido, isApproved, newStato, JSON.stringify(checklistObj), approvatore, id]
    );
    await logOnboardingChange({
      clienteId: id,
      reqUser: req.user,
      oldStato: old.onboarding_stato,
      newStato,
      oldFido: Number(old.fido || 0),
      newFido,
      note: note || '',
    });
    await logDB(req.user.id, approvatore, 'Onboarding cliente', `${r.rows[0].nome} | ${old.onboarding_stato} -> ${newStato} | fido ${newFido}`);
    const { rows: relatedUsers } = await q(
      `SELECT DISTINCT user_id
         FROM clienti_crm_eventi
        WHERE cliente_id = $1
          AND user_id IS NOT NULL
        ORDER BY user_id DESC
        LIMIT 1`,
      [id]
    );
    const notifyUserId = Number(relatedUsers[0]?.user_id || 0) || null;
    if (notifyUserId && ['approvato', 'rifiutato'].includes(newStato)) {
      await createInternalConversation({
        senderUser: req.user,
        destinatarioUserId: notifyUserId,
        oggetto: `Onboarding ${newStato === 'approvato' ? 'approvato' : 'rifiutato'}`,
        testo: newStato === 'approvato'
          ? `Il cliente ${r.rows[0].nome} e stato approvato.`
          : `Il cliente ${r.rows[0].nome} e stato rifiutato.`,
        clienteId: id,
        priorita: 'media',
      }).catch(() => {});
    }
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/clienti/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    await q('DELETE FROM clienti WHERE id=$1', [parseInt(req.params.id)]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/clienti/:id/crm-eventi', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { rows } = await q(
      `SELECT * FROM clienti_crm_eventi WHERE cliente_id=$1 ORDER BY created_at DESC, id DESC LIMIT 300`,
      [id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/clienti/crm-summary', authMiddleware, async (req, res) => {
  try {
    const { rows } = await q(
      `SELECT DISTINCT ON (e.cliente_id)
          e.cliente_id,
          e.tipo,
          e.contatto_tipo,
          e.esito,
          e.stato_cliente,
          e.richiesta,
          e.offerta,
          e.followup_date,
          e.followup_repeat_value,
          e.followup_repeat_unit,
          e.priorita,
          e.created_at
       FROM clienti_crm_eventi e
       ORDER BY e.cliente_id, e.created_at DESC, e.id DESC`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/clienti/:id/crm-eventi', authMiddleware, requirePermission('clienti:update'), async (req, res) => {
  try {
    const clienteId = parseInt(req.params.id);
    const parsed = zCrmEventoPayload.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);
    const { rows: clientiRows } = await q(`SELECT id, nome FROM clienti WHERE id=$1 LIMIT 1`, [clienteId]);
    if (!clientiRows.length) return res.status(404).json({ error: 'Cliente non trovato' });
    const {
      tipo, contatto_tipo, esito, stato_cliente, richiesta, offerta, motivo, note, contatto_nome, telefono,
      incaricato_user_id, invia_messaggio, followup_date, followup_repeat_value, followup_repeat_unit, priorita,
    } = parsed.data;
    const userName = `${req.user.nome} ${req.user.cognome || ''}`.trim();
    let incaricatoUserName = '';
    if (incaricato_user_id) {
      const { rows: incaricatoRows } = await q(`SELECT id, nome, cognome FROM utenti WHERE id=$1 LIMIT 1`, [incaricato_user_id]);
      if (!incaricatoRows.length) return res.status(400).json({ error: 'Incaricato non trovato' });
      incaricatoUserName = `${incaricatoRows[0].nome || ''} ${incaricatoRows[0].cognome || ''}`.trim();
    }
    const r = await q(
      `INSERT INTO clienti_crm_eventi
        (cliente_id,tipo,contatto_tipo,esito,stato_cliente,richiesta,offerta,motivo,note,contatto_nome,telefono,incaricato_user_id,incaricato_user_name,followup_date,followup_repeat_value,followup_repeat_unit,priorita,user_id,user_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
      [
        clienteId,
        String(tipo || 'richiesta'),
        String(contatto_tipo || ''),
        String(esito || ''),
        String(stato_cliente || ''),
        String(richiesta || ''),
        String(offerta || ''),
        String(motivo || ''),
        String(note || ''),
        String(contatto_nome || ''),
        String(telefono || ''),
        incaricato_user_id || null,
        incaricatoUserName,
        followup_date || null,
        followup_repeat_value || null,
        followup_repeat_unit || null,
        String(priorita || 'media'),
        req.user.id || null,
        userName || 'Sistema',
      ]
    );
    if (contatto_nome || telefono || contatto_tipo) {
      await q(
        `UPDATE clienti
            SET contatto_nome = CASE WHEN $2 <> '' THEN $2 ELSE contatto_nome END,
                telefono = CASE WHEN $3 <> '' THEN $3 ELSE telefono END,
                onboarding_contatto_tipo = CASE WHEN $4 <> '' THEN $4 ELSE onboarding_contatto_tipo END
          WHERE id = $1`,
        [clienteId, String(contatto_nome || '').trim(), String(telefono || '').trim(), String(contatto_tipo || '').trim()]
      );
    }
    if (invia_messaggio && incaricato_user_id) {
      const oggetto = `Follow-up cliente: ${clientiRows[0].nome}`;
      const testo = [
        `Cliente: ${clientiRows[0].nome}`,
        contatto_nome ? `Contatto: ${contatto_nome}` : '',
        telefono ? `Telefono: ${telefono}` : '',
        contatto_tipo ? `Tipo contatto: ${contatto_tipo}` : '',
        richiesta ? `Richiesta: ${richiesta}` : '',
        offerta ? `Offerta: ${offerta}` : '',
        note ? `Note: ${note}` : '',
        followup_date ? `Follow-up: ${followup_date}` : '',
        (followup_repeat_value && followup_repeat_unit) ? `Ripetizione: ogni ${followup_repeat_value} ${followup_repeat_unit}` : '',
      ].filter(Boolean).join('\n');
      await createInternalConversation({
        senderUser: req.user,
        destinatarioUserId: incaricato_user_id,
        oggetto,
        testo,
        clienteId,
        priorita,
      }).catch(() => {});
    }
    await logDB(req.user.id, userName, 'CRM cliente', `cliente #${clienteId} - ${tipo}`);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/clienti/onboarding-lead', authMiddleware, requirePermission('clienti:create'), async (req, res) => {
  try {
    const parsed = zCrmEventoPayload.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);
    const nome = String(req.body?.nome || '').trim();
    const localita = String(req.body?.localita || '').trim();
    const contattoNome = String(req.body?.contatto_nome || nome).trim();
    const telefono = String(req.body?.telefono || '').trim();
    if (!nome) return res.status(400).json({ error: 'Nome cliente obbligatorio' });
    if (!telefono) return res.status(400).json({ error: 'Telefono obbligatorio' });
    const userName = `${req.user.nome} ${req.user.cognome || ''}`.trim();
    const createCliente = await q(
      `INSERT INTO clienti
        (nome,crm_tipo,localita,contatto_nome,telefono,onboarding_contatto_tipo,onboarding_stato,onboarding_checklist,fido,sbloccato,piva)
       VALUES ($1,'prospect',$2,$3,$4,$5,'bozza',$6::jsonb,0,FALSE,'')
       RETURNING *`,
      [nome, localita, contattoNome, telefono, String(parsed.data.contatto_tipo || ''), JSON.stringify({ lead: true })]
    );
    const cliente = createCliente.rows[0];
    const {
      tipo, contatto_tipo, esito, stato_cliente, richiesta, offerta, motivo, note,
      incaricato_user_id, invia_messaggio, followup_date, followup_repeat_value, followup_repeat_unit, priorita,
    } = parsed.data;
    let incaricatoUserName = '';
    if (incaricato_user_id) {
      const { rows: incaricatoRows } = await q(`SELECT id, nome, cognome FROM utenti WHERE id=$1 LIMIT 1`, [incaricato_user_id]);
      if (!incaricatoRows.length) return res.status(400).json({ error: 'Incaricato non trovato' });
      incaricatoUserName = `${incaricatoRows[0].nome || ''} ${incaricatoRows[0].cognome || ''}`.trim();
    }
    const crm = await q(
      `INSERT INTO clienti_crm_eventi
        (cliente_id,tipo,contatto_tipo,esito,stato_cliente,richiesta,offerta,motivo,note,contatto_nome,telefono,incaricato_user_id,incaricato_user_name,followup_date,followup_repeat_value,followup_repeat_unit,priorita,user_id,user_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [
        cliente.id,
        String(tipo || 'richiesta'),
        String(contatto_tipo || ''),
        String(esito || ''),
        String(stato_cliente || ''),
        String(richiesta || ''),
        String(offerta || ''),
        String(motivo || ''),
        String(note || ''),
        contattoNome,
        telefono,
        incaricato_user_id || null,
        incaricatoUserName,
        followup_date || null,
        followup_repeat_value || null,
        followup_repeat_unit || null,
        String(priorita || 'media'),
        req.user.id || null,
        userName || 'Sistema',
      ]
    );
    if (invia_messaggio && incaricato_user_id) {
      const oggetto = `Nuovo onboarding: ${nome}`;
      const testo = [
        `Cliente: ${nome}`,
        `Contatto: ${contattoNome}`,
        `Telefono: ${telefono}`,
        contatto_tipo ? `Tipo contatto: ${contatto_tipo}` : '',
        richiesta ? `Richiesta: ${richiesta}` : '',
        offerta ? `Offerta: ${offerta}` : '',
        note ? `Note: ${note}` : '',
        followup_date ? `Follow-up: ${followup_date}` : '',
        (followup_repeat_value && followup_repeat_unit) ? `Ripetizione: ogni ${followup_repeat_value} ${followup_repeat_unit}` : '',
      ].filter(Boolean).join('\n');
      await createInternalConversation({
        senderUser: req.user,
        destinatarioUserId: incaricato_user_id,
        oggetto,
        testo,
        clienteId: cliente.id,
        priorita,
      }).catch(() => {});
    }
    await logDB(req.user.id, userName, 'Nuovo onboarding', nome);
    res.json({ cliente, crm: crm.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── PRODOTTI ────────────────────────────────────────────────────
app.get('/api/prodotti', authMiddleware, async (req, res) => {
  try {
    const { rows } = await q(`
      SELECT
        id, codice, nome, categoria, um, packaging, peso_fisso, gestione_giacenza, punto_riordino,
        cartoni_attivi, peso_medio_pezzo_kg, pezzi_per_cartone, unita_per_cartone, pedane_attive, cartoni_per_pedana, peso_cartone_kg,
        assortimento_stato, ultimo_riordino_qta, ultimo_riordino_at, ultimo_riordino_utente_id, ultimo_riordino_utente_nome,
        auto_anagrafato, auto_anagrafato_at, note,
        scheda_tecnica_nome, scheda_tecnica_mime, scheda_tecnica_uploaded_at,
        (scheda_tecnica_data IS NOT NULL) AS has_scheda_tecnica
      FROM prodotti
      ORDER BY categoria,nome
    `);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/prodotti', authMiddleware, requirePermission('prodotti:manage'), async (req, res) => {
  try {
    const {
      codice, nome, categoria, um, packaging = '', peso_fisso = false,
      gestione_giacenza = true, punto_riordino = null, assortimento_stato = 'attivo', note = '',
      cartoni_attivi = false, peso_medio_pezzo_kg = null, pezzi_per_cartone = null, unita_per_cartone = null, pedane_attive = false, cartoni_per_pedana = null, peso_cartone_kg = null,
    } = req.body;
    if (!codice||!nome||!categoria||!um) return res.status(400).json({ error: 'Campi mancanti' });
    const puntoRiordino = punto_riordino === '' || punto_riordino === null || punto_riordino === undefined
      ? null
      : Number(punto_riordino);
    if (puntoRiordino !== null && (!Number.isFinite(puntoRiordino) || puntoRiordino < 0)) {
      return res.status(400).json({ error: 'Punto di riordino non valido' });
    }
    const assortimentoStato = ['attivo', 'fuori_assortimento', 'su_ordinazione'].includes(String(assortimento_stato || '').trim())
      ? String(assortimento_stato).trim()
      : 'attivo';
    let conv;
    try {
      conv = normalizeProdottoConversioni({ cartoni_attivi, peso_medio_pezzo_kg, pezzi_per_cartone, unita_per_cartone, pedane_attive, cartoni_per_pedana, peso_cartone_kg });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const dup = await q('SELECT id FROM prodotti WHERE codice=$1', [codice.toUpperCase()]);
    if (dup.rows.length) return res.status(409).json({ error: 'Codice già esistente' });
    const r = await q(
      `INSERT INTO prodotti (codice,nome,categoria,um,packaging,peso_fisso,gestione_giacenza,punto_riordino,cartoni_attivi,peso_medio_pezzo_kg,pezzi_per_cartone,unita_per_cartone,pedane_attive,cartoni_per_pedana,peso_cartone_kg,assortimento_stato,note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
      [codice.toUpperCase(), nome, categoria, um, packaging, peso_fisso, !!gestione_giacenza, puntoRiordino, conv.cartoniAttivi, conv.pesoMedioPezzoKg, conv.pezziPerCartone, conv.unitaPerCartone, conv.pedaneAttive, conv.cartoniPerPedana, conv.pesoCartoneKg, assortimentoStato, note]
    );
    res.json({ id: r.rows[0].id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/prodotti/:id', authMiddleware, requirePermission('prodotti:manage'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const {
      codice, nome, categoria, um, packaging = '', peso_fisso = false,
      gestione_giacenza = true, punto_riordino = null, assortimento_stato = 'attivo', note = '',
      cartoni_attivi = false, peso_medio_pezzo_kg = null, pezzi_per_cartone = null, unita_per_cartone = null, pedane_attive = false, cartoni_per_pedana = null, peso_cartone_kg = null,
    } = req.body;
    if (!codice||!nome) return res.status(400).json({ error: 'Campi mancanti' });
    const puntoRiordino = punto_riordino === '' || punto_riordino === null || punto_riordino === undefined
      ? null
      : Number(punto_riordino);
    if (puntoRiordino !== null && (!Number.isFinite(puntoRiordino) || puntoRiordino < 0)) {
      return res.status(400).json({ error: 'Punto di riordino non valido' });
    }
    const assortimentoStato = ['attivo', 'fuori_assortimento', 'su_ordinazione'].includes(String(assortimento_stato || '').trim())
      ? String(assortimento_stato).trim()
      : 'attivo';
    let conv;
    try {
      conv = normalizeProdottoConversioni({ cartoni_attivi, peso_medio_pezzo_kg, pezzi_per_cartone, unita_per_cartone, pedane_attive, cartoni_per_pedana, peso_cartone_kg });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const dup = await q('SELECT id FROM prodotti WHERE codice=$1 AND id!=$2', [codice.toUpperCase(), id]);
    if (dup.rows.length) return res.status(409).json({ error: 'Codice già in uso' });
    await q(
      `UPDATE prodotti
       SET codice=$1,nome=$2,categoria=$3,um=$4,packaging=$5,peso_fisso=$6,
           gestione_giacenza=$7,punto_riordino=$8,cartoni_attivi=$9,peso_medio_pezzo_kg=$10,pezzi_per_cartone=$11,unita_per_cartone=$12,pedane_attive=$13,cartoni_per_pedana=$14,peso_cartone_kg=$15,assortimento_stato=$16,auto_anagrafato=FALSE,auto_anagrafato_at=NULL,note=$17 WHERE id=$18`,
      [codice.toUpperCase(), nome, categoria, um, packaging, peso_fisso, !!gestione_giacenza, puntoRiordino, conv.cartoniAttivi, conv.pesoMedioPezzoKg, conv.pezziPerCartone, conv.unitaPerCartone, conv.pedaneAttive, conv.cartoniPerPedana, conv.pesoCartoneKg, assortimentoStato, note, id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/prodotti/:id', authMiddleware, requirePermission('prodotti:manage'), async (req, res) => {
  try {
    await q('DELETE FROM prodotti WHERE id=$1', [parseInt(req.params.id)]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/prodotti/:id/scheda', authMiddleware, requirePermission('prodotti:manage'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { file_name='', mime_type='application/octet-stream', content_base64='' } = req.body || {};
    const safeName = path.basename(String(file_name || '').trim());
    const ext = path.extname(safeName).toLowerCase();
    const inferredMime = ext === '.pdf'
      ? 'application/pdf'
      : ext === '.doc'
        ? 'application/msword'
        : ext === '.docx'
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : String(mime_type || '').trim();
    const allowed = new Set([
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]);
    if (!id || !safeName || !content_base64) return res.status(400).json({ error: 'File mancante' });
    if (!allowed.has(inferredMime)) return res.status(400).json({ error: 'Formato file non supportato' });
    const base64 = String(content_base64).includes(',') ? String(content_base64).split(',').pop() : String(content_base64);
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) return res.status(400).json({ error: 'Contenuto file non valido' });
    if (buffer.length > 15 * 1024 * 1024) return res.status(400).json({ error: 'File troppo grande' });
    await q(
      `UPDATE prodotti
       SET scheda_tecnica_nome=$1, scheda_tecnica_mime=$2, scheda_tecnica_data=$3, scheda_tecnica_uploaded_at=NOW()
       WHERE id=$4`,
      [safeName, inferredMime, buffer, id]
    );
    res.json({ ok: true, file_name: safeName, mime_type: inferredMime, uploaded_at: new Date().toISOString() });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/prodotti/:id/scheda', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { rows } = await q(
      `SELECT scheda_tecnica_nome, scheda_tecnica_mime, scheda_tecnica_data
       FROM prodotti WHERE id=$1`,
      [id]
    );
    const row = rows[0];
    if (!row || !row.scheda_tecnica_data) return res.status(404).json({ error: 'Scheda tecnica non trovata' });
    res.setHeader('Content-Type', row.scheda_tecnica_mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${String(row.scheda_tecnica_nome || 'scheda-tecnica').replace(/"/g, '')}"`);
    res.send(row.scheda_tecnica_data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/prodotti/:id/scheda', authMiddleware, requirePermission('prodotti:manage'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await q(
      `UPDATE prodotti
       SET scheda_tecnica_nome='', scheda_tecnica_mime='', scheda_tecnica_data=NULL, scheda_tecnica_uploaded_at=NULL
       WHERE id=$1`,
      [id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── ORDINI ──────────────────────────────────────────────────────
app.get('/api/listini', authMiddleware, requirePermission('listini:view'), async (req, res) => {
  try {
    const { prodotto_id, cliente_id, giro, scope, include_scaduti } = req.query;
    const where = ['1=1'];
    const params = [];
    let i = 1;
    if (prodotto_id) { where.push(`l.prodotto_id=$${i++}`); params.push(parseInt(prodotto_id)); }
    if (cliente_id === 'null') {
      where.push('l.cliente_id IS NULL');
    } else if (cliente_id) {
      where.push(`l.cliente_id=$${i++}`); params.push(parseInt(cliente_id));
    }
    if (giro) { where.push(`l.giro=$${i++}`); params.push(String(giro)); }
    if (scope) { where.push(`l.scope=$${i++}`); params.push(String(scope)); }
    if (!include_scaduti || include_scaduti === '0') {
      where.push(`(l.valido_al IS NULL OR l.valido_al >= CURRENT_DATE)`);
    }
    const { rows } = await q(
      `SELECT l.*, p.codice AS prodotto_codice, p.nome AS prodotto_nome,
              c.nome AS cliente_nome
       FROM listini l
       JOIN prodotti p ON p.id=l.prodotto_id
       LEFT JOIN clienti c ON c.id=l.cliente_id
       WHERE ${where.join(' AND ')}
       ORDER BY p.nome, l.scope, l.giro, l.cliente_id NULLS FIRST, l.valido_dal DESC, l.id DESC`,
      params
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/listini', authMiddleware, requirePermission('listini:manage'), async (req, res) => {
  try {
    const parsed = zListinoPayload.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);
    const {
      prodotto_id, prodotto_ids = null,
      cliente_id = null, cliente_ids = null,
      giro = '', scope = 'all', mode = 'final_price',
      prezzo = null, base_price = null, markup_pct = 0, discount_pct = 0, final_price = null,
      excluded_client_ids = [],
      valido_dal, valido_al = null, note = '',
    } = parsed.data;
    const prodotti = asIntArray(prodotto_ids && prodotto_ids.length ? prodotto_ids : [prodotto_id]);
    if (!prodotti.length || !valido_dal) {
      return res.status(400).json({ error: 'Campi obbligatori mancanti' });
    }
    const allowedScope = ['all', 'giro', 'cliente', 'giro_cliente'];
    const allowedMode = ['base_markup', 'discount_pct', 'final_price'];
    if (!allowedScope.includes(scope)) return res.status(400).json({ error: 'Scope non valido' });
    if (!allowedMode.includes(mode)) return res.status(400).json({ error: 'Modalita prezzo non valida' });
    if ((scope === 'giro' || scope === 'giro_cliente') && !String(giro).trim()) {
      return res.status(400).json({ error: 'Giro obbligatorio per questo scope' });
    }
    const clienti = asIntArray(cliente_ids && cliente_ids.length ? cliente_ids : [cliente_id]);
    if ((scope === 'cliente' || scope === 'giro_cliente') && !clienti.length) {
      return res.status(400).json({ error: 'Cliente obbligatorio per questo scope' });
    }
    const excluded = asIntArray(excluded_client_ids);
    const base = asNum(base_price);
    const markup = asNum(markup_pct) ?? 0;
    const discount = asNum(discount_pct) ?? 0;
    const finalP = asNum(final_price ?? prezzo);
    if (mode === 'base_markup' && (base === null || base < 0)) {
      return res.status(400).json({ error: 'Base prezzo non valida' });
    }
    if (mode === 'discount_pct' && (discount < 0 || discount > 100)) {
      return res.status(400).json({ error: 'Sconto % non valido' });
    }
    if (mode === 'final_price' && (finalP === null || finalP < 0)) {
      return res.status(400).json({ error: 'Prezzo finale non valido' });
    }
    if (valido_al && valido_al < valido_dal) return res.status(400).json({ error: 'Intervallo date non valido' });
    const targets = (scope === 'cliente' || scope === 'giro_cliente') ? clienti : [null];
    const inserted = [];
    for (const pid of prodotti) {
      for (const cid of targets) {
        const r = await q(
          `INSERT INTO listini
           (prodotto_id,cliente_id,giro,scope,mode,prezzo,base_price,markup_pct,discount_pct,final_price,excluded_client_ids,valido_dal,valido_al,note,created_by,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,NOW()) RETURNING *`,
          [
            pid, cid, String(giro || ''),
            scope, mode, finalP, base, markup, discount, finalP, JSON.stringify(excluded), valido_dal, valido_al || null, note, req.user.id || null,
          ]
        );
        inserted.push(r.rows[0]);
      }
    }
    if (inserted.length === 1) return res.json(inserted[0]);
    res.json({ created: inserted.length, rows: inserted });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/listini/:id', authMiddleware, requirePermission('listini:manage'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const parsed = zListinoPayload.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);
    const {
      cliente_id = null, giro = '', scope = 'all', mode = 'final_price',
      prezzo = null, base_price = null, markup_pct = 0, discount_pct = 0, final_price = null,
      excluded_client_ids = [],
      valido_dal, valido_al = null, note = '',
    } = parsed.data;
    if (!valido_dal) return res.status(400).json({ error: 'Campi mancanti' });
    const allowedScope = ['all', 'giro', 'cliente', 'giro_cliente'];
    const allowedMode = ['base_markup', 'discount_pct', 'final_price'];
    if (!allowedScope.includes(scope)) return res.status(400).json({ error: 'Scope non valido' });
    if (!allowedMode.includes(mode)) return res.status(400).json({ error: 'Modalita prezzo non valida' });
    if ((scope === 'giro' || scope === 'giro_cliente') && !String(giro).trim()) {
      return res.status(400).json({ error: 'Giro obbligatorio per questo scope' });
    }
    if ((scope === 'cliente' || scope === 'giro_cliente') && !cliente_id) {
      return res.status(400).json({ error: 'Cliente obbligatorio per questo scope' });
    }
    const base = asNum(base_price);
    const markup = asNum(markup_pct) ?? 0;
    const discount = asNum(discount_pct) ?? 0;
    const finalP = asNum(final_price ?? prezzo);
    if (mode === 'base_markup' && (base === null || base < 0)) {
      return res.status(400).json({ error: 'Base prezzo non valida' });
    }
    if (mode === 'discount_pct' && (discount < 0 || discount > 100)) {
      return res.status(400).json({ error: 'Sconto % non valido' });
    }
    if (mode === 'final_price' && (finalP === null || finalP < 0)) {
      return res.status(400).json({ error: 'Prezzo finale non valido' });
    }
    if (valido_al && valido_al < valido_dal) return res.status(400).json({ error: 'Intervallo date non valido' });
    const excluded = asIntArray(excluded_client_ids);
    const r = await q(
      `UPDATE listini
       SET cliente_id=$1, giro=$2, scope=$3, mode=$4,
           prezzo=$5, base_price=$6, markup_pct=$7, discount_pct=$8, final_price=$9, excluded_client_ids=$10::jsonb,
           valido_dal=$11, valido_al=$12, note=$13, updated_at=NOW()
       WHERE id=$14
       RETURNING *`,
      [
        cliente_id ? parseInt(cliente_id) : null, String(giro || ''), scope, mode,
        finalP, base, markup, discount, finalP, JSON.stringify(excluded),
        valido_dal, valido_al || null, note, id,
      ]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Listino non trovato' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/listini/:id', authMiddleware, requirePermission('listini:manage'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await q('DELETE FROM listini WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function getResaRecord(id) {
  const { rows } = await q(
    `SELECT r.*, c.nome AS fornitore_nome
     FROM rese_fornitori r
     JOIN clienti c ON c.id = r.fornitore_id
     WHERE r.id=$1
     LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function ensureFornitoreCliente(fornitoreId) {
  const { rows } = await q(
    `SELECT id, nome, e_fornitore
     FROM clienti
     WHERE id=$1
     LIMIT 1`,
    [fornitoreId]
  );
  const row = rows[0];
  if (!row) {
    const err = new Error('Fornitore non trovato');
    err.status = 404;
    throw err;
  }
  if (!row.e_fornitore) {
    const err = new Error('Il soggetto selezionato non è marcato come fornitore');
    err.status = 400;
    throw err;
  }
  return row;
}

app.get('/api/rese', authMiddleware, requirePermission('rese:view'), async (req, res) => {
  try {
    const { rows } = await q(
      `SELECT r.*, c.nome AS fornitore_nome
       FROM rese_fornitori r
       JOIN clienti c ON c.id = r.fornitore_id
       ORDER BY r.created_at DESC, r.id DESC`
    );
    res.json(rows);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/api/rese', authMiddleware, requirePermission('rese:manage'), async (req, res) => {
  try {
    const parsed = zResaPayload.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);
    const payload = parsed.data;
    const fornitore = await ensureFornitoreCliente(payload.fornitore_id);
    const prezzoVenduto = computePrezzoVenduto(payload.clal_value, payload.buyer_code, payload.resa_pct);
    const { rows } = await q(
      `INSERT INTO rese_fornitori
       (fornitore_id, clal_value, buyer_code, quantita, prezzo_pagato, lotto, resa_pct, prezzo_venduto, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
       RETURNING *`,
      [
        payload.fornitore_id,
        payload.clal_value,
        payload.buyer_code,
        payload.quantita,
        payload.prezzo_pagato,
        String(payload.lotto || '').trim(),
        payload.resa_pct,
        prezzoVenduto,
        req.user.id || null,
      ]
    );
    await logDB(req.user.id, `${req.user.nome} ${req.user.cognome || ''}`.trim() || 'Sistema', 'Gestione rese', `Nuova resa - ${fornitore.nome}`);
    res.json({ ...rows[0], fornitore_nome: fornitore.nome });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.put('/api/rese/:id', authMiddleware, requirePermission('rese:manage'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const parsed = zResaPayload.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);
    const payload = parsed.data;
    const existing = await getResaRecord(id);
    if (!existing) return res.status(404).json({ error: 'Record resa non trovato' });
    const fornitore = await ensureFornitoreCliente(payload.fornitore_id);
    const prezzoVenduto = computePrezzoVenduto(payload.clal_value, payload.buyer_code, payload.resa_pct);
    await q(
      `UPDATE rese_fornitori
       SET fornitore_id=$1,
           clal_value=$2,
           buyer_code=$3,
           quantita=$4,
           prezzo_pagato=$5,
           lotto=$6,
           resa_pct=$7,
           prezzo_venduto=$8,
           updated_at=NOW()
       WHERE id=$9`,
      [
        payload.fornitore_id,
        payload.clal_value,
        payload.buyer_code,
        payload.quantita,
        payload.prezzo_pagato,
        String(payload.lotto || '').trim(),
        payload.resa_pct,
        prezzoVenduto,
        id,
      ]
    );
    await logDB(req.user.id, `${req.user.nome} ${req.user.cognome || ''}`.trim() || 'Sistema', 'Gestione rese', `Modifica resa #${id} - ${fornitore.nome}`);
    const updated = await getResaRecord(id);
    res.json(updated);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.delete('/api/rese/:id', authMiddleware, requirePermission('rese:manage'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await getResaRecord(id);
    if (!existing) return res.status(404).json({ error: 'Record resa non trovato' });
    await q('DELETE FROM rese_fornitori WHERE id=$1', [id]);
    await logDB(req.user.id, `${req.user.nome} ${req.user.cognome || ''}`.trim() || 'Sistema', 'Gestione rese', `Elimina resa #${id} - ${existing.fornitore_nome}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function folderRowToPayload(row) {
  return {
    id: row.id,
    name: row.name || '',
    parent_id: row.parent_id || null,
    allowed_roles: normalizeAllowedRoles(row.allowed_roles),
    created_by: row.created_by || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function buildVisibleFolders(rows, role) {
  const byId = new Map(rows.map(r => [r.id, r]));
  const memo = new Map();
  const visit = (id) => {
    if (memo.has(id)) return memo.get(id);
    const row = byId.get(id);
    if (!row) return false;
    const canSeeSelf = userCanViewDocFolder(role, row.allowed_roles);
    if (!canSeeSelf) {
      memo.set(id, false);
      return false;
    }
    if (!row.parent_id) {
      memo.set(id, true);
      return true;
    }
    const parentOk = visit(row.parent_id);
    memo.set(id, !!parentOk);
    return !!parentOk;
  };
  return rows.filter(r => visit(r.id));
}

async function getDocFolderOrNull(id) {
  const { rows } = await q('SELECT * FROM doc_folders WHERE id=$1 LIMIT 1', [id]);
  return rows[0] || null;
}

async function assertDocFolderVisible(req, res, folderId) {
  const row = await getDocFolderOrNull(folderId);
  if (!row) {
    res.status(404).json({ error: 'Cartella non trovata' });
    return null;
  }
  let cursor = row;
  while (cursor) {
    if (!userCanViewDocFolder(req.user.ruolo, cursor.allowed_roles)) {
      res.status(403).json({ error: 'Permesso negato su cartella' });
      return null;
    }
    if (!cursor.parent_id) break;
    cursor = await getDocFolderOrNull(cursor.parent_id);
  }
  return row;
}

async function resolveOrderLinePrice({ prodottoId, clienteId, data, manualPrice = null, client = null }) {
  const explicit = asNum(manualPrice);
  if (explicit !== null) return explicit;
  if (!prodottoId || !clienteId) return 0;
  const db = client ? { query: (sql, params) => client.query(sql, params) } : pool;
  const fromListino = await resolvePrezzoUnitario({ prodottoId, clienteId, data, client });
  if (fromListino !== null) return Number(fromListino);
  const lastSql = `
    SELECT ol.prezzo_unitario
    FROM ordine_linee ol
    JOIN ordini o ON o.id = ol.ordine_id
    WHERE o.cliente_id = $1
      AND ol.prodotto_id = $2
      AND ol.prezzo_unitario IS NOT NULL
    ORDER BY o.data DESC, ol.id DESC
    LIMIT 1
  `;
  const last = await db.query(lastSql, [clienteId, prodottoId]);
  if (last.rows.length) return Number(last.rows[0].prezzo_unitario || 0);
  return 0;
}

app.get('/api/documenti/folders', authMiddleware, requirePermission('documenti:view'), async (req, res) => {
  try {
    const { rows } = await q(
      `SELECT id,name,parent_id,allowed_roles,created_by,created_at,updated_at
       FROM doc_folders
       ORDER BY COALESCE(parent_id,0), name, id`
    );
    const visible = buildVisibleFolders(rows, req.user.ruolo).map(folderRowToPayload);
    res.json({ folders: visible, can_manage: hasFullDocumentAccess(req.user.ruolo) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/documenti/folders', authMiddleware, requirePermission('documenti:manage'), async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const parentId = req.body?.parent_id ? parseInt(req.body.parent_id) : null;
    const allowedRoles = normalizeAllowedRoles(req.body?.allowed_roles);
    if (!name) return res.status(400).json({ error: 'Nome cartella obbligatorio' });
    if (name.length > 120) return res.status(400).json({ error: 'Nome cartella troppo lungo' });
    if (!allowedRoles.length) return res.status(400).json({ error: 'Seleziona almeno un ruolo visibile' });
    if (parentId) {
      const parent = await getDocFolderOrNull(parentId);
      if (!parent) return res.status(404).json({ error: 'Cartella padre non trovata' });
    }
    const { rows } = await q(
      `INSERT INTO doc_folders (name,parent_id,allowed_roles,created_by,updated_at)
       VALUES ($1,$2,$3::jsonb,$4,NOW())
       RETURNING *`,
      [name, parentId, JSON.stringify(allowedRoles), req.user.id || null]
    );
    await logDB(req.user.id, `${req.user.nome} ${req.user.cognome || ''}`.trim() || 'Sistema', 'Documenti', `Nuova cartella: ${name}`);
    res.json(folderRowToPayload(rows[0]));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/documenti/folders/:id', authMiddleware, requirePermission('documenti:manage'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const old = await getDocFolderOrNull(id);
    if (!old) return res.status(404).json({ error: 'Cartella non trovata' });
    const nextName = req.body?.name !== undefined ? String(req.body.name || '').trim() : String(old.name || '');
    const nextRoles = req.body?.allowed_roles !== undefined ? normalizeAllowedRoles(req.body.allowed_roles) : normalizeAllowedRoles(old.allowed_roles);
    if (!nextName) return res.status(400).json({ error: 'Nome cartella obbligatorio' });
    if (!nextRoles.length) return res.status(400).json({ error: 'Seleziona almeno un ruolo visibile' });
    const { rows } = await q(
      `UPDATE doc_folders
       SET name=$1, allowed_roles=$2::jsonb, updated_at=NOW()
       WHERE id=$3
       RETURNING *`,
      [nextName, JSON.stringify(nextRoles), id]
    );
    await logDB(req.user.id, `${req.user.nome} ${req.user.cognome || ''}`.trim() || 'Sistema', 'Documenti', `Aggiorna cartella: ${nextName}`);
    res.json(folderRowToPayload(rows[0]));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/documenti/folders/:id', authMiddleware, requirePermission('documenti:manage'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const folder = await getDocFolderOrNull(id);
    if (!folder) return res.status(404).json({ error: 'Cartella non trovata' });
    await q('DELETE FROM doc_folders WHERE id=$1', [id]);
    await logDB(req.user.id, `${req.user.nome} ${req.user.cognome || ''}`.trim() || 'Sistema', 'Documenti', `Elimina cartella: ${folder.name}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/documenti/files', authMiddleware, requirePermission('documenti:view'), async (req, res) => {
  try {
    const folderId = parseInt(req.query.folder_id);
    if (!folderId) return res.status(400).json({ error: 'folder_id mancante' });
    const folder = await assertDocFolderVisible(req, res, folderId);
    if (!folder) return;
    const { rows } = await q(
      `SELECT id,folder_id,file_name,mime_type,size_bytes,created_by,created_at
       FROM doc_files
       WHERE folder_id=$1
       ORDER BY created_at DESC, id DESC`,
      [folderId]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/documenti/files', authMiddleware, requirePermission('documenti:manage'), async (req, res) => {
  try {
    const folderId = parseInt(req.body?.folder_id);
    const fileName = String(req.body?.file_name || '').trim();
    const mimeType = String(req.body?.mime_type || 'application/octet-stream').trim() || 'application/octet-stream';
    const contentBase64 = String(req.body?.content_base64 || '');
    if (!folderId) return res.status(400).json({ error: 'folder_id mancante' });
    if (!fileName) return res.status(400).json({ error: 'Nome file obbligatorio' });
    if (!contentBase64) return res.status(400).json({ error: 'Contenuto file mancante' });
    const folder = await getDocFolderOrNull(folderId);
    if (!folder) return res.status(404).json({ error: 'Cartella non trovata' });
    const fileData = decodeBase64Payload(contentBase64);
    if (!fileData.length) return res.status(400).json({ error: 'File vuoto o non valido' });
    if (fileData.length > 10 * 1024 * 1024) return res.status(400).json({ error: 'File troppo grande (max 10MB)' });
    const { rows } = await q(
      `INSERT INTO doc_files (folder_id,file_name,mime_type,size_bytes,file_data,created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id,folder_id,file_name,mime_type,size_bytes,created_by,created_at`,
      [folderId, fileName, mimeType, fileData.length, fileData, req.user.id || null]
    );
    await logDB(req.user.id, `${req.user.nome} ${req.user.cognome || ''}`.trim() || 'Sistema', 'Documenti', `Upload file: ${fileName}`);
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/documenti/files/:id', authMiddleware, requirePermission('documenti:manage'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { rows } = await q('SELECT id,file_name FROM doc_files WHERE id=$1 LIMIT 1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'File non trovato' });
    await q('DELETE FROM doc_files WHERE id=$1', [id]);
    await logDB(req.user.id, `${req.user.nome} ${req.user.cognome || ''}`.trim() || 'Sistema', 'Documenti', `Elimina file: ${rows[0].file_name}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/documenti/files/:id/download', authMiddleware, requirePermission('documenti:view'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { rows } = await q(
      `SELECT f.id,f.folder_id,f.file_name,f.mime_type,f.size_bytes,f.file_data
       FROM doc_files f
       WHERE f.id=$1
       LIMIT 1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'File non trovato' });
    const file = rows[0];
    const folder = await assertDocFolderVisible(req, res, file.folder_id);
    if (!folder) return;
    const safeName = String(file.file_name || 'documento').replace(/[^\w.\- ]+/g, '_');
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', String(file.size_bytes || 0));
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.send(file.file_data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function getOrdineCompleto(id) {
  const { rows } = await q(`
    SELECT o.*,
           c.nome as cliente_nome, c.localita as cliente_localita, c.giro as cliente_giro,
           u.nome as agente_nome,
           a.nome as autista_nome,
           ins.nome as inserted_by_nome, ins.cognome as inserted_by_cognome
    FROM ordini o
    JOIN    clienti c   ON o.cliente_id = c.id
    LEFT JOIN utenti u  ON o.agente_id = u.id
    LEFT JOIN utenti a  ON o.autista_di_giro = a.id
    LEFT JOIN utenti ins ON o.inserted_by = ins.id
    WHERE o.id = $1`, [id]);
  if (!rows.length) return null;
  const ordine = rows[0];
  const linee = await q(`
    SELECT ol.*, p.codice, p.nome as prodotto_nome, p.um, p.packaging, p.cartoni_attivi, p.peso_medio_pezzo_kg, p.pezzi_per_cartone, p.unita_per_cartone, p.pedane_attive, p.cartoni_per_pedana, p.peso_cartone_kg
    FROM ordine_linee ol LEFT JOIN prodotti p ON ol.prodotto_id = p.id
    WHERE ol.ordine_id = $1 ORDER BY ol.id`, [id]);
  ordine.linee = linee.rows;
  return ordine;
}

function normalizeOrderLineMatchKey(line = {}) {
  const um = normalizeOrdineUm(line.unita_misura || line.unitaMisura || 'base');
  const prodottoId = Number(line.prodotto_id || line.prodottoId || 0);
  if (Number.isFinite(prodottoId) && prodottoId > 0) return `prod:${prodottoId}:${um}`;
  const libero = String(line.prodotto_nome_libero || line.prodottoNomeLibero || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!libero) return '';
  return `free:${libero}:${um}`;
}

function mergeOrderNotes(existingNote = '', incomingNote = '') {
  const curr = String(existingNote || '').trim();
  const next = String(incomingNote || '').trim();
  if (!curr) return next;
  if (!next) return curr;
  if (curr.includes(next)) return curr;
  return `${curr} | ${next}`;
}

function formatOrderLineLabel(line = {}, productMap = new Map()) {
  const prodottoId = Number(line.prodotto_id || line.prodottoId || 0);
  const product = prodottoId ? productMap.get(prodottoId) : null;
  const nome = product?.nome || String(line.prodotto_nome_libero || line.prodottoNomeLibero || 'prodotto').trim() || 'prodotto';
  const qty = Number(line.qty || 0);
  const um = String(line.unita_misura || line.unitaMisura || product?.um || 'pezzi').trim() || 'pezzi';
  const qtyLabel = Number.isFinite(qty) ? Number(qty).toFixed(2).replace(/\.00$/, '') : '?';
  return `${qtyLabel} ${um} di ${nome}`;
}

async function prepareOrderLinesForSave({ linee = [], clienteId, data, client }) {
  const prepared = [];
  const productIds = [...new Set(
    linee
      .map(l => Number.parseInt(l.prodotto_id, 10))
      .filter(id => Number.isFinite(id) && id > 0)
  )];
  let productRowsById = new Map();
  if (productIds.length) {
    const { rows } = await client.query(
      `SELECT id, nome, codice, um, cartoni_attivi, peso_medio_pezzo_kg, pezzi_per_cartone,
              unita_per_cartone, pedane_attive, cartoni_per_pedana
         FROM prodotti
        WHERE id = ANY($1::int[])`,
      [productIds]
    );
    productRowsById = new Map(rows.map(row => [row.id, row]));
  }

  for (const l of linee) {
    const prodottoId = l.prodotto_id ? parseInt(l.prodotto_id, 10) : null;
    const prodottoNomeLibero = String(l.prodotto_nome_libero || '').trim();
    if (!prodottoId && !prodottoNomeLibero) {
      throw new Error('Ogni riga ordine deve avere un prodotto o un nome libero');
    }
    const prodottoRow = prodottoId ? productRowsById.get(prodottoId) || null : null;
    const prezzoUnitario = await resolveOrderLinePrice({
      prodottoId,
      clienteId,
      data,
      manualPrice: l.prezzo_unitario,
      client,
    });
    const qty = Number(l.qty);
    const unitaMisura = l.unita_misura || 'pezzi';
    const qtyBase = prodottoRow
      ? calcolaQtyBaseRiga({ qty, unitaMisura, prodotto: prodottoRow })
      : null;
    prepared.push({
      prodottoId,
      prodottoNomeLibero,
      qty,
      qtyBase,
      prezzoUnitario,
      isPedana: !!l.is_pedana,
      notaRiga: l.nota_riga || '',
      unitaMisura,
      preparato: !!l.preparato,
      lotto: String(l.lotto || '').trim(),
      productRow: prodottoRow,
      matchKey: normalizeOrderLineMatchKey({
        prodotto_id: prodottoId,
        prodotto_nome_libero: prodottoNomeLibero,
        unita_misura: unitaMisura,
      }),
    });
  }

  return prepared;
}

async function insertPreparedOrderLines(client, ordineId, preparedLines) {
  for (const l of preparedLines) {
    await client.query(
      `INSERT INTO ordine_linee (ordine_id,prodotto_id,prodotto_nome_libero,qty,qty_base,prezzo_unitario,is_pedana,nota_riga,unita_misura,preparato,lotto)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [ordineId, l.prodottoId, l.prodottoNomeLibero, l.qty, l.qtyBase, l.prezzoUnitario, l.isPedana, l.notaRiga, l.unitaMisura, l.preparato, l.lotto]
    );
  }
}

async function mergePreparedLinesIntoOrder({
  client,
  existingOrderId,
  preparedLines,
  meta,
}) {
  const { rows: existingLines } = await client.query(
    'SELECT * FROM ordine_linee WHERE ordine_id=$1 ORDER BY id',
    [existingOrderId]
  );
  const existingLineByKey = new Map();
  for (const row of existingLines) {
    const key = normalizeOrderLineMatchKey(row);
    if (key && !existingLineByKey.has(key)) existingLineByKey.set(key, row);
  }

  for (const line of preparedLines) {
    const existing = line.matchKey ? existingLineByKey.get(line.matchKey) : null;
    if (existing) {
      const nextQty = Number(existing.qty || 0) + Number(line.qty || 0);
      const nextQtyBase = line.productRow
        ? calcolaQtyBaseRiga({ qty: nextQty, unitaMisura: existing.unita_misura || line.unitaMisura, prodotto: line.productRow })
        : (
          Number.isFinite(Number(existing.qty_base)) && Number.isFinite(Number(line.qtyBase))
            ? (Number(existing.qty_base) + Number(line.qtyBase))
            : (Number.isFinite(Number(existing.qty_base)) ? Number(existing.qty_base) : (Number.isFinite(Number(line.qtyBase)) ? Number(line.qtyBase) : null))
        );
      await client.query(
        `UPDATE ordine_linee
            SET qty=$1,
                qty_base=$2,
                prezzo_unitario=COALESCE(prezzo_unitario, $3)
          WHERE id=$4`,
        [nextQty, nextQtyBase, line.prezzoUnitario, existing.id]
      );
      continue;
    }
    await client.query(
      `INSERT INTO ordine_linee (ordine_id,prodotto_id,prodotto_nome_libero,qty,qty_base,prezzo_unitario,is_pedana,nota_riga,unita_misura,preparato,lotto)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        existingOrderId,
        line.prodottoId,
        line.prodottoNomeLibero,
        line.qty,
        line.qtyBase,
        line.prezzoUnitario,
        line.isPedana,
        line.notaRiga,
        line.unitaMisura,
        line.preparato,
        line.lotto,
      ]
    );
  }

  await client.query(
    `UPDATE ordini
        SET agente_id = COALESCE(agente_id, $1),
            autista_di_giro = COALESCE(autista_di_giro, $2),
            stato = CASE WHEN stato IN ('annullato','consegnato') THEN stato ELSE 'attesa' END,
            note = $3,
            data_non_certa = COALESCE(data_non_certa, FALSE) OR $4,
            stef = COALESCE(stef, FALSE) OR $5,
            altro_vettore = COALESCE(altro_vettore, FALSE) OR $6,
            giro_override = CASE WHEN COALESCE(giro_override, '') <> '' THEN giro_override ELSE $7 END,
            updated_at = NOW()
      WHERE id = $8`,
    [
      meta.agenteId || null,
      meta.autistaDiGiro || null,
      mergeOrderNotes(meta.existingNote, meta.note),
      !!meta.dataNonCerta,
      !!meta.stef,
      !!meta.altroVettore,
      String(meta.giroOverride || ''),
      existingOrderId,
    ]
  );
}

app.get('/api/ordini', authMiddleware, async (req, res) => {
  try {
    const { data, stato, agente_id, autista_id, giro, search } = req.query;
    const where = ['1=1'], params = [];
    let pi = 1;
    if (data)       { where.push(`o.data=$${pi++}`);             params.push(data); }
    if (stato)      { where.push(`o.stato=$${pi++}`);            params.push(stato); }
    if (agente_id)  { where.push(`o.agente_id=$${pi++}`);        params.push(parseInt(agente_id)); }
    if (autista_id) { where.push(`o.autista_di_giro=$${pi++}`);  params.push(parseInt(autista_id)); }
    if (giro)       { where.push(`COALESCE(NULLIF(o.giro_override,''), c.giro)=$${pi++}`); params.push(giro); }
    if (search)     {
      where.push(`(c.nome ILIKE $${pi} OR u.nome ILIKE $${pi+1})`);
      params.push(`%${search}%`, `%${search}%`); pi += 2;
    }

    const { rows } = await q(`
      SELECT o.id, o.data, o.stato, o.note, o.data_non_certa, o.stef, o.altro_vettore, o.giro_override,
             o.inserted_at, o.updated_at,
             o.cliente_id, c.nome as cliente_nome, c.giro as cliente_giro,
             o.agente_id, u.nome as agente_nome,
             o.autista_di_giro, a.nome as autista_nome,
             o.inserted_by, ins.nome as inserted_by_nome, ins.cognome as inserted_by_cognome,
             COUNT(ol.id) as n_linee
      FROM ordini o
      JOIN    clienti c   ON o.cliente_id = c.id
      LEFT JOIN utenti u  ON o.agente_id = u.id
      LEFT JOIN utenti a  ON o.autista_di_giro = a.id
      LEFT JOIN utenti ins ON o.inserted_by = ins.id
      LEFT JOIN ordine_linee ol ON ol.ordine_id = o.id
      WHERE ${where.join(' AND ')}
      GROUP BY o.id,c.nome,c.giro,u.nome,a.nome,ins.nome,ins.cognome
      ORDER BY o.id DESC`, params);

    // Carica linee per tutti gli ordini in un'unica query
    if (rows.length) {
      const ids = rows.map(r => r.id);
      const { rows: linee } = await q(
        `SELECT ol.id, ol.ordine_id, ol.prodotto_id, ol.prodotto_nome_libero, ol.qty, ol.qty_base, ol.colli_effettivi, ol.peso_effettivo,
                ol.prezzo_unitario, ol.is_pedana, ol.nota_riga, ol.unita_misura, ol.preparato, ol.lotto,
                p.codice, p.nome as prodotto_nome, p.um, p.packaging, p.cartoni_attivi, p.peso_medio_pezzo_kg, p.pezzi_per_cartone, p.unita_per_cartone, p.pedane_attive, p.cartoni_per_pedana, p.peso_cartone_kg
         FROM ordine_linee ol LEFT JOIN prodotti p ON ol.prodotto_id = p.id
         WHERE ol.ordine_id = ANY($1) ORDER BY ol.ordine_id, ol.id`, [ids]);
      const lineeMap = {};
      linee.forEach(l => {
        if (!lineeMap[l.ordine_id]) lineeMap[l.ordine_id] = [];
        lineeMap[l.ordine_id].push(l);
      });
      rows.forEach(r => { r.linee = lineeMap[r.id] || []; });
    }

    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/ordini/sync', authMiddleware, async (req, res) => {
  try {
    const sinceRaw = String(req.query.since || '').trim();
    const sinceDate = sinceRaw ? new Date(sinceRaw) : null;
    if (sinceRaw && Number.isNaN(sinceDate?.getTime())) {
      return res.status(400).json({ error: 'Parametro since non valido' });
    }

    const { rows } = await q(
      `
      SELECT o.id, o.data, o.stato, o.note, o.data_non_certa, o.stef, o.altro_vettore, o.giro_override,
             o.inserted_at, o.updated_at,
             o.cliente_id, c.nome as cliente_nome, c.giro as cliente_giro,
             o.agente_id, u.nome as agente_nome,
             o.autista_di_giro, a.nome as autista_nome,
             o.inserted_by, ins.nome as inserted_by_nome, ins.cognome as inserted_by_cognome,
             COUNT(ol.id) as n_linee
        FROM ordini o
        JOIN clienti c ON o.cliente_id = c.id
        LEFT JOIN utenti u ON o.agente_id = u.id
        LEFT JOIN utenti a ON o.autista_di_giro = a.id
        LEFT JOIN utenti ins ON o.inserted_by = ins.id
        LEFT JOIN ordine_linee ol ON ol.ordine_id = o.id
       WHERE ($1::timestamptz IS NULL OR COALESCE(o.updated_at, o.inserted_at, NOW()) > $1::timestamptz)
       GROUP BY o.id, c.nome, c.giro, u.nome, a.nome, ins.nome, ins.cognome
       ORDER BY COALESCE(o.updated_at, o.inserted_at) ASC, o.id ASC
      `,
      [sinceDate ? sinceDate.toISOString() : null]
    );

    if (rows.length) {
      const ids = rows.map(r => r.id);
      const { rows: linee } = await q(
        `SELECT ol.id, ol.ordine_id, ol.prodotto_id, ol.prodotto_nome_libero, ol.qty, ol.qty_base, ol.colli_effettivi, ol.peso_effettivo,
                ol.prezzo_unitario, ol.is_pedana, ol.nota_riga, ol.unita_misura, ol.preparato, ol.lotto,
                p.codice, p.nome as prodotto_nome, p.um, p.packaging, p.cartoni_attivi, p.peso_medio_pezzo_kg, p.pezzi_per_cartone, p.unita_per_cartone, p.pedane_attive, p.cartoni_per_pedana, p.peso_cartone_kg
           FROM ordine_linee ol
           LEFT JOIN prodotti p ON ol.prodotto_id = p.id
          WHERE ol.ordine_id = ANY($1)
          ORDER BY ol.ordine_id, ol.id`,
        [ids]
      );
      const lineeMap = {};
      linee.forEach(l => {
        if (!lineeMap[l.ordine_id]) lineeMap[l.ordine_id] = [];
        lineeMap[l.ordine_id].push(l);
      });
      rows.forEach(r => { r.linee = lineeMap[r.id] || []; });
    }

    res.json({
      server_time: new Date().toISOString(),
      orders: rows,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/ordini/:id', authMiddleware, async (req, res) => {
  try {
    const o = await getOrdineCompleto(parseInt(req.params.id));
    if (!o) return res.status(404).json({ error: 'Non trovato' });
    res.json(o);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ordini', authMiddleware, requirePermission('ordini:create'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { cliente_id, agente_id=null, autista_di_giro=null,
            data, stato='attesa', note='', data_non_certa=false, stef=false, altro_vettore=false, giro_override='', linee=[], merge_duplicate=false } = req.body;
    if (!cliente_id||!data) return res.status(400).json({ error: 'Campi obbligatori mancanti' });
    if (!linee.length) return res.status(400).json({ error: 'Almeno un prodotto richiesto' });
    if (req.user?.ruolo !== 'admin' && isNextDayOrderCutoffLocked(data)) {
      const err = nextDayOrderCutoffError(data);
      return res.status(err.status).json(err.payload);
    }
    const c = await q('SELECT id, sbloccato, onboarding_stato, classificazione FROM clienti WHERE id=$1', [cliente_id]);
    if (!c.rows.length) return res.status(400).json({ error: 'Cliente non trovato' });
    if (!c.rows[0].sbloccato || c.rows[0].onboarding_stato !== 'approvato') return res.status(403).json({ error: 'Cliente non ancora approvato dall\'amministrazione' });
    const isTentataVenditaOrder = String(c.rows[0].classificazione || '').trim().toLowerCase() === TENTATA_VENDITA_CLIENT_CLASS;
    await client.query('BEGIN');
    const preparedLines = await prepareOrderLinesForSave({
      linee,
      clienteId: cliente_id,
      data,
      client,
    });
    const existingOrderParams = [cliente_id, data];
    let existingOrderWhere = `
        WHERE cliente_id=$1
          AND data=$2
          AND stato NOT IN ('annullato', 'consegnato')`;
    if (isTentataVenditaOrder) {
      existingOrderParams.push(autista_di_giro || null);
      existingOrderWhere += ` AND autista_di_giro IS NOT DISTINCT FROM $3`;
    }
    const { rows: existingOrderRows } = await client.query(
      `SELECT id, note
         FROM ordini
         ${existingOrderWhere}
        ORDER BY id DESC
        LIMIT 1
        FOR UPDATE`,
      existingOrderParams
    );

    let oid;
    let mergedIntoExisting = false;
    if (existingOrderRows.length) {
      const existingOrderId = existingOrderRows[0].id;
      const { rows: existingLines } = await client.query(
        'SELECT * FROM ordine_linee WHERE ordine_id=$1 ORDER BY id',
        [existingOrderId]
      );
      const existingKeys = new Set(existingLines.map(row => normalizeOrderLineMatchKey(row)).filter(Boolean));
      const overlappingLines = preparedLines.filter(line => line.matchKey && existingKeys.has(line.matchKey));
      if (overlappingLines.length && !merge_duplicate) {
        const productIds = [...new Set(preparedLines.map(line => Number(line.prodottoId)).filter(id => Number.isFinite(id) && id > 0))];
        const productMap = productIds.length
          ? new Map((await client.query('SELECT id, nome FROM prodotti WHERE id = ANY($1::int[])', [productIds])).rows.map(row => [row.id, row]))
          : new Map();
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Esiste gia un ordine per questo cliente nello stesso giorno con prodotti gia presenti',
          code: 'ORDER_MERGE_CONFIRM_REQUIRED',
          existing_order_id: existingOrderId,
          overlapping_lines: overlappingLines.map(line => formatOrderLineLabel({
            prodotto_id: line.prodottoId,
            prodotto_nome_libero: line.prodottoNomeLibero,
            qty: line.qty,
            unita_misura: line.unitaMisura,
          }, productMap)),
        });
      }

      await mergePreparedLinesIntoOrder({
        client,
        existingOrderId,
        preparedLines,
        meta: {
          agenteId: agente_id,
          autistaDiGiro: autista_di_giro,
          note,
          existingNote: existingOrderRows[0].note || '',
          dataNonCerta: data_non_certa,
          stef,
          altroVettore: !!altro_vettore,
          giroOverride: giro_override,
        },
      });
      oid = existingOrderId;
      mergedIntoExisting = true;
    } else {
      const r = await client.query(
        `INSERT INTO ordini (cliente_id,agente_id,autista_di_giro,inserted_by,data,stato,note,data_non_certa,stef,altro_vettore,giro_override)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [cliente_id, agente_id||null, autista_di_giro||null, req.user.id, data, stato, note, data_non_certa, stef, !!altro_vettore, String(giro_override || '')]
      );
      oid = r.rows[0].id;
      await insertPreparedOrderLines(client, oid, preparedLines);
    }
    await client.query('COMMIT');
    const u = req.user;
    await logDB(u.id, `${u.nome} ${u.cognome||''}`.trim(), 'Nuovo ordine', mergedIntoExisting ? `#${oid} (accodato)` : `#${oid}`);
    res.json({
      ...(await getOrdineCompleto(oid)),
      merged_into_existing: mergedIntoExisting,
    });
  } catch(e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

app.put('/api/ordini/:id', authMiddleware, requirePermission('ordini:update'), async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id);
    const { cliente_id, agente_id=null, autista_di_giro=null,
            data, stato, note='', data_non_certa=false, stef=false, altro_vettore=false, giro_override='', linee=[] } = req.body;
    if (!cliente_id||!data||!stato) return res.status(400).json({ error: 'Campi mancanti' });
    const c = await q('SELECT id, sbloccato, onboarding_stato FROM clienti WHERE id=$1', [cliente_id]);
    if (!c.rows.length) return res.status(400).json({ error: 'Cliente non trovato' });
    if (!c.rows[0].sbloccato || c.rows[0].onboarding_stato !== 'approvato') return res.status(403).json({ error: 'Cliente non ancora approvato dall\'amministrazione' });
    await client.query('BEGIN');
    const { rows: orderRows } = await client.query(
      `SELECT id, cliente_id, data
         FROM ordini
        WHERE id=$1
        FOR UPDATE`,
      [id]
    );
    if (!orderRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ordine non trovato' });
    }
    const { rows: existingLines } = await client.query('SELECT * FROM ordine_linee WHERE ordine_id=$1 ORDER BY id', [id]);
    if (req.user?.ruolo !== 'admin' && isNextDayOrderCutoffLocked(data)) {
      const current = orderRows[0];
      const isCommercialChange = Number(current.cliente_id || 0) !== Number(cliente_id || 0)
        || String(current.data || '').slice(0, 10) !== String(data || '').slice(0, 10)
        || buildStoredOrderCommercialSignature(existingLines) !== buildOrderCommercialSignature(linee);
      if (isCommercialChange) {
        const err = nextDayOrderCutoffError(data);
        await client.query('ROLLBACK');
        return res.status(err.status).json(err.payload);
      }
    }
    await client.query(
      `UPDATE ordini SET cliente_id=$1,agente_id=$2,autista_di_giro=$3,data=$4,stato=$5,
       note=$6,data_non_certa=$7,stef=$8,altro_vettore=$9,giro_override=$10,updated_at=NOW() WHERE id=$11`,
      [cliente_id, agente_id||null, autista_di_giro||null, data, stato, note, data_non_certa, stef, !!altro_vettore, String(giro_override || ''), id]
    );
    const existingLinesById = new Map(existingLines.map(row => [Number(row.id), row]));
    const keptLineIds = new Set();
    for (const l of linee) {
      const prodottoId = l.prodotto_id ? parseInt(l.prodotto_id, 10) : null;
      const prodottoNomeLibero = String(l.prodotto_nome_libero || '').trim();
      if (!prodottoId && !prodottoNomeLibero) {
        throw new Error('Ogni riga ordine deve avere un prodotto o un nome libero');
      }
      const prodottoRow = prodottoId
        ? (await client.query('SELECT id, um, cartoni_attivi, peso_medio_pezzo_kg, pezzi_per_cartone, unita_per_cartone, pedane_attive, cartoni_per_pedana FROM prodotti WHERE id=$1 LIMIT 1', [prodottoId])).rows[0]
        : null;
      const prezzoUnitario = await resolveOrderLinePrice({
        prodottoId,
        clienteId: cliente_id,
        data,
        manualPrice: l.prezzo_unitario,
        client,
      });
      const qtyBase = prodottoRow
        ? calcolaQtyBaseRiga({ qty: l.qty, unitaMisura: l.unita_misura || 'pezzi', prodotto: prodottoRow })
        : null;
      const incomingLineId = Number.parseInt(l.id, 10);
      const existingLine = Number.isFinite(incomingLineId) ? existingLinesById.get(incomingLineId) || null : null;
      const incomingMatchKey = normalizeOrderLineMatchKey({
        prodotto_id: prodottoId,
        prodotto_nome_libero: prodottoNomeLibero,
        unita_misura: l.unita_misura || 'pezzi',
      });
      const sameIdentity = existingLine && normalizeOrderLineMatchKey(existingLine) === incomingMatchKey;
      const nextPreparato = l.preparato !== undefined
        ? !!l.preparato
        : (sameIdentity ? !!existingLine?.preparato : false);
      const nextLotto = l.lotto !== undefined
        ? String(l.lotto || '').trim()
        : (sameIdentity ? String(existingLine?.lotto || '').trim() : '');
      const nextPesoEffettivo = l.peso_effettivo !== undefined
        ? (l.peso_effettivo === null || l.peso_effettivo === '' ? null : Number(l.peso_effettivo))
        : (sameIdentity ? (existingLine?.peso_effettivo ?? null) : null);
      const nextColliEffettivi = l.colli_effettivi !== undefined
        ? (l.colli_effettivi === null || l.colli_effettivi === '' ? null : Number(l.colli_effettivi))
        : (sameIdentity ? (existingLine?.colli_effettivi ?? null) : null);
      if (existingLine) {
        await client.query(
          `UPDATE ordine_linee
              SET prodotto_id=$1,
                  prodotto_nome_libero=$2,
                  qty=$3,
                  qty_base=$4,
                  prezzo_unitario=$5,
                  is_pedana=$6,
                  nota_riga=$7,
                  unita_misura=$8,
                  preparato=$9,
                  lotto=$10,
                  peso_effettivo=$11,
                  colli_effettivi=$12
            WHERE id=$13 AND ordine_id=$14`,
          [
            prodottoId,
            prodottoNomeLibero,
            l.qty,
            qtyBase,
            prezzoUnitario,
            !!l.is_pedana,
            l.nota_riga || '',
            l.unita_misura || 'pezzi',
            nextPreparato,
            nextLotto,
            nextPesoEffettivo,
            nextColliEffettivi,
            existingLine.id,
            id,
          ]
        );
        keptLineIds.add(existingLine.id);
        continue;
      }
      const inserted = await client.query(
        `INSERT INTO ordine_linee
          (ordine_id,prodotto_id,prodotto_nome_libero,qty,qty_base,prezzo_unitario,is_pedana,nota_riga,unita_misura,preparato,lotto,peso_effettivo,colli_effettivi)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING id`,
        [
          id,
          prodottoId,
          prodottoNomeLibero,
          l.qty,
          qtyBase,
          prezzoUnitario,
          !!l.is_pedana,
          l.nota_riga || '',
          l.unita_misura || 'pezzi',
          nextPreparato,
          nextLotto,
          nextPesoEffettivo,
          nextColliEffettivi,
        ]
      );
      keptLineIds.add(inserted.rows[0].id);
    }
    for (const existingLine of existingLines) {
      if (keptLineIds.has(existingLine.id)) continue;
      await client.query('DELETE FROM ordine_linee WHERE id=$1 AND ordine_id=$2', [existingLine.id, id]);
    }
    await client.query('COMMIT');
    const u = req.user;
    await logDB(u.id, `${u.nome} ${u.cognome||''}`.trim(), 'Modifica ordine', `#${id}`);
    res.json(await getOrdineCompleto(id));
  } catch(e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

app.patch('/api/ordini/:id/stato', authMiddleware, requirePermission('ordini:stato'), async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id);
    const { stato } = req.body;
    if (!stato) return res.status(400).json({ error: 'Stato mancante' });
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT id, stato FROM ordini WHERE id=$1 FOR UPDATE', [id]);
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ordine non trovato' });
    }
    const prevStato = String(rows[0].stato || '');
    if (prevStato === 'preparato' && ['sospeso', 'annullato'].includes(String(stato))) {
      await restoreOrderInventory({
        ordineId: id,
        client,
        reqUser: req.user,
        note: `Rientro merce da ordine ${stato}`,
        resetPreparation: true,
      });
    }
    await client.query('UPDATE ordini SET stato=$1,updated_at=NOW() WHERE id=$2', [stato, id]);
    await client.query('COMMIT');
    res.json({ ok: true, stato });
  } catch(e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

app.patch('/api/ordini/:ordineId/linee/:lineaId/preparazione', authMiddleware, requireRole('admin', 'magazzino'), async (req, res) => {
  const client = await pool.connect();
  try {
    const ordineId = parseInt(req.params.ordineId, 10);
    const lineaId = parseInt(req.params.lineaId, 10);
    const parsed = zPreparazioneLineaPayload.safeParse(req.body || {});
    if (!parsed.success) { client.release(); return validationError(res, parsed); }
    const payload = parsed.data;
    const { rows: lineRows } = await client.query(
      `SELECT ol.id, ol.ordine_id, p.um AS prodotto_um
         FROM ordine_linee ol
         LEFT JOIN prodotti p ON p.id = ol.prodotto_id
        WHERE ol.id=$1 AND ol.ordine_id=$2
        LIMIT 1`,
      [lineaId, ordineId]
    );
    if (!lineRows.length) { client.release(); return res.status(404).json({ error: 'Riga ordine non trovata' }); }
    const lineMeta = lineRows[0];

    const sets = ['id=id'];
    const params = [];
    let p = 1;
    if (payload.preparato !== undefined) {
      sets.push(`preparato=$${p++}`);
      params.push(!!payload.preparato);
    }
    if (payload.peso_effettivo !== undefined) {
      sets.push(`peso_effettivo=$${p++}`);
      params.push(payload.peso_effettivo === null ? null : Number(payload.peso_effettivo));
    }
    if (payload.qty_base !== undefined) {
      sets.push(`qty_base=$${p++}`);
      params.push(payload.qty_base === null ? null : Number(payload.qty_base));
      if (payload.peso_effettivo === undefined && String(lineMeta.prodotto_um || '').trim().toLowerCase() === 'kg') {
        sets.push(`peso_effettivo=$${p++}`);
        params.push(payload.qty_base === null ? null : Number(payload.qty_base));
      }
    }
    if (payload.colli_effettivi !== undefined) {
      sets.push(`colli_effettivi=$${p++}`);
      params.push(payload.colli_effettivi === null ? null : Number(payload.colli_effettivi));
    }
    if (payload.lotto !== undefined) {
      sets.push(`lotto=$${p++}`);
      params.push(String(payload.lotto || '').trim());
    }
    params.push(lineaId);
    await client.query(`UPDATE ordine_linee SET ${sets.join(', ')} WHERE id=$${p}`, params);

    const { rows: prepRows } = await client.query(
      `SELECT COUNT(*)::int AS n_tot, SUM(CASE WHEN preparato THEN 1 ELSE 0 END)::int AS n_prep
       FROM ordine_linee WHERE ordine_id=$1`,
      [ordineId]
    );
    const nTot = Number(prepRows[0]?.n_tot || 0);
    const nPrep = Number(prepRows[0]?.n_prep || 0);
    if (nTot > 0 && nPrep === nTot) {
      await client.query(`UPDATE ordini SET stato='preparazione', updated_at=NOW() WHERE id=$1 AND stato='attesa'`, [ordineId]);
    }

    // ─── Giacenza auto-scarico ──────────────────────────────────────
    let warning = null;
    const utenteName = `${req.user.nome || ''} ${req.user.cognome || ''}`.trim() || req.user.username || '';

    if (payload.preparato === true) {
      // Fetch updated line
      const { rows: updLine } = await client.query(
        'SELECT ol.prodotto_id, ol.lotto, ol.peso_effettivo, ol.qty, ol.qty_base, ol.unita_misura, p.um, p.cartoni_attivi, p.peso_medio_pezzo_kg, p.pezzi_per_cartone, p.unita_per_cartone, p.pedane_attive, p.cartoni_per_pedana FROM ordine_linee ol LEFT JOIN prodotti p ON p.id = ol.prodotto_id WHERE ol.id=$1',
        [lineaId]
      );
      if (updLine.length && updLine[0].prodotto_id) {
        const { prodotto_id, lotto } = updLine[0];
        const lottoVal = String(lotto || '').trim();
        if (lottoVal) {
          const { rows: gRows } = await client.query(
            'SELECT id, quantita FROM giacenze WHERE prodotto_id=$1 AND lotto=$2 LIMIT 1',
            [prodotto_id, lottoVal]
          );
          if (!gRows.length) {
            warning = 'LOTTO_NON_IN_GIACENZA';
          } else {
            const giac = gRows[0];
            const qtyBase = updLine[0].qty_base !== null && updLine[0].qty_base !== undefined
              ? Number(updLine[0].qty_base)
              : calcolaQtyBaseRiga({ qty: updLine[0].qty, unitaMisura: updLine[0].unita_misura, prodotto: updLine[0] });
            const scaricoQta = qtyBase;
            if (Number.isFinite(scaricoQta) && scaricoQta > 0) {
              await client.query('BEGIN');
              const nuovaQty = Number(giac.quantita) - scaricoQta;
              await client.query(
                'UPDATE giacenze SET quantita=$1, updated_at=NOW() WHERE id=$2',
                [nuovaQty, giac.id]
              );
              await client.query(
                `INSERT INTO movimenti_giacenza
                  (giacenza_id,prodotto_id,lotto,tipo,quantita,quantita_prima,quantita_dopo,ordine_id,ordine_linea_id,utente_id,utente_nome)
                 VALUES ($1,$2,$3,'scarico_ordine',$4,$5,$6,$7,$8,$9,$10)`,
                [giac.id, prodotto_id, lottoVal, -scaricoQta, Number(giac.quantita), nuovaQty, ordineId, lineaId, req.user.id || null, utenteName]
              );
              await client.query('COMMIT');
            }
          }
        }
      }
    } else if (payload.preparato === false) {
      // Undo: check if a scarico_ordine movimento exists for this line
      const { rows: movRows } = await client.query(
        `SELECT m.id, m.giacenza_id, m.prodotto_id, m.lotto, m.quantita, g.quantita as giac_qty
         FROM movimenti_giacenza m
         LEFT JOIN giacenze g ON g.id = m.giacenza_id
         WHERE m.ordine_linea_id=$1 AND m.tipo='scarico_ordine'
         ORDER BY m.id DESC LIMIT 1`,
        [lineaId]
      );
      if (movRows.length) {
        const mov = movRows[0];
        const pesoToRestore = Math.abs(Number(mov.quantita));
        if (mov.giacenza_id && Number.isFinite(pesoToRestore)) {
          await client.query('BEGIN');
          const nuovaQty = Number(mov.giac_qty || 0) + pesoToRestore;
          await client.query(
            'UPDATE giacenze SET quantita=$1, updated_at=NOW() WHERE id=$2',
            [nuovaQty, mov.giacenza_id]
          );
          await client.query(
            `INSERT INTO movimenti_giacenza
              (giacenza_id,prodotto_id,lotto,tipo,quantita,quantita_prima,quantita_dopo,ordine_id,ordine_linea_id,utente_id,utente_nome,note)
             VALUES ($1,$2,$3,'rettifica',$4,$5,$6,$7,$8,$9,$10,'Undo preparazione')`,
            [mov.giacenza_id, mov.prodotto_id, mov.lotto, pesoToRestore, Number(mov.giac_qty || 0), nuovaQty, ordineId, lineaId, req.user.id || null, utenteName]
          );
          await client.query('COMMIT');
        }
      }
    }

    client.release();
    if (warning) return res.json({ ok: true, warning });
    res.json({ ok: true });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    client.release();
    res.status(500).json({ error: e.message });
  }
});

// ─── SPLIT LINEA (doppio lotto) ──────────────────────────────────
app.delete('/api/ordini/:ordineId/linee/:lineaId', authMiddleware, requireRole('admin', 'magazzino'), async (req, res) => {
  const ordineId = parseInt(req.params.ordineId, 10);
  const lineaId = parseInt(req.params.lineaId, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: lineRows } = await client.query(
      'SELECT id, ordine_id FROM ordine_linee WHERE id=$1 AND ordine_id=$2 LIMIT 1',
      [lineaId, ordineId]
    );
    if (!lineRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Riga non trovata' });
    }
    const utenteName = `${req.user.nome || ''} ${req.user.cognome || ''}`.trim() || req.user.username || '';
    const { rows: movRows } = await client.query(
      `SELECT m.id, m.giacenza_id, m.prodotto_id, m.lotto, m.quantita, g.quantita AS giac_qty
       FROM movimenti_giacenza m
       LEFT JOIN giacenze g ON g.id = m.giacenza_id
       WHERE m.ordine_linea_id=$1 AND m.tipo='scarico_ordine'
       ORDER BY m.id DESC LIMIT 1`,
      [lineaId]
    );
    if (movRows.length) {
      const mov = movRows[0];
      const qtyRestore = Math.abs(Number(mov.quantita));
      if (mov.giacenza_id && Number.isFinite(qtyRestore) && qtyRestore > 0) {
        const nuovaQty = Number(mov.giac_qty || 0) + qtyRestore;
        await client.query('UPDATE giacenze SET quantita=$1, updated_at=NOW() WHERE id=$2', [nuovaQty, mov.giacenza_id]);
        await client.query(
          `INSERT INTO movimenti_giacenza
            (giacenza_id,prodotto_id,lotto,tipo,quantita,quantita_prima,quantita_dopo,ordine_id,ordine_linea_id,utente_id,utente_nome,note)
           VALUES ($1,$2,$3,'rettifica',$4,$5,$6,$7,$8,$9,$10,'Eliminazione riga preparazione')`,
          [mov.giacenza_id, mov.prodotto_id, mov.lotto, qtyRestore, Number(mov.giac_qty || 0), nuovaQty, ordineId, lineaId, req.user.id || null, utenteName]
        );
      }
    }
    await client.query('DELETE FROM ordine_linee WHERE id=$1 AND ordine_id=$2', [lineaId, ordineId]);
    const { rows: remRows } = await client.query('SELECT COUNT(*)::int AS n FROM ordine_linee WHERE ordine_id=$1', [ordineId]);
    const ordineAnnullato = Number(remRows[0]?.n || 0) === 0;
    if (ordineAnnullato) {
      await client.query(`UPDATE ordini SET stato='annullato', updated_at=NOW() WHERE id=$1`, [ordineId]);
    }
    await client.query('COMMIT');
    res.json({ ok: true, ordine_annullato: ordineAnnullato });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.post('/api/ordini/:ordineId/linee', authMiddleware, requireRole('admin', 'magazzino'), async (req, res) => {
  const client = await pool.connect();
  try {
    const ordineId = parseInt(req.params.ordineId, 10);
    const parsed = zOrdineLineaCreatePayload.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);
    const body = parsed.data;
    await client.query('BEGIN');
    const { rows: ordRows } = await client.query(
      `SELECT id, stato
         FROM ordini
        WHERE id = $1
        FOR UPDATE`,
      [ordineId]
    );
    if (!ordRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ordine non trovato' });
    }
    const ordine = ordRows[0];
    if (!['attesa', 'preparazione', 'preparato'].includes(String(ordine.stato || ''))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Non puoi aggiungere righe a questo ordine' });
    }
    if (!body.prodotto_id && !String(body.prodotto_nome_libero || '').trim()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Prodotto obbligatorio' });
    }
    const inserted = await client.query(
      `INSERT INTO ordine_linee
        (ordine_id,prodotto_id,prodotto_nome_libero,qty,qty_base,prezzo_unitario,is_pedana,nota_riga,unita_misura,preparato,lotto)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,FALSE,$10)
       RETURNING *`,
      [
        ordineId,
        body.prodotto_id || null,
        String(body.prodotto_nome_libero || '').trim(),
        body.qty,
        body.qty_base ?? null,
        body.prezzo_unitario ?? null,
        !!body.is_pedana,
        String(body.nota_riga || '').trim(),
        String(body.unita_misura || 'pezzi').trim() || 'pezzi',
        String(body.lotto || '').trim(),
      ]
    );
    if (String(ordine.stato || '') === 'attesa') {
      await client.query(`UPDATE ordini SET stato='preparazione', updated_at=NOW() WHERE id=$1`, [ordineId]);
    }
    await client.query('COMMIT');
    await logDB(req.user.id, `${req.user.nome} ${req.user.cognome || ''}`.trim(), 'Aggiunta riga preparazione', `ordine #${ordineId}`);
    res.json(inserted.rows[0]);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.post('/api/ordini/:ordineId/linee/:lineId/split', authMiddleware, requireRole('admin', 'magazzino'), async (req, res) => {
  const ordineId = parseInt(req.params.ordineId, 10);
  const lineId   = parseInt(req.params.lineId,   10);
  const qtySplit = Number(req.body?.qty_split || 1);
  if (!Number.isFinite(qtySplit) || qtySplit <= 0)
    return res.status(400).json({ error: 'qty_split non valido' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM ordine_linee WHERE id=$1 AND ordine_id=$2 LIMIT 1',
      [lineId, ordineId]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Riga non trovata' });
    }
    const line    = rows[0];
    const origQty = Number(line.qty);
    if (qtySplit >= origQty) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `qty_split (${qtySplit}) deve essere < qty originale (${origQty})` });
    }
    const origQtyBase = line.qty_base !== null && line.qty_base !== undefined ? Number(line.qty_base) : null;
    const qtyBasePerUnit = Number.isFinite(origQtyBase) && origQty > 0 ? origQtyBase / origQty : null;
    await client.query('UPDATE ordine_linee SET qty=$1, qty_base=$2 WHERE id=$3', [origQty - qtySplit, Number.isFinite(qtyBasePerUnit) ? (origQty - qtySplit) * qtyBasePerUnit : null, lineId]);
    const ins = await client.query(
      `INSERT INTO ordine_linee
         (ordine_id,prodotto_id,prodotto_nome_libero,qty,qty_base,prezzo_unitario,is_pedana,nota_riga,unita_misura,preparato,lotto)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,FALSE,'') RETURNING id`,
      [ordineId, line.prodotto_id, line.prodotto_nome_libero || '', qtySplit,
       Number.isFinite(qtyBasePerUnit) ? qtySplit * qtyBasePerUnit : null, line.prezzo_unitario, !!line.is_pedana, line.nota_riga || '', line.unita_misura || 'pezzi']
    );
    await client.query('COMMIT');
    res.json({ ok: true, new_linea_id: ins.rows[0].id });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ─── AUTO-ESPANDI PEDANE (qty > 1 → N righe da qty=1) ────────────
app.post('/api/ordini/:ordineId/auto-espandi-pedane', authMiddleware, requireRole('admin', 'magazzino'), async (req, res) => {
  const ordineId = parseInt(req.params.ordineId, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: linee } = await client.query(
      'SELECT * FROM ordine_linee WHERE ordine_id=$1 AND is_pedana=TRUE AND qty > 1 ORDER BY id',
      [ordineId]
    );
    let nuoveLinee = 0;
    for (const line of linee) {
      const qty = Number(line.qty);
      if (qty <= 1) continue;
      await client.query('UPDATE ordine_linee SET qty=1 WHERE id=$1', [line.id]);
      for (let i = 1; i < qty; i++) {
        await client.query(
          `INSERT INTO ordine_linee
             (ordine_id,prodotto_id,prodotto_nome_libero,qty,qty_base,prezzo_unitario,is_pedana,nota_riga,unita_misura,preparato,lotto)
           VALUES ($1,$2,$3,1,$4,$5,TRUE,$6,$7,FALSE,'')`,
          [ordineId, line.prodotto_id, line.prodotto_nome_libero || '',
           line.qty_base !== null && line.qty_base !== undefined && qty > 0 ? Number(line.qty_base) / qty : null, line.prezzo_unitario, line.nota_riga || '', line.unita_misura || 'pezzi']
        );
        nuoveLinee++;
      }
    }
    await client.query('COMMIT');
    res.json({ ok: true, expanded: linee.length, nuove_linee: nuoveLinee });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

async function createResidualOrderFromMissingLines({ ordine, missingLinee, reqUser, noteSuffix = '', client }) {
  const effectiveGiro = String(ordine.giro_effettivo || ordine.giro_override || ordine.cliente_giro || '').trim();
  const nextDate = await getNextDeliveryDate(effectiveGiro, ordine.data);
  const ins = await client.query(
    `INSERT INTO ordini (cliente_id,agente_id,autista_di_giro,inserted_by,data,stato,note,data_non_certa,stef,altro_vettore,giro_override,inserted_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,'attesa',$6,$7,$8,$9,$10,NOW(),NOW()) RETURNING id`,
    [
      ordine.cliente_id,
      ordine.agente_id || null,
      ordine.autista_di_giro || null,
      reqUser.id || null,
      nextDate,
      `[RIPORTO MAGAZZINO da #${ordine.id}] ${noteSuffix}`.trim(),
      !!ordine.data_non_certa,
      !!ordine.stef,
      !!ordine.altro_vettore,
      String(ordine.giro_override || ''),
    ]
  );
  const newOrdineId = ins.rows[0].id;
  for (const l of missingLinee) {
    await client.query(
      `INSERT INTO ordine_linee (ordine_id,prodotto_id,prodotto_nome_libero,qty,qty_base,prezzo_unitario,peso_effettivo,is_pedana,nota_riga,unita_misura,preparato,lotto)
       VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,FALSE,$10)`,
      [
        newOrdineId,
        l.prodotto_id || null,
        l.prodotto_nome_libero || '',
        l.qty,
        l.qty_base ?? null,
        l.prezzo_unitario,
        !!l.is_pedana,
        l.nota_riga || '',
        l.unita_misura || 'pezzi',
        l.lotto || '',
      ]
    );
  }
  return { newOrdineId, nextDate };
}

app.post('/api/magazzino/giornata/annulla', authMiddleware, requireRole('admin', 'magazzino'), async (req, res) => {
  const { data, giro, password } = req.body || {};
  if (!data || !password) return res.status(400).json({ error: 'data e password obbligatori' });
  const { rows: userRows } = await q('SELECT password FROM utenti WHERE id=$1', [req.user.id]);
  if (!userRows.length) return res.status(401).json({ error: 'Utente non trovato' });
  const ok = await bcrypt.compare(String(password), userRows[0].password);
  if (!ok) return res.status(401).json({ error: 'Password errata' });
  const giroVal = String(giro || '').trim();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const del = await client.query(
      `DELETE FROM magazzino_chiusure_giornata WHERE data=$1 AND giro=$2 RETURNING id`,
      [data, giroVal]
    );
    if (!del.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Nessuna chiusura trovata per questa data/giro' });
    }
    // Ripristina ordini preparato → preparazione
    const params = [data];
    let pi = 2;
    let giroWhere = '';
    if (giroVal) { params.push(giroVal); giroWhere = `AND COALESCE(NULLIF(o.giro_override,''), c.giro, '') = $${pi++}`; }
    await client.query(
      `UPDATE ordini o SET stato='preparazione', updated_at=NOW()
       FROM clienti c WHERE o.cliente_id = c.id AND o.data = $1 AND o.stato = 'preparato' ${giroWhere}`,
      params
    );
    await client.query('COMMIT');
    await logDB(req.user.id, `${req.user.nome} ${req.user.cognome || ''}`.trim(), 'Annullamento chiusura giornata', `${data}${giroVal ? ` (${giroVal})` : ''}`);
    res.json({ ok: true });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

app.post('/api/magazzino/giornata/chiudi', authMiddleware, requireRole('admin', 'magazzino'), async (req, res) => {
  const client = await pool.connect();
  try {
    const parsed = zChiudiGiornataPayload.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);
    const { data, giro, action_if_incomplete, action_if_residual } = parsed.data;

    // Blocca se la giornata è già stata confermata
    const giroVal = String(giro || '').trim();
    const { rows: esistente } = await client.query(
      `SELECT confermata_nome, confermata_at FROM magazzino_chiusure_giornata
       WHERE data=$1 AND giro=$2 ORDER BY id DESC LIMIT 1`,
      [data, giroVal]
    );
    if (esistente.length) {
      return res.status(409).json({
        code: 'GIORNATA_GIA_CONFERMATA',
        message: `Giornata già confermata da ${esistente[0].confermata_nome}`,
        confermata_nome: esistente[0].confermata_nome,
        confermata_at: esistente[0].confermata_at,
      });
    }

    const ordini = await listOrdiniApertiByDateGiro({ data, giro, client });
    if (!ordini.length) {
      return res.status(400).json({ error: 'Nessun ordine trovato per la selezione' });
    }
    const ids = ordini.map(o => o.id);
    const { rows: linee } = await client.query(
      `SELECT ol.id, ol.ordine_id, ol.prodotto_id, ol.prodotto_nome_libero, COALESCE(p.nome, ol.prodotto_nome_libero, '') AS prodotto_nome,
              ol.qty, ol.qty_base, ol.colli_effettivi, ol.peso_effettivo, ol.prezzo_unitario, ol.is_pedana, ol.nota_riga, ol.unita_misura, ol.preparato, ol.lotto
       FROM ordine_linee ol
       LEFT JOIN prodotti p ON p.id = ol.prodotto_id
       WHERE ol.ordine_id = ANY($1)
       ORDER BY ol.ordine_id, ol.id`,
      [ids]
    );
    const lineeByOrder = {};
    linee.forEach(l => {
      if (!lineeByOrder[l.ordine_id]) lineeByOrder[l.ordine_id] = [];
      lineeByOrder[l.ordine_id].push(l);
    });

    const missing = [];
    ordini.forEach(o => {
      const nonPrep = (lineeByOrder[o.id] || []).filter(l => !l.preparato);
      if (nonPrep.length) {
        missing.push({
          ordine_id: o.id,
          cliente_id: o.cliente_id,
          cliente: o.cliente_nome || '',
          trigger: 'linee_non_preparate',
          trigger_count: nonPrep.length,
          mancanti: nonPrep.map(buildResidualLineSnapshot),
        });
      }
    });

    if (missing.length && action_if_incomplete !== 'continue') {
      return res.status(409).json({
        code: 'GIORNATA_INCOMPLETA',
        message: 'Attenzione: alcuni ordini/prodotti non risultano preparati',
        missing,
      });
    }

    if (missing.length && !action_if_residual) {
      return res.status(409).json({
        code: 'RESIDUAL_ACTION_REQUIRED',
        message: 'Seleziona come gestire i prodotti non preparati: ricarica o cancella.',
        missing,
      });
    }

    await client.query('BEGIN');
    const reloaded = [];
    const deleted = [];
    const residualLogs = [];
    for (const o of ordini) {
      const righe = lineeByOrder[o.id] || [];
      const mancanti = righe.filter(l => !l.preparato);
      if (!mancanti.length) {
        await client.query(`UPDATE ordini SET stato='preparato', updated_at=NOW() WHERE id=$1`, [o.id]);
        continue;
      }
      if (action_if_residual === 'reload') {
        const created = await createResidualOrderFromMissingLines({
          ordine: o,
          missingLinee: mancanti,
          reqUser: req.user,
          noteSuffix: 'riporto da chiusura giornata',
          client,
        });
        const residualReasonLines = mancanti.map(buildResidualTriggerText);
        reloaded.push({
          ordine_id: o.id,
          cliente_id: o.cliente_id,
          cliente: o.cliente_nome || '',
          new_order_id: created.newOrdineId,
          next_date: created.nextDate,
          reason_code: 'linee_non_preparate',
          reason_summary: `${mancanti.length} riga/e non preparata/e`,
          reason_lines: residualReasonLines,
          missing_lines: mancanti.map(buildResidualLineSnapshot),
        });
        residualLogs.push({
          ordine_id: o.id,
          cliente: o.cliente_nome || `Cliente #${o.cliente_id}`,
          new_order_id: created.newOrdineId,
          next_date: created.nextDate,
          residualReasonLines,
        });
        await client.query(
          `UPDATE ordini
           SET stato='preparato',
               note=TRIM(BOTH ' ' FROM COALESCE(note,'') || ' [CHIUSURA GIORNATA: residuo su #' || $1 || ']'),
               updated_at=NOW()
           WHERE id=$2`,
          [created.newOrdineId, o.id]
        );
      } else {
        await client.query(`UPDATE ordini SET stato='annullato', updated_at=NOW() WHERE id=$1`, [o.id]);
        deleted.push(o.id);
      }
    }

    await client.query(
      `INSERT INTO magazzino_chiusure_giornata (data,giro,confermata_da,confermata_nome,esito,dettagli)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        data,
        giroVal,
        req.user.id || null,
        `${req.user.nome} ${req.user.cognome || ''}`.trim(),
        missing.length ? 'con_residui' : 'ok',
        JSON.stringify({ missing_count: missing.length, action_if_residual: action_if_residual || null, reloaded, deleted }),
      ]
    );
    await client.query('COMMIT');
    await logDB(req.user.id, `${req.user.nome} ${req.user.cognome || ''}`.trim(), 'Chiusura giornata magazzino', `${data}${giroVal ? ` (${giroVal})` : ''}`);
    for (const item of residualLogs) {
      await logDB(
        req.user.id,
        `${req.user.nome} ${req.user.cognome || ''}`.trim(),
        'Residuo ordine generato',
        `Ordine #${item.ordine_id} (${item.cliente}) -> #${item.new_order_id} del ${item.next_date}. Motivo: ${item.residualReasonLines.join(' | ')}`
      );
    }
    res.json({ ok: true, missing_count: missing.length, reloaded, deleted });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.get('/api/chiusure-giornata/summary', authMiddleware, async (req, res) => {
  try {
    const data = String(req.query?.data || '').trim();
    if (!data) return res.status(400).json({ error: 'data obbligatoria' });
    const summary = await buildDailyClosureSummary({ data });
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/giro/giornata/annulla', authMiddleware, requireRole('admin', 'autista'), async (req, res) => {
  const { data, giro = '', password, autista_id = null } = req.body || {};
  if (!data || !password) return res.status(400).json({ error: 'data e password obbligatori' });
  const { rows: userRows } = await q('SELECT password FROM utenti WHERE id=$1', [req.user.id]);
  if (!userRows.length) return res.status(401).json({ error: 'Utente non trovato' });
  const ok = await bcrypt.compare(String(password), userRows[0].password);
  if (!ok) return res.status(401).json({ error: 'Password errata' });
  const giroVal = String(giro || '').trim();
  const autistaId = req.user.ruolo === 'autista' ? req.user.id : (autista_id ? parseInt(autista_id, 10) : null);
  if (!autistaId) return res.status(400).json({ error: 'autista non specificato' });
  const { rows } = await q(
    `DELETE FROM giro_chiusure_giornata
     WHERE data=$1 AND giro=$2 AND autista_id=$3
     RETURNING id`,
    [data, giroVal, autistaId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Nessuna chiusura giro trovata' });
  await logDB(req.user.id, `${req.user.nome} ${req.user.cognome || ''}`.trim(), 'Annullamento chiusura giro', `${data}${giroVal ? ` (${giroVal})` : ''}`);
  res.json({ ok: true });
});

app.post('/api/giro/giornata/chiudi', authMiddleware, requireRole('admin', 'autista'), async (req, res) => {
  try {
    const data = String(req.body?.data || '').trim();
    const giro = String(req.body?.giro || '').trim();
    const autistaId = req.user.ruolo === 'autista' ? req.user.id : (req.body?.autista_id ? parseInt(req.body.autista_id, 10) : null);
    if (!data) return res.status(400).json({ error: 'data obbligatoria' });
    if (!autistaId) return res.status(400).json({ error: 'autista obbligatorio' });

    const { rows: existing } = await q(
      `SELECT confermata_nome, confermata_at
       FROM giro_chiusure_giornata
       WHERE data=$1 AND giro=$2 AND autista_id=$3
       ORDER BY id DESC LIMIT 1`,
      [data, giro, autistaId]
    );
    if (existing.length) {
      return res.status(409).json({
        code: 'GIRO_GIA_CONFERMATO',
        message: `Giro già confermato da ${existing[0].confermata_nome}`,
        confermata_nome: existing[0].confermata_nome,
        confermata_at: existing[0].confermata_at,
      });
    }

    const params = [data, autistaId];
    let giroWhere = '';
    if (giro) {
      params.push(giro);
      giroWhere = `AND COALESCE(NULLIF(o.giro_override,''), c.giro, '') = $3`;
    }
    const { rows: orders } = await q(
      `SELECT o.id, o.stato, COALESCE(NULLIF(o.giro_override,''), c.giro, '') AS giro_effettivo, c.nome AS cliente_nome
       FROM ordini o
       JOIN clienti c ON c.id = o.cliente_id
       WHERE o.data = $1 AND o.autista_di_giro = $2 ${giroWhere}
       ORDER BY o.id`,
      params
    );
    if (!orders.length) return res.status(400).json({ error: 'Nessun ordine assegnato per la selezione' });
    const aperti = orders.filter(o => ['attesa', 'preparazione', 'preparato'].includes(String(o.stato || '')));
    if (aperti.length) {
      return res.status(409).json({
        code: 'GIRO_NON_CHIUDIBILE',
        message: 'Restano ordini senza esito consegna',
        pending: aperti.map(o => ({ id: o.id, cliente: o.cliente_nome, stato: o.stato })),
      });
    }

    const counts = orders.reduce((acc, row) => {
      acc[row.stato] = (acc[row.stato] || 0) + 1;
      return acc;
    }, {});
    const { rows: userData } = await q('SELECT nome, cognome FROM utenti WHERE id=$1', [autistaId]);
    const autistaNome = `${userData[0]?.nome || ''} ${userData[0]?.cognome || ''}`.trim() || `Autista #${autistaId}`;
    await q(
      `INSERT INTO giro_chiusure_giornata (data,giro,autista_id,autista_nome,confermata_da,confermata_nome,esito,dettagli)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [
        data,
        giro,
        autistaId,
        autistaNome,
        req.user.id || null,
        `${req.user.nome} ${req.user.cognome || ''}`.trim(),
        'ok',
        JSON.stringify({ counts, pending_count: 0, critical_count: (counts.sospeso || 0) + (counts.annullato || 0) }),
      ]
    );
    await logDB(req.user.id, `${req.user.nome} ${req.user.cognome || ''}`.trim(), 'Chiusura giornata giro', `${data}${giro ? ` (${giro})` : ''} - ${autistaNome}`);
    res.json({ ok: true, counts });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/azienda/giornata/annulla', authMiddleware, requireRole('admin', 'direzione'), async (req, res) => {
  const { data, password } = req.body || {};
  if (!data || !password) return res.status(400).json({ error: 'data e password obbligatori' });
  const { rows: userRows } = await q('SELECT password FROM utenti WHERE id=$1', [req.user.id]);
  if (!userRows.length) return res.status(401).json({ error: 'Utente non trovato' });
  const ok = await bcrypt.compare(String(password), userRows[0].password);
  if (!ok) return res.status(401).json({ error: 'Password errata' });
  const { rows } = await q(`DELETE FROM azienda_chiusure_giornata WHERE data=$1 RETURNING id`, [data]);
  if (!rows.length) return res.status(404).json({ error: 'Nessuna chiusura azienda trovata' });
  await logDB(req.user.id, `${req.user.nome} ${req.user.cognome || ''}`.trim(), 'Annullamento chiusura azienda', data);
  res.json({ ok: true });
});

app.post('/api/azienda/giornata/chiudi', authMiddleware, requireRole('admin', 'direzione'), async (req, res) => {
  try {
    const data = String(req.body?.data || '').trim();
    if (!data) return res.status(400).json({ error: 'data obbligatoria' });
    const summary = await buildDailyClosureSummary({ data });
    if (summary.azienda.closed) {
      return res.status(409).json({
        code: 'AZIENDA_GIA_CONFERMATA',
        confermata_nome: summary.azienda.item?.confermata_nome || '',
        confermata_at: summary.azienda.item?.confermata_at || null,
      });
    }
    if (!summary.magazzino.closed) {
      return res.status(409).json({ code: 'MAGAZZINO_NON_CHIUSO', message: 'Manca la chiusura giornata magazzino' });
    }
    if (summary.orders.open > 0) {
      return res.status(409).json({ code: 'ORDINI_APERTI', message: 'Restano ordini senza esito finale', open_count: summary.orders.open });
    }
    if (summary.giro.pending.length) {
      return res.status(409).json({
        code: 'GIRI_NON_CHIUSI',
        message: 'Non tutti i giri risultano chiusi',
        pending: summary.giro.pending,
      });
    }
    await q(
      `INSERT INTO azienda_chiusure_giornata (data,confermata_da,confermata_nome,esito,dettagli)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [
        data,
        req.user.id || null,
        `${req.user.nome} ${req.user.cognome || ''}`.trim(),
        'ok',
        JSON.stringify({
          magazzino_closures: summary.magazzino.count,
          giro_closures: summary.giro.closed_count,
          status_counts: summary.orders.counts,
          critical_count: (summary.orders.counts.sospeso || 0) + (summary.orders.counts.annullato || 0),
        }),
      ]
    );
    await logDB(req.user.id, `${req.user.nome} ${req.user.cognome || ''}`.trim(), 'Chiusura giornata azienda', data);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/ordini/:id/esito-consegna', authMiddleware, requirePermission('ordini:stato'), async (req, res) => {
  const client = await pool.connect();
  try {
    const ordineId = parseInt(req.params.id, 10);
    const outcome = String(req.body?.outcome || '').trim().toLowerCase();
    const note = String(req.body?.note || '').trim();
    const deliveredMap = req.body?.delivered || {};
    const preferredDate = String(req.body?.preferred_date || '').trim() || null;
    const failedStatus = String(req.body?.failed_status || '').trim().toLowerCase();
    if (!['delivered', 'partial', 'failed'].includes(outcome)) {
      return res.status(400).json({ error: 'Esito consegna non valido' });
    }
    if (outcome === 'failed' && !['sospeso', 'annullato'].includes(failedStatus)) {
      return res.status(400).json({ error: 'Stato finale non valido per consegna non riuscita' });
    }

    await client.query('BEGIN');
    const { rows: ordRows } = await client.query('SELECT * FROM ordini WHERE id=$1 FOR UPDATE', [ordineId]);
    if (!ordRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ordine non trovato' });
    }
    const ordine = ordRows[0];
    const { rows: clienteRows } = await client.query(
      'SELECT id, nome, classificazione, giro FROM clienti WHERE id=$1 LIMIT 1',
      [ordine.cliente_id]
    );
    const clienteOrdine = clienteRows[0] || null;
    const isTentataTecnica = isTentataVenditaClienteRecord(clienteOrdine);
    if (String(ordine.stato || '') !== 'preparato') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'L\'ordine deve essere in stato preparato per registrare l\'esito consegna' });
    }
    const { rows: linee } = await client.query('SELECT * FROM ordine_linee WHERE ordine_id=$1 ORDER BY id', [ordineId]);
    if (!linee.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Ordine senza righe' });
    }

    if (outcome === 'delivered') {
      await client.query(
        `UPDATE ordini
            SET stato='consegnato',
                note=CASE WHEN $1 <> '' THEN TRIM(BOTH ' ' FROM COALESCE(note,'') || ' [NOTE CONSEGNA: ' || $1 || ']') ELSE note END,
                updated_at=NOW()
          WHERE id=$2`,
        [note, ordineId]
      );
      await client.query('COMMIT');
      await logDB(req.user.id, `${req.user.nome} ${req.user.cognome || ''}`.trim(), 'Esito consegna', `ordine #${ordineId} consegnato${note ? ` | ${note}` : ''}`);
      return res.json({ ok: true, stato: 'consegnato' });
    }

    if (outcome === 'failed') {
      await restoreOrderInventory({
        ordineId,
        client,
        reqUser: req.user,
        note: `Rientro merce da ordine ${failedStatus}${note ? ` | ${note}` : ''}`,
        resetPreparation: true,
      });
      await client.query(
        `UPDATE ordini
            SET stato=$1,
                note=CASE WHEN $2 <> '' THEN TRIM(BOTH ' ' FROM COALESCE(note,'') || ' [ESITO CONSEGNA: ' || $2 || ']') ELSE note END,
                updated_at=NOW()
          WHERE id=$3`,
        [failedStatus, note, ordineId]
      );
      await client.query('COMMIT');
      await logDB(req.user.id, `${req.user.nome} ${req.user.cognome || ''}`.trim(), 'Esito consegna', `ordine #${ordineId} -> ${failedStatus}${note ? ` | ${note}` : ''}`);
      return res.json({ ok: true, stato: failedStatus });
    }

    const residuali = [];
    const restoreRatios = {};
    for (const l of linee) {
      const key = String(l.id);
      const qty = Number(l.qty || 0);
      const consegnata = Math.max(0, Math.min(qty, Number(deliveredMap[key] ?? qty)));
      const residuo = qty - consegnata;
      if (residuo > 0) {
        restoreRatios[l.id] = qty > 0 ? (residuo / qty) : 0;
        residuali.push({
          prodotto_id: l.prodotto_id,
          prodotto_nome_libero: l.prodotto_nome_libero || '',
          qty: residuo,
          qty_base: l.qty_base !== null && l.qty_base !== undefined && qty > 0 ? (Number(l.qty_base) * (residuo / qty)) : null,
          is_pedana: !!l.is_pedana,
          nota_riga: l.nota_riga || '',
          unita_misura: l.unita_misura || 'pezzi',
          prezzo_unitario: l.prezzo_unitario,
          lotto: l.lotto || '',
        });
      }
    }
    if (!residuali.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Nessun residuo da riportare: usa consegna completa' });
    }

    await restoreOrderInventory({
      ordineId,
      client,
      reqUser: req.user,
      note: `Rientro merce da consegna parziale${note ? ` | ${note}` : ''}`,
      restoreRatios,
      resetPreparation: false,
    });

    const giro = clienteOrdine?.giro || '';
    const autoNextData = await getNextDeliveryDate(giro, ordine.data);
    const nextData = preferredDate && preferredDate >= autoNextData ? preferredDate : autoNextData;
    if (isTentataTecnica) {
      await client.query(
        `UPDATE ordini
            SET stato='consegnato',
                note=TRIM(BOTH ' ' FROM COALESCE(note,'') || CASE
                  WHEN $1 <> '' THEN ' [NOTE CONSEGNA: ' || $1 || ']'
                  ELSE ''
                END || ' [TENTATA VENDITA: nessun riporto automatico generato]'),
                updated_at=NOW()
          WHERE id=$2`,
        [note, ordineId]
      );
      await client.query('COMMIT');
      await logDB(req.user.id, `${req.user.nome} ${req.user.cognome || ''}`.trim(), 'Esito consegna', `ordine #${ordineId} parziale tentata vendita senza riporto${note ? ` | ${note}` : ''}`);
      return res.json({ ok: true, stato: 'consegnato', skipped_residual_order: true, next_date: nextData });
    }
    const ins = await client.query(
      `INSERT INTO ordini (cliente_id,agente_id,autista_di_giro,inserted_by,data,stato,note,data_non_certa,stef,altro_vettore,giro_override,inserted_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,'attesa',$6,$7,$8,$9,$10,NOW(),NOW()) RETURNING id`,
      [
        ordine.cliente_id,
        ordine.agente_id || null,
        ordine.autista_di_giro || null,
        req.user.id || null,
        nextData,
        `[RIPORTO PARZIALE da #${ordineId}] ${note}`.trim(),
        !!ordine.data_non_certa,
        !!ordine.stef,
        !!ordine.altro_vettore,
        String(ordine.giro_override || ''),
      ]
    );
    const newOrdineId = ins.rows[0].id;
    for (const r of residuali) {
      await client.query(
        `INSERT INTO ordine_linee (ordine_id,prodotto_id,prodotto_nome_libero,qty,qty_base,prezzo_unitario,is_pedana,nota_riga,unita_misura,preparato,lotto)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,FALSE,$10)`,
        [newOrdineId, r.prodotto_id, r.prodotto_nome_libero || '', r.qty, r.qty_base ?? null, r.prezzo_unitario, r.is_pedana, r.nota_riga, r.unita_misura, r.lotto || '']
      );
    }
    await client.query(
      `UPDATE ordini
          SET stato='consegnato',
              note=TRIM(BOTH ' ' FROM COALESCE(note,'') || ' [PARZIALE: residuo su #' || $1 || ']'
                || CASE WHEN $2 <> '' THEN ' [NOTE CONSEGNA: ' || $2 || ']' ELSE '' END),
              updated_at=NOW()
        WHERE id=$3`,
      [newOrdineId, note, ordineId]
    );
    await client.query('COMMIT');
    await logDB(req.user.id, `${req.user.nome} ${req.user.cognome || ''}`.trim(), 'Esito consegna', `ordine #${ordineId} parziale -> riporto #${newOrdineId}${note ? ` | ${note}` : ''}`);
    res.json({ ok: true, stato: 'consegnato', new_order_id: newOrdineId, next_date: nextData });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

app.post('/api/ordini/:id/consegna-parziale', authMiddleware, requirePermission('ordini:stato'), async (req, res) => {
  const client = await pool.connect();
  try {
    const ordineId = parseInt(req.params.id);
    const parsed = zConsegnaParzialePayload.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);
    const deliveredMap = parsed.data.delivered || {};
    const note = String(parsed.data.note || '').trim();
    const preferredDate = parsed.data.preferred_date || null;

    await client.query('BEGIN');
    const { rows: ordRows } = await client.query('SELECT * FROM ordini WHERE id=$1 FOR UPDATE', [ordineId]);
    if (!ordRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ordine non trovato' });
    }
    const ordine = ordRows[0];
    const { rows: clienteRows } = await client.query(
      'SELECT id, nome, classificazione, giro FROM clienti WHERE id=$1 LIMIT 1',
      [ordine.cliente_id]
    );
    const clienteOrdine = clienteRows[0] || null;
    const isTentataTecnica = isTentataVenditaClienteRecord(clienteOrdine);
    const { rows: linee } = await client.query('SELECT * FROM ordine_linee WHERE ordine_id=$1 ORDER BY id', [ordineId]);
    if (!linee.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Ordine senza righe' });
    }

    const residuali = [];
    for (const l of linee) {
      const key = String(l.id);
      const consegnata = Math.max(0, Math.min(Number(l.qty), Number(deliveredMap[key] ?? l.qty)));
      const residuo = Number(l.qty) - consegnata;
      if (residuo > 0) {
        residuali.push({
          prodotto_id: l.prodotto_id,
          prodotto_nome_libero: l.prodotto_nome_libero || '',
          qty: residuo,
          is_pedana: !!l.is_pedana,
          nota_riga: l.nota_riga || '',
          unita_misura: l.unita_misura || 'pezzi',
          prezzo_unitario: l.prezzo_unitario,
          lotto: l.lotto || '',
        });
      }
    }
    if (!residuali.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Nessun residuo da riportare: usa consegna completa' });
    }

    const giro = clienteOrdine?.giro || '';
    const autoNextData = await getNextDeliveryDate(giro, ordine.data);
    const nextData = preferredDate && preferredDate >= autoNextData ? preferredDate : autoNextData;
    if (isTentataTecnica) {
      await client.query(
        `UPDATE ordini
            SET stato='consegnato',
                note=TRIM(BOTH ' ' FROM COALESCE(note,'') || ' [TENTATA VENDITA: nessun riporto automatico generato]'),
                updated_at=NOW()
          WHERE id=$1`,
        [ordineId]
      );
      await client.query('COMMIT');
      const u = req.user;
      await logDB(u.id, `${u.nome} ${u.cognome||''}`.trim(), 'Consegna parziale', `ordine #${ordineId} tentata vendita senza riporto`);
      return res.json({ ok: true, skipped_residual_order: true, next_date: nextData });
    }

    const ins = await client.query(
      `INSERT INTO ordini (cliente_id,agente_id,autista_di_giro,inserted_by,data,stato,note,data_non_certa,stef,altro_vettore,giro_override,inserted_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,'attesa',$6,$7,$8,$9,$10,NOW(),NOW()) RETURNING id`,
      [
        ordine.cliente_id,
        ordine.agente_id || null,
        ordine.autista_di_giro || null,
        req.user.id || null,
        nextData,
        `[RIPORTO PARZIALE da #${ordineId}] ${note}`.trim(),
        !!ordine.data_non_certa,
        !!ordine.stef,
        !!ordine.altro_vettore,
        String(ordine.giro_override || ''),
      ]
    );
    const newOrdineId = ins.rows[0].id;
    for (const r of residuali) {
      await client.query(
        `INSERT INTO ordine_linee (ordine_id,prodotto_id,prodotto_nome_libero,qty,qty_base,prezzo_unitario,is_pedana,nota_riga,unita_misura,preparato,lotto)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,FALSE,$10)`,
        [newOrdineId, r.prodotto_id, r.prodotto_nome_libero || '', r.qty, r.qty_base ?? null, r.prezzo_unitario, r.is_pedana, r.nota_riga, r.unita_misura, r.lotto || '']
      );
    }

    await client.query(
      `UPDATE ordini SET stato='consegnato', note=TRIM(BOTH ' ' FROM COALESCE(note,'') || ' [PARZIALE: residuo su #' || $1 || ']'), updated_at=NOW() WHERE id=$2`,
      [newOrdineId, ordineId]
    );
    await client.query('COMMIT');
    const u = req.user;
    await logDB(u.id, `${u.nome} ${u.cognome||''}`.trim(), 'Consegna parziale', `ordine #${ordineId} -> riporto #${newOrdineId}`);
    res.json({ ok: true, new_order_id: newOrdineId, next_date: nextData });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

app.delete('/api/ordini/:id', authMiddleware, requirePermission('ordini:delete'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const row = await q(`SELECT o.id, c.nome as cn FROM ordini o JOIN clienti c ON o.cliente_id=c.id WHERE o.id=$1`, [id]);
    await q('DELETE FROM ordini WHERE id=$1', [id]);
    const u = req.user;
    await logDB(u.id, `${u.nome} ${u.cognome||''}`.trim(), 'Eliminazione ordine', `#${id} ${row.rows[0]?.cn||''}`);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── CAMIONS / PIANO DI CARICO ────────────────────────────────────
app.get('/api/camions', authMiddleware, requireRole('admin','autista','magazzino'), async (req, res) => {
  try {
    const pianoData = String(req.query.data || '').match(/^\d{4}-\d{2}-\d{2}$/) ? String(req.query.data) : new Date().toISOString().slice(0, 10);
    const { rows: camions } = await q('SELECT * FROM camions ORDER BY id');
    for (const c of camions) {
      const { rows: pedane } = await q('SELECT numero, nota FROM pedane WHERE camion_id=$1 AND piano_data=$2 ORDER BY numero', [c.id, pianoData]);
      if (!pedane.length) {
        const templateRows = await q('SELECT num_pedane FROM camions WHERE id=$1', [c.id]);
        const n = Number(templateRows.rows[0]?.num_pedane || 0);
        if (n > 0) {
          for (let i = 1; i <= n; i++) {
            await q(
              `INSERT INTO pedane (camion_id,piano_data,numero,nota)
               VALUES ($1,$2,$3,'')
               ON CONFLICT (camion_id,piano_data,numero) DO NOTHING`,
              [c.id, pianoData, i]
            );
          }
          const seeded = await q('SELECT numero, nota FROM pedane WHERE camion_id=$1 AND piano_data=$2 ORDER BY numero', [c.id, pianoData]);
          c.pedane = seeded.rows;
        } else {
          c.pedane = [];
        }
      } else {
        c.pedane = pedane;
      }
      c.piano_data = pianoData;
    }
    res.json(camions);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/scorte', authMiddleware, requirePermission('scorte:view'), async (req, res) => {
  try {
    const includeRipristinate = String(req.query.include_ripristinate || '') === '1';
    const where = includeRipristinate ? '' : `WHERE s.stato='attiva'`;
    const { rows } = await q(
      `SELECT s.*,
              p.codice AS prodotto_codice,
              p.nome   AS prodotto_nome_ref
       FROM scorte_magazzino s
       LEFT JOIN prodotti p ON p.id = s.prodotto_id
       ${where}
       ORDER BY
         CASE WHEN s.stato='attiva' THEN 0 ELSE 1 END,
         s.updated_at DESC,
         s.id DESC`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/scorte', authMiddleware, requirePermission('scorte:manage'), async (req, res) => {
  try {
    const parsed = zScortaPayload.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);
    const b = parsed.data;
    const prodottoId = b.prodotto_id ? Number(b.prodotto_id) : null;
    const prodottoNome = String(b.prodotto_nome || '').trim();
    const unita = String(b.unita_misura || '').trim();
    const note = String(b.note || '').trim();
    const { rows } = await q(
      `INSERT INTO scorte_magazzino
       (prodotto_id,prodotto_nome,quantita_rimanente,unita_misura,kg_stimati,note,stato,created_by,updated_by,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'attiva',$7,$8,NOW(),NOW())
       RETURNING *`,
      [prodottoId, prodottoNome, Number(b.quantita_rimanente || 0), unita, b.kg_stimati ?? null, note, req.user.id || null, req.user.id || null]
    );
    await logDB(req.user.id, `${req.user.nome} ${req.user.cognome || ''}`.trim(), 'Scorte magazzino', `Nuova soglia: ${prodottoNome}`);
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/scorte/:id', authMiddleware, requirePermission('scorte:manage'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const parsed = zScortaPayload.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);
    const b = parsed.data;
    const { rows } = await q(
      `UPDATE scorte_magazzino
       SET prodotto_id=$1,
           prodotto_nome=$2,
           quantita_rimanente=$3,
           unita_misura=$4,
           kg_stimati=$5,
           note=$6,
           stato='attiva',
           ripristinata_at=NULL,
           updated_by=$7,
           updated_at=NOW()
       WHERE id=$8
       RETURNING *`,
      [
        b.prodotto_id ? Number(b.prodotto_id) : null,
        String(b.prodotto_nome || '').trim(),
        Number(b.quantita_rimanente || 0),
        String(b.unita_misura || '').trim(),
        b.kg_stimati ?? null,
        String(b.note || '').trim(),
        req.user.id || null,
        id,
      ]
    );
    if (!rows.length) return res.status(404).json({ error: 'Scorta non trovata' });
    await logDB(req.user.id, `${req.user.nome} ${req.user.cognome || ''}`.trim(), 'Scorte magazzino', `Aggiorna soglia: ${rows[0].prodotto_nome}`);
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/scorte/:id/ripristina', authMiddleware, requirePermission('scorte:manage'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows } = await q(
      `UPDATE scorte_magazzino
       SET stato='ripristinata', updated_by=$1, updated_at=NOW(), ripristinata_at=NOW()
       WHERE id=$2
       RETURNING *`,
      [req.user.id || null, id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Scorta non trovata' });
    await logDB(req.user.id, `${req.user.nome} ${req.user.cognome || ''}`.trim(), 'Scorte magazzino', `Scorta ripristinata: ${rows[0].prodotto_nome}`);
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/camions/:id/pedane', authMiddleware, requireRole('admin','autista'), async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id);
    const { pedane } = req.body;
    const pianoData = String(req.body?.data || '').match(/^\d{4}-\d{2}-\d{2}$/) ? String(req.body.data) : new Date().toISOString().slice(0, 10);
    await client.query('BEGIN');
    for (const p of pedane) {
      await client.query(
        `INSERT INTO pedane (camion_id,piano_data,numero,nota)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (camion_id,piano_data,numero)
         DO UPDATE SET nota=EXCLUDED.nota`,
        [id, pianoData, p.numero, p.nota || '']
      );
    }
    await client.query('UPDATE camions SET last_update=NOW(), confermato=FALSE, confermato_da=NULL, confermato_at=NULL WHERE id=$1', [id]);
    await client.query('COMMIT');
    const u = req.user;
    await logDB(u.id, `${u.nome} ${u.cognome||''}`.trim(), 'Piano di carico', `Camion #${id} aggiornato`);
    res.json({ ok: true });
  } catch(e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

app.patch('/api/camions/:id/autista', authMiddleware, requireRole('admin','autista'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { autista_in_uso } = req.body;
    await q('UPDATE camions SET autista_in_uso=$1, confermato=FALSE, confermato_da=NULL, confermato_at=NULL WHERE id=$2',
      [autista_in_uso||null, id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/camions/:id/conferma', authMiddleware, requireRole('admin','magazzino'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { confermato } = req.body;
    const u = req.user;
    const nome = `${u.nome} ${u.cognome||''}`.trim();
    if (confermato) {
      await q('UPDATE camions SET confermato=TRUE, confermato_da=$1, confermato_at=NOW() WHERE id=$2', [nome, id]);
      await logDB(u.id, nome, 'Conferma carico', `Camion #${id}`);
    } else {
      await q('UPDATE camions SET confermato=FALSE, confermato_da=NULL, confermato_at=NULL WHERE id=$1', [id]);
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── GIRI CALENDARIO ─────────────────────────────────────────────
app.get('/api/giri', authMiddleware, async (req, res) => {
  try {
    const { rows } = await q('SELECT * FROM giri_calendario ORDER BY giro');
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/giri', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const parsed = zGiroCalendarioPayload.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);
    const giro = String(parsed.data.giro || '').trim();
    const giorni = [...new Set((parsed.data.giorni || []).map(Number))].sort((a, b) => a - b);
    const { rows: existing } = await q('SELECT id FROM giri_calendario WHERE LOWER(giro)=LOWER($1) LIMIT 1', [giro]);
    if (existing.length) {
      return res.status(409).json({ error: 'Esiste gia un giro con questo nome' });
    }
    const { rows } = await q(
      `INSERT INTO giri_calendario (giro, giorni)
       VALUES ($1, $2)
       RETURNING *`,
      [giro, JSON.stringify(giorni)]
    );
    await logDB(req.user.id, `${req.user.nome} ${req.user.cognome || ''}`.trim(), 'Calendario giri', `Creato giro: ${giro}`);
    res.status(201).json(rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/giri/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const parsed = z.object({
      giorni: z.array(z.coerce.number().int().min(0).max(6)).optional().default([]),
    }).safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);
    const giorni = [...new Set((parsed.data.giorni || []).map(Number))].sort((a, b) => a - b);
    const { rows } = await q(
      'UPDATE giri_calendario SET giorni=$1 WHERE id=$2 RETURNING giro',
      [JSON.stringify(giorni), parseInt(req.params.id)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Giro non trovato' });
    await logDB(req.user.id, `${req.user.nome} ${req.user.cognome || ''}`.trim(), 'Calendario giri', `Aggiorna giro: ${rows[0].giro}`);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/giri/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const giroId = parseInt(req.params.id);
    const { rows } = await q('SELECT id, giro FROM giri_calendario WHERE id=$1 LIMIT 1', [giroId]);
    if (!rows.length) return res.status(404).json({ error: 'Giro non trovato' });
    const giro = String(rows[0].giro || '').trim();

    const dependencyChecks = await Promise.all([
      q('SELECT COUNT(*)::int AS count FROM clienti WHERE giro=$1', [giro]),
      q(`SELECT COUNT(*)::int AS count
         FROM utenti
         WHERE EXISTS (
           SELECT 1
           FROM jsonb_array_elements_text(COALESCE(giri_consegna, '[]'::jsonb)) AS g(val)
           WHERE g.val = $1
         )`, [giro]),
      q('SELECT COUNT(*)::int AS count FROM listini WHERE giro=$1', [giro]),
      q('SELECT COUNT(*)::int AS count FROM ordini WHERE COALESCE(giro_override, \'\')=$1', [giro]),
    ]);

    const usage = {
      clienti: dependencyChecks[0].rows[0]?.count || 0,
      utenti: dependencyChecks[1].rows[0]?.count || 0,
      listini: dependencyChecks[2].rows[0]?.count || 0,
      ordini_override: dependencyChecks[3].rows[0]?.count || 0,
    };
    const totalUsage = Object.values(usage).reduce((sum, value) => sum + Number(value || 0), 0);
    if (totalUsage > 0) {
      return res.status(409).json({
        error: 'Impossibile eliminare il giro: risulta ancora assegnato o utilizzato',
        usage,
      });
    }

    await q('DELETE FROM giri_calendario WHERE id=$1', [giroId]);
    await logDB(req.user.id, `${req.user.nome} ${req.user.cognome || ''}`.trim(), 'Calendario giri', `Elimina giro: ${giro}`);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── ACTIVITY LOG ────────────────────────────────────────────────
app.get('/api/impostazioni/notifiche-email', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const cfg = await getEmailNotificationSettings();
    const smtpMissing = getSmtpMissingFields();
    res.json({
      ...cfg,
      smtp_configured: smtpMissing.length === 0,
      smtp_missing: smtpMissing,
      smtp_from: SMTP_FROM || '',
      timezone: NOTIFY_TIMEZONE,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/impostazioni/notifiche-email', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const body = req.body || {};
    const cfg = await getEmailNotificationSettings();
    const next = {
      ...cfg,
      enabled: !!body.enabled,
      recipients: Array.isArray(body.recipients) ? body.recipients.map(x => String(x || '').trim()).filter(Boolean) : cfg.recipients,
      on_new_client: body.on_new_client !== undefined ? !!body.on_new_client : cfg.on_new_client,
      daily_summary: body.daily_summary !== undefined ? !!body.daily_summary : cfg.daily_summary,
      daily_summary_hour: body.daily_summary_hour !== undefined ? Number(body.daily_summary_hour) : cfg.daily_summary_hour,
      last_daily_sent_key: cfg.last_daily_sent_key || '',
    };
    if (!next.recipients.length) return res.status(400).json({ error: 'Inserisci almeno un destinatario' });
    const saved = await saveEmailNotificationSettings(next);
    await logDB(
      req.user.id,
      `${req.user.nome} ${req.user.cognome || ''}`.trim(),
      'Impostazioni notifiche email',
      `destinatari: ${saved.recipients.join(', ')}`
    );
    res.json({
      ...saved,
      smtp_configured: getSmtpMissingFields().length === 0,
      smtp_missing: getSmtpMissingFields(),
      smtp_from: SMTP_FROM || '',
      timezone: NOTIFY_TIMEZONE,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/impostazioni/tentata-vendita', authMiddleware, async (req, res) => {
  try {
    res.json(await getTentataVenditaSettings());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/impostazioni/tentata-vendita', authMiddleware, requireRole('admin', 'magazzino'), async (req, res) => {
  try {
    const saved = await saveTentataVenditaSettings(req.body || {});
    await logDB(
      req.user.id,
      `${req.user.nome} ${req.user.cognome || ''}`.trim(),
      'Configurazione tentata vendita',
      `${saved.carichi.length} autisti configurati`
    );
    res.json(saved);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/impostazioni/notifiche-email/test', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const cfg = await getEmailNotificationSettings();
    if (!cfg.recipients.length) return res.status(400).json({ error: 'Nessun destinatario configurato' });
    const now = new Date().toISOString();
    const sent = await sendManagedEmail({
      to: cfg.recipients,
      subject: 'Test notifiche Norbalat Ordini',
      text: `Test inviato correttamente alle ${now}`,
      html: `<div style="font-family:Arial,sans-serif;"><h3>Test notifiche</h3><p>Invio riuscito alle <b>${now}</b></p></div>`,
    });
    if (sent.skipped && sent.reason === 'smtp_not_configured') {
      return res.status(400).json({
        error: 'SMTP non configurato sul server (.env)',
        smtp_missing: getSmtpMissingFields(),
      });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.get('/api/activity', authMiddleware, requireRole('admin','direzione','amministrazione'), async (req, res) => {
  try {
    const { rows } = await q('SELECT * FROM activity_log ORDER BY id DESC LIMIT 500');
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/notifiche/ordini', authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 12));
    const { rows } = await q(
      `SELECT id, user_id, user_name, action, detail, ts
         FROM activity_log
        WHERE action IN ('Nuovo ordine', 'Modifica ordine')
        ORDER BY id DESC
        LIMIT $1`,
      [limit]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/messaggi', authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 80));
    const inboxWhere = getMessaggiInboxWhere(req.user, 1);
    const inboxSql = buildMessaggiConversationListSql(inboxWhere.clause, 1, 3);
    const sentSql = buildMessaggiConversationListSql('m.created_by = $1', 2, 3);
    const unreadSql = `
      WITH last_messages AS (
        SELECT DISTINCT ON (mi.conversation_id)
               mi.conversation_id,
               mi.id AS last_message_id
          FROM messaggi_interni mi
         WHERE mi.conversation_id IS NOT NULL
         ORDER BY mi.conversation_id, mi.created_at DESC, mi.id DESC
      )
      SELECT COUNT(*)::int AS unread_count
        FROM messaggi_conversazioni m
        JOIN last_messages lm ON lm.conversation_id = m.id
        LEFT JOIN messaggi_conversazione_letture ml
          ON ml.conversation_id = m.id
         AND ml.user_id = $1
       WHERE ${inboxWhere.clause}
         AND (ml.last_read_message_id IS NULL OR ml.last_read_message_id < lm.last_message_id)`;
    const [inbox, sent, unread] = await Promise.all([
      q(inboxSql, [...inboxWhere.params, limit]),
      q(sentSql, [req.user.id || null, req.user.id || null, limit]),
      q(unreadSql, inboxWhere.params),
    ]);
    res.json({
      inbox: inbox.rows.map(normalizeMessaggioConversationRow),
      sent: sent.rows.map(normalizeMessaggioConversationRow),
      unread_count: unread.rows[0]?.unread_count || 0,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/messaggi/summary', authMiddleware, async (req, res) => {
  try {
    const inboxWhere = getMessaggiInboxWhere(req.user, 1);
    const [recent, unread] = await Promise.all([
      q(buildMessaggiConversationListSql(inboxWhere.clause, 1, 3), [...inboxWhere.params, 6]),
      q(
        `WITH last_messages AS (
           SELECT DISTINCT ON (mi.conversation_id)
                  mi.conversation_id,
                  mi.id AS last_message_id
             FROM messaggi_interni mi
            WHERE mi.conversation_id IS NOT NULL
            ORDER BY mi.conversation_id, mi.created_at DESC, mi.id DESC
         )
         SELECT COUNT(*)::int AS unread_count
           FROM messaggi_conversazioni m
           JOIN last_messages lm ON lm.conversation_id = m.id
           LEFT JOIN messaggi_conversazione_letture ml
             ON ml.conversation_id = m.id
            AND ml.user_id = $1
          WHERE ${inboxWhere.clause}
            AND (ml.last_read_message_id IS NULL OR ml.last_read_message_id < lm.last_message_id)`,
        inboxWhere.params
      ),
    ]);
    res.json({
      unread_count: unread.rows[0]?.unread_count || 0,
      recent: recent.rows.map(normalizeMessaggioConversationRow),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/messaggi', authMiddleware, async (req, res) => {
  try {
    const parsed = zMessaggioCreate.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);
    const payload = parsed.data;
    const mittenteNome = `${req.user.nome || ''} ${req.user.cognome || ''}`.trim() || req.user.username || 'Utente';
    const currentUserId = Number(req.user.id || 0) || null;
    let conversationKind = 'direct';
    let participantUserIds = [];
    let destinatarioUserId = null;
    let destinatarioRuolo = null;
    let destinatarioTipo = payload.destinatario_tipo;
    let nomeChat = String(payload.nome_chat || '').trim();
    if (payload.destinatario_tipo === 'self') {
      conversationKind = 'self';
      participantUserIds = normalizeConversationParticipantIds([currentUserId]);
      destinatarioUserId = currentUserId;
      destinatarioTipo = 'user';
      if (!nomeChat) nomeChat = 'Note personali';
    } else if (payload.destinatario_tipo === 'group') {
      conversationKind = 'group';
      participantUserIds = normalizeConversationParticipantIds([currentUserId, ...(payload.destinatario_user_ids || [])]);
      if (participantUserIds.length < 2) return res.status(400).json({ error: 'Seleziona almeno un altro partecipante per il gruppo' });
      const { rows } = await q('SELECT id FROM utenti WHERE id = ANY($1::int[])', [participantUserIds]);
      if (rows.length !== participantUserIds.length) return res.status(400).json({ error: 'Uno o piu partecipanti non sono validi' });
      destinatarioTipo = 'user';
      destinatarioUserId = null;
      if (!nomeChat) nomeChat = 'Chat di gruppo';
    } else if (payload.destinatario_tipo === 'user') {
      if (!payload.destinatario_user_id) return res.status(400).json({ error: 'Destinatario utente obbligatorio' });
      const { rows } = await q('SELECT id FROM utenti WHERE id=$1 LIMIT 1', [payload.destinatario_user_id]);
      if (!rows.length) return res.status(400).json({ error: 'Utente destinatario non trovato' });
      destinatarioUserId = payload.destinatario_user_id;
      participantUserIds = normalizeConversationParticipantIds([currentUserId, payload.destinatario_user_id]);
    } else {
      const ruolo = String(payload.destinatario_ruolo || '').trim();
      if (!APP_ROLES.includes(ruolo)) return res.status(400).json({ error: 'Ruolo destinatario non valido' });
      conversationKind = 'role';
      destinatarioRuolo = ruolo;
      participantUserIds = normalizeConversationParticipantIds([currentUserId]);
    }
    if (payload.ordine_id) {
      const { rows } = await q('SELECT id FROM ordini WHERE id=$1 LIMIT 1', [payload.ordine_id]);
      if (!rows.length) return res.status(400).json({ error: 'Ordine collegato non trovato' });
    }
    if (payload.cliente_id) {
      const { rows } = await q('SELECT id FROM clienti WHERE id=$1 LIMIT 1', [payload.cliente_id]);
      if (!rows.length) return res.status(400).json({ error: 'Cliente collegato non trovato' });
    }
    const conv = await q(
      `INSERT INTO messaggi_conversazioni
        (created_by, created_by_name, conversation_kind, nome_chat, partecipanti_user_ids, destinatario_tipo, destinatario_user_id, destinatario_ruolo, oggetto, stato, priorita, cliente_id, ordine_id, last_message_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,'nuovo',$10,$11,$12,NOW())
       RETURNING id`,
      [
        currentUserId,
        mittenteNome,
        conversationKind,
        nomeChat,
        JSON.stringify(participantUserIds),
        destinatarioTipo,
        destinatarioUserId,
        destinatarioRuolo,
        String(payload.oggetto || '').trim(),
        payload.priorita || 'media',
        payload.cliente_id || null,
        payload.ordine_id || null,
      ]
    );
    const conversationId = conv.rows[0].id;
    await q(
      `INSERT INTO messaggi_interni
         (conversation_id, mittente_id, mittente_nome, destinatario_tipo, destinatario_user_id, destinatario_ruolo, oggetto, testo, ordine_id, cliente_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        conversationId,
        currentUserId,
        mittenteNome,
        destinatarioTipo,
        destinatarioUserId,
        destinatarioRuolo,
        String(payload.oggetto || '').trim(),
        String(payload.testo || '').trim(),
        payload.ordine_id || null,
        payload.cliente_id || null,
      ]
    );
    await markConversationReadForUser(conversationId, currentUserId || 0);
    await logDB(req.user.id, mittenteNome, 'Messaggio interno', String(payload.oggetto || '').trim() || `conversazione #${conversationId}`);
    const summary = await getMessaggioConversationSummaryById(conversationId, req.user);
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/messaggi/:id', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Conversazione non valida' });
    const summary = await getMessaggioConversationSummaryById(id, req.user);
    if (!summary) return res.status(404).json({ error: 'Conversazione non trovata' });
    const messages = await q(
      `SELECT id, conversation_id, mittente_id, mittente_nome, testo, created_at
         FROM messaggi_interni
        WHERE conversation_id = $1
        ORDER BY created_at ASC, id ASC`,
      [id]
    );
    res.json({
      conversation: summary,
      messages: messages.rows.map(normalizeMessaggioRow),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/messaggi/:id/reply', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Conversazione non valida' });
    const parsed = zMessaggioReply.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);
    const summary = await getMessaggioConversationSummaryById(id, req.user);
    if (!summary) return res.status(404).json({ error: 'Conversazione non trovata' });
    const mittenteNome = `${req.user.nome || ''} ${req.user.cognome || ''}`.trim() || req.user.username || 'Utente';
    await q(
      `INSERT INTO messaggi_interni
         (conversation_id, mittente_id, mittente_nome, destinatario_tipo, destinatario_user_id, destinatario_ruolo, oggetto, testo, ordine_id, cliente_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id,
        req.user.id || null,
        mittenteNome,
        summary.destinatario_tipo,
        summary.destinatario_user_id || null,
        summary.destinatario_ruolo || null,
        summary.oggetto || '',
        parsed.data.testo,
        summary.ordine_id || null,
        summary.cliente_id || null,
      ]
    );
    await q(
      `UPDATE messaggi_conversazioni
          SET last_message_at = NOW(),
              stato = CASE WHEN stato = 'chiuso' THEN 'in_attesa' ELSE stato END,
              closed_at = CASE WHEN stato = 'chiuso' THEN NULL ELSE closed_at END
        WHERE id = $1`,
      [id]
    );
    await markConversationReadForUser(id, req.user.id || 0);
    const updated = await getMessaggioConversationSummaryById(id, req.user);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/messaggi/:id', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Conversazione non valida' });
    const parsed = zMessaggioConversationUpdate.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);
    const current = await getMessaggioConversationSummaryById(id, req.user);
    if (!current) return res.status(404).json({ error: 'Conversazione non trovata' });
    const next = parsed.data || {};
    if (next.assegnato_user_id) {
      const { rows } = await q('SELECT id FROM utenti WHERE id=$1 LIMIT 1', [next.assegnato_user_id]);
      if (!rows.length) return res.status(400).json({ error: 'Assegnatario non trovato' });
    }
    const { rows } = await q(
      `UPDATE messaggi_conversazioni
          SET stato = COALESCE($1, stato),
              priorita = COALESCE($2, priorita),
              assegnato_user_id = $3,
              closed_at = CASE
                WHEN COALESCE($1, stato) = 'chiuso' THEN COALESCE(closed_at, NOW())
                ELSE NULL
              END
        WHERE id = $4
        RETURNING id`,
      [
        next.stato || null,
        next.priorita || null,
        next.assegnato_user_id === undefined ? current.assegnato_user_id : (next.assegnato_user_id || null),
        id,
      ]
    );
    if (!rows.length) return res.status(404).json({ error: 'Conversazione non trovata' });
    const updated = await getMessaggioConversationSummaryById(id, req.user);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/messaggi/:id/take', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Conversazione non valida' });
    const summary = await getMessaggioConversationSummaryById(id, req.user);
    if (!summary) return res.status(404).json({ error: 'Conversazione non trovata' });
    await q(
      `UPDATE messaggi_conversazioni
          SET assegnato_user_id = $1,
              stato = CASE WHEN stato = 'chiuso' THEN 'in_attesa' ELSE 'preso_in_carico' END,
              closed_at = NULL
        WHERE id = $2`,
      [req.user.id || null, id]
    );
    const updated = await getMessaggioConversationSummaryById(id, req.user);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/messaggi/:id/read', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Conversazione non valida' });
    const inboxWhere = getMessaggiInboxWhere(req.user, 2);
    const { rows } = await q(
      `SELECT m.id
         FROM messaggi_conversazioni m
        WHERE m.id = $1
          AND ${inboxWhere.clause}
        LIMIT 1`,
      [id, ...inboxWhere.params]
    );
    if (!rows.length) return res.status(404).json({ error: 'Conversazione non trovata' });
    const lastReadMessageId = await markConversationReadForUser(id, req.user.id || 0);
    res.json({ ok: true, id, last_read_message_id: lastReadMessageId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/activity', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    await q('DELETE FROM activity_log');
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── STATS ───────────────────────────────────────────────────────
app.get('/api/magazzino/residui-log', authMiddleware, requireRole('admin','magazzino'), async (req, res) => {
  try {
    const data = String(req.query?.data || '').trim();
    const giro = String(req.query?.giro || '').trim();
    const params = [];
    const where = [`esito = 'con_residui'`];
    if (data) {
      params.push(data);
      where.push(`data = $${params.length}`);
    }
    if (giro) {
      params.push(giro);
      where.push(`giro = $${params.length}`);
    }
    params.push(40);
    const { rows } = await q(
      `SELECT id, data, giro, confermata_nome, confermata_at, dettagli
       FROM magazzino_chiusure_giornata
       WHERE ${where.join(' AND ')}
       ORDER BY confermata_at DESC NULLS LAST, id DESC
       LIMIT $${params.length}`,
      params
    );

    const entries = [];
    rows.forEach(row => {
      const details = row.dettagli && typeof row.dettagli === 'object' ? row.dettagli : {};
      const reloaded = Array.isArray(details.reloaded) ? details.reloaded : [];
      reloaded.forEach(item => {
        entries.push({
          log_id: row.id,
          data: row.data,
          giro: row.giro || '',
          confermata_nome: row.confermata_nome || '',
          confermata_at: row.confermata_at,
          ordine_id: item.ordine_id,
          cliente_id: item.cliente_id || null,
          cliente: item.cliente || '',
          new_order_id: item.new_order_id,
          next_date: item.next_date || null,
          reason_code: item.reason_code || '',
          reason_summary: item.reason_summary || '',
          reason_lines: Array.isArray(item.reason_lines) ? item.reason_lines : [],
          missing_lines: Array.isArray(item.missing_lines) ? item.missing_lines : [],
        });
      });
    });

    res.json(entries);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stats/dashboard', authMiddleware, async (req, res) => {
  try {
    const oggi = new Date().toISOString().split('T')[0];
    const [r1,r2,r3,r4,week,agenti,topClienti] = await Promise.all([
      q(`SELECT COUNT(*) as n FROM ordini WHERE data=$1`, [oggi]),
      q(`SELECT COUNT(*) as n FROM ordini WHERE stato='attesa'`),
      q(`SELECT COUNT(*) as n FROM ordini WHERE stato='consegnato'`),
      q(`SELECT COUNT(*) as n FROM ordini WHERE stato='preparazione'`),
      q(`SELECT data::text, COUNT(*) as n FROM ordini WHERE data >= NOW()-INTERVAL '6 days' GROUP BY data ORDER BY data`),
      q(`SELECT u.nome, u.cognome, COUNT(o.id) as n FROM utenti u LEFT JOIN ordini o ON o.agente_id=u.id WHERE u.is_agente=TRUE GROUP BY u.id ORDER BY n DESC`),
      q(`SELECT c.nome, c.localita, c.giro, COUNT(o.id) as n FROM clienti c LEFT JOIN ordini o ON o.cliente_id=c.id GROUP BY c.id ORDER BY n DESC LIMIT 15`),
    ]);
    res.json({
      stats: {
        ordini_oggi:     parseInt(r1.rows[0].n),
        in_attesa:       parseInt(r2.rows[0].n),
        consegnati:      parseInt(r3.rows[0].n),
        in_preparazione: parseInt(r4.rows[0].n),
      },
      week: week.rows,
      perAgente: agenti.rows,
      topClienti: topClienti.rows,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

function decodeHtmlEntities(input = '') {
  return String(input || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripHtmlTags(input = '') {
  return decodeHtmlEntities(String(input || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function parseNumberLoose(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseDateLoose(raw) {
  const s = String(raw || '').trim();
  const mIt = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mIt) {
    const dd = mIt[1].padStart(2, '0');
    const mm = mIt[2].padStart(2, '0');
    return `${mIt[3]}-${mm}-${dd}`;
  }
  const mIso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (mIso) return s;
  return null;
}

function parseItalianMonthDate(raw) {
  const s = decodeHtmlEntities(String(raw || '')).replace(/\s+/g, ' ').trim();
  const m = s.match(/(\d{1,2})\s+([A-Za-zÀ-ÿ]{3,})\s+(\d{4})/);
  if (!m) return null;
  const mmMap = {
    gen: '01', feb: '02', mar: '03', apr: '04', mag: '05', giu: '06',
    lug: '07', ago: '08', set: '09', ott: '10', nov: '11', dic: '12',
  };
  const mon = String(m[2] || '').toLowerCase().slice(0, 3);
  const mm = mmMap[mon];
  if (!mm) return null;
  const dd = String(m[1]).padStart(2, '0');
  return `${m[3]}-${mm}-${dd}`;
}

function extractTableRowsFromHtml(html) {
  const out = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr;
  while ((tr = trRe.exec(String(html || '')))) {
    const rowHtml = tr[1];
    const cells = [];
    const tdRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let td;
    while ((td = tdRe.exec(rowHtml))) {
      cells.push(stripHtmlTags(td[1]));
    }
    if (cells.length) out.push(cells);
  }
  return out;
}

function parseClalBurroZangolatoFromHtml(html) {
  const scannedRows = extractTableRowsFromHtml(html).length;
  const rows = [];
  const scrapedAt = new Date().toISOString();
  const htmlRaw = String(html || '');
  const lower = htmlRaw.toLowerCase();
  const anchorIdx = lower.search(/name\s*=\s*["']zangolato["']/i);
  if (anchorIdx >= 0) {
    const nextAnchor = lower.indexOf('<a name', anchorIdx + 20);
    const section = htmlRaw.slice(anchorIdx, nextAnchor > anchorIdx ? nextAnchor : anchorIdx + 60000);
    const rowRe = /<tr>\s*<td[^>]*class="data[^"]*"[^>]*>([\s\S]*?)<\/td>[\s\S]*?<td[^>]*class="value[^"]*"[^>]*>\s*([0-9]+(?:,[0-9]+)?)\s*<\/td>[\s\S]*?<td[^>]*class="value[^"]*"[^>]*>\s*([+\-]?[0-9]+(?:,[0-9]+)?)%/gi;
    let m;
    let idx = 0;
    while ((m = rowRe.exec(section))) {
      const dateRaw = stripHtmlTags(m[1]);
      const price = parseNumberLoose(m[2]);
      const deltaPct = parseNumberLoose(m[3]);
      if (!Number.isFinite(price)) continue;
      const dateIso = parseItalianMonthDate(dateRaw) || parseDateLoose(dateRaw);
      rows.push({
        row_index: idx++,
        date_raw: dateRaw,
        date_iso: dateIso,
        min_price: price,
        max_price: price,
        delta_pct: deltaPct,
        prices: [price],
        cells: [dateRaw, String(m[2]), `${m[3]}%`],
      });
    }
  }

  if (!rows.length) {
    const fallbackRows = extractTableRowsFromHtml(htmlRaw);
    fallbackRows.forEach((cells, idx) => {
      const line = cells.join(' | ');
      if (!/zangolat/i.test(line)) return;
      const joined = cells.join(' ');
      const dateRawCell = cells.find(c => /(\d{1,2}\/\d{1,2}\/\d{4})|(\d{4}-\d{2}-\d{2})/.test(c)) || '';
      const dateMatch = joined.match(/(\d{1,2}\/\d{1,2}\/\d{4})|(\d{4}-\d{2}-\d{2})/);
      const dateRaw = dateRawCell || dateMatch?.[0] || '';
      const dateIso = parseDateLoose(dateRaw);
      const nums = cells
        .map(parseNumberLoose)
        .filter(n => Number.isFinite(n) && n > 0 && n < 100);
      if (!nums.length) return;
      rows.push({
        row_index: idx,
        date_raw: dateRaw,
        date_iso: dateIso,
        min_price: Math.min(...nums),
        max_price: Math.max(...nums),
        prices: nums,
        cells,
      });
    });
  }

  rows.sort((a, b) => {
    const da = String(a.date_iso || '');
    const db = String(b.date_iso || '');
    if (da && db) return db.localeCompare(da);
    return b.row_index - a.row_index;
  });

  return {
    source_key: 'burro_milano_zangolato',
    source_url: CLAL_BURRO_ZANGOLATO_URL,
    scraped_at: scrapedAt,
    rows,
    total_rows_scanned: scannedRows,
  };
}

async function fetchExternalText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 NorbalatBot/1.0',
      },
    });
    if (!r.ok) throw new Error(`Sorgente esterna errore ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

async function saveClalZangolatoSnapshot({ sourceUrl, parsed, userId }) {
  const inserted = [];
  for (const row of (parsed.rows || [])) {
    const existing = await q(
      `SELECT id
       FROM experimental_clal_quotes
       WHERE source_key=$1
         AND ref_date IS NOT DISTINCT FROM $2
         AND min_price IS NOT DISTINCT FROM $3
         AND max_price IS NOT DISTINCT FROM $4
       LIMIT 1`,
      [
        EXPERIMENTAL_CLAL_SOURCE_KEY,
        row.date_iso || null,
        row.min_price ?? null,
        row.max_price ?? null,
      ]
    );
    if (existing.rows.length) continue;

    const payload = {
      row_index: row.row_index,
      prices: row.prices || [],
      cells: row.cells || [],
      scraped_at: parsed.scraped_at,
    };
    const { rows } = await q(
      `INSERT INTO experimental_clal_quotes
       (source_key,source_url,ref_date,date_raw,min_price,max_price,payload,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
       RETURNING id,fetched_at`,
      [
        EXPERIMENTAL_CLAL_SOURCE_KEY,
        sourceUrl,
        row.date_iso || null,
        String(row.date_raw || ''),
        row.min_price ?? null,
        row.max_price ?? null,
        JSON.stringify(payload),
        userId || null,
      ]
    );
    inserted.push(rows[0]);
  }
  return inserted;
}

async function fetchClalZangolatoSnapshot({ sourceUrl = CLAL_BURRO_ZANGOLATO_URL, persist = false, userId = null } = {}) {
  const html = await fetchExternalText(String(sourceUrl || CLAL_BURRO_ZANGOLATO_URL).trim());
  const parsed = parseClalBurroZangolatoFromHtml(html);
  if (!parsed.rows.length) {
    const err = new Error('Nessuna riga BURRO ZANGOLATO trovata nella sorgente');
    err.statusCode = 422;
    err.payload = {
      source: sourceUrl,
      scanned_rows: parsed.total_rows_scanned,
    };
    throw err;
  }

  let inserted = [];
  if (persist) {
    inserted = await saveClalZangolatoSnapshot({ sourceUrl, parsed, userId });
  }

  const latest = parsed.rows[0] || null;
  return {
    ok: true,
    source: sourceUrl,
    fetched_at: parsed.scraped_at,
    total_rows_scanned: parsed.total_rows_scanned,
    rows_count: parsed.rows.length,
    latest: latest ? {
      date_raw: latest.date_raw,
      date_iso: latest.date_iso,
      min_price: latest.min_price,
      max_price: latest.max_price,
    } : null,
    rows: parsed.rows,
    persisted: persist,
    inserted_count: inserted.length,
  };
}

async function getExperimentalSourceConfig() {
  const defaults = {
    url: EXPERIMENTAL_SOURCE_URL || CLAL_BURRO_ZANGOLATO_URL,
    mode: 'auto',
    product_selector: '',
    code_selector: '',
    name_selector: '',
    price_selector: '',
  };
  try {
    const { rows } = await q('SELECT value FROM app_settings WHERE key=$1', ['experimental_source']);
    if (!rows.length) return defaults;
    const saved = rows[0].value && typeof rows[0].value === 'object' ? rows[0].value : {};
    return { ...defaults, ...saved };
  } catch (_) {
    return defaults;
  }
}

async function saveExperimentalSourceConfig(next) {
  const merged = { ...(await getExperimentalSourceConfig()), ...next };
  await q(
    `INSERT INTO app_settings (key,value,updated_at)
     VALUES ('experimental_source',$1::jsonb,NOW())
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
    [JSON.stringify(merged)]
  );
  return merged;
}

function parseExperimentalPreviewFromHtml(html) {
  const text = String(html || '');
  const rows = [];
  const lineRegex = /([A-Z0-9-]{2,})?\s*([A-Za-zÀ-ÿ][^<\n]{2,80}?)\s+([0-9]+(?:[.,][0-9]{1,2})?)\s*(?:€|euro|eur)/gi;
  let m;
  while ((m = lineRegex.exec(text)) && rows.length < 200) {
    rows.push({
      codice: (m[1] || '').trim(),
      nome: (m[2] || '').replace(/\s+/g, ' ').trim(),
      prezzo: Number(String(m[3]).replace(',', '.')),
    });
  }
  return rows;
}

function normalizeExperimentalPreview(body, contentType) {
  if (contentType.includes('application/json')) {
    if (Array.isArray(body)) return body.slice(0, 300);
    if (body && Array.isArray(body.items)) return body.items.slice(0, 300);
    return body;
  }
  const rows = parseExperimentalPreviewFromHtml(String(body || ''));
  if (rows.length) return rows;
  return String(body || '').slice(0, 8000);
}

app.get('/api/experimental/config', authMiddleware, requireRole('admin','direzione'), async (req, res) => {
  try {
    res.json(await getExperimentalSourceConfig());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/experimental/config', authMiddleware, requireRole('admin','direzione'), async (req, res) => {
  try {
    const zExperimentalConfig = z.object({
      url: z.string().url().optional(),
      mode: z.enum(['auto', 'json', 'html']).optional(),
      product_selector: z.string().max(200).optional(),
      code_selector: z.string().max(200).optional(),
      name_selector: z.string().max(200).optional(),
      price_selector: z.string().max(200).optional(),
    });
    const parsed = zExperimentalConfig.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);
    const saved = await saveExperimentalSourceConfig(parsed.data);
    res.json(saved);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/experimental/source', authMiddleware, requireRole('admin','direzione'), async (req, res) => {
  try {
    const zExperimentalQuery = z.object({ url: z.string().url().optional(), mode: z.enum(['auto', 'json', 'html']).optional() });
    const parsed = zExperimentalQuery.safeParse(req.query || {});
    if (!parsed.success) return validationError(res, parsed);
    const cfg = await getExperimentalSourceConfig();
    const url = String(parsed.data.url || cfg.url || EXPERIMENTAL_SOURCE_URL || '').trim();
    const mode = String(parsed.data.mode || cfg.mode || 'auto');
    if (!url) return res.status(400).json({ error: 'URL sorgente non configurato' });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    let r;
    try {
      r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json,text/html;q=0.9,*/*;q=0.8' } });
    } finally {
      clearTimeout(timer);
    }
    if (!r.ok) return res.status(502).json({ error: `Sorgente esterna errore ${r.status}` });
    const ct = r.headers.get('content-type') || '';
    const shouldJson = mode === 'json' || (mode === 'auto' && ct.includes('application/json'));
    const body = shouldJson ? await r.json() : await r.text();
    const preview = normalizeExperimentalPreview(body, ct);
    res.json({ ok: true, source: url, mode, content_type: ct, preview });
  } catch (e) {
    res.status(500).json({ error: e.name === 'AbortError' ? 'Timeout sorgente esterna' : e.message });
  }
});

app.get('/api/experimental/clal/zangolato', authMiddleware, requireRole('admin','direzione'), async (req, res) => {
  try {
    const zQuery = z.object({
      url: z.string().url().optional(),
      persist: z.union([z.string(), z.boolean()]).optional(),
    });
    const parsedQ = zQuery.safeParse(req.query || {});
    if (!parsedQ.success) return validationError(res, parsedQ);
    const sourceUrl = String(parsedQ.data.url || CLAL_BURRO_ZANGOLATO_URL).trim();
    const persistRaw = parsedQ.data.persist;
    const persist = persistRaw === true || String(persistRaw || '').toLowerCase() === 'true' || String(persistRaw || '') === '1';
    const result = await fetchClalZangolatoSnapshot({
      sourceUrl,
      persist,
      userId: req.user?.id || null,
    });
    if (persist) {
      await logDB(
        req.user.id,
        `${req.user.nome} ${req.user.cognome || ''}`.trim(),
        'Sperimentale CLAL',
        `Snapshot zangolato: ${result.rows_count} righe, nuovi record ${result.inserted_count}`
      );
    }
    res.json(result);
  } catch (e) {
    const status = e.statusCode || 500;
    res.status(status).json({
      error: e.name === 'AbortError' ? 'Timeout sorgente CLAL' : e.message,
      ...(e.payload || {}),
    });
  }
});

app.get('/api/experimental/clal/zangolato/history', authMiddleware, requireRole('admin','direzione'), async (req, res) => {
  try {
    const zQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).optional() });
    const parsed = zQuery.safeParse(req.query || {});
    if (!parsed.success) return validationError(res, parsed);
    const limit = parsed.data.limit || 120;
    const { rows } = await q(
      `SELECT id, source_url, fetched_at, ref_date, date_raw, min_price, max_price, payload
       FROM experimental_clal_quotes
       WHERE source_key=$2
       ORDER BY fetched_at DESC, id DESC
       LIMIT $1`,
      [limit, EXPERIMENTAL_CLAL_SOURCE_KEY]
    );
    res.json({ ok: true, count: rows.length, rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/experimental/clal/status', authMiddleware, requireRole('admin','direzione'), async (req, res) => {
  try {
    const automation = await getExperimentalAutomationSettings();
    const lastImport = await q(
      `SELECT fetched_at, ref_date, date_raw, min_price, max_price
       FROM experimental_clal_quotes
       WHERE source_key=$1
       ORDER BY fetched_at DESC, id DESC
       LIMIT 1`,
      [EXPERIMENTAL_CLAL_SOURCE_KEY]
    );
    const latest = lastImport.rows[0] || null;
    res.json({
      ok: true,
      source_url: CLAL_BURRO_ZANGOLATO_URL,
      timezone: EXPERIMENTAL_TIMEZONE,
      next_window: getNextClalBulletinWindow(),
      automation,
      last_import: latest ? {
        fetched_at: latest.fetched_at,
        ref_date: latest.ref_date,
        date_raw: latest.date_raw,
        min_price: latest.min_price,
        max_price: latest.max_price,
      } : null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GIACENZE API ─────────────────────────────────────────────────

// GET /api/giacenze — lista giacenze con info prodotto
app.get('/api/giacenze', authMiddleware, async (req, res) => {
  try {
    const { rows } = await q(
      `WITH giacenze_ranked AS (
         SELECT
           g.*,
           p.codice,
           p.nome,
           p.um,
           p.categoria,
           p.gestione_giacenza,
           p.punto_riordino,
           p.assortimento_stato,
           p.ultimo_riordino_qta,
           p.ultimo_riordino_at,
           p.ultimo_riordino_utente_id,
           p.ultimo_riordino_utente_nome,
           SUM(CASE WHEN COALESCE(g.quantita, 0) > 0 THEN COALESCE(g.quantita, 0) ELSE 0 END) OVER (PARTITION BY g.prodotto_id) AS totale_lotti_aperti,
           ROW_NUMBER() OVER (
             PARTITION BY g.prodotto_id
             ORDER BY
               CASE WHEN COALESCE(g.quantita, 0) > 0 THEN 0 ELSE 1 END,
               g.updated_at DESC NULLS LAST,
               g.id DESC
           ) AS prodotto_row_rank
         FROM giacenze g
         JOIN prodotti p ON p.id = g.prodotto_id
         WHERE COALESCE(p.gestione_giacenza, TRUE) = TRUE
       )
       SELECT *
       FROM giacenze_ranked
       WHERE COALESCE(quantita, 0) > 0
          OR (
            COALESCE(assortimento_stato, 'attivo') = 'attivo'
            AND COALESCE(totale_lotti_aperti, 0) = 0
            AND prodotto_row_rank = 1
          )
       ORDER BY nome, lotto`
    );
    // Calcola totale per prodotto
    const totali = {};
    for (const r of rows) {
      const pid = r.prodotto_id;
      totali[pid] = (totali[pid] || 0) + Number(r.quantita || 0);
    }
    const result = rows.map(r => ({ ...r, totale_per_prodotto: totali[r.prodotto_id] || 0 }));
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/giacenze/lotti?prodotto_id=X — lotti disponibili per un prodotto
app.get('/api/giacenze/lotti', authMiddleware, requireRole('admin', 'magazzino'), async (req, res) => {
  try {
    const prodottoId = parseInt(req.query.prodotto_id, 10);
    if (!prodottoId) return res.status(400).json({ error: 'prodotto_id mancante' });
    const { rows } = await q(
      `SELECT id, lotto, quantita, scadenza FROM giacenze
       WHERE prodotto_id=$1 AND quantita > 0 ORDER BY scadenza ASC NULLS LAST`,
      [prodottoId]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/giacenze/alerts — prodotti sotto soglia e lotti in scadenza
app.get('/api/giacenze/alerts', authMiddleware, async (req, res) => {
  try {
    const { rows: sottoSoglia } = await q(
      `SELECT p.id, p.codice, p.nome, p.um, p.punto_riordino, p.assortimento_stato,
              p.ultimo_riordino_qta, p.ultimo_riordino_at, p.ultimo_riordino_utente_nome,
              COALESCE(SUM(g.quantita),0) as totale_quantita
       FROM prodotti p
       LEFT JOIN giacenze g ON g.prodotto_id = p.id
       WHERE COALESCE(p.gestione_giacenza, TRUE) = TRUE
         AND p.punto_riordino IS NOT NULL
         AND p.punto_riordino > 0
         AND COALESCE(p.assortimento_stato, 'attivo') = 'attivo'
       GROUP BY p.id, p.codice, p.nome, p.um, p.punto_riordino, p.assortimento_stato,
                p.ultimo_riordino_qta, p.ultimo_riordino_at, p.ultimo_riordino_utente_nome
       HAVING COALESCE(SUM(g.quantita),0) < p.punto_riordino`
    );
    const { rows: inScadenza } = await q(
      `SELECT g.id, g.lotto, g.scadenza, g.quantita, g.prodotto_id,
              p.codice, p.nome, p.um, p.assortimento_stato,
              p.ultimo_riordino_qta, p.ultimo_riordino_at, p.ultimo_riordino_utente_nome
       FROM giacenze g JOIN prodotti p ON p.id = g.prodotto_id
       WHERE COALESCE(p.gestione_giacenza, TRUE) = TRUE
         AND g.scadenza IS NOT NULL
         AND g.scadenza <= NOW() + INTERVAL '30 days'
         AND g.quantita > 0
       ORDER BY g.scadenza ASC`
    );
    res.json({ sotto_soglia: sottoSoglia, in_scadenza: inScadenza });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/giacenze/carico — carico/reso/tentata_vendita
app.post('/api/giacenze/carico', authMiddleware, requireRole('admin', 'magazzino'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { prodotto_id, lotto, quantita, scadenza, tipo, note } = req.body || {};
    if (!prodotto_id) return res.status(400).json({ error: 'prodotto_id obbligatorio' });
    if (!lotto && lotto !== 0) return res.status(400).json({ error: 'lotto obbligatorio' });
    const qty = Number(quantita);
    if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: 'quantita deve essere > 0' });
    const tipoVal = ['carico', 'reso', 'tentata_vendita'].includes(tipo) ? tipo : 'carico';
    const lottoVal = String(lotto || '').trim();
    const scadenzaVal = scadenza || null;
    const utenteName = `${req.user.nome || ''} ${req.user.cognome || ''}`.trim() || req.user.username || '';
    const { rows: prodRows } = await client.query(
      'SELECT gestione_giacenza FROM prodotti WHERE id=$1 LIMIT 1',
      [prodotto_id]
    );
    if (!prodRows.length) { client.release(); return res.status(404).json({ error: 'Prodotto non trovato' }); }
    if (!prodRows[0].gestione_giacenza) { client.release(); return res.status(400).json({ error: 'Il prodotto non è gestito a giacenza' }); }

    await client.query('BEGIN');
    // Find existing giacenza
    const { rows: existing } = await client.query(
      'SELECT id, quantita FROM giacenze WHERE prodotto_id=$1 AND lotto=$2 LIMIT 1',
      [prodotto_id, lottoVal]
    );
    let giacenzaId, oldQty, newQty;
    if (existing.length) {
      giacenzaId = existing[0].id;
      oldQty = Number(existing[0].quantita);
      newQty = oldQty + qty;
      await client.query(
        'UPDATE giacenze SET quantita=$1, updated_at=NOW() WHERE id=$2',
        [newQty, giacenzaId]
      );
    } else {
      oldQty = 0;
      newQty = qty;
      const ins = await client.query(
        `INSERT INTO giacenze (prodotto_id, lotto, scadenza, quantita, note)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [prodotto_id, lottoVal, scadenzaVal, newQty, note || '']
      );
      giacenzaId = ins.rows[0].id;
    }
    await client.query(
      `INSERT INTO movimenti_giacenza
        (giacenza_id,prodotto_id,lotto,tipo,quantita,quantita_prima,quantita_dopo,utente_id,utente_nome,note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [giacenzaId, prodotto_id, lottoVal, tipoVal, qty, oldQty, newQty, req.user.id || null, utenteName, note || '']
    );
    await client.query('COMMIT');
    client.release();
    res.json({ ok: true, giacenza_id: giacenzaId });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    client.release();
    res.status(500).json({ error: e.message });
  }
});

// POST /api/giacenze/import — import iniziale da Excel
app.post('/api/giacenze/carico-batch', authMiddleware, requireRole('admin', 'magazzino'), async (req, res) => {
  const client = await pool.connect();
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const tipoVal = ['carico', 'reso', 'tentata_vendita'].includes(req.body?.tipo) ? req.body.tipo : 'carico';
    const sharedNote = String(req.body?.note || '').trim();
    if (!rows.length) return res.status(400).json({ error: 'Nessuna riga da caricare' });
    const utenteName = `${req.user.nome || ''} ${req.user.cognome || ''}`.trim() || req.user.username || '';

    const normalizedRows = rows.map((row, index) => {
      const prodottoId = Number(row?.prodotto_id);
      const lottoVal = String(row?.lotto || '').trim();
      const qty = Number(row?.quantita);
      if (!prodottoId) {
        const err = new Error(`prodotto_id obbligatorio alla riga ${index + 1}`);
        err.status = 400;
        throw err;
      }
      if (!lottoVal) {
        const err = new Error(`lotto obbligatorio alla riga ${index + 1}`);
        err.status = 400;
        throw err;
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        const err = new Error(`quantita deve essere > 0 alla riga ${index + 1}`);
        err.status = 400;
        throw err;
      }
      return {
        prodotto_id: prodottoId,
        lotto: lottoVal,
        quantita: qty,
        scadenza: row?.scadenza || null,
        note: String(row?.note || sharedNote || '').trim(),
      };
    });

    await client.query('BEGIN');
    const giacenzaIds = [];
    for (const row of normalizedRows) {
      const { rows: prodRows } = await client.query(
        'SELECT gestione_giacenza FROM prodotti WHERE id=$1 LIMIT 1',
        [row.prodotto_id]
      );
      if (!prodRows.length) {
        const err = new Error('Prodotto non trovato');
        err.status = 404;
        throw err;
      }
      if (!prodRows[0].gestione_giacenza) {
        const err = new Error('Il prodotto non è gestito a giacenza');
        err.status = 400;
        throw err;
      }

      const { rows: existing } = await client.query(
        'SELECT id, quantita FROM giacenze WHERE prodotto_id=$1 AND lotto=$2 LIMIT 1',
        [row.prodotto_id, row.lotto]
      );
      let giacenzaId, oldQty, newQty;
      if (existing.length) {
        giacenzaId = existing[0].id;
        oldQty = Number(existing[0].quantita);
        newQty = oldQty + row.quantita;
        await client.query(
          'UPDATE giacenze SET quantita=$1, updated_at=NOW() WHERE id=$2',
          [newQty, giacenzaId]
        );
      } else {
        oldQty = 0;
        newQty = row.quantita;
        const ins = await client.query(
          `INSERT INTO giacenze (prodotto_id, lotto, scadenza, quantita, note)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [row.prodotto_id, row.lotto, row.scadenza, newQty, row.note || '']
        );
        giacenzaId = ins.rows[0].id;
      }
      await client.query(
        `INSERT INTO movimenti_giacenza
          (giacenza_id,prodotto_id,lotto,tipo,quantita,quantita_prima,quantita_dopo,utente_id,utente_nome,note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [giacenzaId, row.prodotto_id, row.lotto, tipoVal, row.quantita, oldQty, newQty, req.user.id || null, utenteName, row.note || '']
      );
      giacenzaIds.push(giacenzaId);
    }
    await client.query('COMMIT');
    client.release();
    res.json({ ok: true, count: giacenzaIds.length, giacenza_ids: giacenzaIds });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    client.release();
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/api/giacenze/import', authMiddleware, requireRole('admin', 'magazzino'), async (req, res) => {
  const client = await pool.connect();
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) {
      client.release();
      return res.status(400).json({ error: 'Nessuna riga da importare' });
    }

    const normalized = rows.map((row, idx) => ({
      idx: idx + 1,
      codice: String(row?.codice || '').trim().toUpperCase(),
      descrizione: String(row?.descrizione || '').trim(),
      lotto: String(row?.lotto || '').trim(),
      um: String(row?.um || '').trim(),
      quantita: Number(row?.quantita),
      scadenza: row?.scadenza ? String(row.scadenza).trim() : null,
    }));

    const invalid = normalized.filter(r => !r.codice || !r.lotto || !Number.isFinite(r.quantita) || r.quantita <= 0);
    if (invalid.length) {
      client.release();
      return res.status(400).json({
        error: 'Il file contiene righe non valide',
        invalid_rows: invalid.slice(0, 20).map(r => ({
          riga: r.idx,
          codice: r.codice,
          lotto: r.lotto,
          quantita: r.quantita,
        })),
      });
    }

    const codici = [...new Set(normalized.map(r => r.codice))];
    let { rows: prodotti } = await client.query(
      `SELECT id, codice, nome, um, gestione_giacenza
       FROM prodotti
       WHERE UPPER(codice) = ANY($1::text[])`,
      [codici]
    );
    const prodottiMap = new Map(prodotti.map(p => [String(p.codice || '').trim().toUpperCase(), p]));
    const createdProducts = [];

    const missingByCode = new Map();
    normalized.forEach(r => {
      if (!prodottiMap.has(r.codice) && !missingByCode.has(r.codice)) missingByCode.set(r.codice, r);
    });

    if (missingByCode.size) {
      for (const row of missingByCode.values()) {
        const um = row.um || 'pz';
        const pesoFisso = String(um).toLowerCase() !== 'kg';
        const ins = await client.query(
          `INSERT INTO prodotti
            (codice,nome,categoria,um,packaging,peso_fisso,gestione_giacenza,punto_riordino,auto_anagrafato,auto_anagrafato_at,note)
           VALUES ($1,$2,$3,$4,$5,$6,TRUE,NULL,TRUE,NOW(),$7)
           RETURNING id, codice, nome, um, gestione_giacenza`,
          [
            row.codice,
            row.descrizione || row.codice,
            'ALTRO',
            um,
            '',
            pesoFisso,
            'Creato automaticamente da import giacenze Excel',
          ]
        );
        const created = ins.rows[0];
        prodottiMap.set(created.codice, created);
        createdProducts.push({ codice: created.codice, nome: created.nome });
      }
      prodotti = [...prodotti, ...createdProducts];
    }

    const excluded = normalized.filter(r => !prodottiMap.get(r.codice)?.gestione_giacenza);
    if (excluded.length) {
      client.release();
      return res.status(400).json({
        error: 'Alcuni prodotti non sono gestiti a giacenza',
        excluded_codes: [...new Set(excluded.map(r => r.codice))],
      });
    }

    const warnings = [];
    const aggregated = new Map();
    for (const row of normalized) {
      const prodotto = prodottiMap.get(row.codice);
      if (!prodotto) continue;
      if (row.descrizione && prodotto.nome && row.descrizione.localeCompare(prodotto.nome, 'it', { sensitivity: 'base' }) !== 0) {
        warnings.push({
          riga: row.idx,
          codice: row.codice,
          excel: row.descrizione,
          sistema: prodotto.nome,
        });
      }
      if (row.um && prodotto.um && row.um.localeCompare(prodotto.um, 'it', { sensitivity: 'base' }) !== 0) {
        warnings.push({
          riga: row.idx,
          codice: row.codice,
          excel: row.um,
          sistema: prodotto.um,
          tipo: 'um',
        });
      }

      const key = `${prodotto.id}__${row.lotto.toUpperCase()}`;
      const current = aggregated.get(key) || {
        prodotto_id: prodotto.id,
        codice: prodotto.codice,
        nome: prodotto.nome,
        lotto: row.lotto,
        quantita: 0,
        scadenza: row.scadenza || null,
      };
      current.quantita += row.quantita;
      if (!current.scadenza && row.scadenza) current.scadenza = row.scadenza;
      aggregated.set(key, current);
    }

    const utenteName = `${req.user.nome || ''} ${req.user.cognome || ''}`.trim() || req.user.username || '';
    let imported = 0;

    await client.query('BEGIN');
    for (const row of aggregated.values()) {
      const { rows: existing } = await client.query(
        'SELECT id, quantita FROM giacenze WHERE prodotto_id=$1 AND lotto=$2 LIMIT 1',
        [row.prodotto_id, row.lotto]
      );
      let giacenzaId;
      let oldQty = 0;
      let newQty = row.quantita;
      if (existing.length) {
        giacenzaId = existing[0].id;
        oldQty = Number(existing[0].quantita || 0);
        newQty = oldQty + row.quantita;
        await client.query(
          `UPDATE giacenze
           SET quantita=$1, scadenza=COALESCE($2, scadenza), updated_at=NOW()
           WHERE id=$3`,
          [newQty, row.scadenza, giacenzaId]
        );
      } else {
        const ins = await client.query(
          `INSERT INTO giacenze (prodotto_id, lotto, scadenza, quantita, note)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [row.prodotto_id, row.lotto, row.scadenza, row.quantita, 'Import giacenza iniziale da Excel']
        );
        giacenzaId = ins.rows[0].id;
      }
      await client.query(
        `INSERT INTO movimenti_giacenza
          (giacenza_id,prodotto_id,lotto,tipo,quantita,quantita_prima,quantita_dopo,utente_id,utente_nome,note)
         VALUES ($1,$2,$3,'carico',$4,$5,$6,$7,$8,$9)`,
        [giacenzaId, row.prodotto_id, row.lotto, row.quantita, oldQty, newQty, req.user.id || null, utenteName, 'Import giacenza iniziale da Excel']
      );
      imported++;
    }
    await client.query('COMMIT');
    client.release();
    res.json({
      ok: true,
      imported_rows: imported,
      created_products: createdProducts,
      warnings: warnings.slice(0, 50),
    });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    client.release();
    res.status(500).json({ error: e.message });
  }
});

// POST /api/giacenze/inventario-import — rettifica massiva da inventario fisico
app.post('/api/giacenze/inventario-import', authMiddleware, requireRole('admin', 'magazzino'), async (req, res) => {
  const client = await pool.connect();
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const zeroMissing = !!req.body?.zero_missing;
    const noteVal = String(req.body?.note || '').trim() || 'Inventario fisico massivo';
    if (!rows.length) {
      client.release();
      return res.status(400).json({ error: 'Nessuna riga da importare' });
    }

    const normalized = rows.map((row, idx) => ({
      idx: idx + 1,
      codice: String(row?.codice || '').trim().toUpperCase(),
      descrizione: String(row?.descrizione || '').trim(),
      lotto: String(row?.lotto || '').trim(),
      um: String(row?.um || '').trim(),
      quantita: Number(row?.quantita),
      scadenza: row?.scadenza ? String(row.scadenza).trim() : null,
    }));

    const invalid = normalized.filter(r => !r.codice || !r.lotto || !Number.isFinite(r.quantita) || r.quantita < 0);
    if (invalid.length) {
      client.release();
      return res.status(400).json({
        error: 'Il file contiene righe non valide',
        invalid_rows: invalid.slice(0, 20).map(r => ({
          riga: r.idx,
          codice: r.codice,
          lotto: r.lotto,
          quantita: r.quantita,
        })),
      });
    }

    const codici = [...new Set(normalized.map(r => r.codice))];
    const { rows: prodotti } = await client.query(
      `SELECT id, codice, nome, um, gestione_giacenza
       FROM prodotti
       WHERE UPPER(codice) = ANY($1::text[])`,
      [codici]
    );
    const prodottiMap = new Map(prodotti.map(p => [String(p.codice || '').trim().toUpperCase(), p]));
    const missingCodes = codici.filter(c => !prodottiMap.has(c));
    if (missingCodes.length) {
      client.release();
      return res.status(400).json({ error: 'Alcuni codici non esistono in anagrafica prodotti', missing_codes: missingCodes });
    }

    const excluded = normalized.filter(r => !prodottiMap.get(r.codice)?.gestione_giacenza);
    if (excluded.length) {
      client.release();
      return res.status(400).json({
        error: 'Alcuni prodotti non sono gestiti a giacenza',
        excluded_codes: [...new Set(excluded.map(r => r.codice))],
      });
    }

    const warnings = [];
    const aggregated = new Map();
    for (const row of normalized) {
      const prodotto = prodottiMap.get(row.codice);
      if (row.descrizione && prodotto.nome && row.descrizione.localeCompare(prodotto.nome, 'it', { sensitivity: 'base' }) !== 0) {
        warnings.push({ riga: row.idx, codice: row.codice, excel: row.descrizione, sistema: prodotto.nome });
      }
      if (row.um && prodotto.um && row.um.localeCompare(prodotto.um, 'it', { sensitivity: 'base' }) !== 0) {
        warnings.push({ riga: row.idx, codice: row.codice, excel: row.um, sistema: prodotto.um, tipo: 'um' });
      }
      const key = `${prodotto.id}__${row.lotto.toUpperCase()}`;
      const current = aggregated.get(key) || {
        prodotto_id: prodotto.id,
        codice: prodotto.codice,
        nome: prodotto.nome,
        lotto: row.lotto,
        quantita: 0,
        scadenza: row.scadenza || null,
      };
      current.quantita += row.quantita;
      if (!current.scadenza && row.scadenza) current.scadenza = row.scadenza;
      aggregated.set(key, current);
    }

    const utenteName = `${req.user.nome || ''} ${req.user.cognome || ''}`.trim() || req.user.username || '';
    const importedKeys = new Set(aggregated.keys());
    const stats = { updated_rows: 0, created_rows: 0, zeroed_rows: 0, unchanged_rows: 0 };

    await client.query('BEGIN');
    const { rows: existingRows } = await client.query(
      `SELECT g.id, g.prodotto_id, g.lotto, g.quantita, g.scadenza
       FROM giacenze g
       JOIN prodotti p ON p.id = g.prodotto_id
       WHERE COALESCE(p.gestione_giacenza, TRUE) = TRUE
       FOR UPDATE`
    );
    const existingMap = new Map(existingRows.map(r => [`${r.prodotto_id}__${String(r.lotto || '').trim().toUpperCase()}`, r]));

    for (const row of aggregated.values()) {
      const key = `${row.prodotto_id}__${String(row.lotto || '').trim().toUpperCase()}`;
      const existing = existingMap.get(key);
      if (!existing) {
        if (Number(row.quantita || 0) === 0) {
          stats.unchanged_rows++;
          continue;
        }
        const ins = await client.query(
          `INSERT INTO giacenze (prodotto_id, lotto, scadenza, quantita, note)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [row.prodotto_id, row.lotto, row.scadenza, row.quantita, noteVal]
        );
        await client.query(
          `INSERT INTO movimenti_giacenza
            (giacenza_id,prodotto_id,lotto,tipo,quantita,quantita_prima,quantita_dopo,utente_id,utente_nome,note)
           VALUES ($1,$2,$3,'rettifica',$4,$5,$6,$7,$8,$9)`,
          [ins.rows[0].id, row.prodotto_id, row.lotto, row.quantita, 0, row.quantita, req.user.id || null, utenteName, noteVal]
        );
        stats.created_rows++;
        continue;
      }
      const oldQty = Number(existing.quantita || 0);
      const newQty = Number(row.quantita || 0);
      const delta = newQty - oldQty;
      if (delta === 0 && (!row.scadenza || String(existing.scadenza || '').slice(0, 10) === String(row.scadenza || '').slice(0, 10))) {
        stats.unchanged_rows++;
        continue;
      }
      await client.query(
        `UPDATE giacenze
         SET quantita=$1, scadenza=$2, updated_at=NOW(), note=CASE WHEN COALESCE(note,'') = '' THEN $3 ELSE note END
         WHERE id=$4`,
        [newQty, row.scadenza || existing.scadenza || null, noteVal, existing.id]
      );
      await client.query(
        `INSERT INTO movimenti_giacenza
          (giacenza_id,prodotto_id,lotto,tipo,quantita,quantita_prima,quantita_dopo,utente_id,utente_nome,note)
         VALUES ($1,$2,$3,'rettifica',$4,$5,$6,$7,$8,$9)`,
        [existing.id, row.prodotto_id, row.lotto, delta, oldQty, newQty, req.user.id || null, utenteName, noteVal]
      );
      stats.updated_rows++;
    }

    if (zeroMissing) {
      for (const row of existingRows) {
        const key = `${row.prodotto_id}__${String(row.lotto || '').trim().toUpperCase()}`;
        if (importedKeys.has(key)) continue;
        const oldQty = Number(row.quantita || 0);
        if (oldQty === 0) continue;
        await client.query(
          `UPDATE giacenze SET quantita=0, updated_at=NOW(), note=CASE WHEN COALESCE(note,'') = '' THEN $1 ELSE note END WHERE id=$2`,
          [noteVal, row.id]
        );
        await client.query(
          `INSERT INTO movimenti_giacenza
            (giacenza_id,prodotto_id,lotto,tipo,quantita,quantita_prima,quantita_dopo,utente_id,utente_nome,note)
           VALUES ($1,$2,$3,'rettifica',$4,$5,$6,$7,$8,$9)`,
          [row.id, row.prodotto_id, row.lotto, -oldQty, oldQty, 0, req.user.id || null, utenteName, `${noteVal} - lotto assente dal file`]
        );
        stats.zeroed_rows++;
      }
    }

    await client.query('COMMIT');
    client.release();
    await logDB(req.user.id, utenteName, 'Import inventario giacenze', `${stats.updated_rows} aggiornati, ${stats.created_rows} creati, ${stats.zeroed_rows} azzerati, zero_missing=${zeroMissing}`);
    res.json({ ok: true, ...stats, warnings: warnings.slice(0, 50) });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    client.release();
    res.status(500).json({ error: e.message });
  }
});

// POST /api/giacenze/:id/scarico-manuale
app.post('/api/giacenze/:id/scarico-manuale', authMiddleware, requireRole('admin', 'magazzino'), async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    const quantita = Number(req.body?.quantita);
    const noteVal = String(req.body?.note || '').trim();
    if (!Number.isFinite(quantita) || quantita <= 0) {
      client.release();
      return res.status(400).json({ error: 'quantita deve essere > 0' });
    }
    const { rows: existing } = await client.query('SELECT * FROM giacenze WHERE id=$1 LIMIT 1', [id]);
    if (!existing.length) {
      client.release();
      return res.status(404).json({ error: 'Giacenza non trovata' });
    }
    const giac = existing[0];
    const qtyBefore = Number(giac.quantita || 0);
    if (quantita > qtyBefore) {
      client.release();
      return res.status(400).json({ error: 'Quantità insufficiente in giacenza' });
    }
    const qtyAfter = qtyBefore - quantita;
    const utenteName = `${req.user.nome || ''} ${req.user.cognome || ''}`.trim() || req.user.username || '';

    await client.query('BEGIN');
    await client.query('UPDATE giacenze SET quantita=$1, updated_at=NOW() WHERE id=$2', [qtyAfter, id]);
    await client.query(
      `INSERT INTO movimenti_giacenza
        (giacenza_id,prodotto_id,lotto,tipo,quantita,quantita_prima,quantita_dopo,utente_id,utente_nome,note)
       VALUES ($1,$2,$3,'scarico_manuale',$4,$5,$6,$7,$8,$9)`,
      [id, giac.prodotto_id, giac.lotto, -quantita, qtyBefore, qtyAfter, req.user.id || null, utenteName, noteVal]
    );
    await client.query('COMMIT');
    client.release();
    res.json({ ok: true });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    client.release();
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/giacenze/:id — modifica giacenza
app.post('/api/giacenze/scarico-batch', authMiddleware, requireRole('admin', 'magazzino'), async (req, res) => {
  const client = await pool.connect();
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) {
      client.release();
      return res.status(400).json({ error: 'Nessuna riga da scaricare' });
    }
    const utenteName = `${req.user.nome || ''} ${req.user.cognome || ''}`.trim() || req.user.username || '';
    await client.query('BEGIN');
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const prodottoId = Number(row.prodotto_id);
      const lotto = String(row.lotto || '').trim();
      const quantita = Number(row.quantita);
      const noteVal = String(row.note || '').trim();
      if (!Number.isFinite(prodottoId) || prodottoId <= 0 || !lotto || !Number.isFinite(quantita) || quantita <= 0) {
        throw new Error(`Riga ${i + 1}: dati non validi`);
      }
      const { rows: existing } = await client.query(
        'SELECT * FROM giacenze WHERE prodotto_id=$1 AND lotto=$2 LIMIT 1',
        [prodottoId, lotto]
      );
      if (!existing.length) throw new Error(`Riga ${i + 1}: lotto non trovato in giacenza`);
      const giac = existing[0];
      const qtyBefore = Number(giac.quantita || 0);
      if (quantita > qtyBefore) throw new Error(`Riga ${i + 1}: quantità insufficiente in giacenza`);
      const qtyAfter = qtyBefore - quantita;
      await client.query('UPDATE giacenze SET quantita=$1, updated_at=NOW() WHERE id=$2', [qtyAfter, giac.id]);
      await client.query(
        `INSERT INTO movimenti_giacenza
          (giacenza_id,prodotto_id,lotto,tipo,quantita,quantita_prima,quantita_dopo,utente_id,utente_nome,note)
         VALUES ($1,$2,$3,'scarico_manuale',$4,$5,$6,$7,$8,$9)`,
        [giac.id, giac.prodotto_id, giac.lotto, -quantita, qtyBefore, qtyAfter, req.user.id || null, utenteName, noteVal]
      );
    }
    await client.query('COMMIT');
    client.release();
    res.json({ ok: true, count: rows.length });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    client.release();
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/giacenze/:id', authMiddleware, requireRole('admin', 'magazzino'), async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    const { rows: existing } = await client.query('SELECT * FROM giacenze WHERE id=$1 LIMIT 1', [id]);
    if (!existing.length) { client.release(); return res.status(404).json({ error: 'Giacenza non trovata' }); }
    const giac = existing[0];
    const { lotto, scadenza, quantita, note } = req.body || {};
    const utenteName = `${req.user.nome || ''} ${req.user.cognome || ''}`.trim() || req.user.username || '';

    const sets = ['updated_at=NOW()'];
    const params = [];
    let p = 1;
    if (lotto !== undefined) { sets.push(`lotto=$${p++}`); params.push(String(lotto || '').trim()); }
    if (scadenza !== undefined) { sets.push(`scadenza=$${p++}`); params.push(scadenza || null); }
    if (quantita !== undefined) { sets.push(`quantita=$${p++}`); params.push(Number(quantita)); }
    if (note !== undefined) { sets.push(`note=$${p++}`); params.push(note || ''); }
    params.push(id);
    await client.query(`UPDATE giacenze SET ${sets.join(', ')} WHERE id=$${p}`, params);

    if (quantita !== undefined && Number(quantita) !== Number(giac.quantita)) {
      const nuovaQty = Number(quantita);
      const diff = nuovaQty - Number(giac.quantita);
      await client.query(
        `INSERT INTO movimenti_giacenza
          (giacenza_id,prodotto_id,lotto,tipo,quantita,quantita_prima,quantita_dopo,utente_id,utente_nome,note)
         VALUES ($1,$2,$3,'rettifica',$4,$5,$6,$7,$8,'Modifica manuale giacenza')`,
        [id, giac.prodotto_id, giac.lotto, diff, Number(giac.quantita), nuovaQty, req.user.id || null, utenteName]
      );
    }
    await client.query('COMMIT');
    client.release();
    res.json({ ok: true });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    client.release();
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/giacenze/:id
app.delete('/api/giacenze/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await q('DELETE FROM giacenze WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/giacenze/:id/rettifica — inventario fisico
app.post('/api/giacenze/:id/rettifica', authMiddleware, requireRole('admin', 'magazzino'), async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    const { rows: existing } = await client.query('SELECT * FROM giacenze WHERE id=$1 LIMIT 1', [id]);
    if (!existing.length) { client.release(); return res.status(404).json({ error: 'Giacenza non trovata' }); }
    const giac = existing[0];
    const nuovaQty = Number(req.body?.nuova_quantita);
    if (!Number.isFinite(nuovaQty)) { client.release(); return res.status(400).json({ error: 'nuova_quantita non valida' }); }
    const noteVal = req.body?.note || '';
    const utenteName = `${req.user.nome || ''} ${req.user.cognome || ''}`.trim() || req.user.username || '';
    const diff = nuovaQty - Number(giac.quantita);

    await client.query('BEGIN');
    await client.query('UPDATE giacenze SET quantita=$1, updated_at=NOW() WHERE id=$2', [nuovaQty, id]);
    await client.query(
      `INSERT INTO movimenti_giacenza
        (giacenza_id,prodotto_id,lotto,tipo,quantita,quantita_prima,quantita_dopo,utente_id,utente_nome,note)
       VALUES ($1,$2,$3,'rettifica',$4,$5,$6,$7,$8,$9)`,
      [id, giac.prodotto_id, giac.lotto, diff, Number(giac.quantita), nuovaQty, req.user.id || null, utenteName, noteVal]
    );
    await client.query('COMMIT');
    client.release();
    res.json({ ok: true });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    client.release();
    res.status(500).json({ error: e.message });
  }
});

// GET /api/giacenze/movimenti
app.get('/api/giacenze/movimenti', authMiddleware, requireRole('admin', 'magazzino'), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
    const offset = parseInt(req.query.offset || '0', 10);
    const prodottoId = req.query.prodotto_id ? parseInt(req.query.prodotto_id, 10) : null;
    const lotto = req.query.lotto ? String(req.query.lotto).trim() : null;

    const conditions = [];
    const params = [];
    let pi = 1;
    if (prodottoId) { conditions.push(`m.prodotto_id=$${pi++}`); params.push(prodottoId); }
    if (lotto) { conditions.push(`m.lotto=$${pi++}`); params.push(lotto); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit, offset);

    const { rows } = await q(
      `SELECT m.*, p.nome as prodotto_nome, p.codice
       FROM movimenti_giacenza m LEFT JOIN prodotti p ON p.id = m.prodotto_id
       ${where}
       ORDER BY m.created_at DESC
       LIMIT $${pi++} OFFSET $${pi++}`,
      params
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/prodotti/:id/punto-riordino
app.patch('/api/prodotti/:id/punto-riordino', authMiddleware, requireRole('admin', 'magazzino', 'direzione'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const puntoRiordino = req.body?.punto_riordino !== undefined
      ? (req.body.punto_riordino === null || req.body.punto_riordino === '' ? null : Number(req.body.punto_riordino))
      : null;
    if (puntoRiordino !== null && (!Number.isFinite(puntoRiordino) || puntoRiordino < 0)) {
      return res.status(400).json({ error: 'Punto di riordino non valido' });
    }
    await q('UPDATE prodotti SET punto_riordino=$1 WHERE id=$2', [puntoRiordino, id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/prodotti/:id/riordino', authMiddleware, requireRole('admin', 'magazzino', 'direzione'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const quantita = Number(req.body?.quantita);
    if (!id) return res.status(400).json({ error: 'Prodotto non valido' });
    if (!Number.isFinite(quantita) || quantita <= 0) return res.status(400).json({ error: 'Quantità ordinata non valida' });
    const utenteNome = `${req.user.nome || ''} ${req.user.cognome || ''}`.trim() || req.user.username || '';
    await q(
      `UPDATE prodotti
       SET ultimo_riordino_qta=$1,
           ultimo_riordino_at=NOW(),
           ultimo_riordino_utente_id=$2,
           ultimo_riordino_utente_nome=$3
       WHERE id=$4`,
      [quantita, req.user.id || null, utenteNome, id]
    );
    await logDB(req.user.id, utenteNome, 'Riordino prodotto', `prodotto #${id} - qty ${quantita}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/giacenze/rientro-tv — prodotti preparati per una data/giro
app.get('/api/giacenze/rientro-tv', authMiddleware, requireRole('admin', 'magazzino'), async (req, res) => {
  try {
    const data = req.query.data || '';
    const giro = String(req.query.giro || '').trim();
    const clienteId = Number.parseInt(req.query.cliente_id, 10);
    if (!data) return res.status(400).json({ error: 'data obbligatoria' });
    if (req.query.cliente_id !== undefined && (!Number.isFinite(clienteId) || clienteId <= 0)) {
      return res.status(400).json({ error: 'cliente_id non valido' });
    }
    const { rows } = await q(
      `SELECT ol.prodotto_id, p.nome, p.codice, p.um, ol.lotto,
              o.cliente_id, c.nome AS cliente_nome,
              p.um AS unita_misura, SUM(COALESCE(ol.qty_base, ol.qty)) as qty_totale, SUM(ol.peso_effettivo) as peso_totale
       FROM ordine_linee ol
       JOIN ordini o ON o.id = ol.ordine_id
       JOIN clienti c ON c.id = o.cliente_id
       JOIN prodotti p ON p.id = ol.prodotto_id
       WHERE o.data = $1 AND ol.preparato = true AND ol.lotto != ''
         AND COALESCE(p.gestione_giacenza, TRUE) = TRUE
         AND (
           LOWER(COALESCE(c.classificazione, '')) = $2
           OR UPPER(TRIM(COALESCE(c.nome, ''))) LIKE $3
         )
         AND ($4::int IS NULL OR o.cliente_id = $4)
         AND ($5 = '' OR COALESCE(NULLIF(o.giro_override,''), NULLIF(c.giro,''), '') = $5)
       GROUP BY ol.prodotto_id, p.nome, p.codice, p.um, ol.lotto, o.cliente_id, c.nome
       ORDER BY c.nome, p.nome, ol.lotto, p.um`,
      [
        data,
        TENTATA_VENDITA_CLIENT_CLASS,
        `${TENTATA_VENDITA_CLIENT_NAME}%`,
        Number.isFinite(clienteId) && clienteId > 0 ? clienteId : null,
        giro,
      ]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/giacenze/rientro-tv — conferma rientro merce tentata vendita
app.post('/api/giacenze/rientro-tv', authMiddleware, requireRole('admin', 'magazzino'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { righe } = req.body || {};
    if (!Array.isArray(righe) || !righe.length) { client.release(); return res.status(400).json({ error: 'righe obbligatorie' }); }
    const utenteName = `${req.user.nome || ''} ${req.user.cognome || ''}`.trim() || req.user.username || '';
    await client.query('BEGIN');
    for (const r of righe) {
      const qty = Number(r.quantita_rientro || 0);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const lottoVal = String(r.lotto || '').trim();
      const prodottoId = Number(r.prodotto_id || 0);
      if (!Number.isFinite(prodottoId) || prodottoId <= 0) continue;
      const { rows: prodotti } = await client.query(
        `SELECT id, um, cartoni_attivi, peso_medio_pezzo_kg, pezzi_per_cartone, unita_per_cartone, pedane_attive, cartoni_per_pedana
         FROM prodotti
         WHERE id=$1
         LIMIT 1`,
        [prodottoId]
      );
      const prodotto = prodotti[0];
      if (!prodotto) continue;
      const unitaMisura = String(r.unita_misura || prodotto.um || 'pezzi').trim() || 'pezzi';
      const qtyBase = calcolaQtyBaseRiga({ qty, unitaMisura, prodotto });
      const qtyMagazzino = Number.isFinite(qtyBase) && qtyBase > 0 ? qtyBase : qty;
      const { rows: existing } = await client.query(
        'SELECT id, quantita FROM giacenze WHERE prodotto_id=$1 AND lotto=$2 LIMIT 1',
        [prodottoId, lottoVal]
      );
      let giacenzaId, oldQty, newQty;
      if (existing.length) {
        giacenzaId = existing[0].id;
        oldQty = Number(existing[0].quantita);
        newQty = oldQty + qtyMagazzino;
        await client.query('UPDATE giacenze SET quantita=$1, updated_at=NOW() WHERE id=$2', [newQty, giacenzaId]);
      } else {
        oldQty = 0;
        newQty = qtyMagazzino;
        const ins = await client.query(
          `INSERT INTO giacenze (prodotto_id,lotto,quantita,note) VALUES ($1,$2,$3,$4) RETURNING id`,
          [prodottoId, lottoVal, newQty, r.note || '']
        );
        giacenzaId = ins.rows[0].id;
      }
      await client.query(
        `INSERT INTO movimenti_giacenza
          (giacenza_id,prodotto_id,lotto,tipo,quantita,quantita_prima,quantita_dopo,utente_id,utente_nome,note)
         VALUES ($1,$2,$3,'tentata_vendita',$4,$5,$6,$7,$8,$9)`,
        [giacenzaId, prodottoId, lottoVal, qtyMagazzino, oldQty, newQty, req.user.id || null, utenteName, r.note || '']
      );
    }
    await client.query('COMMIT');
    client.release();
    res.json({ ok: true });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    client.release();
    res.status(500).json({ error: e.message });
  }
});

// ─── END GIACENZE API ──────────────────────────────────────────────

app.get('/api/health', (req, res) => res.json({ status: 'ok', version: '2.0.0' }));

app.get('/api/dev/metrics', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const tDb0 = Date.now();
    await q('SELECT 1');
    const db_latency_ms = Date.now() - tDb0;

    const [utenti, clienti, ordini, prodotti, camions, onboarding, recent] = await Promise.all([
      q('SELECT COUNT(*)::int AS n FROM utenti'),
      q('SELECT COUNT(*)::int AS n FROM clienti'),
      q('SELECT COUNT(*)::int AS n FROM ordini'),
      q('SELECT COUNT(*)::int AS n FROM prodotti'),
      q('SELECT COUNT(*)::int AS n FROM camions'),
      q(`SELECT COUNT(*)::int AS n
         FROM clienti
         WHERE onboarding_stato <> 'approvato' OR sbloccato = FALSE`),
      q('SELECT id,user_name,action,detail,ts FROM activity_log ORDER BY id DESC LIMIT 20'),
    ]);

    res.json({
      server_time: new Date().toISOString(),
      version: '2.0.0',
      uptime_sec: Math.floor(process.uptime()),
      memory_mb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      db_latency_ms,
      counts: {
        utenti: utenti.rows[0].n,
        clienti: clienti.rows[0].n,
        ordini: ordini.rows[0].n,
        prodotti: prodotti.rows[0].n,
        camions: camions.rows[0].n,
      },
      onboarding: {
        pending: onboarding.rows[0].n,
      },
      recent_activity: recent.rows,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/dev/smoke', authMiddleware, requireRole('admin'), async (req, res) => {
  const checks = [];
  let ok = true;
  try {
    const t0 = Date.now();
    await q('SELECT 1');
    checks.push({ check: 'db_connection', ok: true, ms: Date.now() - t0 });
  } catch (e) {
    ok = false;
    checks.push({ check: 'db_connection', ok: false, error: e.message });
  }

  try {
    const r = await q("SELECT COUNT(*)::int AS n FROM clienti WHERE onboarding_stato='approvato' AND sbloccato=TRUE");
    checks.push({ check: 'approved_clients', ok: true, value: r.rows[0].n });
  } catch (e) {
    ok = false;
    checks.push({ check: 'approved_clients', ok: false, error: e.message });
  }

  try {
    const r = await q("SELECT COUNT(*)::int AS n FROM ordini WHERE data >= CURRENT_DATE - INTERVAL '7 days'");
    checks.push({ check: 'orders_last_7d', ok: true, value: r.rows[0].n });
  } catch (e) {
    ok = false;
    checks.push({ check: 'orders_last_7d', ok: false, error: e.message });
  }

  try {
    const r = await q("SELECT COUNT(*)::int AS n FROM listini WHERE (valido_al IS NULL OR valido_al >= CURRENT_DATE)");
    checks.push({ check: 'active_listini', ok: true, value: r.rows[0].n });
  } catch (e) {
    ok = false;
    checks.push({ check: 'active_listini', ok: false, error: e.message });
  }

  try {
    const r = await q("SELECT COUNT(*)::int AS n FROM clienti_crm_eventi WHERE followup_date IS NOT NULL AND followup_date <= CURRENT_DATE + INTERVAL '7 days'");
    checks.push({ check: 'crm_followup_next_7d', ok: true, value: r.rows[0].n });
  } catch (e) {
    ok = false;
    checks.push({ check: 'crm_followup_next_7d', ok: false, error: e.message });
  }

  try {
    const r = await q("SELECT COUNT(*)::int AS n FROM camions WHERE layout IN ('asym8','sym12','ford5')");
    checks.push({ check: 'camion_layout_supported', ok: true, value: r.rows[0].n });
  } catch (e) {
    ok = false;
    checks.push({ check: 'camion_layout_supported', ok: false, error: e.message });
  }

  res.json({
    ok,
    ts: new Date().toISOString(),
    checks,
  });
});

// Serve frontend
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── AVVIO ───────────────────────────────────────────────────────
async function start() {
  try {
    await pool.query('SELECT 1'); // test connessione
    console.log('✅ Connesso a PostgreSQL');
    await createSchema();
    await migrateLegacyMessaggiToConversations();
    await seed();
    startEmailNotificationsScheduler();
    startExperimentalScheduler();
    app.listen(PORT, () => {
      console.log(`\n🧀 Norbalat Ordini v2 — http://localhost:${PORT}`);
      console.log(`   DB: ${DATABASE_URL.replace(/:([^:@]+)@/, ':****@')}\n`);
    });
  } catch(e) {
    console.error('❌ Errore avvio:', e.message);
    console.error('\n👉 Assicurati che PostgreSQL sia avviato e che il database esista.');
    console.error('   Crea il DB con: createdb norbalat');
    console.error('   Oppure imposta DATABASE_URL nel file .env\n');
    process.exit(1);
  }
}
start();

