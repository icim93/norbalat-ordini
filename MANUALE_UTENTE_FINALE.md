# Manuale Utente Finale - Norbalat Ordini

## 1. Obiettivo del programma
Norbalat Ordini e' il gestionale operativo per:
- inserire e aggiornare ordini
- gestire clienti, prodotti e listini
- coordinare magazzino e piano di carico
- generare report giornalieri
- consultare documenti aziendali utili

Questo manuale e' pensato per chi usa il programma ogni giorno.

## 2. Accesso
1. Apri il link del gestionale.
2. Inserisci username e password.
3. Premi `Accedi`.

Se dopo un aggiornamento non vedi una funzione nuova:
- fai `Ctrl+F5`
- esci e rientra con il tuo utente

## 3. Menu principale
In base al ruolo, vedi alcune o tutte queste sezioni:
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
- Il mio profilo

## 4. Sezione Ordini
### 4.1 Nuovo ordine (modalita classica)
Compila:
- Cliente
- Agente
- Data consegna
- Stato
- Note ordine (se necessarie)

Opzioni disponibili:
- `Data non certa`
- `Spedizione STEF`
- `Altro vettore`
- `Giro override` (solo per quell'ordine/consegna)

### 4.2 Righe prodotto
Per ogni riga puoi impostare:
- Prodotto da anagrafica
- Quantita
- Unita di misura
- Prezzo unitario (sempre modificabile)
- Nota riga
- Prodotto libero (testo), utile per articolo spot non presente in anagrafica

### 4.3 Regola automatica del prezzo riga
Quando selezioni un prodotto, il prezzo predefinito segue questo ordine:
1. prezzo da listino valido
2. ultimo prezzo usato per quel prodotto su quel cliente
3. valore `0`

Il prezzo resta comunque modificabile manualmente.

### 4.4 Modifica e dettaglio ordine
Dalla tabella ordini puoi:
- modificare ordine
- aprire dettaglio
- eliminare ordine

Nel dettaglio puoi anche fare:
- conferma consegna
- consegna parziale (con riporto residuo su nuovo ordine)

## 5. Sezione Clienti
Funzioni principali:
- ricerca cliente
- filtro per giro
- creazione/modifica anagrafica
- onboarding cliente (per ruoli abilitati)
- CRM cliente

Nota: un cliente non approvato puo' essere bloccato all'ordine finche' onboarding non e' completato.

## 6. Sezione Listini
Serve per gestire regole prezzo per:
- tutti
- per giro
- per cliente
- per giro + cliente

Con validita nel tempo (`dal/al`) e note.

## 7. Sezione Prodotti
Gestisci:
- codice
- nome
- categoria
- unita di misura
- packaging
- note

## 8. Sezione Documenti
Sezione visibile a tutti gli utenti.

### 8.1 Cosa puoi fare
- aprire cartelle visibili al tuo ruolo
- scaricare file disponibili

### 8.2 Gestione cartelle/file (solo ruoli autorizzati)
Utenti con gestione completa:
- admin
- amministrazione
- direzione

Possono:
- creare cartelle e sottocartelle
- scegliere i ruoli che possono vedere ogni cartella
- caricare/eliminare file

Regola importante:
- se una cartella non e' visibile al tuo ruolo, non puoi aprire neppure i file dentro.

## 9. Sezione Piano Carico
Il piano di carico e' ora gestito per giorno.

### 9.1 Uso corretto
1. Seleziona la data in alto.
2. Scegli il camion.
3. Compila le pedane.
4. Salva il piano.

### 9.2 Nuovo piano giornaliero
Il pulsante `Nuovo piano` svuota il piano del giorno selezionato.
Se cambi data, vedi il piano di quel giorno (se non esiste, parte vuoto).

## 10. Sezione Magazzino
Per la preparazione ordini:
- filtra per data/stato/giro
- prendi in carico
- controlla le righe
- marca avanzamento preparazione

## 11. Sezione Report
Report operativi e stampa PDF:
- report magazzino
- report fatturazione
- filtri per data e giri

## 12. Buone pratiche operative
- usa `Giro override` solo per eccezioni reali
- usa `Prodotto libero` solo per richieste spot
- verifica sempre prezzo riga prima di salvare
- in piano carico controlla sempre la data attiva
- aggiungi note brevi ma chiare quando servono

## 13. Problemi frequenti
### Non vedo una sezione nuova
- `Ctrl+F5`
- logout/login
- verifica di essere nell'ambiente giusto

### Prezzo non corretto
- controlla listino e data ordine
- controlla prezzo manuale in riga
- controlla ultimo storico cliente/prodotto

### Piano carico vuoto
- probabilmente stai guardando una data diversa
- verifica il campo data del piano in alto

## 14. Supporto
Quando segnali un problema, indica sempre:
- utente usato
- sezione
- numero ordine (se presente)
- data/ora
- screenshot
- passi per riprodurre

Questo riduce molto i tempi di risoluzione.
