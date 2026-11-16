
const sql = require('mssql');

async function inspectMssql(config) {
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
    const schema = 'dbo';

    const report = {
      dialect: 'mssql',
      databaseName: config.database,
      summary: {
        tableCount: 0,
        totalRows: 0,
        foreignKeyCount: 0
      },
      tables: []
    };

    // 1. Tabelle
    const tablesResult = await pool.request()
      .input('schema', sql.NVarChar, schema)
      .query(`
        SELECT TABLE_NAME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = @schema
          AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME
      `);

    for (const t of tablesResult.recordset) {
      const tableName = t.TABLE_NAME;

      // 2. Colonne e PK
      const columnResult = await pool.request()
        .input('schema', sql.NVarChar, schema)
        .input('tableName', sql.NVarChar, tableName)
        .query(`
          SELECT
            c.COLUMN_NAME,
            c.DATA_TYPE,
            c.IS_NULLABLE,
            CASE
              WHEN pk.COLUMN_NAME IS NOT NULL THEN 1
              ELSE 0
            END AS is_primary_key
          FROM INFORMATION_SCHEMA.COLUMNS c
          LEFT JOIN (
            SELECT
              ku.TABLE_SCHEMA,
              ku.TABLE_NAME,
              ku.COLUMN_NAME
            FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
            JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
              ON tc.CONSTRAINT_SCHEMA = ku.CONSTRAINT_SCHEMA
             AND tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
             AND tc.TABLE_SCHEMA = ku.TABLE_SCHEMA
             AND tc.TABLE_NAME = ku.TABLE_NAME
            WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
          ) pk
            ON pk.TABLE_SCHEMA = c.TABLE_SCHEMA
           AND pk.TABLE_NAME = c.TABLE_NAME
           AND pk.COLUMN_NAME = c.COLUMN_NAME
          WHERE c.TABLE_SCHEMA = @schema
            AND c.TABLE_NAME = @tableName
          ORDER BY c.ORDINAL_POSITION
        `);

      // 3. Vincoli UNIQUE e indici UNIQUE
      const uniqueResult = await pool.request()
        .input('schema', sql.NVarChar, schema)
        .input('tableName', sql.NVarChar, tableName)
        .query(`
          SELECT
            i.name AS index_name,
            c.name AS column_name,
            ic.key_ordinal
          FROM sys.indexes i
          JOIN sys.index_columns ic
            ON ic.object_id = i.object_id
           AND ic.index_id = i.index_id
          JOIN sys.columns c
            ON c.object_id = ic.object_id
           AND c.column_id = ic.column_id
          JOIN sys.tables t
            ON t.object_id = i.object_id
          JOIN sys.schemas s
            ON s.schema_id = t.schema_id
          WHERE s.name = @schema
            AND t.name = @tableName
            AND i.is_unique = 1
            AND i.is_hypothetical = 0
            AND ic.key_ordinal > 0
          ORDER BY i.name, ic.key_ordinal
        `);

      const uniqueMap = new Map();

      for (const row of uniqueResult.recordset) {
        if (!uniqueMap.has(row.index_name)) {
          uniqueMap.set(row.index_name, []);
        }

        uniqueMap.get(row.index_name).push(row.column_name);
      }

      const uniqueKeys = [...uniqueMap.entries()].map(
        ([name, columns]) => ({
          name,
          columns
        })
      );

      // 4. Foreign Keys, comprese quelle composte
      const fkResult = await pool.request()
        .input('schema', sql.NVarChar, schema)
        .input('tableName', sql.NVarChar, tableName)
        .query(`
          SELECT
            fk.name AS constraint_name,
            child_col.name AS column_name,
            parent_schema.name AS referenced_schema,
            parent_table.name AS referenced_table,
            parent_col.name AS referenced_column,
            fkc.constraint_column_id
          FROM sys.foreign_keys fk
          JOIN sys.foreign_key_columns fkc
            ON fkc.constraint_object_id = fk.object_id
          JOIN sys.tables child_table
            ON child_table.object_id = fk.parent_object_id
          JOIN sys.schemas child_schema
            ON child_schema.schema_id = child_table.schema_id
          JOIN sys.columns child_col
            ON child_col.object_id = child_table.object_id
           AND child_col.column_id = fkc.parent_column_id
          JOIN sys.tables parent_table
            ON parent_table.object_id = fk.referenced_object_id
          JOIN sys.schemas parent_schema
            ON parent_schema.schema_id = parent_table.schema_id
          JOIN sys.columns parent_col
            ON parent_col.object_id = parent_table.object_id
           AND parent_col.column_id = fkc.referenced_column_id
          WHERE child_schema.name = @schema
            AND child_table.name = @tableName
          ORDER BY fk.name, fkc.constraint_column_id
        `);

      const fkMap = new Map();

      for (const row of fkResult.recordset) {
        if (!fkMap.has(row.constraint_name)) {
          fkMap.set(row.constraint_name, {
            name: row.constraint_name,
            referencedSchema: row.referenced_schema,
            referencedTable: row.referenced_table,
            columns: [],
            referencedColumns: []
          });
        }

        const fk = fkMap.get(row.constraint_name);

        fk.columns.push(row.column_name);
        fk.referencedColumns.push(row.referenced_column);
      }

      const foreignKeys = [...fkMap.values()];

      // 5. Struttura normalizzata delle colonne
      const columns = columnResult.recordset.map(col => ({
        name: col.COLUMN_NAME,
        type: col.DATA_TYPE,
        nullable: col.IS_NULLABLE === 'YES',
        isPrimaryKey: col.is_primary_key === 1,
        isUnique: uniqueKeys.some(
          key =>
            key.columns.length === 1 &&
            key.columns[0] === col.COLUMN_NAME
        )
      }));

      // 6. Conteggio righe
      let rowCount = 0;

      try {
        const escapedTable = tableName.replace(/]/g, ']]');
        const escapedSchema = schema.replace(/]/g, ']]');

        const countResult = await pool.request().query(
          `SELECT COUNT_BIG(*) AS cnt FROM [${escapedSchema}].[${escapedTable}]`
        );

        rowCount = Number(countResult.recordset[0].cnt);
      } catch (error) {
        // Permessi insufficienti
      }

      report.tables.push({
        name: tableName,
        schema,
        rowCount,
        columns,
        uniqueKeys,
        foreignKeys
      });

      report.summary.foreignKeyCount += foreignKeys.length;
      report.summary.totalRows += rowCount;
    }

    report.summary.tableCount = report.tables.length;

    return report;

  } finally {
    await pool.close();
  }
}

module.exports = inspectMssql;
