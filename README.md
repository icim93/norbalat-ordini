# Norbalat Ordini v2

Gestione ordini, clienti, prodotti, piano di carico e activity log per Norbalat.

## Stack
- **Backend**: Node.js + Express + SQLite (better-sqlite3)
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
```

## API principali

| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login → JWT |
| GET | `/api/utenti` | Lista utenti |
| GET | `/api/clienti` | Lista clienti |
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

SQLite in `./data/norbalat.db` — backup giornaliero consigliato:

```bash
cp data/norbalat.db data/norbalat-$(date +%Y%m%d).db
```
