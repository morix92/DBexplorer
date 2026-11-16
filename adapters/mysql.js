
const mysql = require('mysql2/promise');

async function inspectMysql(config) {
  const connection = await mysql.createConnection(config);

  // Protegge gli identificatori SQL, come nomi di tabelle
  // e database, che non possono essere passati come parametri.
  const quoteIdentifier = value =>
    '`' + String(value).replace(/`/g, '``') + '`';

  try {
    const databaseName = config.database;

    const report = {
      dialect: 'mysql',
      databaseName,
      summary: {
        tableCount: 0,
        totalRows: 0,
        foreignKeyCount: 0
      },
      tables: []
    };

    // 1. Recupera le tabelle del database
    const [tables] = await connection.execute(`
      SELECT TABLE_NAME
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ?
        AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `, [databaseName]);

    report.summary.tableCount = tables.length;

    for (const t of tables) {
      const tableName = t.TABLE_NAME;

      // 2. Recupera le colonne
      const [columnsResult] = await connection.execute(`
        SELECT
          COLUMN_NAME,
          DATA_TYPE,
          IS_NULLABLE,
          COLUMN_KEY
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ?
          AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION
      `, [databaseName, tableName]);

      // 3. Recupera tutti gli indici, comprese PK,
      // UNIQUE e indici normali. Gestisce le chiavi composte.
      const [indexesResult] = await connection.execute(`
        SELECT
          INDEX_NAME,
          COLUMN_NAME,
          SEQ_IN_INDEX,
          NON_UNIQUE
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ?
          AND TABLE_NAME = ?
        ORDER BY INDEX_NAME, SEQ_IN_INDEX
      `, [databaseName, tableName]);

      const indexMap = new Map();

      for (const index of indexesResult) {
        if (!indexMap.has(index.INDEX_NAME)) {
          indexMap.set(index.INDEX_NAME, {
            name: index.INDEX_NAME,
            columns: [],
            unique: index.NON_UNIQUE === 0,
            isPrimary: index.INDEX_NAME === 'PRIMARY',
            valid: true
          });
        }

        const item = indexMap.get(index.INDEX_NAME);

        if (!index.COLUMN_NAME) {
          item.valid = false;
          continue;
        }

        item.columns[index.SEQ_IN_INDEX - 1] =
          index.COLUMN_NAME;
      }

      const allIndexes = [...indexMap.values()]
        .filter(index =>
          index.valid &&
          index.columns.length > 0 &&
          index.columns.every(Boolean)
        );

      // Indici da visualizzare nella sezione strutturale.
      const indexes = allIndexes.map(index => ({
        name: index.name,
        columns: index.columns,
        unique: index.unique,
        isPrimary: index.isPrimary
      }));

      // Chiavi primarie e vincoli UNIQUE.
      const uniqueKeys = allIndexes
        .filter(index => index.unique)
        .map(index => ({
          name: index.name,
          columns: index.columns,
          type: index.isPrimary ? 'PRIMARY KEY' : 'UNIQUE'
        }));


		const uniqueMap = new Map();

		for (const index of indexesResult) {
		  if (!uniqueMap.has(index.INDEX_NAME)) {
			uniqueMap.set(index.INDEX_NAME, {
			  name: index.INDEX_NAME,
			  columns: [],
			  valid: true
			});
		  }

		  const key = uniqueMap.get(index.INDEX_NAME);

		  if (!index.COLUMN_NAME) {
			key.valid = false;
			continue;
		  }

		  key.columns[index.SEQ_IN_INDEX - 1] = index.COLUMN_NAME;
		}

		// 4. Normalizza le colonne
		const columns = columnsResult.map(col => ({
		  name: col.COLUMN_NAME,
		  type: col.DATA_TYPE,
		  nullable: col.IS_NULLABLE === 'YES',
		  isPrimaryKey: col.COLUMN_KEY === 'PRI',
		  isUnique: uniqueKeys.some(key =>
			key.columns.length === 1 &&
			key.columns[0] === col.COLUMN_NAME
		  )
		}));

      // 5. Recupera le Foreign Keys
      const [fkResult] = await connection.execute(`
       
		SELECT
		  kcu.CONSTRAINT_NAME,
		  kcu.COLUMN_NAME,
		  kcu.REFERENCED_TABLE_SCHEMA,
		  kcu.REFERENCED_TABLE_NAME,
		  kcu.REFERENCED_COLUMN_NAME,
		  kcu.ORDINAL_POSITION,
		  rc.DELETE_RULE,
		  rc.UPDATE_RULE
		FROM information_schema.KEY_COLUMN_USAGE kcu
		LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
		  ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
		  AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
		  AND rc.TABLE_NAME = kcu.TABLE_NAME
		WHERE kcu.TABLE_SCHEMA = ?
		  AND kcu.TABLE_NAME = ?
		  AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
		ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
      `, [databaseName, tableName]);

      // Raggruppa le FK per vincolo, mantenendo
      // l'ordine delle colonne nelle FK composte.
      const fkMap = new Map();

      for (const row of fkResult) {
        if (!fkMap.has(row.CONSTRAINT_NAME)) {
            fkMap.set(row.CONSTRAINT_NAME, {
		    name: row.CONSTRAINT_NAME,
		    referencedSchema: row.REFERENCED_TABLE_SCHEMA,
		    referencedTable: row.REFERENCED_TABLE_NAME,
		    columns: [],
		    referencedColumns: [],
		    onDelete: row.DELETE_RULE || 'NO ACTION',
		    onUpdate: row.UPDATE_RULE || 'NO ACTION'
		  });
        }

        const fk = fkMap.get(row.CONSTRAINT_NAME);

        const position = row.ORDINAL_POSITION - 1;

        fk.columns[position] = row.COLUMN_NAME;
        fk.referencedColumns[position] =
          row.REFERENCED_COLUMN_NAME;
      }

      const foreignKeys = [...fkMap.values()];

      // 6. Conteggio righe
      let rowCount = 0;

      try {
        const query = `
          SELECT COUNT(*) AS total
          FROM ${quoteIdentifier(databaseName)}.${quoteIdentifier(tableName)}
        `;

        const [countResult] = await connection.query(query);

        rowCount = Number(countResult[0].total);
      } catch (error) {
        // Tabella non accessibile.
      }

      // 7. Inserisce la tabella nel report
      report.tables.push({
        name: tableName,
        schema: databaseName,
        rowCount,
        columns,
        uniqueKeys,
		indexes,
		foreignKeys
      });

      report.summary.foreignKeyCount += foreignKeys.length;
      report.summary.totalRows += rowCount;
    }

    return report;

  } finally {
    await connection.end();
  }
}

module.exports = inspectMysql;
