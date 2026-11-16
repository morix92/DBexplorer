# 🗄️ DB Explorer
DB Explorer consente di connettersi a diversi database relazionali (SQLite, PostgreSQL, MySQL, SQL Server) e ottenere una rappresentazione completa della loro struttura attraverso report automatici, metriche aggregate, vincoli e diagrammi Entity Relationship (ER).

L'applicazione integra un assistente AI basato su Google Gemini che permette di interrogare il database in linguaggio naturale e una console SQL dedicata per eseguire query in modalità diretta senza coinvolgere servizi esterni.
Per impostazione predefinita nessun dato applicativo viene condiviso con Google, in quanto l'accesso ai dati è una funzionalità opzionale che richiede autorizzazione esplicita dell'utente.

**Nota**: In entrambi i casi si possono eseguire query di sola lettura.

- **L'assistente AI** è pensato per esplorare il database in linguaggio naturale, risponde non solo alle domande sulla struttura, sulle relazioni, su vincoli, o su come effettuare query specifiche, ma anche, previa abilitazione di un consenso, all'estrazione dei dati dal DB.
**Nota**: L'integrazione avviene tramite le API pubbliche e gratuite di Google Gemini, pertanto, i loro server potrebbero essere temporaneamente sovraccarichi e restituire un errore, oppure impiegare molto tempo (anche qualche minuto).
Inoltre google ha previsto un limite giornaliero di 20 richieste per singola API Key.

- **Console SQL** Un box di testo dedicato per effettuare query direttamente tramite il BE, bypassando completamente l'IA di Google. Questo consente non solo una maggiore velocità di esecuzione ma anche la possibilità di estrarre dati dal DB senza esporre i dati a Google. 
Ovviamente, con questa modalità, le query restituiranno i dati desiderati soltanto se vengono eseguite seguendo le regole sintattiche, in quanto non c'è la componente interpretativa tipica dell'IA.

---

## Stack Tecnologico

- **Backend**: Node.js, Express, dotenv
- **Driver & Connettività DB**: sqlite3, pg (PostgreSQL), mysql2 (MySQL / MariaDB), mssql (SQL Server)
- **Intelligenza Artificiale**: API `@google/genai` (Google Gemini SDK)
- **Frontend**: Vanilla HTML5, CSS3, JavaScript (ES6+), Mermaid.js (per diagrammi ER dinamici)

---

## Funzionalità

- **Supporto multi-database:** Connessione a file SQLite locali (o al database demo integrato), PostgreSQL, MySQL e SQL Server.
- **Database Demo:** Include un DB SQLite di prova pronto all'uso per testare subito tutte le funzionalità del tool.
- **Report Strutturato:** Calcolo istantaneo di tabelle, righe totali, foreign key, indici e vincoli.
- **Diagramma ER Automatico:** Generazione visiva delle relazioni tra le tabelle tramite **Mermaid.js**.
- **Assistente AI (Gemini):** Interazione in linguaggio naturale per analisi strutturali e query guidate.
- **Privacy & Consenso Esplicito:** Richiesta di autorizzazione prima di consentire all'IA di interrogare i dati reali.
- **Console SQL Interattiva:** Tab dedicato per l'esecuzione manuale di istruzioni `SELECT`.
- **Parser di Sicurezza Rigoroso:** Protezione a livello backend che blocca qualsiasi comando di scrittura o modifica (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, ecc.), accettando esclusivamente query di sola lettura.
- **UX Resiliente:** Gestione degli stati, reset automatico della console al cambio di DB e feedback visivo immediato in caso di errori di connessione.

---

## Come leggere i Diagrammi ER generati

I diagrammi ER utilizzano la notazione standard *Crow's Foot* (piede di corvo) per rappresentare le relazioni tra le tabelle in modo intuitivo:

1. **Rettangoli:** Ogni blocco rappresenta una tabella del database (es DB demo: `users`, `user_profile`, `orders`, `order_items`, `products` e `category`).
2. **Le Linee e le Estremità:**
   - `||`: Rappresentano "Esattamente 1" (Mandatory). (es DB demo: un `user_profile` **deve** appartenere obbligatoriamente a un solo `users`).
   - `|o` da 0 a 1 (Optional). (es DB demo: un `users` **può** avere zero o uno `user_profile`).
   - `}|` da 1 a Molti (Mandatory). (es DB demo: un oggetto `orders` **deve** avere uno o molti oggetti `order_items`).
   - `o{` da 0 a Molti (Optional). (es DB demo: un `users` **può** possedere zero o molti `orders`)
 
**Nota**: `orders` e `products` hanno tra loro una relazione N a N , che sui database viene gestita attraverso una tabella "ponte", in questo caso `order_items`, dove `orders` e `products` devono avere uno o più `order_items`, mentre `order_items` può avere solo un `orders` ed un `products` 

3. **Analisi delle dipendenze:** Se una tabella `categories` non ha una linea verso la tabella `users`, significa che le categorie sono entità globali/condivise e non legate al singolo utente.

---

## Installazione e Avvio in Locale

1. Clona la repository

2. Installa dipendenze:
	```bash
		npm install
	```

3. Modificare il file ".env", inserendo la propria Gemini API Key. 
Per ottenere la propria API Key utilizza il tuo account google sul sito: https://aistudio.google.com)

4. Avvia il server:
	```bash
		node server.js
	```

5. Apri il browser all'indirizzo: http://localhost:3000

