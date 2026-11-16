const express = require('express');
const path = require('path');
require('dotenv').config({ silent: true });
const { GoogleGenAI } = require('@google/genai');

const initDemoDb = require('./data/init-demo');
const inspectSqlite = require('./adapters/sqlite');
const inspectPostgres = require('./adapters/postgres');
const inspectMysql = require('./adapters/mysql');
const inspectMssql = require('./adapters/mssql');

const analyzeRelationships = require('./utils/relationship-analyzer');
const interpretCheck = require('./utils/check-interpreter');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const demoDbPath = initDemoDb();

// ============================================
// FUNZIONE HELPER UNIVERSALE PER LE QUERY
// ============================================
async function runQueryOnDatabase(databaseReport, safeQuery) {
  const dialect = databaseReport.dialect;
  const config = databaseReport.connectionConfig || {};

  if (dialect === 'sqlite') {
    const sqlite3 = require('sqlite3').verbose();
    const targetPath = databaseReport.dbPath === 'demo' || !databaseReport.dbPath ? demoDbPath : databaseReport.dbPath;
    
    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(targetPath, sqlite3.OPEN_READONLY, (err) => {
        if (err) return reject(err);
      });
      db.all(safeQuery, [], (err, results) => {
        db.close();
        if (err) return reject(err);
        resolve(results);
      });
    });
  } 
  
  else if (dialect === 'postgres' || dialect === 'postgresql') {
    const { Client } = require('pg');
    const client = new Client(config);
    await client.connect();
    try {
      const res = await client.query(safeQuery);
      return res.rows;
    } finally {
      await client.end();
    }
  } 
  
  else if (dialect === 'mysql') {
    const mysql = require('mysql2/promise');
    const connection = await mysql.createConnection(config);
    try {
      const [rows] = await connection.execute(safeQuery);
      return rows;
    } finally {
      await connection.end();
    }
  }

  else if (dialect === 'mssql') {
    const sql = require('mssql');
    const pool = await new sql.ConnectionPool({
      server: config.host || 'localhost',
      port: Number(config.port) || 1433,
      database: config.database,
      user: config.user,
      password: config.password,
      options: {
        encrypt: false,
        trustServerCertificate: true
      }
    }).connect();

    try {
      const result = await pool.request().query(safeQuery);
      return result.recordset;
    } finally {
      await pool.close();
    }
  }

  throw new Error(`Dialetto '${dialect}' non supportato per l'esecuzione dati.`);
}


// ============================================
// ROTTA DI ISPEZIONE DATABASE
// ============================================
app.post('/api/inspect', async (req, res) => {
  const { dialect, dbPath, host, port, database, user, password } = req.body;

  try {
    const config = { host, port, database, user, password };
    let report;

    switch (dialect) {
      case 'sqlite': {
        const targetPath = dbPath === 'demo' || !dbPath ? demoDbPath : dbPath;
        report = await inspectSqlite(targetPath);
        break;
      }
      case 'postgres':
        report = await inspectPostgres(config);
        break;
      case 'mysql':
        report = await inspectMysql(config);
        break;
      case 'mssql':
        report = await inspectMssql(config);
        break;
      default:
        return res.status(400).json({ error: `Dialetto '${dialect}' non supportato.` });
    }

    report.relationships = analyzeRelationships(report.tables);
    
    for (const table of report.tables) {
      table.checkConstraints = (table.checkConstraints || []).map(check => ({
        ...check,
        interpretation: interpretCheck(check.expression)
      }));
    }

    // FONDAMENTALE: Salviamo la configurazione e il dbPath nel report
    // così il server saprà come ricollegarsi per le query successive.
    report.connectionConfig = config;
    report.dbPath = dbPath;

    return res.json(report);

  } catch (err) {
    console.error('Errore durante l’ispezione:', err);
    return res.status(500).json({ error: err.message });
  }
});


// ============================================
// ROTTA CONSOLE SQL MANUALE
// ============================================
app.post('/api/execute-query', async (req, res) => {
  const { query, databaseReport } = req.body;

  if (!query || !databaseReport) {
    return res.status(400).json({ error: 'Query o report del database mancanti.' });
  }

  const cleanQuery = query.replace(/;+$/, '').trim();
  const upperQuery = cleanQuery.toUpperCase();

  // PARSER DI SICUREZZA RIGOROSO (Sola lettura)
  const isSelect = upperQuery.startsWith('SELECT') || upperQuery.startsWith('WITH');
  const hasDangerousWords = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|REPLACE|GRANT|REVOKE|EXEC|EXECUTE)\b/i.test(cleanQuery);

  if (!isSelect || hasDangerousWords) {
    return res.status(403).json({ error: 'Operazione non consentita. La console accetta esclusivamente istruzioni di sola lettura (SELECT).' });
  }

  // Aggiungiamo un LIMIT di sicurezza se manca e non siamo su Postgres/MySQL che magari lo gestiscono diversamente
  let safeQuery = cleanQuery;
  if (!/\bLIMIT\b/i.test(safeQuery) && databaseReport.dialect === 'sqlite') {
    safeQuery += ' LIMIT 100';
  }

  try {
    const rows = await runQueryOnDatabase(databaseReport, safeQuery);
    return res.json({ results: rows });

  } catch (err) {
    console.error('Errore esecuzione query manuale:', err.message);
    return res.status(400).json({ error: err.message });
  }
});


// ============================================
// ROTTA ASSISTENTE AI (GEMINI)
// ============================================
app.post('/api/ai-chat', async (req, res) => {
  const { question, databaseReport, allowDataRead } = req.body;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '' || apiKey === 'la_tua_chiave_gemini_qui') {
    return res.status(400).json({ error: 'API Key di Gemini non configurata nel file .env.' });
  }

  const ai = new GoogleGenAI({ apiKey: apiKey.trim() });

  let systemInstruction = `Sei un esperto DBA e sviluppatore. Ti trovi su questo database:
- Nome: ${databaseReport.databaseName} (${databaseReport.dialect})
- Tabelle e colonne: ${JSON.stringify(databaseReport.tables.map(t => ({ name: t.name, columns: t.columns.map(c => c.name) })))}`.trim();

  if (allowDataRead) {
    systemInstruction += `\nL'utente HA AUTORIZZATO l'accesso in sola lettura ai dati. Se la domanda richiede dati reali, scrivi UNA query SQL SELECT racchiusa rigorosamente in un blocco \`\`\`sql ... \`\`\`. Sii estremamente sintetico e vai dritto al punto: evita preamboli, mostra la query e lascia che i risultati parlino da soli.`;
  } else {
    systemInstruction += `\nL'utente NON ha autorizzato l'accesso ai dati reali. Fornisci solo spiegazioni strutturali o query teoriche. Sii conciso.`;
  }

  const prompt = `${systemInstruction}\n\nRichiesta utente:\n"${question}"`;

  async function callGeminiWithRetry(retries = 2, delay = 2000) {
    for (let i = 0; i <= retries; i++) {
      try {
        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt,
        });
        return response;
      } catch (err) {
        const msg = err.message || '';
        const isUnavailable = msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('high demand');
        
        if (isUnavailable && i < retries) {
          console.warn(`Tentativo ${i + 1} fallito per sovraccarico (503). Riprovo tra ${delay / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw err;
      }
    }
  }

  try {
    const aiResponse = await callGeminiWithRetry();
    let answerText = aiResponse.text;
    let queryResults = null;

    if (allowDataRead) {
      const sqlMatch = answerText.match(/```sql([\s\S]*?)```/i);
      
      if (sqlMatch && sqlMatch[1]) {
        let rawQuery = sqlMatch[1].trim();
        const cleanQuery = rawQuery.replace(/;+$/, '').trim();
        const upperQuery = cleanQuery.toUpperCase();

        const isSelect = upperQuery.startsWith('SELECT') || upperQuery.startsWith('WITH');
        const hasDangerousWords = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|REPLACE|GRANT|REVOKE|EXEC|EXECUTE)\b/i.test(cleanQuery);

        if (!isSelect || hasDangerousWords) {
          answerText += `\n\n⚠️ *Intervento di sicurezza:* Query non consentita o bloccata.`;
        } else {
          let safeQuery = cleanQuery;
          if (!/\bLIMIT\b/i.test(safeQuery) && databaseReport.dialect === 'sqlite') {
            safeQuery += ' LIMIT 50';
          }

          try {
            queryResults = await runQueryOnDatabase(databaseReport, safeQuery);
            answerText = answerText.replace(/```json[\s\S]*?```/g, '').trim();
          } catch (sqlErr) {
            console.error('Errore esecuzione query SQL:', sqlErr.message);
            answerText += `\n\n❌ *Errore SQL:* \`${sqlErr.message}\``;
          }
        }
      }
    }

    return res.json({ answer: answerText, queryResults });

  } catch (err) {
    console.error('Errore chat Gemini:', err);
    const errMessage = err.message || '';

    // 1. Gestione specifica per API Key non valida o mancante (400)
    if (errMessage.includes('API_KEY_INVALID') || errMessage.includes('API key not valid')) {
      return res.status(400).json({ 
        error: 'API Key di Gemini non valida o non configurata correttamente. Controlla il file .env e inserisci una chiave attiva.' 
      });
    }

    // 2. Gestione specifica per Quota terminata / Limiti di richieste superati (429)
    if (errMessage.includes('429') || errMessage.includes('RESOURCE_EXHAUSTED') || errMessage.includes('quota')) {
      return res.status(429).json({ 
        error: 'Hai esaurito le chiamate disponibili (Quota esaurita o limite giornaliero/al minuto raggiunto per questa API Key). Riprova più tardi o passa a un piano superiore.' 
      });
    }

    // 3. Gestione per sovraccarico temporaneo dei server (503)
    if (errMessage.includes('503') || errMessage.includes('UNAVAILABLE') || errMessage.includes('high demand')) {
      return res.status(503).json({ error: 'I server di Gemini sono temporaneamente sovraccarichi (503). Riprova tra qualche istante.' });
    }

    return res.status(500).json({ error: 'Impossibile elaborare la richiesta con l’assistente AI.' });
  }
});


app.listen(PORT, () => {
  console.log(`Server avviato su http://localhost:${PORT}`);
});