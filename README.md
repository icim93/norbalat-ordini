# Norbalat Ordini v2

Gestione ordini, clienti, prodotti, piano di carico e activity log per Norbalat.

## Stack
- **Backend**: Node.js + Express + PostgreSQL
- **Auth**: JWT (12h)
- **Frontend**: HTML/CSS/JS monolitico servito da Express

## Avvio rapido

```bash
npm install
node server.js
```

Apri **http://localhost:3000**

## Credenziali default (cambiale subito!)

| Utente | Username | Password | Ruolo |
|--------|----------|----------|-------|
| Marco Palmisano | `marco` | `1234` | admin |
| Francesco Chiarappa | `francescoc` | `1234` | direzione |
| Gianvito Chiarappa | `gianvito` | `1234` | direzione |
| Marica Chiarappa | `marica` | `1234` | direzione |
| Mariella Lacatena | `mariella` | `1234` | direzione |
| Gaston Casas | `gaston` | `1234` | magazzino |
| Franco Laricchiuta | `franco` | `1234` | magazzino |
| Francesco Avossa | `francescoa` | `1234` | autista |
| Emanuele Fornaro | `emanuele` | `1234` | autista |

## Deploy su Hetzner VPS

```bash
# Installa Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Clona/carica il progetto, poi:
npm install
npm install -g pm2
pm2 start server.js --name norbalat
pm2 save
pm2 startup

# Nginx reverse proxy (opzionale)
# proxy_pass http://localhost:3000;
```

## Variabili d'ambiente

Crea un file `.env` (o impostale nel sistema):

```
PORT=3000
JWT_SECRET=cambia-questo-segreto-in-produzione
DATABASE_URL=postgresql://user:password@host:5432/database
DATABASE_SSL_MODE=
DB_CONNECT_TIMEOUT_MS=15000
STARTUP_DB_MAX_RETRIES=6
STARTUP_DB_RETRY_DELAY_MS=5000

# Lookup automatico anagrafica da Partita IVA (opzionale)
PIVA_LOOKUP_URL=
PIVA_LOOKUP_TOKEN=
PIVA_LOOKUP_AUTH_HEADER=Authorization
PIVA_LOOKUP_TOKEN_PREFIX=Bearer 
PIVA_LOOKUP_EXTRA_HEADERS=
```

Note bootstrap DB:
- `DB_CONNECT_TIMEOUT_MS`: timeout singolo di connessione PostgreSQL.
- `STARTUP_DB_MAX_RETRIES`: numero massimo di tentativi all'avvio prima del fail definitivo.
- `STARTUP_DB_RETRY_DELAY_MS`: attesa tra un tentativo e il successivo.
- `DATABASE_SSL_MODE`: lascia vuoto per l'autodetect oppure usa `require` su provider remoti come Render.

## API principali

| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login → JWT |
| GET | `/api/utenti` | Lista utenti |
| GET | `/api/clienti` | Lista clienti |
| POST | `/api/clienti/lookup-piva` | Precompila dati cliente da P.IVA |
| GET | `/api/prodotti` | Lista prodotti |
| GET | `/api/ordini` | Lista ordini (filtri: data, stato, giro) |
| POST | `/api/ordini` | Nuovo ordine |
| PUT | `/api/ordini/:id` | Modifica ordine |
| DELETE | `/api/ordini/:id` | Elimina ordine |
| GET | `/api/camions` | Piano di carico |
| PATCH | `/api/camions/:id/pedane` | Salva pedane |
| PATCH | `/api/camions/:id/conferma` | Conferma carico |
| GET | `/api/stats/dashboard` | Stats dashboard |
| GET | `/api/activity` | Activity log |

## Database

PostgreSQL. Prima dell'avvio assicurati che `DATABASE_URL` punti a un database raggiungibile.

Se il database remoto ha un problema temporaneo, il server effettua retry automatici all'avvio e stampa diagnostica aggiuntiva nei log.

```bash
pg_dump "$DATABASE_URL" > backup-$(date +%Y%m%d).sql
```
