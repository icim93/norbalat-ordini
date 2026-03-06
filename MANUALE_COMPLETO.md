# Manuale Completo Norbalat Ordini

## 1. Panoramica
Norbalat Ordini e' una web app per la gestione operativa di ordini, clienti, listini, magazzino, piano di carico, report e documenti aziendali.

Obiettivi principali:
- acquisizione ordini rapida (classica o catalogo)
- controllo prezzi con listini e fallback intelligente
- tracciamento stato ordine fino alla consegna
- supporto operativo magazzino e autisti
- report giornalieri/PDF
- archivio documenti con permessi per ruolo

## 2. Ruoli e Permessi
Ruoli applicativi:
- `admin`
- `amministrazione`
- `direzione`
- `autista`
- `magazzino`

Permessi chiave:
- clienti: creazione/aggiornamento secondo policy backend
- listini: visione ampia, gestione limitata (`admin`, `direzione`)
- ordini: create/update/stato/delete per ruoli abilitati
- onboarding clienti: `admin`, `amministrazione`
- documenti:
  - vista sezione: tutti
  - gestione cartelle/file: `admin`, `amministrazione`, `direzione`
  - accesso cartella/file vincolato da ACL cartella

## 3. Accesso
1. Aprire l'app.
2. Inserire username/password.
3. Dopo login viene caricata la navigazione in base al ruolo.

Nota: se non compaiono nuove sezioni dopo deploy, eseguire hard refresh (`Ctrl+F5`) e rifare login.

## 4. Navigazione Principale
Sezioni principali (variano per ruolo):
- Dashboard
- Ordini
- Clienti
- Documenti
- Listini
- Prodotti
- Utenti
- Piano Carico
- Magazzino
- Report
- Impostazioni
- Sperimentale
- Profilo

## 5. Modulo Ordini
### 5.1 Nuovo Ordine (modale classica)
Campi principali:
- Cliente
- Agente
- Consegnatario (auto dal giro)
- Data consegna
- Giro override (solo per quell'ordine)
- Stato
- flag `Data non certa`
- flag `Spedizione STEF`
- flag `Altro vettore`
- righe prodotto
- note ordine

### 5.2 Righe Prodotto
Per ogni riga sono disponibili:
- selezione prodotto da anagrafica
- quantita
- unita misura
- prezzo unitario (modificabile)
- prodotto libero (testo, se non presente a catalogo)
- nota riga

### 5.3 Logica Prezzo Riga
Ordine di precedenza:
1. prezzo inserito manualmente in riga
2. prezzo da listino valido (se presente)
3. ultimo prezzo usato per stesso cliente+prodotto
4. `0`

### 5.4 Modalita Catalogo
Consente ordine guidato per categorie con carrello.
Supporta:
- flag STEF / Altro vettore
- data incerta
- giro override
- note ordine

### 5.5 Stati Ordine
- attesa
- preparazione
- consegnato
- annullato

### 5.6 Consegna Parziale
Da dettaglio ordine e' possibile registrare consegna parziale.
Il residuo viene riportato su nuovo ordine in data successiva (automatica o forzata).

## 6. Modulo Clienti
Funzioni:
- anagrafica clienti
- ricerca e filtri giro
- onboarding (bozza/in attesa/in verifica/approvato/rifiutato/sospeso)
- CRM cliente
- import Excel clienti
- gestione fido e blocco/sblocco ordine

## 7. Modulo Listini
Funzioni:
- regole prezzo per scope (`all`, `giro`, `cliente`, `giro_cliente`)
- validita temporale
- esclusioni clienti
- PDF listini

Uso listino nei prezzi ordine:
- applicazione automatica sulla data ordine
- fallback ultimo prezzo se non esiste regola valida

## 8. Modulo Prodotti
Funzioni:
- anagrafica prodotti
- categoria, UM, packaging, note
- modifica/eliminazione (ruoli abilitati)

## 9. Modulo Documenti
Sezione visibile a tutti.

### 9.1 Cartelle e Sottocartelle
- creazione cartella (manager documenti)
- parent opzionale (sottocartella)
- ACL per ruoli visibili

### 9.2 Regole ACL
- `admin`, `amministrazione`, `direzione`: accesso completo a tutte le cartelle/file
- altri ruoli: accesso solo se inclusi in `allowed_roles` della cartella (e gerarchia padre consentita)

### 9.3 File
- upload in cartella
- elenco file cartella
- download file
- delete file (solo manager)

Limite corrente upload: 10MB per file.

## 10. Piano di Carico
Piano ora separato per data.

### 10.1 Flusso
1. Selezionare data piano.
2. Selezionare camion.
3. Compilare pedane.
4. Salvare piano.
5. (magazzino/admin) confermare carico.

### 10.2 Nuovo Piano Giornaliero
Pulsante `Nuovo piano`:
- svuota pedane per il giorno selezionato
- non impatta altri giorni

### 10.3 Regola Data
Entrando in un giorno diverso, viene aperto il dataset pedane di quel giorno.
Se non esiste, viene creato vuoto.

## 11. Modulo Magazzino
Funzioni:
- filtro ordini per data/stato/giro
- presa in carico ordine
- checklist righe prodotto
- supporto pesi effettivi (quando richiesto)

## 12. Report e PDF
Funzioni:
- report operativo per data/filtro giri
- PDF magazzino/fatturazione
- uso quantita e unita riga (non forzate su UM prodotto)

## 13. Profilo e Utenti
- profilo personale (dati e credenziali)
- gestione utenti da admin
- assegnazione ruolo/tipo utente/giri consegna

## 14. Configurazione Tecnica
Stack:
- backend: Node.js + Express + PostgreSQL
- frontend: HTML/CSS/JS vanilla

Avvio locale:
1. `npm install`
2. configurare `.env` (DB e variabili)
3. `npm start`

## 15. Variabili Ambiente Principali
- `PORT`
- `DATABASE_URL`
- `JWT_SECRET`
- blocco email/notifiche (`SMTP_*`, `NOTIFY_*`)
- blocco integrazioni esterne (`PIVA_*`, `EXPERIMENTAL_*`)

## 16. Troubleshooting Rapido
### 16.1 Sezione Documenti non visibile
- hard refresh (`Ctrl+F5`)
- logout/login
- verificare di essere sull'ambiente corretto (staging vs production)
- verificare che il deploy includa il commit con `documenti-ui.js`

### 16.2 Prezzi ordine inattesi
- controllare prezzo manuale riga
- controllare listino valido per data/scope
- verificare storico prezzi cliente+prodotto

### 16.3 Piano carico apparentemente vuoto
- verificare data selezionata in `Piano di Carico`
- ogni data ha un piano separato

### 16.4 Deploy non triggerato
- controllare branch/auto-deploy/webhook in Render
- eseguire `Manual Deploy -> Deploy latest commit`

## 17. Best Practice Operative
- usare `giro override` solo per eccezioni singolo ordine
- valorizzare `prezzo unitario` quando necessario (deroghe)
- usare `prodotto libero` solo per casi spot non ricorrenti
- confermare piano carico solo dopo check pedane completo

## 18. Changelog Operativo (sintesi)
Ultime evoluzioni incluse:
- Documenti utili con ACL cartelle/file
- Tooltip azioni principali in tabelle
- Ordini: prezzo riga manuale + fallback listino/storico
- Ordini: prodotto libero
- Ordini: flag `Altro vettore`
- Ordini: giro override per singola consegna
- Piano carico separato per data + nuovo piano giornaliero
