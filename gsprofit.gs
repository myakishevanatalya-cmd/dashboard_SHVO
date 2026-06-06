/**
 * Profit module for P&L dashboard.
 * Reads sheet "Прибыль", normalizes source rows, classifies articles,
 * and returns one stable response format for profit.html.
 */

const PROFIT_CONFIG = {
  sheetName: 'Прибыль',
  timezone: Session.getScriptTimeZone() || 'Europe/Moscow',
  fallbackTimezone: 'Europe/Moscow',
  directions: ['Азарово', 'Северная', 'Валуйки', 'Администрация / Общее'],
  schoolMonthNames: [
    'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
    'Январь', 'Февраль', 'Март', 'Апрель',
    'Май', 'Июнь', 'Июль', 'Август',
  ],
};

const PROFIT_HEADER_ALIASES = {
  period: ['период', 'дата', 'дата операции', 'дата_операции'],
  month: ['месяц', 'отчетный месяц', 'отчетный_месяц'],
  year: ['год', 'г'],
  schoolYear: ['учебные годы', 'учебный год', 'учебный_год'],
  direction: ['направление'],
  cfo: ['цфо'],
  articleParent: ['статья ддс.родитель', 'статья доходов и расходов.родитель', 'статья дир.родитель', 'родитель', 'статья родитель'],
  article: ['статья ддс', 'статья доходов и расходов', 'статья доходов/расходов', 'статья', 'статья дир'],
  topLevel: ['верхний уровень'],
  registrar: ['регистратор', 'документ'],
  amount: ['сумма', 'результат', 'оборот'],
};

function profitGetDashboardData(payload) {
  return profitSafeExecute('profitGetDashboardData', function () {
    const facts = profitReadFacts();
    const normalizedPayload = profitNormalizePayload(payload, facts);
    const filteredFacts = profitFilterFacts(facts, normalizedPayload.filters);
    const dictionaries = profitBuildDictionaries(facts, normalizedPayload.filters);

    return profitCreateSuccess({
      facts: filteredFacts,
      dictionaries: dictionaries,
      defaults: profitBuildDefaults(facts),
      meta: {
        totalRows: facts.length,
        filteredRows: filteredFacts.length,
        generatedAt: profitFormatDateTime(new Date()),
      },
    });
  });
}

function profitGetDrilldown(payload) {
  return profitSafeExecute('profitGetDrilldown', function () {
    const facts = profitReadFacts();
    const normalizedPayload = profitNormalizePayload(payload, facts);
    const rows = profitFilterFacts(facts, normalizedPayload.filters).filter(function profitFilterDrillFact(fact) {
      if (normalizedPayload.drill.monthKey && fact.monthKey !== normalizedPayload.drill.monthKey) return false;
      if (normalizedPayload.drill.type && fact.managementType !== normalizedPayload.drill.type) return false;
      if (normalizedPayload.drill.articleParent && fact.articleParent !== normalizedPayload.drill.articleParent) return false;
      return true;
    });

    return profitCreateSuccess({
      rows: rows.map(function profitMapDrillRow(fact) {
        return {
          date: fact.dateLabel,
          registrar: fact.registrar,
          amount: fact.amount,
          cfo: fact.cfo,
          article: fact.article,
          articleParent: fact.articleParent,
          direction: fact.direction,
        };
      }),
    });
  });
}

function profitCreateQualityReport(payload) {
  return profitSafeExecute('profitCreateQualityReport', function () {
    const facts = profitReadFacts();
    const normalizedPayload = profitNormalizePayload(payload, facts);
    const filteredFacts = profitFilterFacts(facts, normalizedPayload.filters);
    const rows = profitBuildQualityReportRows(filteredFacts);
    const sheetName = 'Контроль P&L';
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
    const headers = [
      'Риск',
      'Дата',
      'Направление',
      'ЦФО',
      'Статья ДДС.Родитель',
      'Статья ДДС',
      'Верхний уровень',
      'Управленческий тип',
      'Сумма',
      'Регистратор',
      'Что проверить',
    ];
    const values = [headers].concat(rows);

    sheet.clear();
    sheet.getRange(1, 1, values.length, headers.length).setValues(values);
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground('#111827')
      .setFontColor('#ffffff')
      .setFontWeight('bold');
    if (rows.length) {
      sheet.getRange(2, 9, rows.length, 1).setNumberFormat('#,##0.00');
    }
    sheet.autoResizeColumns(1, headers.length);
    sheet.setFrozenRows(1);

    return profitCreateSuccess({
      sheetName: sheetName,
      rowsCount: rows.length,
      generatedAt: profitFormatDateTime(new Date()),
    });
  });
}

function profitBuildQualityReportRows(facts) {
  const rows = [];
  facts.forEach(function profitCollectQualityRows(fact) {
    const issues = profitGetFactQualityIssues(fact);
    issues.forEach(function profitPushQualityIssue(issue) {
      rows.push([
        issue.risk,
        fact.dateLabel || fact.date || '',
        fact.direction,
        fact.cfo,
        fact.articleParent,
        fact.article,
        fact.topLevel,
        fact.managementType,
        fact.amount,
        fact.registrar,
        issue.action,
      ]);
    });
  });
  return rows;
}

function profitGetFactQualityIssues(fact) {
  const issues = [];
  const topLevel = profitNormalizeKey(fact.topLevel);
  const parent = profitNormalizeKey(fact.articleParent);

  if (!fact.timestamp) {
    issues.push({
      risk: 'Нет даты',
      action: 'Проверить поле "Период" или дату внутри регистратора.',
    });
  }
  if (fact.directionWasEmpty) {
    issues.push({
      risk: 'Нет направления',
      action: 'Заполнить направление, чтобы P&L корректно считал филиалы и управленческие расходы.',
    });
  }
  if (fact.cfoWasEmpty) {
    issues.push({
      risk: 'Нет ЦФО',
      action: 'Заполнить ЦФО или подтвердить, что операция действительно не распределяется по группе/классу.',
    });
  }
  if (fact.classificationWarning) {
    issues.push({
      risk: 'Новая статья вне справочника',
      action: fact.classificationWarning + '. Добавить ее в маппинг P&L или подтвердить текущий тип.',
    });
  }
  if (parent === 'выяснить' || topLevel === 'выяснить') {
    issues.push({
      risk: 'Статья "Выяснить"',
      action: 'Разнести операцию по корректной статье доходов или расходов до управленческой отчетности.',
    });
  }
  if (topLevel === 'выручка' && fact.managementType !== 'revenue' && !fact.isExcluded) {
    issues.push({
      risk: 'Верхний уровень не совпал с P&L-типом',
      action: 'В 1С стоит "Выручка", но статья классифицирована не как доход. Проверить родительскую статью и маппинг.',
    });
  }
  if ((topLevel === 'затраты расходы' || topLevel === 'затратырасходы') && fact.managementType === 'revenue') {
    issues.push({
      risk: 'Расход попал в доходную статью',
      action: 'В 1С стоит "Затраты/расходы", но родительская статья классифицирована как доход. Проверить справочник.',
    });
  }
  if (fact.isRevenue && fact.amount < 0) {
    issues.push({
      risk: 'Отрицательный доход',
      action: 'Похоже на возврат или корректировку выручки. Убедиться, что знак и статья указаны верно.',
    });
  }
  if ((fact.isDirectExpense || fact.isIndirectExpense || fact.isTax || fact.isInvestment) && fact.amount > 0) {
    issues.push({
      risk: 'Положительный расход',
      action: 'Похоже на возврат расхода или корректировку. Проверить, что положительная сумма осознанно уменьшает расходы.',
    });
  }

  return issues;
}

function profitDebugSheetStructure() {
  return profitSafeExecute('profitDebugSheetStructure', function () {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) throw profitCreateError('SPREADSHEET_NOT_FOUND', 'Не удалось получить активную таблицу.');

    const sheet = spreadsheet.getSheetByName(PROFIT_CONFIG.sheetName);
    if (!sheet) throw profitCreateError('SHEET_NOT_FOUND', 'Лист "' + PROFIT_CONFIG.sheetName + '" не найден.');

    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();
    const headers = lastColumn ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0] : [];

    return profitCreateSuccess({
      sheetName: sheet.getName(),
      lastRow: lastRow,
      lastColumn: lastColumn,
      headers: headers.map(function profitDebugHeader(header) {
        return String(header || '').trim();
      }),
    });
  });
}

function profitReadFacts() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw profitCreateError('SPREADSHEET_NOT_FOUND', 'Не удалось получить активную таблицу.');

  const sheet = spreadsheet.getSheetByName(PROFIT_CONFIG.sheetName);
  if (!sheet) throw profitCreateError('SHEET_NOT_FOUND', 'Лист "' + PROFIT_CONFIG.sheetName + '" не найден.');

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map(function profitMapHeader(header) { return String(header || '').trim(); });
  const index = profitBuildHeaderIndex(headers);

  if (index.amount === -1) {
    throw profitCreateError('AMOUNT_COLUMN_NOT_FOUND', 'На листе "Прибыль" не найден столбец "сумма".');
  }

  return values.slice(1).map(function profitMapRow(row, rowIndex) {
    return profitNormalizeFact(row, index, rowIndex + 2);
  }).filter(function profitFilterEmptyFact(fact) {
    return fact.amount !== 0 || fact.articleParent || fact.article || fact.registrar;
  });
}

function profitNormalizeFact(row, index, sourceRow) {
  const periodValue = profitGetCell(row, index.period);
  const registrar = profitCleanText(profitGetCell(row, index.registrar));
  const parsedDate = profitParseDate(periodValue) || profitParseDate(registrar) || profitParseDateFromMonth(row, index);
  const monthNumber = parsedDate ? parsedDate.getMonth() + 1 : profitMonthNameToNumber(profitCleanText(profitGetCell(row, index.month)));
  const year = parsedDate ? parsedDate.getFullYear() : profitParseNumber(profitGetCell(row, index.year));
  const schoolMonthNumber = profitGetSchoolMonthNumber(monthNumber);
  const schoolYear = profitCleanText(profitGetCell(row, index.schoolYear)) || profitGetSchoolYear(year, monthNumber);
  const direction = profitNormalizeDirection(profitGetCell(row, index.direction));
  const directionWasEmpty = !profitCleanText(profitGetCell(row, index.direction));
  const cfoRaw = profitCleanText(profitGetCell(row, index.cfo));
  const cfo = cfoRaw || 'ЦФО не распределено';
  const cfoWasEmpty = !cfoRaw;
  const articleParent = profitCleanText(profitGetCell(row, index.articleParent)) || 'Не распределено';
  const article = profitCleanText(profitGetCell(row, index.article)) || articleParent;
  const amount = profitParseNumber(profitGetCell(row, index.amount));
  const topLevel = profitCleanText(profitGetCell(row, index.topLevel));
  const managementType = profitClassifyArticle(articleParent, direction);
  const classificationWarning = profitIsKnownArticleParent(articleParent)
    ? ''
    : 'Новая или неописанная статья P&L: ' + articleParent;

  return {
    sourceRow: sourceRow,
    date: parsedDate ? profitFormatDate(parsedDate) : '',
    dateLabel: parsedDate ? profitFormatDateRu(parsedDate) : '',
    timestamp: parsedDate ? parsedDate.getTime() : 0,
    month: profitMonthNumberToName(monthNumber),
    monthKey: year && monthNumber ? year + '-' + profitPad(monthNumber) : '',
    monthNumber: monthNumber || 0,
    schoolYear: schoolYear,
    schoolMonthNumber: schoolMonthNumber || 0,
    schoolMonthLabel: profitMonthNumberToName(monthNumber),
    direction: direction,
    directionWasEmpty: directionWasEmpty,
    cfo: cfo,
    cfoWasEmpty: cfoWasEmpty,
    articleParent: articleParent,
    article: article,
    topLevel: topLevel,
    registrar: registrar,
    amount: amount,
    managementType: managementType,
    classificationWarning: classificationWarning,
    isRevenue: managementType === 'revenue',
    isDirectExpense: managementType === 'directExpense',
    isIndirectExpense: managementType === 'indirectExpense',
    isTax: managementType === 'tax',
    isNonOperating: managementType === 'nonOperating',
    isInvestment: managementType === 'investment',
    isExcluded: managementType === 'excluded',
  };
}

function profitBuildHeaderIndex(headers) {
  const normalizedHeaders = headers.map(function profitNormalizeHeaderName(header) {
    return profitNormalizeKey(header);
  });
  const result = {};

  Object.keys(PROFIT_HEADER_ALIASES).forEach(function profitFindHeader(field) {
    result[field] = -1;
    const aliases = PROFIT_HEADER_ALIASES[field].map(function profitNormalizeAlias(alias) {
      return profitNormalizeKey(alias);
    });

    for (let i = 0; i < normalizedHeaders.length; i += 1) {
      if (aliases.indexOf(normalizedHeaders[i]) !== -1) {
        result[field] = i;
        break;
      }
    }
  });

  return result;
}

function profitNormalizePayload(payload, facts) {
  const safePayload = payload || {};
  const defaults = profitBuildDefaults(facts || []);
  const filters = safePayload.filters || {};

  return {
    filters: {
      dateFrom: filters.dateFrom || defaults.dateFrom,
      dateTo: filters.dateTo || defaults.dateTo,
      schoolYear: filters.schoolYear || '',
      direction: filters.direction || '',
      cfo: filters.cfo || '',
      articleParent: filters.articleParent || '',
      article: filters.article || '',
    },
    drill: safePayload.drill || {},
  };
}

function profitFilterFacts(facts, filters) {
  const fromTime = filters.dateFrom ? profitParseDate(filters.dateFrom).getTime() : null;
  const toDate = filters.dateTo ? profitParseDate(filters.dateTo) : null;
  const toTime = toDate ? new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate(), 23, 59, 59).getTime() : null;

  return facts.filter(function profitFilterFact(fact) {
    if ((fromTime !== null || toTime !== null) && !fact.timestamp) return false;
    if (fromTime !== null && fact.timestamp < fromTime) return false;
    if (toTime !== null && fact.timestamp > toTime) return false;
    if (filters.schoolYear && fact.schoolYear !== filters.schoolYear) return false;
    if (filters.direction && fact.direction !== filters.direction) return false;
    if (filters.cfo && fact.cfo !== filters.cfo) return false;
    if (filters.articleParent && fact.articleParent !== filters.articleParent) return false;
    if (filters.article && fact.article !== filters.article) return false;
    return true;
  });
}

function profitBuildDictionaries(facts, filters) {
  const safeFilters = filters || {};
  const directionFiltered = facts.filter(function profitFilterForCfo(fact) {
    return !safeFilters.direction || fact.direction === safeFilters.direction;
  });
  const parentFiltered = facts.filter(function profitFilterForArticle(fact) {
    return !safeFilters.articleParent || fact.articleParent === safeFilters.articleParent;
  });

  return {
    schoolYears: profitUniqueSorted(facts, 'schoolYear'),
    directions: profitUniqueSorted(facts, 'direction'),
    cfo: profitUniqueSorted(directionFiltered, 'cfo'),
    articleParents: profitUniqueSorted(facts, 'articleParent'),
    articles: profitUniqueSorted(parentFiltered, 'article'),
  };
}

function profitBuildDefaults(facts) {
  const today = new Date();
  let start = new Date(today.getFullYear(), today.getMonth(), 1);
  let end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const hasCurrentMonth = facts.some(function profitHasCurrentFact(fact) {
    return fact.timestamp >= start.getTime() && fact.timestamp <= end.getTime();
  });

  if (!hasCurrentMonth && facts.length) {
    const latest = facts.reduce(function profitFindLatest(max, fact) {
      return Math.max(max, Number(fact.timestamp || 0));
    }, 0);
    if (latest) {
      const latestDate = new Date(latest);
      start = new Date(latestDate.getFullYear(), latestDate.getMonth(), 1);
      end = new Date(latestDate.getFullYear(), latestDate.getMonth() + 1, 0);
    }
  }

  return {
    dateFrom: profitFormatDate(start),
    dateTo: profitFormatDate(end),
    usedFallbackLatestMonth: !hasCurrentMonth && facts.length > 0,
  };
}

function profitClassifyArticle(articleParent, direction) {
  const article = profitNormalizeKey(articleParent);
  const normalizedDirection = profitNormalizeKey(direction);
  const branchDirections = ['азарово', 'северная', 'валуйки'];

  const revenue = ['основное образование', 'доп образование', 'лагерь', 'субсидия', 'прочие доходы'];
  const directByDirection = ['фот', 'расходы на персонал', 'материалы', 'расходы на образовательные мероприятия', 'мероприятия', 'оборудование'];
  const indirectAny = ['аренда', 'коммунальные расходы', 'охрана', 'маркетинг', 'консультационные услуги', 'по лицензии', 'санитарная обработка', 'то ремонт', 'транспортные расходы', 'комиссии банков', 'представительские расходы', 'прочие расходы', 'выяснить'];
  const taxes = ['налоги и взносы'];
  const nonOperating = ['внеоперационные расходы', 'дополнительные доходы расходы проекты'];
  const investment = ['строительство звд'];
  const excluded = ['дивиденды', 'кредиты', 'кредиты сотрудникам', 'перемещение денег', 'движение денег внутри шво'];

  if (profitIncludesNormalized(excluded, article)) return 'excluded';
  if (profitIncludesNormalized(revenue, article)) return 'revenue';
  if (profitIncludesNormalized(taxes, article)) return 'tax';
  if (profitIncludesNormalized(nonOperating, article)) return 'nonOperating';
  if (profitIncludesNormalized(investment, article)) return 'investment';

  if (profitIncludesNormalized(directByDirection, article)) {
    return branchDirections.indexOf(normalizedDirection) !== -1 ? 'directExpense' : 'indirectExpense';
  }

  if (profitIncludesNormalized(indirectAny, article)) return 'indirectExpense';
  return 'indirectExpense';
}

function profitIsKnownArticleParent(articleParent) {
  const article = profitNormalizeKey(articleParent);
  const known = [
    'основное образование', 'доп образование', 'лагерь', 'субсидия', 'прочие доходы',
    'фот', 'расходы на персонал', 'материалы', 'расходы на образовательные мероприятия',
    'мероприятия', 'оборудование', 'аренда', 'коммунальные расходы', 'охрана',
    'маркетинг', 'консультационные услуги', 'по лицензии', 'санитарная обработка',
    'то ремонт', 'транспортные расходы', 'комиссии банков', 'представительские расходы',
    'прочие расходы', 'выяснить', 'налоги и взносы', 'внеоперационные расходы',
    'дополнительные доходы расходы проекты', 'строительство звд', 'дивиденды',
    'кредиты', 'кредиты сотрудникам', 'перемещение денег', 'движение денег внутри шво'
  ];

  return known.indexOf(article) !== -1;
}

function profitIncludesNormalized(dictionary, value) {
  return dictionary.indexOf(value) !== -1;
}

function profitUniqueSorted(facts, key) {
  const registry = {};
  facts.forEach(function profitCollectUnique(fact) {
    if (fact[key]) registry[fact[key]] = true;
  });
  return Object.keys(registry).sort(function profitSortRu(a, b) {
    return String(a).localeCompare(String(b), 'ru');
  });
}

function profitGetCell(row, index) {
  return index === -1 || index === undefined ? '' : row[index];
}

function profitNormalizeDirection(value) {
  const text = profitCleanText(value);
  return text || 'Администрация / Общее';
}

function profitCleanText(value) {
  return String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
}

function profitNormalizeKey(value) {
  return profitCleanText(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[._/\\()\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function profitParseNumber(value) {
  if (typeof value === 'number') return value;
  const text = String(value === null || value === undefined ? '' : value)
    .replace(/\s/g, '')
    .replace(',', '.')
    .replace(/[₽рруб]/gi, '');
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

function profitParseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const text = String(value === null || value === undefined ? '' : value);
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const ru = text.match(/(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{4})/);
  if (ru) return new Date(Number(ru[3]), Number(ru[2]) - 1, Number(ru[1]));

  return null;
}

function profitParseDateFromMonth(row, index) {
  const month = profitMonthNameToNumber(profitCleanText(profitGetCell(row, index.month)));
  const year = profitParseNumber(profitGetCell(row, index.year));
  if (!month || !year) return null;
  return new Date(year, month - 1, 1);
}

function profitMonthNameToNumber(monthName) {
  const normalized = profitNormalizeKey(monthName);
  const months = {
    'январь': 1, 'января': 1,
    'февраль': 2, 'февраля': 2,
    'март': 3, 'марта': 3,
    'апрель': 4, 'апреля': 4,
    'май': 5, 'мая': 5,
    'июнь': 6, 'июня': 6,
    'июль': 7, 'июля': 7,
    'август': 8, 'августа': 8,
    'сентябрь': 9, 'сентября': 9,
    'октябрь': 10, 'октября': 10,
    'ноябрь': 11, 'ноября': 11,
    'декабрь': 12, 'декабря': 12,
  };
  return months[normalized] || 0;
}

function profitMonthNumberToName(monthNumber) {
  const names = ['','Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  return names[monthNumber] || '';
}

function profitGetSchoolMonthNumber(monthNumber) {
  if (!monthNumber) return 0;
  return monthNumber >= 9 ? monthNumber - 8 : monthNumber + 4;
}

function profitGetSchoolYear(year, monthNumber) {
  if (!year || !monthNumber) return '';
  return monthNumber >= 9 ? year + '-' + (year + 1) : (year - 1) + '-' + year;
}

function profitFormatDate(date) {
  return Utilities.formatDate(date, PROFIT_CONFIG.timezone || PROFIT_CONFIG.fallbackTimezone, 'yyyy-MM-dd');
}

function profitFormatDateRu(date) {
  return Utilities.formatDate(date, PROFIT_CONFIG.timezone || PROFIT_CONFIG.fallbackTimezone, 'dd.MM.yyyy');
}

function profitFormatDateTime(date) {
  return Utilities.formatDate(date, PROFIT_CONFIG.timezone || PROFIT_CONFIG.fallbackTimezone, 'dd.MM.yyyy HH:mm');
}

function profitPad(value) {
  return String(value).padStart(2, '0');
}

function profitSafeExecute(functionName, callback) {
  try {
    return callback();
  } catch (error) {
    return profitCreateFailure(error, functionName);
  }
}

function profitCreateSuccess(data) {
  return {
    success: true,
    status: 'ok',
    data: data || {},
  };
}

function profitCreateFailure(error, functionName) {
  return {
    success: false,
    status: 'error',
    error: {
      code: error && error.code ? error.code : 'PROFIT_ERROR',
      message: error && error.message ? error.message : 'Ошибка модуля прибыли.',
      functionName: functionName,
      details: error && error.details ? error.details : {},
    },
  };
}

function profitCreateError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  error.details = details || {};
  return error;
}
