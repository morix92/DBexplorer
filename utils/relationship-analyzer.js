
function analyzeRelationships(tables) {
  const relationships = [];

  for (const childTable of tables) {
    for (const fk of (childTable.foreignKeys || [])) {

      // Individua la tabella referenziata
      const parentTable = tables.find(table =>
        table.name === fk.referencedTable &&
        (
          !fk.referencedSchema ||
          !table.schema ||
          table.schema === fk.referencedSchema
        )
      );

      if (!parentTable) continue;

      const fkColumns = fk.columns || [];

      // Una FK è obbligatoria solo se tutte
      // le sue colonne sono NOT NULL.
      const mandatory = fkColumns.length > 0 &&
        fkColumns.every(columnName => {
          const column = childTable.columns.find(
            col => col.name === columnName
          );

          return column && !column.nullable;
        });

      // Una FK è UNIQUE solo se esiste un vincolo
      // UNIQUE/PK sulle stesse identiche colonne.
      const sortedFkColumns = [...fkColumns].sort();

      const oneToOne = (childTable.uniqueKeys || []).some(key => {
	    const columns = Array.isArray(key.columns)
	  	  ? key.columns
	  	  : [];
	  
	    const uniqueColumns = [...columns].sort();
	  
	    return (
	  	  uniqueColumns.length === sortedFkColumns.length &&
	  	  uniqueColumns.every(
	  	  (column, index) =>
	        column === sortedFkColumns[index]
	  	  )
	    );
	  });

      relationships.push({
	    name: fk.name || null,
	  
	    sourceTable: parentTable.name,
	    sourceSchema: parentTable.schema || null,
	  
	    targetTable: childTable.name,
	    targetSchema: childTable.schema || null,
	  
	    foreignKeyColumns: fkColumns,
	    referencedColumns: fk.referencedColumns || [],
	  
	    mandatory,
	    oneToOne,
	  
	    onDelete: fk.onDelete || 'NO ACTION',
	    onUpdate: fk.onUpdate || 'NO ACTION'
	  });
    }
  }

  return relationships;
}

module.exports = analyzeRelationships;
