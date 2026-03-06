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

const PORT        = process.env.PORT       || 3000;
const JWT_SECRET  = process.env.JWT_SECRET || 'norbalat-secret-change-in-production-2026';
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/norbalat';
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
const SMTP_FROM = process.env.SMTP_FROM || '';
const SMTP_FROM_NAME = process.env.SMTP_FROM_NAME || 'Norbalat Ordini';
const NOTIFY_EMAIL_TO = process.env.NOTIFY_EMAIL_TO || '';
const NOTIFY_TIMEZONE = process.env.NOTIFY_TIMEZONE || 'Europe/Rome';
const EXPERIMENTAL_SOURCE_URL = process.env.EXPERIMENTAL_SOURCE_URL || '';

const app  = express();
const pool = new Pool({ connectionString: DATABASE_URL });

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Helper query
const q = (text, params) => pool.query(text, params);

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

function isSmtpConfigured() {
  return !!(SMTP_HOST && SMTP_PORT && SMTP_FROM);
}

function getSmtpTransporter() {
  if (!isSmtpConfigured()) return null;
  if (!smtpTransporter) {
    smtpTransporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
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
      onboarding_stato TEXT DEFAULT 'in_attesa',
      onboarding_checklist JSONB DEFAULT '{}'::jsonb,
      fido             NUMERIC DEFAULT 0,
      sbloccato        BOOLEAN DEFAULT FALSE,
      onboarding_approvato_da TEXT,
      onboarding_approvato_at TIMESTAMPTZ,
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
      note        TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS ordini (
      id               SERIAL PRIMARY KEY,
      cliente_id       INTEGER NOT NULL REFERENCES clienti(id),
      agente_id        INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
      autista_di_giro  INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
      inserted_by      INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
      data             DATE NOT NULL,
      stato            TEXT NOT NULL DEFAULT 'attesa'
                         CHECK(stato IN ('attesa','preparazione','consegnato','annullato')),
      note             TEXT DEFAULT '',
      data_non_certa   BOOLEAN DEFAULT FALSE,
      stef             BOOLEAN DEFAULT FALSE,
      inserted_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at       TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ordine_linee (
      id              SERIAL PRIMARY KEY,
      ordine_id       INTEGER NOT NULL REFERENCES ordini(id) ON DELETE CASCADE,
      prodotto_id     INTEGER NOT NULL REFERENCES prodotti(id),
      qty             NUMERIC NOT NULL DEFAULT 1,
      prezzo_unitario NUMERIC,
      peso_effettivo  NUMERIC,
      is_pedana       BOOLEAN DEFAULT FALSE,
      nota_riga       TEXT DEFAULT ''
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
      esito       TEXT DEFAULT '',
      stato_cliente TEXT DEFAULT '',
      richiesta   TEXT DEFAULT '',
      motivo      TEXT DEFAULT '',
      note        TEXT DEFAULT '',
      followup_date DATE,
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

    CREATE INDEX IF NOT EXISTS idx_ordini_data    ON ordini(data);
    CREATE INDEX IF NOT EXISTS idx_ordini_stato   ON ordini(stato);
    CREATE INDEX IF NOT EXISTS idx_ordini_agente  ON ordini(agente_id);
    CREATE INDEX IF NOT EXISTS idx_ordini_cliente ON ordini(cliente_id);
    CREATE INDEX IF NOT EXISTS idx_linee_ordine   ON ordine_linee(ordine_id);
    CREATE INDEX IF NOT EXISTS idx_activity_ts    ON activity_log(ts);
    CREATE INDEX IF NOT EXISTS idx_listini_prod_cliente ON listini(prodotto_id,cliente_id);
    CREATE INDEX IF NOT EXISTS idx_listini_validita ON listini(valido_dal,valido_al);
    CREATE INDEX IF NOT EXISTS idx_crm_cliente_created ON clienti_crm_eventi(cliente_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_doc_folders_parent ON doc_folders(parent_id);
    CREATE INDEX IF NOT EXISTS idx_doc_files_folder ON doc_files(folder_id);

    -- Migrazioni safe per DB esistenti
    ALTER TABLE clienti     ADD COLUMN IF NOT EXISTS classificazione TEXT DEFAULT '';
    ALTER TABLE clienti     ADD COLUMN IF NOT EXISTS onboarding_stato TEXT DEFAULT 'in_attesa';
    ALTER TABLE clienti     ADD COLUMN IF NOT EXISTS onboarding_checklist JSONB DEFAULT '{}'::jsonb;
    ALTER TABLE clienti     ADD COLUMN IF NOT EXISTS fido             NUMERIC DEFAULT 0;
    ALTER TABLE clienti     ADD COLUMN IF NOT EXISTS sbloccato        BOOLEAN DEFAULT FALSE;
    ALTER TABLE clienti     ADD COLUMN IF NOT EXISTS onboarding_approvato_da TEXT;
    ALTER TABLE clienti     ADD COLUMN IF NOT EXISTS onboarding_approvato_at TIMESTAMPTZ;
    ALTER TABLE clienti     ADD COLUMN IF NOT EXISTS codice_fiscale   TEXT DEFAULT '';
    ALTER TABLE clienti     ADD COLUMN IF NOT EXISTS codice_univoco   TEXT DEFAULT '';
    ALTER TABLE clienti     ADD COLUMN IF NOT EXISTS pec              TEXT DEFAULT '';
    ALTER TABLE clienti     ADD COLUMN IF NOT EXISTS created_at       TIMESTAMPTZ DEFAULT NOW();
    ALTER TABLE ordine_linee ADD COLUMN IF NOT EXISTS is_pedana      BOOLEAN DEFAULT FALSE;
    ALTER TABLE ordine_linee ADD COLUMN IF NOT EXISTS nota_riga      TEXT DEFAULT '';
    ALTER TABLE ordine_linee ADD COLUMN IF NOT EXISTS unita_misura   TEXT DEFAULT 'pezzi';
    ALTER TABLE ordine_linee ADD COLUMN IF NOT EXISTS prezzo_unitario NUMERIC;
    ALTER TABLE listini     ADD COLUMN IF NOT EXISTS giro            TEXT DEFAULT '';
    ALTER TABLE listini     ADD COLUMN IF NOT EXISTS scope           TEXT NOT NULL DEFAULT 'all';
    ALTER TABLE listini     ADD COLUMN IF NOT EXISTS mode            TEXT NOT NULL DEFAULT 'final_price';
    ALTER TABLE listini     ADD COLUMN IF NOT EXISTS base_price      NUMERIC;
    ALTER TABLE listini     ADD COLUMN IF NOT EXISTS markup_pct      NUMERIC DEFAULT 0;
    ALTER TABLE listini     ADD COLUMN IF NOT EXISTS discount_pct    NUMERIC DEFAULT 0;
    ALTER TABLE listini     ADD COLUMN IF NOT EXISTS final_price     NUMERIC;
    ALTER TABLE listini     ADD COLUMN IF NOT EXISTS excluded_client_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE doc_folders ADD COLUMN IF NOT EXISTS allowed_roles JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE doc_folders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    ALTER TABLE doc_files   ADD COLUMN IF NOT EXISTS mime_type TEXT NOT NULL DEFAULT 'application/octet-stream';
    ALTER TABLE doc_files   ADD COLUMN IF NOT EXISTS size_bytes INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE clienti_crm_eventi ADD COLUMN IF NOT EXISTS stato_cliente TEXT DEFAULT '';
    ALTER TABLE clienti_crm_eventi ADD COLUMN IF NOT EXISTS followup_date DATE;
    ALTER TABLE clienti_crm_eventi ADD COLUMN IF NOT EXISTS priorita TEXT DEFAULT 'media';
    CREATE INDEX IF NOT EXISTS idx_crm_followup ON clienti_crm_eventi(followup_date);
    UPDATE clienti_crm_eventi SET priorita = 'media' WHERE priorita IS NULL OR priorita = '';
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
  'listini:view': ['admin', 'amministrazione', 'direzione', 'autista', 'magazzino'],
  'listini:manage': ['admin', 'direzione'],
  'onboarding:manage': ['admin', 'amministrazione'],
  'ordini:create': ['admin', 'amministrazione', 'direzione', 'autista', 'magazzino'],
  'ordini:update': ['admin', 'amministrazione', 'direzione', 'autista', 'magazzino'],
  'ordini:delete': ['admin', 'amministrazione'],
  'ordini:stato': ['admin', 'autista', 'magazzino', 'amministrazione', 'direzione'],
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

const zCrmEventoPayload = z.object({
  tipo: z.string().min(1).max(80).optional().default('richiesta'),
  esito: z.string().max(300).optional().default(''),
  stato_cliente: z.string().max(80).optional().default(''),
  richiesta: z.string().max(2000).optional().default(''),
  motivo: z.string().max(2000).optional().default(''),
  note: z.string().max(3000).optional().default(''),
  followup_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  priorita: z.string().max(20).optional().default('media'),
});

const zConsegnaParzialePayload = z.object({
  delivered: z.record(z.coerce.number()).optional().default({}),
  note: z.string().max(2000).optional().default(''),
  preferred_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
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
    const { rows } = await q('SELECT * FROM utenti WHERE username=$1', [username]);
    const u = rows[0];
    if (!u || !(await bcrypt.compare(password, u.password)))
      return res.status(401).json({ error: 'Credenziali errate' });
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
    const dup = await q('SELECT id FROM utenti WHERE username=$1', [username]);
    if (dup.rows.length) return res.status(409).json({ error: 'Username già esistente' });
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const r = await q(
      `INSERT INTO utenti (nome,cognome,username,password,ruolo,tipo_utente,giri_consegna,is_agente)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [nome, cognome, username, hash, ruolo, tipo_utente, JSON.stringify(giri_consegna), is_agente]
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
    const dup = await q('SELECT id FROM utenti WHERE username=$1 AND id!=$2', [username, id]);
    if (dup.rows.length) return res.status(409).json({ error: 'Username già in uso' });
    if (password) {
      const hash = await bcrypt.hash(password, SALT_ROUNDS);
      await q(
        `UPDATE utenti SET nome=$1,cognome=$2,username=$3,password=$4,ruolo=$5,
         tipo_utente=$6,giri_consegna=$7,is_agente=$8 WHERE id=$9`,
        [nome, cognome, username, hash, ruolo, tipo_utente, JSON.stringify(giri_consegna), is_agente, id]
      );
    } else {
      await q(
        `UPDATE utenti SET nome=$1,cognome=$2,username=$3,ruolo=$4,
         tipo_utente=$5,giri_consegna=$6,is_agente=$7 WHERE id=$8`,
        [nome, cognome, username, ruolo, tipo_utente, JSON.stringify(giri_consegna), is_agente, id]
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
    const { rows: dup } = await q('SELECT id FROM utenti WHERE username=$1 AND id!=$2', [username, id]);
    if (dup.length) return res.status(400).json({ error: 'Username già in uso' });

    if (password) {
      const bcrypt = require('bcrypt');
      const hash = await bcrypt.hash(password, 10);
      await q('UPDATE utenti SET nome=$1,cognome=$2,username=$3,password=$4 WHERE id=$5',
        [nome, cognome, username, hash, id]);
    } else {
      await q('UPDATE utenti SET nome=$1,cognome=$2,username=$3 WHERE id=$4',
        [nome, cognome, username, id]);
    }
    res.json({ ok: true, nome, cognome, username });
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
app.get('/api/clienti', authMiddleware, async (req, res) => {
  try {
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
    const { nome, localita='', giro='', agente_id=null, autista_di_giro=null,
            note='', piva='', codice_fiscale='', codice_univoco='', pec='',
            cond_pagamento='', e_fornitore=false, classificazione='' } = req.body;
    if (!nome) return res.status(400).json({ error: 'Nome obbligatorio' });
    const r = await q(
      `INSERT INTO clienti (nome,localita,giro,agente_id,autista_di_giro,note,piva,codice_fiscale,codice_univoco,pec,cond_pagamento,e_fornitore,classificazione,onboarding_stato,onboarding_checklist,fido,sbloccato)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'in_attesa',$14::jsonb,0,FALSE)
       RETURNING id,nome,localita,giro,piva,codice_fiscale,codice_univoco,pec,onboarding_stato,fido,sbloccato`,
      [nome, localita, giro, agente_id||null, autista_di_giro||null, note, piva, codice_fiscale, codice_univoco, pec, cond_pagamento, e_fornitore, classificazione, JSON.stringify({})]
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
    const { nome, localita='', giro='', agente_id=null, autista_di_giro=null,
            note='', piva='', codice_fiscale='', codice_univoco='', pec='',
            cond_pagamento='', e_fornitore=false, classificazione='' } = req.body;
    if (!nome) return res.status(400).json({ error: 'Nome obbligatorio' });
    await q(
      `UPDATE clienti SET nome=$1,localita=$2,giro=$3,agente_id=$4,autista_di_giro=$5,
       note=$6,piva=$7,codice_fiscale=$8,codice_univoco=$9,pec=$10,cond_pagamento=$11,e_fornitore=$12,classificazione=$13 WHERE id=$14`,
      [nome, localita, giro, agente_id||null, autista_di_giro||null, note, piva, codice_fiscale, codice_univoco, pec, cond_pagamento, e_fornitore, classificazione, id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
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
          e.esito,
          e.stato_cliente,
          e.followup_date,
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
    const { tipo, esito, stato_cliente, richiesta, motivo, note, followup_date, priorita } = parsed.data;
    const userName = `${req.user.nome} ${req.user.cognome || ''}`.trim();
    const r = await q(
      `INSERT INTO clienti_crm_eventi
        (cliente_id,tipo,esito,stato_cliente,richiesta,motivo,note,followup_date,priorita,user_id,user_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        clienteId,
        String(tipo || 'richiesta'),
        String(esito || ''),
        String(stato_cliente || ''),
        String(richiesta || ''),
        String(motivo || ''),
        String(note || ''),
        followup_date || null,
        String(priorita || 'media'),
        req.user.id || null,
        userName || 'Sistema',
      ]
    );
    await logDB(req.user.id, userName, 'CRM cliente', `cliente #${clienteId} - ${tipo}`);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── PRODOTTI ────────────────────────────────────────────────────
app.get('/api/prodotti', authMiddleware, async (req, res) => {
  try {
    const { rows } = await q('SELECT * FROM prodotti ORDER BY categoria,nome');
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/prodotti', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { codice, nome, categoria, um, packaging='', peso_fisso=false, note='' } = req.body;
    if (!codice||!nome||!categoria||!um) return res.status(400).json({ error: 'Campi mancanti' });
    const dup = await q('SELECT id FROM prodotti WHERE codice=$1', [codice.toUpperCase()]);
    if (dup.rows.length) return res.status(409).json({ error: 'Codice già esistente' });
    const r = await q(
      `INSERT INTO prodotti (codice,nome,categoria,um,packaging,peso_fisso,note)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [codice.toUpperCase(), nome, categoria, um, packaging, peso_fisso, note]
    );
    res.json({ id: r.rows[0].id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/prodotti/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { codice, nome, categoria, um, packaging='', peso_fisso=false, note='' } = req.body;
    if (!codice||!nome) return res.status(400).json({ error: 'Campi mancanti' });
    const dup = await q('SELECT id FROM prodotti WHERE codice=$1 AND id!=$2', [codice.toUpperCase(), id]);
    if (dup.rows.length) return res.status(409).json({ error: 'Codice già in uso' });
    await q(
      `UPDATE prodotti SET codice=$1,nome=$2,categoria=$3,um=$4,packaging=$5,peso_fisso=$6,note=$7 WHERE id=$8`,
      [codice.toUpperCase(), nome, categoria, um, packaging, peso_fisso, note, id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/prodotti/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    await q('DELETE FROM prodotti WHERE id=$1', [parseInt(req.params.id)]);
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
    SELECT ol.*, p.codice, p.nome as prodotto_nome, p.um, p.packaging
    FROM ordine_linee ol JOIN prodotti p ON ol.prodotto_id = p.id
    WHERE ol.ordine_id = $1 ORDER BY ol.id`, [id]);
  ordine.linee = linee.rows;
  return ordine;
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
    if (giro)       { where.push(`c.giro=$${pi++}`);             params.push(giro); }
    if (search)     {
      where.push(`(c.nome ILIKE $${pi} OR u.nome ILIKE $${pi+1})`);
      params.push(`%${search}%`, `%${search}%`); pi += 2;
    }

    const { rows } = await q(`
      SELECT o.id, o.data, o.stato, o.note, o.data_non_certa, o.stef,
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
        `SELECT ol.ordine_id, ol.prodotto_id, ol.qty, ol.peso_effettivo,
                ol.prezzo_unitario, ol.is_pedana, ol.nota_riga, ol.unita_misura,
                p.codice, p.nome as prodotto_nome, p.um, p.packaging
         FROM ordine_linee ol JOIN prodotti p ON ol.prodotto_id = p.id
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
            data, stato='attesa', note='', data_non_certa=false, stef=false, linee=[] } = req.body;
    if (!cliente_id||!data) return res.status(400).json({ error: 'Campi obbligatori mancanti' });
    if (!linee.length) return res.status(400).json({ error: 'Almeno un prodotto richiesto' });
    const c = await q('SELECT id, sbloccato, onboarding_stato FROM clienti WHERE id=$1', [cliente_id]);
    if (!c.rows.length) return res.status(400).json({ error: 'Cliente non trovato' });
    if (!c.rows[0].sbloccato || c.rows[0].onboarding_stato !== 'approvato') return res.status(403).json({ error: 'Cliente non ancora approvato dall\'amministrazione' });

    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO ordini (cliente_id,agente_id,autista_di_giro,inserted_by,data,stato,note,data_non_certa,stef)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [cliente_id, agente_id||null, autista_di_giro||null, req.user.id, data, stato, note, data_non_certa, stef]
    );
    const oid = r.rows[0].id;
    for (const l of linee) {
      const prezzoUnitario = await resolvePrezzoUnitario({
        prodottoId: l.prodotto_id,
        clienteId: cliente_id,
        data,
        client,
      });
      await client.query(
        `INSERT INTO ordine_linee (ordine_id,prodotto_id,qty,prezzo_unitario,is_pedana,nota_riga,unita_misura) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [oid, l.prodotto_id, l.qty, prezzoUnitario, !!l.is_pedana, l.nota_riga||'', l.unita_misura||'pezzi']
      );
    }
    await client.query('COMMIT');
    const u = req.user;
    await logDB(u.id, `${u.nome} ${u.cognome||''}`.trim(), 'Nuovo ordine', `#${oid}`);
    res.json(await getOrdineCompleto(oid));
  } catch(e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

app.put('/api/ordini/:id', authMiddleware, requirePermission('ordini:update'), async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id);
    const { cliente_id, agente_id=null, autista_di_giro=null,
            data, stato, note='', data_non_certa=false, stef=false, linee=[] } = req.body;
    if (!cliente_id||!data||!stato) return res.status(400).json({ error: 'Campi mancanti' });
    const c = await q('SELECT id, sbloccato, onboarding_stato FROM clienti WHERE id=$1', [cliente_id]);
    if (!c.rows.length) return res.status(400).json({ error: 'Cliente non trovato' });
    if (!c.rows[0].sbloccato || c.rows[0].onboarding_stato !== 'approvato') return res.status(403).json({ error: 'Cliente non ancora approvato dall\'amministrazione' });

    await client.query('BEGIN');
    await client.query(
      `UPDATE ordini SET cliente_id=$1,agente_id=$2,autista_di_giro=$3,data=$4,stato=$5,
       note=$6,data_non_certa=$7,stef=$8,updated_at=NOW() WHERE id=$9`,
      [cliente_id, agente_id||null, autista_di_giro||null, data, stato, note, data_non_certa, stef, id]
    );
    await client.query('DELETE FROM ordine_linee WHERE ordine_id=$1', [id]);
    for (const l of linee) {
      const prezzoUnitario = await resolvePrezzoUnitario({
        prodottoId: l.prodotto_id,
        clienteId: cliente_id,
        data,
        client,
      });
      await client.query(
        `INSERT INTO ordine_linee (ordine_id,prodotto_id,qty,prezzo_unitario,is_pedana,nota_riga,unita_misura)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, l.prodotto_id, l.qty, prezzoUnitario, !!l.is_pedana, l.nota_riga||'', l.unita_misura||'pezzi']
      );
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
  try {
    const id = parseInt(req.params.id);
    const { stato } = req.body;
    if (!stato) return res.status(400).json({ error: 'Stato mancante' });
    await q('UPDATE ordini SET stato=$1,updated_at=NOW() WHERE id=$2', [stato, id]);
    res.json({ ok: true, stato });
  } catch(e) { res.status(500).json({ error: e.message }); }
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
          qty: residuo,
          is_pedana: !!l.is_pedana,
          nota_riga: l.nota_riga || '',
          unita_misura: l.unita_misura || 'pezzi',
          prezzo_unitario: l.prezzo_unitario,
        });
      }
    }
    if (!residuali.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Nessun residuo da riportare: usa consegna completa' });
    }

    const { rows: cRows } = await client.query('SELECT giro FROM clienti WHERE id=$1', [ordine.cliente_id]);
    const giro = cRows[0]?.giro || '';
    const autoNextData = await getNextDeliveryDate(giro, ordine.data);
    const nextData = preferredDate && preferredDate >= autoNextData ? preferredDate : autoNextData;

    const ins = await client.query(
      `INSERT INTO ordini (cliente_id,agente_id,autista_di_giro,inserted_by,data,stato,note,data_non_certa,stef,inserted_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,'attesa',$6,$7,$8,NOW(),NOW()) RETURNING id`,
      [
        ordine.cliente_id,
        ordine.agente_id || null,
        ordine.autista_di_giro || null,
        req.user.id || null,
        nextData,
        `[RIPORTO PARZIALE da #${ordineId}] ${note}`.trim(),
        !!ordine.data_non_certa,
        !!ordine.stef,
      ]
    );
    const newOrdineId = ins.rows[0].id;
    for (const r of residuali) {
      await client.query(
        `INSERT INTO ordine_linee (ordine_id,prodotto_id,qty,prezzo_unitario,is_pedana,nota_riga,unita_misura)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [newOrdineId, r.prodotto_id, r.qty, r.prezzo_unitario, r.is_pedana, r.nota_riga, r.unita_misura]
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
    const { rows: camions } = await q('SELECT * FROM camions ORDER BY id');
    for (const c of camions) {
      const { rows: pedane } = await q('SELECT numero, nota FROM pedane WHERE camion_id=$1 ORDER BY numero', [c.id]);
      c.pedane = pedane;
    }
    res.json(camions);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/camions/:id/pedane', authMiddleware, requireRole('admin','autista'), async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id);
    const { pedane } = req.body;
    await client.query('BEGIN');
    for (const p of pedane) {
      await client.query('UPDATE pedane SET nota=$1 WHERE camion_id=$2 AND numero=$3', [p.nota||'', id, p.numero]);
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

app.put('/api/giri/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    await q('UPDATE giri_calendario SET giorni=$1 WHERE id=$2',
      [JSON.stringify(req.body.giorni||[]), parseInt(req.params.id)]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── ACTIVITY LOG ────────────────────────────────────────────────
app.get('/api/impostazioni/notifiche-email', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const cfg = await getEmailNotificationSettings();
    res.json({
      ...cfg,
      smtp_configured: isSmtpConfigured(),
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
      smtp_configured: isSmtpConfigured(),
      smtp_from: SMTP_FROM || '',
      timezone: NOTIFY_TIMEZONE,
    });
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
      return res.status(400).json({ error: 'SMTP non configurato sul server (.env)' });
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

app.delete('/api/activity', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    await q('DELETE FROM activity_log');
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── STATS ───────────────────────────────────────────────────────
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

async function getExperimentalSourceConfig() {
  const defaults = {
    url: EXPERIMENTAL_SOURCE_URL || '',
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
    await seed();
    startEmailNotificationsScheduler();
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

