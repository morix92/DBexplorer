
const { Client } = require('pg');

async function inspectPostgres(config) {
  const client = new Client(config);
  await client.connect();

  try {
    const schema = 'public';

    const report = {
      dialect: 'postgresql',
      databaseName: config.database,
      summary: {
        tableCount: 0,
        totalRows: 0,
        foreignKeyCount: 0
      },
      tables: []
    };

    // 1. Tabelle
    const tablesResult = await client.query(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema = $1
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `, [schema]);

    for (const t of tablesResult.rows) {
      const tableName = t.table_name;

      // 2. Colonne
      const columnsResult = await client.query(`
        SELECT
          c.column_name,
          c.data_type,
          c.is_nullable,
          EXISTS (
            SELECT 1
            FROM information_schema.key_column_usage k
            JOIN information_schema.table_constraints tc
              ON tc.constraint_schema = k.constraint_schema
             AND tc.constraint_name = k.constraint_name
             AND tc.table_schema = k.table_schema
             AND tc.table_name = k.table_name
            WHERE tc.constraint_type = 'PRIMARY KEY'
              AND k.table_schema = c.table_schema
              AND k.table_name = c.table_name
              AND k.column_name = c.column_name
          ) AS is_primary_key
        FROM information_schema.columns c
        WHERE c.table_schema = $1
          AND c.table_name = $2
        ORDER BY c.ordinal_position
      `, [schema, tableName]);

      // 3. Vincoli UNIQUE
      const uniqueResult = await client.query(`
        SELECT
          tc.constraint_name,
          json_agg(
		    kcu.column_name
		    ORDER BY kcu.ordinal_position
		  ) AS columns
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_schema = tc.constraint_schema
         AND kcu.constraint_name = tc.constraint_name
         AND kcu.table_schema = tc.table_schema
         AND kcu.table_name = tc.table_name
        WHERE tc.constraint_type = 'UNIQUE'
          AND tc.table_schema = $1
          AND tc.table_name = $2
        GROUP BY tc.constraint_name
      `, [schema, tableName]);

      // 4. Primary Key
      const pkResult = await client.query(`
        SELECT
          tc.constraint_name,
          json_agg(
		    kcu.column_name
		    ORDER BY kcu.ordinal_position
		  ) AS columns
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_schema = tc.constraint_schema
         AND kcu.constraint_name = tc.constraint_name
         AND kcu.table_schema = tc.table_schema
         AND kcu.table_name = tc.table_name
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = $1
          AND tc.table_name = $2
        GROUP BY tc.constraint_name
      `, [schema, tableName]);

      // 5. Indici
      const indexesResult = await client.query(`
        SELECT
          i.relname AS index_name,
          am.amname AS index_type,
          ix.indisunique AS is_unique,
          ix.indisprimary AS is_primary,
          ix.indisvalid AS is_valid,
          array_agg(
            a.attname
            ORDER BY key_columns.ordinality
          ) FILTER (
            WHERE key_columns.ordinality <= ix.indnkeyatts
          ) AS columns
        FROM pg_index ix

        JOIN pg_class t
          ON t.oid = ix.indrelid

        JOIN pg_namespace n
          ON n.oid = t.relnamespace

        JOIN pg_class i
          ON i.oid = ix.indexrelid

        JOIN pg_am am
          ON am.oid = i.relam

        LEFT JOIN LATERAL
          unnest(ix.indkey)
          WITH ORDINALITY AS key_columns(attnum, ordinality)
          ON true

        LEFT JOIN pg_attribute a
          ON a.attrelid = t.oid
         AND a.attnum = key_columns.attnum

        WHERE n.nspname = $1
          AND t.relname = $2

        GROUP BY
          i.relname,
          am.amname,
          ix.indisunique,
          ix.indisprimary,
          ix.indisvalid,
          ix.indnkeyatts

        ORDER BY i.relname
      `, [schema, tableName]);

      const indexes = indexesResult.rows.map(index => ({
        name: index.index_name,
        columns: index.columns || [],
        unique: index.is_unique,
        type: index.index_type.toUpperCase(),
        isPrimary: index.is_primary,
        valid: index.is_valid
      }));


		// ======================================
		// 6. CHECK CONSTRAINTS
		// ======================================

		
		const checkResult = await client.query(`
		  SELECT
			con.conname AS constraint_name,
			pg_get_constraintdef(con.oid) AS definition,
			con.convalidated AS is_validated
		  FROM pg_constraint con

		  JOIN pg_class t
			ON t.oid = con.conrelid

		  JOIN pg_namespace n
			ON n.oid = t.relnamespace

		  WHERE con.contype = 'c'
			AND n.nspname = $1
			AND t.relname = $2

		  ORDER BY con.conname
		`, [schema, tableName]);


		const checkConstraints = checkResult.rows.map(check => ({
		  name: check.constraint_name,

		  // Manteniamo la definizione originale restituita
		  // da PostgreSQL, senza modificarla.
		  expression: check.definition,

		  validated: check.is_validated
		}));


      // 7. Foreign Keys
      const fkResult = await client.query(`
        SELECT
          con.conname AS constraint_name,
		  con.confdeltype AS on_delete_code,
		  con.confupdtype AS on_update_code,
          child_col.attname AS column_name,
          parent_ns.nspname AS referenced_schema,
          parent_table.relname AS referenced_table,
          parent_col.attname AS referenced_column,
          cols.ordinality AS ordinal_position
        FROM pg_constraint con

        JOIN pg_class child_table
          ON child_table.oid = con.conrelid

        JOIN pg_namespace child_ns
          ON child_ns.oid = child_table.relnamespace

        JOIN pg_class parent_table
          ON parent_table.oid = con.confrelid

        JOIN pg_namespace parent_ns
          ON parent_ns.oid = parent_table.relnamespace

        JOIN LATERAL unnest(con.conkey, con.confkey)
          WITH ORDINALITY AS cols(
            child_attnum,
            parent_attnum,
            ordinality
          )
          ON true

        JOIN pg_attribute child_col
          ON child_col.attrelid = child_table.oid
         AND child_col.attnum = cols.child_attnum

        JOIN pg_attribute parent_col
          ON parent_col.attrelid = parent_table.oid
         AND parent_col.attnum = cols.parent_attnum

        WHERE con.contype = 'f'
          AND child_ns.nspname = $1
          AND child_table.relname = $2

        ORDER BY con.conname, cols.ordinality
      `, [schema, tableName]);

      const foreignKeyMap = new Map();
	  const referentialActions = {
	    a: 'NO ACTION',
	    r: 'RESTRICT',
	    c: 'CASCADE',
	    n: 'SET NULL',
	    d: 'SET DEFAULT'
	  };
	  
      for (const fk of fkResult.rows) {
        if (!foreignKeyMap.has(fk.constraint_name)) {
          foreignKeyMap.set(fk.constraint_name, {
		    name: fk.constraint_name,
		    referencedSchema: fk.referenced_schema,
		    referencedTable: fk.referenced_table,
		    columns: [],
		    referencedColumns: [],
		    onDelete: referentialActions[fk.on_delete_code],
		    onUpdate: referentialActions[fk.on_update_code]
		  });
        }

        const item = foreignKeyMap.get(fk.constraint_name);

        item.columns[fk.ordinal_position - 1] =
          fk.column_name;

        item.referencedColumns[fk.ordinal_position - 1] =
          fk.referenced_column;
      }

      // 8. Normalizzazione delle chiavi
      const uniqueKeys = [
	    ...uniqueResult.rows,
	    ...pkResult.rows
	  ].map(key => ({
	    name: key.constraint_name,
	    type: key.constraint_name === 'PRIMARY KEY'
	  	? 'PRIMARY KEY'
	  	: (
	  		pkResult.rows.some(
	  		  pk => pk.constraint_name === key.constraint_name
	  		)
	  		  ? 'PRIMARY KEY'
	  		  : 'UNIQUE'
	  	  ),
	    columns: Array.isArray(key.columns)
	  	? key.columns
	  	: []
	  }));

      const columns = columnsResult.rows.map(col => ({
        name: col.column_name,
        type: col.data_type,
        nullable: col.is_nullable === 'YES',
        isPrimaryKey: col.is_primary_key,
        isUnique: uniqueKeys.some(
          key =>
            key.columns.length === 1 &&
            key.columns[0] === col.column_name
        )
      }));

      const foreignKeys = [...foreignKeyMap.values()];

      // 9. Conteggio righe
      let rowCount = 0;

      try {
        const count = await client.query(
          `SELECT COUNT(*) FROM "${schema}"."${tableName.replace(/"/g, '""')}"`
        );

        rowCount = Number(count.rows[0].count);
      } catch (err) {
        // Tabella non accessibile.
      }

		// 10. Report tabella
		report.tables.push({
		  name: tableName,
		  schema,
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

    report.summary.tableCount = report.tables.length;

    return report;

  } finally {
    await client.end();
  }
}

module.exports = inspectPostgres;
