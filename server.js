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

const app  = express();
const pool = new Pool({ connectionString: DATABASE_URL });

app.use(cors());
app.use(express.json());
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
      onboarding_approvato_at TIMESTAMPTZ
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

    CREATE INDEX IF NOT EXISTS idx_ordini_data    ON ordini(data);
    CREATE INDEX IF NOT EXISTS idx_ordini_stato   ON ordini(stato);
    CREATE INDEX IF NOT EXISTS idx_ordini_agente  ON ordini(agente_id);
    CREATE INDEX IF NOT EXISTS idx_ordini_cliente ON ordini(cliente_id);
    CREATE INDEX IF NOT EXISTS idx_linee_ordine   ON ordine_linee(ordine_id);
    CREATE INDEX IF NOT EXISTS idx_activity_ts    ON activity_log(ts);

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
    ALTER TABLE ordine_linee ADD COLUMN IF NOT EXISTS is_pedana      BOOLEAN DEFAULT FALSE;
    ALTER TABLE ordine_linee ADD COLUMN IF NOT EXISTS nota_riga      TEXT DEFAULT '';
    ALTER TABLE ordine_linee ADD COLUMN IF NOT EXISTS unita_misura   TEXT DEFAULT 'pezzi';

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

async function logOnboardingChange({ clienteId, reqUser, oldStato, newStato, oldFido, newFido, note = '' }) {
  const userName = `${reqUser.nome} ${reqUser.cognome || ''}`.trim();
  await q(
    `INSERT INTO clienti_onboarding_log (cliente_id,user_id,user_name,old_stato,new_stato,old_fido,new_fido,note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [clienteId, reqUser.id || null, userName || 'Sistema', oldStato || null, newStato || null, oldFido ?? null, newFido ?? null, note || '']
  );
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
    await logDB(u.id, `${u.nome} ${u.cognome||''}`.trim(), 'Nuovo cliente', nome);
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
                ol.is_pedana, ol.nota_riga, ol.unita_misura,
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
      await client.query(
        `INSERT INTO ordine_linee (ordine_id,prodotto_id,qty,is_pedana,nota_riga,unita_misura) VALUES ($1,$2,$3,$4,$5,$6)`,
        [oid, l.prodotto_id, l.qty, !!l.is_pedana, l.nota_riga||'', l.unita_misura||'pezzi']
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
      await client.query(
        `INSERT INTO ordine_linee (ordine_id,prodotto_id,qty) VALUES ($1,$2,$3)`,
        [id, l.prodotto_id, l.qty]
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
