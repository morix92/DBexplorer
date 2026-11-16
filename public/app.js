// ============================================
// GESTIONE CAMBIO DIALETTO
// ============================================

const dialectSelect = document.getElementById('dialect');
const fieldsSqlite = document.getElementById('fields-sqlite');
const fieldsNetwork = document.getElementById('fields-network');
const portInput = document.getElementById('port');

const defaultPorts = {
  postgres: 5432,
  mysql: 3306,
  mssql: 1433
};

if (dialectSelect) {
  dialectSelect.addEventListener('change', (e) => {
    const val = e.target.value;

    if (val === 'sqlite') {
      if (fieldsSqlite) fieldsSqlite.classList.remove('hidden');
      if (fieldsNetwork) fieldsNetwork.classList.add('hidden');
    } else {
      if (fieldsSqlite) fieldsSqlite.classList.add('hidden');
      if (fieldsNetwork) fieldsNetwork.classList.remove('hidden');
      if (portInput) portInput.value = defaultPorts[val] || '';
    }
  });
}


// ============================================
// INVIO FORM E ISPEZIONE DATABASE
// ============================================

const inspectForm = document.getElementById('inspectForm');
if (inspectForm) {
  inspectForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const formData = new FormData(e.target);
    const payload = Object.fromEntries(formData.entries());

    if (payload.port) {
      payload.port = Number(payload.port);
    }

    const resultsSection = document.getElementById('resultsSection');
    const reportOutput = document.getElementById('reportOutput');
    const sqlResultsContainer = document.getElementById('sqlResultsContainer');
    const sqlInput = document.getElementById('sqlInput');
    const chatMessages = document.getElementById('chatMessages');

    if (reportOutput) {
      reportOutput.innerHTML = '<p style="text-align:center;color:#94a3b8;">Connessione e analisi del database in corso...</p>';
    }

    // Mostriamo temporaneamente la sezione per far vedere il caricamento
    if (resultsSection) {
      resultsSection.classList.remove('hidden');
    }

    // RESET: Puliamo la console SQL precedente ad ogni nuova ispezione
    if (sqlInput) sqlInput.value = '';
    if (sqlResultsContainer) sqlResultsContainer.innerHTML = '';

    try {
      const response = await fetch('/api/inspect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Errore durante l\'ispezione');
      }

      // Reset e aggiornamento della chat al cambio database
      if (chatMessages) {
        chatMessages.innerHTML = `
          <div class="chat-msg ai-msg">
            Database di riferimento: <strong>${escapeHtml(data.databaseName)}</strong> (${escapeHtml(data.dialect)}). 
            Chiedimi pure qualsiasi cosa su tabelle, relazioni o query!
          </div>
        `;
      }

      // Renderizziamo il report (questo mostrerà anche i tab AI e Console SQL in modo pulito)
      renderReport(data);

    } catch (err) {
      // SE LA CONNESSIONE FALLISCE: Nascondiamo completamente la sezione dei tab/chat
      if (resultsSection) {
        resultsSection.classList.remove('hidden');
      }

      // 2. Nascondiamo il blocco interattivo (Chat AI e Console SQL) poiché non c'è una connessione valida
      const interactiveSection = document.getElementById('interactiveSection');
      if (interactiveSection) {
        interactiveSection.classList.add('hidden');
      }

      if (reportOutput) {
        reportOutput.innerHTML = `<div style="background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; padding: 1.25rem; border-radius: 8px; color: #fca5a5; text-align: center; margin-top: 1.5rem;"><strong>❌ Errore di connessione / Ispezione fallita:</strong><br>${escapeHtml(err.message)}</div>`;
      }
    }
  });
}


// ============================================
// UTILITY
// ============================================

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}


// ============================================
// GENERAZIONE DIAGRAMMA ER
// ============================================

function generateMermaid(report) {
  let mermaidCode = 'erDiagram\n';
  const relationsSet = new Set();
  const relationships = report.relationships || [];

  relationships.forEach(rel => {
    const parentSymbol = rel.mandatory ? '||' : 'o|';
    const childSymbol = rel.oneToOne ? 'o|' : 'o{';
    const relationSymbol = `${parentSymbol}--${childSymbol}`;

    const parentName = escapeMermaidName(rel.sourceTable);
    const childName = escapeMermaidName(rel.targetTable);

    relationsSet.add(`    ${parentName} ${relationSymbol} ${childName} : ""`);
  });

  if (relationsSet.size > 0) {
    mermaidCode += Array.from(relationsSet).join('\n');
  } else if (report.tables) {
    report.tables.forEach(table => {
      const name = escapeMermaidName(table.name);
      mermaidCode += `${name} {\n string id\n }\n`;
    });
  }

  return mermaidCode;
}

function escapeMermaidName(name) {
  return String(name).replace(/[^a-zA-Z0-9_]/g, '_');
}


// ============================================
// RENDER REPORT
// ============================================

function renderReport(report) {
  const reportOutput = document.getElementById('reportOutput');
  const interactiveSection = document.getElementById('interactiveSection');

  if (!reportOutput) return;

  if (interactiveSection) {
    interactiveSection.classList.remove('hidden');
  }

  const mermaidCode = generateMermaid(report);

  let html = `
    <h2>
      Report: ${escapeHtml(report.databaseName)}
      <span style="font-size:0.9rem;color:#94a3b8;font-weight:normal;">
        (${escapeHtml(report.dialect)})
      </span>
    </h2>

    <div class="summary-grid">
      <div class="summary-box">
        <h3>Tabelle</h3>
        <p>${report.summary.tableCount}</p>
      </div>

      <div class="summary-box">
        <h3>Righe Totali</h3>
        <p>${report.summary.totalRows}</p>
      </div>

      <div class="summary-box">
        <h3>Foreign Keys</h3>
        <p>${report.summary.foreignKeyCount}</p>
      </div>
    </div>

    <div class="card" style="margin-top:1.5rem;">
      <h3 style="margin-top:0;color:#3b82f6;">
        Mappa delle Relazioni (ER Diagram)
      </h3>

      <div class="mermaid"
        style="text-align:center;background:#0f172a;padding:1rem;border-radius:6px;overflow-x:auto;">
        ${mermaidCode}
      </div>
    </div>

    <div class="card" style="margin-top:1.5rem;">
      <h3 style="color:#3b82f6;margin-top:0;">
        Dettagli strutturali del database
      </h3>

      <p style="color:#94a3b8;">
        Indici, chiavi primarie, vincoli UNIQUE e chiavi composte.
      </p>

      <div id="structuralDetails">
  `;

  if (report.tables) {
    report.tables.forEach(table => {
      const indexes = table.indexes || [];
      const uniqueKeys = table.uniqueKeys || [];

      function normalizeColumns(columns) {
        if (Array.isArray(columns)) return columns;
        if (typeof columns === 'string') {
          const cleaned = columns.replace(/^\{|\}$/g, '').trim();
          return cleaned ? cleaned.split(',').map(col => col.trim().replace(/^"|"$/g, '')) : [];
        }
        return [];
      }

      const technicalIndexes = indexes.filter(index => {
        if (index.isPrimary || index.origin === 'pk') return false;
        const representedByConstraint = uniqueKeys.some(key => key.name === index.name);
        return !representedByConstraint;
      });

      const primaryKeys = uniqueKeys.filter(key => String(key.type || '').toUpperCase() === 'PRIMARY KEY');
      const uniqueConstraints = uniqueKeys.filter(key => String(key.type || '').toUpperCase() === 'UNIQUE');
      const pkColumns = primaryKeys.flatMap(key => normalizeColumns(key.columns));

      const uniqueDescriptions = uniqueConstraints.map(key => {
        const columns = normalizeColumns(key.columns);
        const quotedColumns = columns.map(column => `'${escapeHtml(column)}'`).join(' + ');
        return `La tabella '${escapeHtml(table.name)}' non può contenere due righe con ${quotedColumns} dello stesso valore`;
      });

      const indexDescriptions = technicalIndexes.map(index => {
        const columns = normalizeColumns(index.columns);
        return columns.length ? columns.join(' + ') : 'Colonne non disponibili';
      });

      const hasStructuralInfo = primaryKeys.length > 0 || uniqueConstraints.length > 0 || technicalIndexes.length > 0;

      html += `
        <details style="margin:0.5rem 0;padding:0.65rem 0.85rem;background:#0f172a;border-radius:6px;">
          <summary style="cursor:pointer;font-weight:bold;font-size:0.9rem;">
            ${escapeHtml(table.name)}
            <span style="color:#94a3b8;font-weight:normal;font-size:0.8rem;">
              · ${primaryKeys.length} PK · ${uniqueConstraints.length} UNIQUE · ${technicalIndexes.length} indici aggiuntivi
            </span>
          </summary>
          <div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:0.85rem;font-size:0.85rem;">
      `;

      if (!hasStructuralInfo) {
        html += `<p style="color:#94a3b8;">Nessun indice o vincolo strutturale rilevato.</p>`;
      }

      if (primaryKeys.length > 0) {
        html += `
          <div style="flex:1 1 180px;min-width:0;padding:0.65rem;background:#1e293b;border-radius:5px;">
            <strong style="color:#60a5fa;">Identificazione</strong><br>
            <span style="color:#94a3b8;font-size:0.75rem;">Identifica univocamente le righe</span>
            <hr style="border:none; height:1px; background-color:#94a3b8;">
            <p style="margin:0.35rem 0 0;color:#cbd5e1;">${escapeHtml(pkColumns.join(', '))}</p>
          </div>
        `;
      }

      if (uniqueConstraints.length > 0) {
        html += `
          <div style="flex:1 1 180px;min-width:0;padding:0.65rem;background:#1e293b;border-radius:5px;">
            <strong style="color:#34d399;">Regole di unicità</strong><br>
            <span style="color:#94a3b8;font-size:0.75rem;">Impediscono combinazioni duplicate</span>
            <hr style="border:none; height:1px; background-color:#94a3b8;">
            ${uniqueDescriptions.map(description => `<p style="margin:0.35rem 0 0;color:#cbd5e1;">${escapeHtml(description)}</p>`).join('')}
          </div>
        `;
      }

      if (technicalIndexes.length > 0) {
        html += `
          <div style="flex:1 1 180px;min-width:0;padding:0.65rem;background:#1e293b;border-radius:5px;">
            <strong style="color:#fbbf24;">Indici aggiuntivi</strong><br>
            <span style="color:#94a3b8;font-size:0.75rem;">Supportano le ricerche e l'unicità.</span>
            <hr style="border:none; height:1px; background-color:#94a3b8;">
            ${indexDescriptions.map((description, i) => `
              <p style="margin:0.35rem 0 0;color:#cbd5e1;">
                ${escapeHtml(description)}
                <span style="color:#94a3b8;font-size:0.75rem;">
                  ${indexes.filter(index => !index.isPrimary && index.origin !== 'pk' && !index.unique).includes(technicalIndexes[i]) ? ' · Ricerca' : ' · Unicità'}
                </span>
              </p>
            `).join('')}
          </div>
        `;
      }

      html += `</div></details>`;
    });
  }

  html += `</div></div>`;

  // Dettaglio tabelle
  html += `<div class="card" style="margin-top:2rem;padding:1.25rem;"><h3 style="margin-top:0;color:#3b82f6;">Dettaglio tabelle</h3>`;

  if (report.tables) {
    report.tables.forEach(table => {
      html += `
        <div class="card" style="margin-top:1rem;">
          <h3 style="margin-top:0;color:#3b82f6;">
            ${escapeHtml(table.name)}
            <span style="font-size:0.8rem;color:#94a3b8;font-weight:normal;">(${table.rowCount} righe)</span>
          </h3>
          <table>
            <thead>
              <tr>
                <th>Colonna</th>
                <th>Tipo</th>
                <th>Nullabile</th>
                <th>Vincoli</th>
              </tr>
            </thead>
            <tbody>
      `;

      if (table.columns) {
        table.columns.forEach(col => {
          let badges = '';
          if (col.isPrimaryKey) badges += '<span class="badge pk">PK</span> ';
          const foreignKeys = table.foreignKeys || [];
          foreignKeys.filter(fk => (fk.columns || []).includes(col.name)).forEach(fk => {
            badges += `<span class="badge fk" title="FK verso ${escapeHtml(fk.referencedTable)}">FK → ${escapeHtml(fk.referencedTable)}</span> `;
          });

          html += `
            <tr>
              <td><strong>${escapeHtml(col.name)}</strong></td>
              <td><code>${escapeHtml(col.type)}</code></td>
              <td>${col.nullable ? 'Sì' : 'No'}</td>
              <td>${badges || '-'}</td>
            </tr>
          `;
        });
      }

      html += `</tbody></table></div>`;
    });
  }

  html += `</div>`;
  reportOutput.innerHTML = html;

  if (typeof mermaid !== 'undefined') {
    mermaid.run({
      nodes: reportOutput.querySelectorAll('.mermaid')
    }).catch(error => {
      console.error('Errore rendering Mermaid:', error);
    });
  }
}

// ============================================
// GESTIONE CHAT AI ON-DEMAND & CONSENSO DATI
// ============================================

let currentDatabaseReport = null;

const originalRenderReport = renderReport;
renderReport = function(report) {
  currentDatabaseReport = report;
  originalRenderReport(report);
};

const consentCheckbox = document.getElementById('dataConsentCheckbox');
const consentModal = document.getElementById('consentModal');
const modalConfirmBtn = document.getElementById('modalConfirmBtn');
const modalCancelBtn = document.getElementById('modalCancelBtn');

if (consentCheckbox && consentModal) {
  consentCheckbox.addEventListener('change', (e) => {
    const chatMessages = document.getElementById('chatMessages');
    
    if (e.target.checked) {
      // Se l'utente tenta di spuntarla, blocchiamo temporaneamente e apriamo la modale
      e.target.checked = false;
      consentModal.classList.remove('hidden');
    } else {
      // Se l'utente ha tolto la spunta, avvisiamo chiaramente in chat che il permesso è stato revocato
      if (chatMessages) {
        chatMessages.innerHTML += `<div class="chat-msg ai-msg" style="color:#fbbf24;">🔓 Permesso revocato: l'IA è tornata in modalità sola struttura (dati protetti).</div>`;
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
    }
  });
}

if (modalConfirmBtn && consentModal && consentCheckbox) {
  modalConfirmBtn.addEventListener('click', () => {
    consentCheckbox.checked = true;
    consentModal.classList.add('hidden');
    
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
      chatMessages.innerHTML += `<div class="chat-msg ai-msg" style="color:#34d399;">🔒 Consenso accordato: l'IA può ora interrogare i dati reali in sola lettura.</div>`;
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  });
}

if (modalCancelBtn && consentModal && consentCheckbox) {
  modalCancelBtn.addEventListener('click', () => {
    consentCheckbox.checked = false;
    consentModal.classList.add('hidden');
  });
}

// ============================================
// INVIO MESSAGGI ALLA CHAT AI
// ============================================

const chatInput = document.getElementById('chatInput');
if (chatInput) {
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const chatForm = document.getElementById('chatForm');
      if (chatForm) chatForm.dispatchEvent(new Event('submit'));
    }
  });
}

const chatForm = document.getElementById('chatForm');
if (chatForm) {
  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const input = document.getElementById('chatInput');
    const submitBtn = document.querySelector('.chat-btn');
    if (!input) return;

    const question = input.value.trim();
    if (!question || !currentDatabaseReport) return;

    const chatMessages = document.getElementById('chatMessages');
    const allowDataRead = consentCheckbox ? consentCheckbox.checked : false;

    // Disabilita input e bottone per evitare invii multipli
    input.disabled = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.style.opacity = '0.5';
    }

    if (chatMessages) {
      chatMessages.innerHTML += `<div class="chat-msg user-msg">${escapeHtml(question)}</div>`;
      input.value = '';
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    const loadingId = 'loading-' + Date.now();
    if (chatMessages) {
      chatMessages.innerHTML += `<div id="${loadingId}" class="chat-msg ai-msg" style="color:#94a3b8;">Sto elaborando la risposta...</div>`;
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

	try {
      const response = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: question,
          databaseReport: currentDatabaseReport,
          allowDataRead: allowDataRead
        })
      });

      const data = await response.json();
      const loadingElement = document.getElementById(loadingId);
      if (loadingElement) loadingElement.remove();

      if (!response.ok) {
        throw new Error(data.error || 'Errore durante la comunicazione con l’IA');
      }

      // 1. Messaggio di risposta dell'IA (testo normale)
      if (chatMessages && data.answer) {
        chatMessages.innerHTML += `<div class="chat-msg ai-msg">${escapeHtml(data.answer).replace(/\n/g, '<br>')}</div>`;
      }

      // 2. Se ci sono risultati dalla query, li mostriamo in un blocco tabella dedicato e spazioso (fuori dai vincoli stretti della chat)
      if (data.queryResults && Array.isArray(data.queryResults) && data.queryResults.length > 0) {
        const rows = data.queryResults;
        const columns = Object.keys(rows[0]);

        let tableContainerHtml = `
          <div class="card" style="margin-top: 1rem; background: #0f172a; border: 1px solid var(--border); padding: 1rem;">
            <p style="margin: 0 0 0.75rem 0; font-size: 0.9rem; color: #34d399; font-weight: bold;">
              Risultato query eseguita (${rows.length} record):
            </p>
            <div style="overflow-x: auto; width: 100%;">
              <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem; text-align: left;">
                <thead>
                  <tr style="background: #1e293b; border-bottom: 2px solid var(--border);">
        `;

        columns.forEach(col => {
          tableContainerHtml += `<th style="padding: 0.75rem; color: #60a5fa; border: 1px solid var(--border); white-space: nowrap;">${escapeHtml(col)}</th>`;
        });

        tableContainerHtml += `</tr></thead><tbody>`;

        rows.forEach((row, index) => {
          const bgStyle = index % 2 === 0 ? 'background: rgba(30, 41, 59, 0.3);' : '';
          tableContainerHtml += `<tr style="${bgStyle}">`;
          columns.forEach(col => {
            const val = row[col] !== null && row[col] !== undefined ? row[col] : '<span style="color: #64748b; font-style: italic;">NULL</span>';
            tableContainerHtml += `<td style="padding: 0.75rem; border: 1px solid var(--border); color: #cbd5e1;">${escapeHtml(val)}</td>`;
          });
          tableContainerHtml += `</tr>`;
        });

        tableContainerHtml += `</tbody></table></div></div>`;
        
        // Appendiamo il contenitore della tabella direttamente in fondo alla chat
        if (chatMessages) {
          chatMessages.innerHTML += tableContainerHtml;
        }
      } else if (data.queryResults && Array.isArray(data.queryResults) && data.queryResults.length === 0) {
        if (chatMessages) {
          chatMessages.innerHTML += `<div class="chat-msg ai-msg" style="color: #fbbf24; font-size: 0.85rem;">La query non ha restituito alcun record (0 righe).</div>`;
        }
      }

    } catch (err) {
      const loadingElement = document.getElementById(loadingId);
      if (loadingElement) loadingElement.remove();

      if (chatMessages) {
        chatMessages.innerHTML += `<div class="chat-msg error-msg">⚠️ ${escapeHtml(err.message)}</div>`;
      }
    } finally {
      input.disabled = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
      }
      input.focus();
    }

    if (chatMessages) {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  });
}

// ============================================
// GESTIONE TAB (Assistente AI vs Console SQL)
// ============================================

const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const targetTab = btn.getAttribute('data-tab');

    // Rimuovi active da tutti i bottoni e nascondi tutti i contenuti
    tabButtons.forEach(b => {
      b.classList.remove('active');
      b.style.background = '#1e293b';
      b.style.color = '#94a3b8';
    });
    tabContents.forEach(c => c.classList.add('hidden'));

    // Attiva il tab cliccato
    btn.classList.add('active');
    btn.style.background = '#2563eb';
    btn.style.color = 'white';

    const targetContent = document.getElementById(targetTab);
    if (targetContent) {
      targetContent.classList.remove('hidden');
    }
  });
});


// ============================================
// GESTIONE CONSOLE SQL MANUALE
// ============================================

const sqlForm = document.getElementById('sqlForm');
const sqlInput = document.getElementById('sqlInput');
const sqlResultsContainer = document.getElementById('sqlResultsContainer');

if (sqlInput) {
  // Permetti l'invio con Ctrl + Invio nella textarea della console SQL
  sqlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (sqlForm) sqlForm.dispatchEvent(new Event('submit'));
    }
  });
}

if (sqlForm) {
  sqlForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const query = sqlInput.value.trim();
    if (!query || !currentDatabaseReport) {
      sqlResultsContainer.innerHTML = `<p style="color: #ef4444; font-size: 0.85rem;">⚠️ Inserisci una query SQL e ispeziona prima un database.</p>`;
      return;
    }

    sqlResultsContainer.innerHTML = `<p style="color: #94a3b8; font-size: 0.85rem; text-align: center;">Esecuzione query in corso...</p>`;

    try {
      const response = await fetch('/api/execute-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query,
          databaseReport: currentDatabaseReport
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Errore durante l\'esecuzione della query');
      }

      const rows = data.results;
      if (!Array.isArray(rows) || rows.length === 0) {
        sqlResultsContainer.innerHTML = `<div style="background: #0f172a; border: 1px solid var(--border); padding: 1rem; border-radius: 6px; color: #fbbf24; font-size: 0.85rem;">📊 Query eseguita con successo, ma 0 righe restituite.</div>`;
        return;
      }

      // Generazione della tabella dinamica per i risultati manuali
      const columns = Object.keys(rows[0]);
      let html = `
        <div style="background: #0f172a; border: 1px solid var(--border); padding: 1rem; border-radius: 6px;">
          <p style="margin: 0 0 0.75rem 0; font-size: 0.9rem; color: #34d399; font-weight: bold;">
            Risultato (${rows.length} record):
          </p>
          <div style="overflow-x: auto; width: 100%;">
            <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: left;">
              <thead>
                <tr style="background: #1e293b; border-bottom: 2px solid var(--border);">
      `;

      columns.forEach(col => {
        html += `<th style="padding: 0.6rem; color: #60a5fa; border: 1px solid var(--border); white-space: nowrap;">${escapeHtml(col)}</th>`;
      });

      html += `</tr></thead><tbody>`;

      rows.forEach((row, index) => {
        const bgStyle = index % 2 === 0 ? 'background: rgba(30, 41, 59, 0.3);' : '';
        html += `<tr style="${bgStyle}">`;
        columns.forEach(col => {
          const val = row[col] !== null && row[col] !== undefined ? row[col] : '<span style="color: #64748b; font-style: italic;">NULL</span>';
          html += `<td style="padding: 0.6rem; border: 1px solid var(--border); color: #cbd5e1;">${escapeHtml(val)}</td>`;
        });
        html += `</tr>`;
      });

      html += `</tbody></table></div></div>`;
      sqlResultsContainer.innerHTML = html;

    } catch (err) {
      sqlResultsContainer.innerHTML = `
        <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; padding: 1rem; border-radius: 6px; color: #fca5a5; font-size: 0.9rem;">
          <strong>❌ Errore SQL / Sicurezza:</strong> ${escapeHtml(err.message)}
        </div>
      `;
    }
  });
}