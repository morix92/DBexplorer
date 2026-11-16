
function interpretCheck(expression) {
  if (!expression || typeof expression !== 'string') {
    return {
      supported: false,
      description: null
    };
  }

  let sql = expression.trim();

  // Rimuove il CHECK esterno, se presente.
  if (/^CHECK\s*\(/i.test(sql)) {
    sql = sql.replace(/^CHECK\s*\(/i, '');

    if (sql.endsWith(')')) {
      sql = sql.slice(0, -1);
    }
  }

  sql = sql.trim();

  // Rimuove parentesi esterne bilanciate.
  function removeOuterParentheses(value) {
    let result = value.trim();

    while (
      result.startsWith('(') &&
      result.endsWith(')')
    ) {
      let depth = 0;
      let valid = true;

      for (let i = 0; i < result.length; i++) {
        if (result[i] === '(') depth++;
        if (result[i] === ')') depth--;

        if (depth === 0 && i < result.length - 1) {
          valid = false;
          break;
        }
      }

      if (!valid || depth !== 0) break;

      result = result.slice(1, -1).trim();
    }

    return result;
  }

  sql = removeOuterParentheses(sql);

  // Identificatori SQL semplici o quotati.
  const identifier =
    '(?:"([^"]+)"|`([^`]+)`|\\[([^\\]]+)\\]|([a-zA-Z_][a-zA-Z0-9_]*))';

  const literal =
    "(?:-?\\d+(?:\\.\\d+)?|'(?:[^']|'')*')";

  function getIdentifier(match) {
    return match[1] || match[2] || match[3] || match[4];
  }

  function formatValue(value) {
    if (/^-?\d+(?:\.\d+)?$/.test(value)) {
      return value;
    }

    if (value.startsWith("'")) {
      return value.slice(1, -1).replace(/''/g, "'");
    }

    return value;
  }

  function result(description) {
    return {
      supported: true,
      description
    };
  }

  // ========================================
  // IS NULL / IS NOT NULL
  // ========================================

  let match = sql.match(
    new RegExp(`^${identifier}\\s+IS\\s+(NOT\\s+)?NULL$`, 'i')
  );

  if (match) {
    const column = getIdentifier(match);
    const isNot = Boolean(match[5]);

    return result(
      isNot
        ? `La colonna '${column}' non può contenere valori NULL.`
        : `La colonna '${column}' deve contenere un valore NULL.`
    );
  }

  // ========================================
  // BETWEEN
  // ========================================

  match = sql.match(
    new RegExp(
      `^${identifier}\\s+(NOT\\s+)?BETWEEN\\s+(${literal})\\s+AND\\s+(${literal})$`,
      'i'
    )
  );

  if (match) {
    const column = getIdentifier(match);
    const not = Boolean(match[5]);
    const min = formatValue(match[6]);
    const max = formatValue(match[7]);

    return result(
      not
        ? `La colonna '${column}' deve avere un valore inferiore a ${min} oppure superiore a ${max}.`
        : `La colonna '${column}' deve avere un valore compreso tra ${min} e ${max}, estremi inclusi.`
    );
  }

  // ========================================
  // CONFRONTI NUMERICI E TESTUALI
  // ========================================

  match = sql.match(
    new RegExp(
      `^${identifier}\\s*(>=|<=|<>|!=|=|>|<)\\s*(${literal})$`,
      'i'
    )
  );

  if (match) {
    const column = getIdentifier(match);
    const operator = match[5];
    const value = formatValue(match[6]);

    const descriptions = {
      '>': 'deve essere maggiore di',
      '>=': 'deve essere maggiore o uguale a',
      '<': 'deve essere minore di',
      '<=': 'deve essere minore o uguale a',
      '=': 'deve essere uguale a',
      '!=': 'deve essere diverso da',
      '<>': 'deve essere diverso da'
    };

    return result(
      `La colonna '${column}' ${descriptions[operator]} ${value}.`
    );
  }

  // ========================================
  // IN / NOT IN
  // ========================================

  match = sql.match(
    new RegExp(
      `^${identifier}\\s+(NOT\\s+)?IN\\s*\\(([^()]*)\\)$`,
      'i'
    )
  );

  if (match) {
    const column = getIdentifier(match);
    const not = Boolean(match[5]);

    const values = match[6]
      .split(',')
      .map(value => value.trim());

    // Non interpreta liste con elementi complessi.
    const valid = values.every(value =>
      new RegExp(`^${literal}$`).test(value)
    );

    if (!valid || values.length === 0) {
      return {
        supported: false,
        description: null
      };
    }

    const formatted = values
      .map(formatValue)
      .map(value => `'${value}'`)
      .join(', ');

    return result(
      not
        ? `La colonna '${column}' non può assumere i valori: ${formatted}.`
        : `La colonna '${column}' può assumere soltanto uno dei valori: ${formatted}.`
    );
  }

  // ========================================
  // ESPRESSIONE NON RICONOSCIUTA
  // ========================================

  return {
    supported: false,
    description: null
  };
}

module.exports = interpretCheck;
