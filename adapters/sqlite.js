
const sqlite3 = require('sqlite3').verbose();

// ============================================
// ESTRAZIONE VINCOLI CHECK DAL SQL
// ============================================

function extractCheckConstraints(sql) {
  if (!sql) return [];

  const checks = [];
  let i = 0;

  while (i < sql.length) {
    // Salta stringhe e identificatori quotati.
    const char = sql[i];

    if (char === "'" || char === '"' || char === '`') {
      const quote = char;
      i++;

      while (i < sql.length) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            i += 2;
            continue;
          }

          i++;
          break;
        }

        i++;
      }

      continue;
    }

    // Identificatori racchiusi tra parentesi quadre.
    if (char === '[') {
      i++;

      while (i < sql.length && sql[i] !== ']') i++;

      i++;
      continue;
    }

    // Commenti SQL su una riga.
    if (sql.slice(i, i + 2) === '--') {
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }

    // Commenti SQL multilinea.
    if (sql.slice(i, i + 2) === '/*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }

    // Individua la parola CHECK.
    if (
      sql.slice(i, i + 5).toUpperCase() === 'CHECK' &&
      !/[a-zA-Z0-9_]/.test(sql[i - 1] || '') &&
      !/[a-zA-Z0-9_]/.test(sql[i + 5] || '')
    ) {
      let open = i + 5;

      while (/\s/.test(sql[open] || '')) open++;

      if (sql[open] !== '(') {
        i += 5;
        continue;
      }

      // Estrae l'espressione rispettando
      // le parentesi annidate e le stringhe.
      let depth = 1;
      let j = open + 1;
      let expression = '';

      while (j < sql.length && depth > 0) {
        const current = sql[j];

        if (current === "'" || current === '"' || current === '`') {
          const quote = current;
          expression += current;
          j++;

          while (j < sql.length) {
            expression += sql[j];

            if (sql[j] === quote) {
              if (sql[j + 1] === quote) {
                expression += sql[j + 1];
                j += 2;
                continue;
              }

              j++;
              break;
            }

            j++;
          }

          continue;
        }

        if (current === '[') {
          expression += current;
          j++;

          while (j < sql.length) {
            expression += sql[j];

            if (sql[j] === ']') {
              j++;
              break;
            }

            j++;
          }

          continue;
        }

        if (current === '(') depth++;
        if (current === ')') depth--;

        if (depth > 0) expression += current;

        j++;
      }

      // Non restituisce espressioni incomplete.
      if (depth === 0) {
        checks.push({
		  name: null,
		  expression: expression.trim(),
		  validated: true
		});
      }

      i = j;
      continue;
    }

    i++;
  }

  return checks;
}


// ============================================
// ISPEZIONE DATABASE SQLITE
// ============================================

function inspectSqlite(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(
      dbPath,
      sqlite3.OPEN_READONLY,
      async err => {
        if (err) return reject(err);

        let closed = false;

        const closeDb = () => new Promise((res, rej) => {
          if (closed) return res();
          closed = true;

          db.close(error => {
            if (error) return rej(error);
            res();
          });
        });

        try {
          const report = {
            dialect: 'sqlite',
            databaseName: dbPath.split(/[\\/]/).pop(),
            summary: {
              tableCount: 0,
              totalRows: 0,
              foreignKeyCount: 0
            },
            tables: []
          };

          const all = (query, params = []) =>
            new Promise((res, rej) => {
              db.all(query, params, (error, rows) => {
                if (error) return rej(error);
                res(rows);
              });
            });

          const get = (query, params = []) =>
            new Promise((res, rej) => {
              db.get(query, params, (error, row) => {
                if (error) return rej(error);
                res(row);
              });
            });

          const quote = name =>
            '"' + String(name).replace(/"/g, '""') + '"';

          // ========================================
          // 1. TABELLE
          // ========================================

          const tables = await all(`
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
              AND name NOT LIKE 'sqlite_%'
            ORDER BY name
          `);

          report.summary.tableCount = tables.length;

          for (const t of tables) {
            const tableName = t.name;
            const qTable = quote(tableName);

            // ======================================
            // 2. COLONNE
            // ======================================

            const info = await all(
              `PRAGMA table_info(${qTable})`
            );

            // ======================================
            // 3. DEFINIZIONE SQL DELLA TABELLA
            // ======================================

            const tableDefinition = await get(`
              SELECT sql
              FROM sqlite_master
              WHERE type = 'table'
                AND name = ?
            `, [tableName]);

            const checkConstraints = extractCheckConstraints(
              tableDefinition?.sql
            );

            // ======================================
            // 4. INDICI
            // ======================================

            const indexList = await all(
              `PRAGMA index_list(${qTable})`
            );

            const uniqueKeys = [];
            const indexes = [];

            // ======================================
            // 5. PRIMARY KEY
            // ======================================

            const pkColumns = info
              .filter(c => c.pk > 0)
              .sort((a, b) => a.pk - b.pk)
              .map(c => c.name);

            if (pkColumns.length) {
              uniqueKeys.push({
                name: 'PRIMARY KEY',
                type: 'PRIMARY KEY',
                columns: pkColumns
              });
            }

            // ======================================
            // 6. INDICI E VINCOLI UNIQUE
            // ======================================

            for (const index of indexList) {
              const indexInfo = await all(
                `PRAGMA index_info(${quote(index.name)})`
              );

              const indexColumns = indexInfo
                .sort((a, b) => a.seqno - b.seqno)
                .map(c => c.name);

              const validColumns =
                indexColumns.length > 0 &&
                indexColumns.every(Boolean);

              const indexData = {
                name: index.name,
                columns: validColumns ? indexColumns : [],
                unique: Boolean(index.unique),
                origin: index.origin || null,
                partial: Boolean(index.partial)
              };

              indexes.push(indexData);

              if (
                index.unique &&
                index.origin === 'u' &&
                validColumns
              ) {
                uniqueKeys.push({
                  name: index.name,
                  type: 'UNIQUE',
                  columns: indexColumns
                });
              }
            }

            // ======================================
            // 7. COLONNE NORMALIZZATE
            // ======================================

            const columns = info.map(col => ({
              name: col.name,
              type: col.type || 'TEXT',
              nullable: col.notnull === 0 && col.pk === 0,
              isPrimaryKey: col.pk > 0,

              isUnique: uniqueKeys.some(
                key =>
                  key.columns.length === 1 &&
                  key.columns[0] === col.name &&
                  key.type === 'UNIQUE'
              ),

              // Valore DEFAULT esattamente come
              // dichiarato nella definizione SQL.
              defaultValue: col.dflt_value ?? null
            }));

            // ======================================
            // 8. FOREIGN KEYS
            // ======================================

            const fkRows = await all(
              `PRAGMA foreign_key_list(${qTable})`
            );

            const fkMap = new Map();

            for (const row of fkRows) {
              if (!fkMap.has(row.id)) {
                fkMap.set(row.id, {
                  name: `fk_${tableName}_${row.id}`,
                  referencedSchema: 'main',
                  referencedTable: row.table,
                  columns: [],
                  referencedColumns: [],
                  match: row.match,
                  onDelete: row.on_delete,
                  onUpdate: row.on_update
                });
              }

              const fk = fkMap.get(row.id);

              fk.columns[row.seq] = row.from;
              fk.referencedColumns[row.seq] = row.to;
            }

            const foreignKeys = [...fkMap.values()];

            // ======================================
            // 9. CONTEGGIO RIGHE
            // ======================================

            let rowCount = 0;

            try {
              const count = await get(
                `SELECT COUNT(*) AS count FROM ${qTable}`
              );

              rowCount = Number(count.count);
            } catch (error) {
              // Tabella non accessibile.
            }

            // ======================================
            // 10. REPORT TABELLA
            // ======================================

            report.tables.push({
              name: tableName,
              schema: 'main',
              rowCount,
              columns,
              uniqueKeys,
              indexes,
              foreignKeys,
              checkConstraints
            });

            report.summary.foreignKeyCount += foreignKeys.length;
            report.summary.totalRows += rowCount;
          }

          await closeDb();
          resolve(report);

        } catch (error) {
          try {
            await closeDb();
          } catch (closeError) {
            console.error('Errore chiusura SQLite:', closeError);
          }

          reject(error);
        }
      }
    );
  });
}

module.exports = inspectSqlite;
