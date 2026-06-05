const cashConfig = {
  sheetName: 'Деньги',
  startBalance: 4311060.98,
  startDate: new Date(2025, 8, 1),
  maxRows: 20000,
  directionFallback: 'Администрация / Общее',
  cfoFallback: 'Не распределено',
  articleFallback: 'Не распределено',
  requiredDirections: [
    'Азарово',
    'Северная',
    'Валуйки',
    'Администрация / Общее',
  ],
  internalPatterns: [
    'перемещение денег',
    'движение денег внутри шво',
  ],
  odddsSections: {
    operating: 'Денежные потоки от текущей деятельности',
    investing: 'Денежные потоки от инвестиционной деятельности',
    financing: 'Денежные потоки от финансовой деятельности',
  },
  odddsTypes: {
    receipt: 'Поступления',
    payment: 'Платежи',
  },
  operatingReceiptPatterns: [
    'основное образование',
    'доп образование',
    'доп. образование',
    'дополнительное образование',
    'допобразование',
    'дополнительные доходы',
    'дополнительные доходы/расходы',
    'проекты',
    'лагерь',
    'мероприятия',
    'прочие доходы',
    'субсидия',
    'депозиты',
  ],
  operatingPaymentPatterns: [
    'аренда',
    'прочие расходы',
    'реклама',
    'поставщикам',
    'материалы',
    'коммунал',
    'электроэнерг',
    'налоги',
    'фот',
    'проценты по кредиту',
    'выдача в подотчет',
    'подотчет',
  ],
  investingPaymentPatterns: [
    'приобретение ос',
    'основные средства',
    'лизинг',
  ],
  financingReceiptPatterns: [
    'взнос в ук',
    'получение ссуды',
    'получение кредита',
    'кредит получен',
    'ссуда получена',
  ],
  financingPaymentPatterns: [
    'погашение ссуды',
    'погашение кредита',
    'дивиденды',
  ],
  incomeLevel: 'выручка',
  expenseLevel: 'затраты/расходы',
  headerAliases: {
    reportMonth: ['месяц'],
    reportYear: ['г', 'год'],
    direction: ['направление'],
    cfo: ['цфо'],
    article: ['статья ддс'],
    articleParent: ['статья ддс.родитель', 'статья ддс родитель'],
    topLevel: ['верхний уровень'],
    registrar: ['регистратор'],
    amount: ['результ', 'результат'],
    comment: ['комментарии (доп. информация)', 'комментарии', 'комментарий'],
  },
  monthNames: [
    'Январь',
    'Февраль',
    'Март',
    'Апрель',
    'Май',
    'Июнь',
    'Июль',
    'Август',
    'Сентябрь',
    'Октябрь',
    'Ноябрь',
    'Декабрь',
  ],
};

function cashGetMoneyDashboardData(request) {
  return cashSafeRun('cashGetMoneyDashboardData', function () {
    const rows = cashReadSourceRows(request);
    const model = cashBuildModel(rows);
    return cashSuccess(model);
  });
}

function cashGetMoneyDrilldown(request) {
  return cashSafeRun('cashGetMoneyDrilldown', function () {
    const safeRequest = request || {};
    const rows = cashReadSourceRows({ limit: cashConfig.maxRows });
    const model = cashBuildModel(rows);
    const facts = cashApplyServerFilters(model.facts, safeRequest.filters || {});
    const filtered = facts.filter(function cashFilterDrillFact(fact) {
      const articleParentOk = !safeRequest.articleParent || fact.articleParent === safeRequest.articleParent;
      const articleOk = !safeRequest.article || fact.article === safeRequest.article;
      const monthOk = !safeRequest.monthKey || fact.monthKey === safeRequest.monthKey;
      const levelOk = !safeRequest.topLevel || fact.topLevel === safeRequest.topLevel;
      const sectionOk = !safeRequest.cashFlowSectionKey || fact.cashFlowSectionKey === safeRequest.cashFlowSectionKey;
      const typeOk = !safeRequest.cashFlowType || fact.cashFlowType === safeRequest.cashFlowType;
      return articleParentOk && articleOk && monthOk && levelOk && sectionOk && typeOk;
    });

    return cashSuccess({
      rows: filtered.map(function cashMapDrillFact(fact) {
        return {
          registrar: fact.registrar,
          amount: fact.amount,
          amountLabel: cashFormatCurrency(fact.amount),
          cfo: fact.cfo,
          comment: fact.comment,
          dateLabel: fact.operationDateLabel || fact.operationDate,
          articleParent: fact.articleParent,
          article: fact.article,
        };
      }),
    });
  });
}

function cashBuildModel(rows) {
  const counters = {
    emptyDirection: 0,
    emptyCfo: 0,
    internalExcluded: 0,
    internalNetAmount: 0,
  };
  const mapping = cashReadOldArticleParentMapping();
  const facts = [];

  rows.forEach(function cashTransformSourceWithFinalMapping(source) {
    const fact = cashTransformFact(source, counters);

    if (fact.isInternal) {
      counters.internalExcluded += 1;
      counters.internalNetAmount = cashRound(counters.internalNetAmount + fact.amount);
      return;
    }

    cashApplyNormalizedArticleParent(fact, mapping);
    facts.push(fact);
  });

  facts.sort(function cashSortFactsWithFinalMapping(a, b) {
    return a.operationDateValue - b.operationDateValue;
  });

  const months = cashBuildMonths(facts);
  const balances = cashBuildBalances(facts, months);

  return {
    config: {
      startBalance: cashConfig.startBalance,
      startDate: cashFormatDate(cashConfig.startDate, 'yyyy-MM-dd'),
    },
    facts: cashSerializeFacts(facts),
    directories: cashBuildDirectories(facts),
    months: months,
    balances: balances,
    metrics: cashBuildMetrics(facts, balances),
    validation: cashBuildValidation(rows, facts, counters, balances),
    mapping: {
      oldArticleParentRows: Number(mapping.count || 0),
      cutoffDate: '2026-01-01',
    },
  };
}

function cashApplyServerFilters(facts, filters) {
  const safeFilters = filters || {};
  const dateFrom = safeFilters.dateFrom ? cashParseIsoDate(safeFilters.dateFrom) : null;
  const dateTo = safeFilters.dateTo ? cashParseIsoDate(safeFilters.dateTo) : null;

  return facts.filter(function cashFilterServerFactV2(fact) {
    const operationDate = fact.operationDate instanceof Date ? fact.operationDate : cashParseIsoDate(fact.operationDate);
    const factParent = fact.normalizedArticleParent || fact.articleParent;
    const directionOk = !safeFilters.direction || safeFilters.direction === 'all' || fact.direction === safeFilters.direction;
    const cfoOk = !safeFilters.cfo || safeFilters.cfo === 'all' || fact.cfoKey === safeFilters.cfo;
    const parentOk = !safeFilters.articleParent || safeFilters.articleParent === 'all' || factParent === safeFilters.articleParent;
    const articleOk = !safeFilters.article || safeFilters.article === 'all' || fact.article === safeFilters.article;
    const dateFromOk = !dateFrom || operationDate >= dateFrom;
    const dateToOk = !dateTo || operationDate <= dateTo;
    return directionOk && cfoOk && parentOk && articleOk && dateFromOk && dateToOk;
  });
}

function cashCreateMoneyReconciliationReport() {
  return cashSafeRun('cashCreateMoneyReconciliationReport', function () {
    const rows = cashReadSourceRows({ limit: cashConfig.maxRows });
    const model = cashBuildModel(rows);
    const reportRows = cashBuildMoneyReconciliationRows(model.facts);
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheetName = 'Проверка ДДС';
    let sheet = spreadsheet.getSheetByName(sheetName);

    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
    }

    sheet.clear();
    sheet.getRange(1, 1, 1, 13).setValues([[
      'Месяц',
      'Учебный год',
      'Направление',
      'ЦФО',
      'Статья ДДС.Родитель',
      'Статья ДДС',
      'Верхний уровень',
      'Раздел ОДДС',
      'Тип потока',
      'Кол-во строк',
      'Сумма Результ',
      'Поступления',
      'Выплаты',
    ]]);

    if (reportRows.length) {
      sheet.getRange(2, 1, reportRows.length, 13).setValues(reportRows);
    }

    sheet.autoResizeColumns(1, 13);
    sheet.setFrozenRows(1);

    return cashSuccess({
      sheetName: sheetName,
      rows: reportRows.length,
      message: 'Сверочный лист создан: ' + sheetName,
    });
  });
}

function cashCreateMoneyDiagnosticsReport() {
  return cashSafeRun('cashCreateMoneyDiagnosticsReport', function () {
    const rows = cashReadSourceRows({ limit: cashConfig.maxRows });
    const model = cashBuildModel(rows);
    const facts = model.facts || [];
    const factsByRow = {};
    const diagnostics = [];

    facts.forEach(function cashIndexDiagnosticFact(fact) {
      factsByRow[fact.rowNumber] = fact;
    });

    rows.forEach(function cashScanDiagnosticSourceRow(row) {
      const amount = cashNormalizeNumber(row.raw.amount);
      const fact = factsByRow[row.rowNumber] || null;
      const isInternal = cashMoneyIsInternalSourceRow(row);

      if (isInternal) {
        cashPushDiagnosticRow(diagnostics, 'Внутреннее перемещение', row, fact, amount, 'Строка исключена из ОДДС. Если общий итог внутренних перемещений не равен нулю, нужно найти непарную операцию.');
        return;
      }

      if (!fact) {
        cashPushDiagnosticRow(diagnostics, 'Строка не попала в модель', row, fact, amount, 'Исходная строка не была преобразована в факт ОДДС.');
        return;
      }

      if (Math.abs(amount) >= 0.01 && Math.abs(Number(fact.cashFlowValue || 0)) < 0.01) {
        cashPushDiagnosticRow(diagnostics, 'Не классифицировано в ОДДС', row, fact, amount, 'Сумма есть в листе «Деньги», но не попала ни в поступления, ни в платежи ОДДС.');
      }

      if (fact.cashFlowType === cashConfig.odddsTypes.receipt && amount < 0) {
        cashPushDiagnosticRow(diagnostics, 'Минус в поступлениях', row, fact, amount, 'Это корректировка/сторно доходной статьи. Она уменьшает поступления, но строку стоит проверить.');
      }

      if (fact.cashFlowType === cashConfig.odddsTypes.payment && amount > 0) {
        cashPushDiagnosticRow(diagnostics, 'Плюс в платежах', row, fact, amount, 'Это возврат/сторно расходной статьи. Он уменьшает платежи, но строку стоит проверить.');
      }

      if (fact.isUnclear) {
        cashPushDiagnosticRow(diagnostics, 'Верхний уровень «Выяснить»', row, fact, amount, 'Операцию нужно разобрать и перенести в правильную статью.');
      }

      if (fact.cfo === cashConfig.cfoFallback || fact.direction === cashConfig.directionFallback) {
        cashPushDiagnosticRow(diagnostics, 'Не заполнена аналитика', row, fact, amount, 'Пустое направление или ЦФО заменено автоматически. Нужно проверить качество разнесения.');
      }
    });

    const summary = cashBuildDiagnosticsSummary(model.validation, diagnostics);
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheetName = 'Контроль ошибок ДДС';
    let sheet = spreadsheet.getSheetByName(sheetName);

    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
    }

    sheet.clear();
    sheet.getRange(1, 1, 1, 2).setValues([['Показатель', 'Значение']]);
    sheet.getRange(2, 1, summary.length, 2).setValues(summary);

    const headerRow = summary.length + 4;
    const headers = [
      'Тип проблемы',
      'Номер строки',
      'Дата',
      'Месяц',
      'Направление',
      'ЦФО',
      'Статья ДДС.Родитель',
      'Статья ДДС',
      'Верхний уровень',
      'Раздел ОДДС',
      'Тип потока',
      'Результат',
      'Сумма в ОДДС',
      'Регистратор',
      'Комментарий',
      'Что проверить',
    ];

    sheet.getRange(headerRow, 1, 1, headers.length).setValues([headers]);

    if (diagnostics.length) {
      sheet.getRange(headerRow + 1, 1, diagnostics.length, headers.length).setValues(diagnostics);
    }

    sheet.setFrozenRows(headerRow);
    sheet.autoResizeColumns(1, headers.length);
    sheet.getRange(1, 1, 1, 2).setFontWeight('bold');
    sheet.getRange(headerRow, 1, 1, headers.length).setFontWeight('bold');

    return cashSuccess({
      sheetName: sheetName,
      rows: diagnostics.length,
      message: 'Контрольный лист создан: ' + sheetName + '. Найдено строк: ' + diagnostics.length + '.',
    });
  });
}

function cashPushDiagnosticRow(target, issueType, row, fact, amount, recommendation) {
  target.push([
    issueType,
    row.rowNumber,
    fact ? fact.operationDateLabel : '',
    fact ? fact.monthYearLabel : cashNormalizeText(row.display.reportMonth || row.raw.reportMonth),
    fact ? fact.direction : cashNormalizeText(row.raw.direction || row.display.direction),
    fact ? fact.cfo : cashNormalizeText(row.raw.cfo || row.display.cfo),
    fact ? fact.articleParent : cashNormalizeText(row.raw.articleParent || row.display.articleParent),
    fact ? fact.article : cashNormalizeText(row.raw.article || row.display.article),
    fact ? fact.topLevel : cashNormalizeText(row.raw.topLevel || row.display.topLevel),
    fact ? fact.cashFlowSection : '',
    fact ? fact.cashFlowType : '',
    cashRound(amount),
    fact ? cashRound(fact.cashFlowValue || 0) : 0,
    cashNormalizeText(row.raw.registrar || row.display.registrar),
    cashNormalizeText(row.raw.comment || row.display.comment),
    recommendation,
  ]);
}

function cashBuildDiagnosticsSummary(validation, diagnostics) {
  const source = validation && validation.sourceReconciliation ? validation.sourceReconciliation : {};
  const internal = validation && validation.internalFilter ? validation.internalFilter : {};
  const grouped = {};

  diagnostics.forEach(function cashGroupDiagnosticSummary(row) {
    grouped[row[0]] = (grouped[row[0]] || 0) + 1;
  });

  const result = [
    ['Итог листа «Деньги» без внутренних перемещений', source.sourceNetAmount || 0],
    ['Итог ОДДС', source.odddsNetAmount || 0],
    ['Расхождение Деньги - ОДДС', source.difference || 0],
    ['Нетто внутренних перемещений', internal.netAmount || 0],
    ['Исключено внутренних строк', internal.excludedRows || 0],
    ['Всего диагностических строк', diagnostics.length],
  ];

  Object.keys(grouped).sort().forEach(function cashAppendDiagnosticGroup(issueType) {
    result.push([issueType, grouped[issueType]]);
  });

  return result;
}

function cashCreateMoneyControlReport() {
  return cashSafeRun('cashCreateMoneyControlReport', function () {
    const rows = cashReadSourceRows({ limit: cashConfig.maxRows });
    const model = cashBuildModel(rows);
    const facts = model.facts || [];
    const factsByRow = {};
    const issues = [];
    const severityRank = {
      'Критично': 1,
      'Высокий риск': 2,
      'Проверить': 3,
      'Информация': 4,
    };

    facts.forEach(function cashIndexControlFact(fact) {
      factsByRow[fact.rowNumber] = fact;
    });

    rows.forEach(function cashScanControlRow(row) {
      const amount = cashNormalizeNumber(row.raw.amount);
      const fact = factsByRow[row.rowNumber] || null;
      const isInternal = cashMoneyIsInternalSourceRow(row);

      if (isInternal) {
        cashPushControlIssue(issues, 'Критично', 'Внутреннее перемещение', row, fact, amount, 'Строка исключена из ОДДС. Если общий итог внутренних перемещений не равен нулю — найти непарную операцию.');
        return;
      }

      if (!fact) {
        cashPushControlIssue(issues, 'Критично', 'Строка не попала в модель', row, fact, amount, 'Исходная строка не была преобразована в факт ОДДС.');
        return;
      }

      if (Math.abs(amount) >= 0.01 && Math.abs(Number(fact.cashFlowValue || 0)) < 0.01) {
        cashPushControlIssue(issues, 'Критично', 'Не классифицировано в ОДДС', row, fact, amount, 'Сумма есть в листе «Деньги», но не попала ни в поступления, ни в платежи ОДДС.');
      }

      if (fact.isUnclear) {
        cashPushControlIssue(issues, 'Высокий риск', 'Верхний уровень «Выяснить»', row, fact, amount, 'Операцию нужно разобрать и перенести в правильную статью.');
      }

      if (fact.cfo === cashConfig.cfoFallback || fact.direction === cashConfig.directionFallback) {
        cashPushControlIssue(issues, 'Высокий риск', 'Не заполнена аналитика', row, fact, amount, 'Пустое направление или ЦФО заменено автоматически. Нужно проверить качество разнесения.');
      }

      if (fact.cashFlowType === cashConfig.odddsTypes.receipt && amount < 0) {
        cashPushControlIssue(issues, 'Проверить', 'Минус в поступлениях', row, fact, amount, 'Это сторно или корректировка доходной статьи. Она уменьшает поступления, но строку стоит проверить.');
      }

      if (fact.cashFlowType === cashConfig.odddsTypes.payment && amount > 0) {
        cashPushControlIssue(issues, 'Проверить', 'Плюс в платежах', row, fact, amount, 'Это возврат или сторно расходной статьи. Он уменьшает платежи, но строку стоит проверить.');
      }
    });

    issues.sort(function cashSortControlIssues(a, b) {
      return (severityRank[a[0]] || 99) - (severityRank[b[0]] || 99)
        || Math.abs(Number(b[12] || 0)) - Math.abs(Number(a[12] || 0))
        || Number(a[2] || 0) - Number(b[2] || 0);
    });

    const validation = model.validation || {};
    const source = validation.sourceReconciliation || {};
    const internal = validation.internalFilter || {};
    const criticalCount = issues.filter(function cashCountCriticalIssue(row) { return row[0] === 'Критично'; }).length;
    const highRiskCount = issues.filter(function cashCountHighRiskIssue(row) { return row[0] === 'Высокий риск'; }).length;
    const summary = [
      ['Расхождение лист «Деньги» минус ОДДС', Number(source.difference || 0), Math.abs(Number(source.difference || 0)) < 0.01 ? 'OK' : 'КРИТИЧНО'],
      ['Нетто внутренних перемещений', Number(internal.netAmount || 0), Math.abs(Number(internal.netAmount || 0)) < 0.01 ? 'OK' : 'КРИТИЧНО'],
      ['Итог листа «Деньги» без внутренних перемещений', Number(source.sourceNetAmount || 0), 'Инфо'],
      ['Итог ОДДС', Number(source.odddsNetAmount || 0), 'Инфо'],
      ['Исключено внутренних строк', Number(internal.excludedRows || 0), 'Инфо'],
      ['Критичных строк', criticalCount, criticalCount ? 'КРИТИЧНО' : 'OK'],
      ['Строк высокого риска', highRiskCount, highRiskCount ? 'ПРОВЕРИТЬ' : 'OK'],
      ['Всего строк в контрольном отчёте', issues.length, issues.length ? 'ПРОВЕРИТЬ' : 'OK'],
    ];

    cashAppendControlIssueSummary(summary, issues);

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheetName = 'Контроль ошибок ДДС';
    let sheet = spreadsheet.getSheetByName(sheetName);

    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
    }

    sheet.clear();
    sheet.getRange(1, 1, 1, 4).merge().setValue('Контроль качества данных ОДДС');
    sheet.getRange(2, 1, 1, 4).merge().setValue('Сначала исправляйте строки с критичностью «Критично»: именно они дают расхождения баланса и ОДДС.');
    sheet.getRange(4, 1, 1, 3).setValues([['Блок проверки', 'Значение', 'Статус']]);
    sheet.getRange(5, 1, summary.length, 3).setValues(summary);

    const headerRow = summary.length + 7;
    const headers = [
      'Критичность',
      'Тип проблемы',
      'Номер строки',
      'Дата',
      'Месяц',
      'Направление',
      'ЦФО',
      'Статья ДДС.Родитель',
      'Статья ДДС',
      'Верхний уровень',
      'Раздел ОДДС',
      'Тип потока',
      'Результат',
      'Сумма в ОДДС',
      'Регистратор',
      'Комментарий',
      'Что проверить',
    ];

    sheet.getRange(headerRow, 1, 1, headers.length).setValues([headers]);

    if (issues.length) {
      sheet.getRange(headerRow + 1, 1, issues.length, headers.length).setValues(issues);
    }

    cashFormatMoneyControlReportSheet(sheet, summary.length, issues.length, headerRow, headers.length);

    return cashSuccess({
      sheetName: sheetName,
      rows: issues.length,
      message: 'Контрольный отчёт создан: ' + sheetName + '. Найдено строк: ' + issues.length + '.',
    });
  });
}

function cashPushControlIssue(target, severity, issueType, row, fact, amount, recommendation) {
  target.push([
    severity,
    issueType,
    row.rowNumber,
    fact ? fact.operationDateLabel : '',
    fact ? fact.monthYearLabel : cashNormalizeText(row.display.reportMonth || row.raw.reportMonth),
    fact ? fact.direction : cashNormalizeText(row.raw.direction || row.display.direction),
    fact ? fact.cfo : cashNormalizeText(row.raw.cfo || row.display.cfo),
    fact ? fact.articleParent : cashNormalizeText(row.raw.articleParent || row.display.articleParent),
    fact ? fact.article : cashNormalizeText(row.raw.article || row.display.article),
    fact ? fact.topLevel : cashNormalizeText(row.raw.topLevel || row.display.topLevel),
    fact ? fact.cashFlowSection : '',
    fact ? fact.cashFlowType : '',
    cashRound(amount),
    fact ? cashRound(fact.cashFlowValue || 0) : 0,
    cashNormalizeText(row.raw.registrar || row.display.registrar),
    cashNormalizeText(row.raw.comment || row.display.comment),
    recommendation,
  ]);
}

function cashAppendControlIssueSummary(summary, issues) {
  const grouped = {};

  issues.forEach(function cashGroupControlIssue(row) {
    const key = row[0] + ' · ' + row[1];
    grouped[key] = (grouped[key] || 0) + 1;
  });

  Object.keys(grouped).sort().forEach(function cashAppendControlIssueGroup(key) {
    summary.push([key, grouped[key], grouped[key] ? 'ПРОВЕРИТЬ' : 'OK']);
  });
}

function cashFormatMoneyControlReportSheet(sheet, summaryLength, issuesLength, headerRow, headersLength) {
  sheet.setFrozenRows(headerRow);
  sheet.getRange(1, 1, 1, 4)
    .setBackground('#0f172a')
    .setFontColor('#ffffff')
    .setFontSize(14)
    .setFontWeight('bold');
  sheet.getRange(2, 1, 1, 4)
    .setBackground('#e0f2fe')
    .setFontColor('#0f172a')
    .setWrap(true);
  sheet.getRange(4, 1, 1, 3)
    .setBackground('#1f2937')
    .setFontColor('#ffffff')
    .setFontWeight('bold');
  sheet.getRange(5, 1, summaryLength, 3)
    .setBorder(true, true, true, true, true, true)
    .setWrap(true);
  sheet.getRange(5, 2, summaryLength, 1).setNumberFormat('#,##0.00');
  sheet.getRange(headerRow, 1, 1, headersLength)
    .setBackground('#1f2937')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setWrap(true);

  if (issuesLength) {
    sheet.getRange(headerRow + 1, 1, issuesLength, headersLength)
      .setBorder(true, true, true, true, true, true)
      .setWrap(true);
    sheet.getRange(headerRow + 1, 13, issuesLength, 2).setNumberFormat('#,##0.00');

    for (let index = 0; index < issuesLength; index += 1) {
      const severity = sheet.getRange(headerRow + 1 + index, 1).getValue();
      const rowRange = sheet.getRange(headerRow + 1 + index, 1, 1, headersLength);
      if (severity === 'Критично') {
        rowRange.setBackground('#fee2e2');
      } else if (severity === 'Высокий риск') {
        rowRange.setBackground('#ffedd5');
      } else if (severity === 'Проверить') {
        rowRange.setBackground('#fef9c3');
      }
    }
  }

  sheet.autoResizeColumns(1, headersLength);
  sheet.setColumnWidths(15, 3, 260);
}

function cashCreateInternalTransfersControlReport() {
  return cashSafeRun('cashCreateInternalTransfersControlReport', function () {
    const rows = cashReadSourceRows({ limit: cashConfig.maxRows });
    const grouped = {};
    const details = [];
    let totalNet = 0;

    rows.forEach(function cashScanInternalTransferRow(row) {
      const article = cashNormalizeText(row.raw.article || row.display.article);
      const articleParent = cashNormalizeText(row.raw.articleParent || row.display.articleParent);
      const topLevel = cashNormalizeText(row.raw.topLevel || row.display.topLevel);

      if (!cashIsInternalOperation(article, articleParent, topLevel)) {
        return;
      }

      const registrar = cashNormalizeText(row.raw.registrar || row.display.registrar);
      const date = cashExtractDateFromRegistrar(registrar) || cashFallbackDate(row);
      const amount = cashNormalizeNumber(row.raw.amount);
      const direction = cashNormalizeText(row.raw.direction || row.display.direction) || cashConfig.directionFallback;
      const cfo = cashNormalizeCfo(row.raw.cfo || row.display.cfo) || cashConfig.cfoFallback;
      const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
      const monthKey = cashFormatDate(monthStart, 'yyyy-MM-dd');
      const monthLabel = cashConfig.monthNames[date.getMonth()] + ' ' + date.getFullYear();
      const groupKey = [
        monthKey,
        articleParent,
        article,
        topLevel,
        direction,
        cfo,
      ].join('||');

      totalNet = cashRound(totalNet + amount);

      if (!grouped[groupKey]) {
        grouped[groupKey] = {
          monthKey: monthKey,
          monthLabel: monthLabel,
          articleParent: articleParent,
          article: article,
          topLevel: topLevel,
          direction: direction,
          cfo: cfo,
          count: 0,
          amount: 0,
        };
      }

      grouped[groupKey].count += 1;
      grouped[groupKey].amount = cashRound(grouped[groupKey].amount + amount);
      details.push([
        row.rowNumber,
        cashFormatDate(date, 'dd.MM.yyyy'),
        monthLabel,
        direction,
        cfo,
        articleParent,
        article,
        topLevel,
        amount,
        registrar,
        cashNormalizeText(row.raw.comment || row.display.comment),
      ]);
    });

    const groupedRows = Object.keys(grouped).map(function cashMapInternalTransferGroup(key) {
      const item = grouped[key];
      return [
        Math.abs(item.amount) < 0.01 ? 'OK' : 'НЕ СХОДИТСЯ',
        item.monthLabel,
        item.direction,
        item.cfo,
        item.articleParent,
        item.article,
        item.topLevel,
        item.count,
        item.amount,
      ];
    }).sort(function cashSortInternalTransferGroups(a, b) {
      return String(a[0]).localeCompare(String(b[0]), 'ru')
        || Math.abs(Number(b[8] || 0)) - Math.abs(Number(a[8] || 0));
    });

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheetName = 'Контроль внутренних ДДС';
    let sheet = spreadsheet.getSheetByName(sheetName);

    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
    }

    sheet.clear();
    sheet.getRange(1, 1, 1, 5).merge().setValue('Контроль внутренних перемещений ДДС');
    sheet.getRange(2, 1, 1, 5).merge().setValue('Проверка показывает не только статью «Перемещение денег», но и строки, где внутреннее движение указано в родителе или верхнем уровне.');
    sheet.getRange(4, 1, 4, 2).setValues([
      ['Нетто внутренних перемещений', totalNet],
      ['Статус', Math.abs(totalNet) < 0.01 ? 'OK' : 'НЕ СХОДИТСЯ'],
      ['Групп с расхождением', groupedRows.filter(function cashCountInternalMismatch(row) { return row[0] !== 'OK'; }).length],
      ['Детальных строк', details.length],
    ]);

    const groupHeaderRow = 10;
    const groupHeaders = [
      'Статус',
      'Месяц',
      'Направление',
      'ЦФО',
      'Статья ДДС.Родитель',
      'Статья ДДС',
      'Верхний уровень',
      'Кол-во строк',
      'Нетто-сумма',
    ];
    sheet.getRange(groupHeaderRow, 1, 1, groupHeaders.length).setValues([groupHeaders]);

    if (groupedRows.length) {
      sheet.getRange(groupHeaderRow + 1, 1, groupedRows.length, groupHeaders.length).setValues(groupedRows);
    }

    const detailHeaderRow = groupHeaderRow + groupedRows.length + 4;
    const detailHeaders = [
      'Номер строки',
      'Дата',
      'Месяц',
      'Направление',
      'ЦФО',
      'Статья ДДС.Родитель',
      'Статья ДДС',
      'Верхний уровень',
      'Результат',
      'Регистратор',
      'Комментарий',
    ];
    sheet.getRange(detailHeaderRow, 1, 1, detailHeaders.length).setValues([detailHeaders]);

    if (details.length) {
      sheet.getRange(detailHeaderRow + 1, 1, details.length, detailHeaders.length).setValues(details);
    }

    cashFormatInternalTransfersControlSheet(sheet, groupedRows.length, details.length, groupHeaderRow, detailHeaderRow);

    return cashSuccess({
      sheetName: sheetName,
      groups: groupedRows.length,
      rows: details.length,
      netAmount: cashRound(totalNet),
      message: 'Контроль внутренних перемещений создан: ' + sheetName + '. Нетто: ' + cashRound(totalNet) + '.',
    });
  });
}

function cashFormatInternalTransfersControlSheet(sheet, groupedRowsLength, detailsLength, groupHeaderRow, detailHeaderRow) {
  sheet.setFrozenRows(groupHeaderRow);
  sheet.getRange(1, 1, 1, 5)
    .setBackground('#0f172a')
    .setFontColor('#ffffff')
    .setFontSize(14)
    .setFontWeight('bold');
  sheet.getRange(2, 1, 1, 5)
    .setBackground('#e0f2fe')
    .setFontColor('#0f172a')
    .setWrap(true);
  sheet.getRange(4, 1, 4, 2)
    .setBorder(true, true, true, true, true, true)
    .setWrap(true);
  sheet.getRange(4, 2, 1, 1).setNumberFormat('#,##0.00');
  sheet.getRange(groupHeaderRow, 1, 1, 9)
    .setBackground('#1f2937')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setWrap(true);

  if (groupedRowsLength) {
    sheet.getRange(groupHeaderRow + 1, 1, groupedRowsLength, 9)
      .setBorder(true, true, true, true, true, true)
      .setWrap(true);
    sheet.getRange(groupHeaderRow + 1, 9, groupedRowsLength, 1).setNumberFormat('#,##0.00');

    for (let index = 0; index < groupedRowsLength; index += 1) {
      const status = sheet.getRange(groupHeaderRow + 1 + index, 1).getValue();
      if (status !== 'OK') {
        sheet.getRange(groupHeaderRow + 1 + index, 1, 1, 9).setBackground('#fee2e2');
      }
    }
  }

  sheet.getRange(detailHeaderRow, 1, 1, 11)
    .setBackground('#1f2937')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setWrap(true);

  if (detailsLength) {
    sheet.getRange(detailHeaderRow + 1, 1, detailsLength, 11)
      .setBorder(true, true, true, true, true, true)
      .setWrap(true);
    sheet.getRange(detailHeaderRow + 1, 9, detailsLength, 1).setNumberFormat('#,##0.00');
  }

  sheet.autoResizeColumns(1, 11);
  sheet.setColumnWidths(10, 2, 260);
}

function cashCreateArticleMappingDraftReport() {
  return cashSafeRun('cashCreateArticleMappingDraftReport', function () {
    const rows = cashReadSourceRows({ limit: cashConfig.maxRows });
    const registry = {};
    const cutoffDate = new Date(2026, 0, 1);

    rows.forEach(function cashScanArticleMappingRow(row) {
      const articleParent = cashNormalizeText(row.raw.articleParent || row.display.articleParent) || cashConfig.articleFallback;
      const article = cashNormalizeText(row.raw.article || row.display.article) || cashConfig.articleFallback;
      const topLevel = cashNormalizeText(row.raw.topLevel || row.display.topLevel);
      const registrar = cashNormalizeText(row.raw.registrar || row.display.registrar);
      const operationDate = cashExtractDateFromRegistrar(registrar) || cashFallbackDate(row);
      const amount = cashNormalizeNumber(row.raw.amount);
      const periodType = operationDate < cutoffDate ? 'Исторический справочник до 31.12.2025' : 'Новый справочник с 01.01.2026';
      const key = [periodType, articleParent, topLevel].join('||');

      if (!registry[key]) {
        registry[key] = {
          periodType: periodType,
          articleParent: articleParent,
          topLevel: topLevel,
          suggestedGroup: cashSuggestManagementCategory(articleParent, article, topLevel),
          rowsCount: 0,
          totalAmount: 0,
          absAmount: 0,
          inflowAmount: 0,
          outflowAmount: 0,
          articles: {},
        };
      }

      registry[key].rowsCount += 1;
      registry[key].totalAmount = cashRound(registry[key].totalAmount + amount);
      registry[key].absAmount = cashRound(registry[key].absAmount + Math.abs(amount));

      if (amount >= 0) {
        registry[key].inflowAmount = cashRound(registry[key].inflowAmount + amount);
      } else {
        registry[key].outflowAmount = cashRound(registry[key].outflowAmount + Math.abs(amount));
      }

      registry[key].articles[article] = (registry[key].articles[article] || 0) + 1;
    });

    const reportRows = Object.keys(registry).map(function cashMapArticleMappingDraft(key) {
      const item = registry[key];
      const topArticles = Object.keys(item.articles)
        .sort(function cashSortTopArticles(a, b) {
          return item.articles[b] - item.articles[a] || String(a).localeCompare(String(b), 'ru');
        })
        .slice(0, 8)
        .join('; ');

      return [
        item.periodType,
        item.articleParent,
        item.topLevel,
        item.suggestedGroup,
        '',
        item.rowsCount,
        item.totalAmount,
        item.absAmount,
        item.inflowAmount,
        item.outflowAmount,
        topArticles,
        cashGetMappingConfidence(item.suggestedGroup),
        cashGetMappingComment(item.articleParent, item.topLevel, item.suggestedGroup),
      ];
    }).sort(function cashSortArticleMappingDraft(a, b) {
      return String(a[0]).localeCompare(String(b[0]), 'ru')
        || Math.abs(Number(b[7] || 0)) - Math.abs(Number(a[7] || 0))
        || String(a[1]).localeCompare(String(b[1]), 'ru');
    });

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheetName = 'Мэппинг статей ДДС — черновик';
    let sheet = spreadsheet.getSheetByName(sheetName);

    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
    }

    sheet.clear();
    sheet.getRange(1, 1, 1, 6).merge().setValue('Черновик управленческой группировки статей ДДС');
    sheet.getRange(2, 1, 1, 6).merge().setValue('Заполните колонку «Утверждённая группа». Если она пустая, дашборд сможет использовать предложенную группу после согласования.');

    const headers = [
      'Период справочника',
      'Статья ДДС.Родитель',
      'Верхний уровень',
      'Предложенная управленческая группа',
      'Утверждённая группа',
      'Кол-во строк',
      'Нетто-сумма',
      'Оборот ABS',
      'Поступления +',
      'Платежи ABS',
      'Примеры статей ДДС',
      'Уверенность',
      'Комментарий для согласования',
    ];

    sheet.getRange(4, 1, 1, headers.length).setValues([headers]);

    if (reportRows.length) {
      sheet.getRange(5, 1, reportRows.length, headers.length).setValues(reportRows);
    }

    cashFormatArticleMappingDraftSheet(sheet, reportRows.length, headers.length);

    return cashSuccess({
      sheetName: sheetName,
      rows: reportRows.length,
      message: 'Черновик мэппинга создан: ' + sheetName + '. Строк для согласования: ' + reportRows.length + '.',
    });
  });
}

function cashSuggestManagementCategory(articleParent, article, topLevel) {
  const text = cashNormalizeText([articleParent, article, topLevel].join(' ')).toLowerCase().replace(/ё/g, 'е');

  if (cashTextHasAny(text, ['основное образование', 'доп образование', 'доп. образование', 'дополнительное образование', 'допобразование', 'лагерь', 'мероприятия', 'прочие доходы', 'субсидия', 'депозит', 'депозиты', 'аванс'])) {
    return 'Выручка и авансы';
  }

  if (cashTextHasAny(text, ['фот', 'зарплата', 'расходы на персонал', 'обучение сотрудников', 'кадры', 'hr'])) {
    return 'ФОТ и персонал';
  }

  if (cashTextHasAny(text, ['аренда'])) {
    return 'Аренда и содержание площадок';
  }

  if (cashTextHasAny(text, ['коммунал', 'электроэнерг', 'санитар', 'охрана', 'обслуживание', 'транспортные расходы', 'транспорт'])) {
    return 'Коммунальные и эксплуатация';
  }

  if (cashTextHasAny(text, ['материалы', 'питание', 'учеб', 'оборудование', 'мебель', 'канц', 'хоз', 'игруш', 'пособ'])) {
    return 'Материалы, питание и учебный процесс';
  }

  if (cashTextHasAny(text, ['маркетинг', 'реклама', 'продажи'])) {
    return 'Маркетинг и продажи';
  }

  if (cashTextHasAny(text, ['налоги', 'взносы', 'комиссия банка', 'комиссии банков', 'банк', 'эквайринг'])) {
    return 'Налоги, комиссии и банк';
  }

  if (cashTextHasAny(text, ['ремонт', 'то/ремонт', 'строительство', 'ос ', 'основные средства', 'лизинг'])) {
    return 'Ремонт, строительство и оборудование';
  }

  if (cashTextHasAny(text, ['кредит', 'ссуда', 'заем', 'займ', 'дивиденды', 'ук', 'проценты'])) {
    return 'Кредиты, займы и дивиденды';
  }

  if (cashTextHasAny(text, ['подотчет', 'подотчетные суммы'])) {
    return 'Подотчётные суммы';
  }

  if (cashTextHasAny(text, ['администрац', 'ахо', 'консультац', 'юрид', 'прочие расходы', 'внереализац'])) {
    return 'Административные и прочие расходы';
  }

  if (cashTextHasAny(text, ['выяснить', 'не распределено', 'движение денег внутри шво', 'перемещение денег'])) {
    return 'Требует разбора';
  }

  return 'Прочее / требует согласования';
}

function cashGetMappingConfidence(groupName) {
  return groupName === 'Прочее / требует согласования' || groupName === 'Требует разбора'
    ? 'Нужно согласовать'
    : 'Высокая';
}

function cashGetMappingComment(articleParent, topLevel, groupName) {
  if (groupName === 'Требует разбора') {
    return 'Проверить вручную: статья может быть технической или неразнесённой.';
  }

  if (groupName === 'Прочее / требует согласования') {
    return 'Не найдено уверенное правило. Нужна управленческая группа от пользователя.';
  }

  if (!cashNormalizeText(articleParent)) {
    return 'Пустой родитель статьи. Желательно поправить справочник или утвердить группу вручную.';
  }

  if (!cashNormalizeText(topLevel)) {
    return 'Пустой верхний уровень. Проверьте качество исходной аналитики.';
  }

  return 'Автоматическое предложение по ключевым словам. Можно оставить или заменить в колонке «Утверждённая группа».';
}

function cashFormatArticleMappingDraftSheet(sheet, rowsLength, headersLength) {
  sheet.setFrozenRows(4);
  sheet.getRange(1, 1, 1, 6)
    .setBackground('#0f172a')
    .setFontColor('#ffffff')
    .setFontSize(14)
    .setFontWeight('bold');
  sheet.getRange(2, 1, 1, 6)
    .setBackground('#e0f2fe')
    .setFontColor('#0f172a')
    .setWrap(true);
  sheet.getRange(4, 1, 1, headersLength)
    .setBackground('#1f2937')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setWrap(true);

  if (rowsLength) {
    sheet.getRange(5, 1, rowsLength, headersLength)
      .setBorder(true, true, true, true, true, true)
      .setWrap(true);
    sheet.getRange(5, 7, rowsLength, 4).setNumberFormat('#,##0.00');

    for (let index = 0; index < rowsLength; index += 1) {
      const confidence = sheet.getRange(5 + index, 12).getValue();
      if (confidence === 'Нужно согласовать') {
        sheet.getRange(5 + index, 1, 1, headersLength).setBackground('#fef9c3');
      }
    }
  }

  sheet.autoResizeColumns(1, headersLength);
  sheet.setColumnWidth(2, 260);
  sheet.setColumnWidth(4, 260);
  sheet.setColumnWidth(5, 260);
  sheet.setColumnWidth(11, 360);
  sheet.setColumnWidth(13, 360);
}

function cashCreateOldArticleParentMappingReport() {
  return cashSafeRun('cashCreateOldArticleParentMappingReport', function () {
    const rows = cashReadSourceRows({ limit: cashConfig.maxRows });
    const cutoffDate = new Date(2026, 0, 1);
    const targetParents = cashGetTargetArticleParents();
    const registry = {};

    rows.forEach(function cashScanOldArticleParentRow(row) {
      const registrar = cashNormalizeText(row.raw.registrar || row.display.registrar);
      const operationDate = cashExtractDateFromRegistrar(registrar) || cashFallbackDate(row);

      if (operationDate >= cutoffDate) {
        return;
      }

      const articleParent = cashNormalizeText(row.raw.articleParent || row.display.articleParent) || cashConfig.articleFallback;
      const article = cashNormalizeText(row.raw.article || row.display.article) || cashConfig.articleFallback;
      const topLevel = cashNormalizeText(row.raw.topLevel || row.display.topLevel);
      const amount = cashNormalizeNumber(row.raw.amount);
      const normalizedParent = cashNormalizeArticleParentName(articleParent);

      if (targetParents[normalizedParent]) {
        return;
      }

      const key = [articleParent, topLevel].join('||');

      if (!registry[key]) {
        registry[key] = {
          articleParent: articleParent,
          topLevel: topLevel,
          suggestedParent: cashSuggestNormalizedArticleParent(articleParent, article, topLevel),
          rowsCount: 0,
          netAmount: 0,
          absAmount: 0,
          inflowAmount: 0,
          outflowAmount: 0,
          articles: {},
          cfo: {},
          comments: {},
        };
      }

      registry[key].rowsCount += 1;
      registry[key].netAmount = cashRound(registry[key].netAmount + amount);
      registry[key].absAmount = cashRound(registry[key].absAmount + Math.abs(amount));

      if (amount >= 0) {
        registry[key].inflowAmount = cashRound(registry[key].inflowAmount + amount);
      } else {
        registry[key].outflowAmount = cashRound(registry[key].outflowAmount + Math.abs(amount));
      }

      registry[key].articles[article] = (registry[key].articles[article] || 0) + 1;

      const cfo = cashNormalizeCfo(row.raw.cfo || row.display.cfo) || cashConfig.cfoFallback;
      registry[key].cfo[cfo] = (registry[key].cfo[cfo] || 0) + 1;

      const comment = cashNormalizeText(row.raw.comment || row.display.comment);
      if (comment) {
        registry[key].comments[comment] = (registry[key].comments[comment] || 0) + 1;
      }
    });

    const reportRows = Object.keys(registry).map(function cashMapOldArticleParentMapping(key) {
      const item = registry[key];
      const suggestion = item.suggestedParent;

      return [
        item.articleParent,
        item.topLevel,
        suggestion.parent,
        '',
        suggestion.confidence,
        suggestion.reason,
        item.rowsCount,
        item.netAmount,
        item.absAmount,
        item.inflowAmount,
        item.outflowAmount,
        cashTopKeys(item.articles, 10),
        cashTopKeys(item.cfo, 6),
        cashTopKeys(item.comments, 4),
      ];
    }).sort(function cashSortOldArticleParentMapping(a, b) {
      return cashMappingConfidenceRank(a[4]) - cashMappingConfidenceRank(b[4])
        || Math.abs(Number(b[8] || 0)) - Math.abs(Number(a[8] || 0))
        || String(a[0]).localeCompare(String(b[0]), 'ru');
    });

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheetName = 'Мэппинг старого справочника';
    let sheet = spreadsheet.getSheetByName(sheetName);

    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
    }

    sheet.clear();
    sheet.getRange(1, 1, 1, 6).merge().setValue('Мэппинг старого справочника до 01.01.2026');
    sheet.getRange(2, 1, 1, 6).merge().setValue('В отчёт попали только старые родительские статьи, которых нет в эталонном списке. Заполните «Утверждённая нормализованная статья», если хотите изменить моё предложение.');

    const headers = [
      'Исходная Статья ДДС.Родитель',
      'Верхний уровень',
      'Предложенная нормализованная статья',
      'Утверждённая нормализованная статья',
      'Уверенность',
      'Логика предложения',
      'Кол-во строк',
      'Нетто-сумма',
      'Оборот ABS',
      'Поступления +',
      'Платежи ABS',
      'Примеры Статья ДДС',
      'Основные ЦФО',
      'Примеры комментариев',
    ];

    sheet.getRange(4, 1, 1, headers.length).setValues([headers]);

    if (reportRows.length) {
      sheet.getRange(5, 1, reportRows.length, headers.length).setValues(reportRows);
    }

    cashFormatOldArticleParentMappingSheet(sheet, reportRows.length, headers.length);

    return cashSuccess({
      sheetName: sheetName,
      rows: reportRows.length,
      message: 'Черновик сворачивания старого справочника создан: ' + sheetName + '. Строк для согласования: ' + reportRows.length + '.',
    });
  });
}

function cashGetTargetArticleParents() {
  const names = [
    'Аренда',
    'Комиссии банков',
    'Коммунальные расходы',
    'Консультационные услуги',
    'Маркетинг',
    'Материалы',
    'Налоги и взносы',
    'Оборудование',
    'Охрана',
    'ПО/Лицензии',
    'Подотчетные суммы',
    'Расходы на персонал',
    'ТО/Ремонт',
    'ФОТ',
    'Транспортные расходы',
    'Санитарная обработка',
    'Прочие расходы',
    'Внереализационные расходы',
  ];
  const result = {};

  names.forEach(function cashRegisterTargetArticleParent(name) {
    result[cashNormalizeArticleParentName(name)] = name;
  });

  return result;
}

function cashSuggestNormalizedArticleParent(articleParent, article, topLevel) {
  const text = cashNormalizeText([articleParent, article, topLevel].join(' ')).toLowerCase().replace(/ё/g, 'е');
  const exactRules = [
    { parent: 'Комиссии банков', patterns: ['комисси', 'эквайр', 'банк'] },
    { parent: 'Коммунальные расходы', patterns: ['коммунал', 'электроэнерг', 'вода', 'тепло', 'свет', 'жкх'] },
    { parent: 'Консультационные услуги', patterns: ['консультац', 'юрид', 'бухгалтер', 'аудит'] },
    { parent: 'Маркетинг', patterns: ['маркетинг', 'реклама', 'продвиж', 'таргет', 'сайт'] },
    { parent: 'Материалы', patterns: ['материал', 'комплектац', 'сред', 'канц', 'питание', 'кухня', 'запасы', 'учеб', 'пособ', 'игруш', 'хоз'] },
    { parent: 'Налоги и взносы', patterns: ['налог', 'взнос', 'обязательные платежи', 'обязательн'] },
    { parent: 'Оборудование', patterns: ['оборуд', 'имущество', 'мебель', 'здв выезд', 'здв', 'ос ', 'основн'] },
    { parent: 'Охрана', patterns: ['охрана'] },
    { parent: 'ПО/Лицензии', patterns: ['по/', 'лиценз', 'программ', 'сервис', 'подписк'] },
    { parent: 'Подотчетные суммы', patterns: ['подотчет', 'подотчетные'] },
    { parent: 'Расходы на персонал', patterns: ['расходы на персонал', 'забота о сотрудниках', 'обучение сотрудников', 'персонал', 'сотрудник', 'hr'] },
    { parent: 'ТО/Ремонт', patterns: ['то/ремонт', 'ремонт', 'обслуживание', 'строительство', 'поддержание жизнедеятельности'] },
    { parent: 'ФОТ', patterns: ['фот', 'зарплат', 'зарплата'] },
    { parent: 'Транспортные расходы', patterns: ['транспорт', 'авто', 'выезд'] },
    { parent: 'Санитарная обработка', patterns: ['санитар', 'дезинфекц', 'обработка'] },
    { parent: 'Внереализационные расходы', patterns: ['внереализац', 'штраф', 'пени', 'проценты по кредиту'] },
  ];

  for (let index = 0; index < exactRules.length; index += 1) {
    if (cashTextHasAny(text, exactRules[index].patterns)) {
      return {
        parent: exactRules[index].parent,
        confidence: 'Высокая',
        reason: 'Совпадение по ключевым словам: ' + exactRules[index].patterns.join(', '),
      };
    }
  }

  if (cashTextHasAny(text, ['возврат от поставщика'])) {
    return {
      parent: 'Прочие расходы',
      confidence: 'Средняя',
      reason: 'Возврат уменьшает расходы, но нужна проверка исходной статьи поставщика.',
    };
  }

  if (cashTextHasAny(text, ['не учитывается', 'яархив', 'архив', 'общие расходы', 'прочие доходы/расходы', 'прочие расходы', 'расходы азарово', 'северная'])) {
    return {
      parent: 'Прочие расходы',
      confidence: 'Средняя',
      reason: 'Техническая или слишком общая историческая статья. Лучше свернуть в «Прочие расходы», если нет более точного смысла.',
    };
  }

  if (cashTextHasAny(text, ['корпоративные мероприятия', 'образовательные мероприятия'])) {
    return {
      parent: 'Расходы на персонал',
      confidence: 'Средняя',
      reason: 'Мероприятия похожи на расходы на команду/персонал, но можно перенести в «Прочие расходы», если это внешние события.',
    };
  }

  return {
    parent: 'Прочие расходы',
    confidence: 'Низкая',
    reason: 'Не найдено уверенное правило. Проверьте примеры статей и при необходимости укажите свою нормализованную статью.',
  };
}

function cashNormalizeArticleParentName(value) {
  return cashNormalizeText(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .replace(/[.,;:]+/g, '')
    .trim();
}

function cashTopKeys(source, limit) {
  return Object.keys(source)
    .sort(function cashSortTopKeys(a, b) {
      return source[b] - source[a] || String(a).localeCompare(String(b), 'ru');
    })
    .slice(0, limit || 5)
    .join('; ');
}

function cashMappingConfidenceRank(value) {
  const ranks = {
    'Низкая': 1,
    'Средняя': 2,
    'Высокая': 3,
  };
  return ranks[value] || 99;
}

function cashFormatOldArticleParentMappingSheet(sheet, rowsLength, headersLength) {
  sheet.setFrozenRows(4);
  sheet.getRange(1, 1, 1, 6)
    .setBackground('#0f172a')
    .setFontColor('#ffffff')
    .setFontSize(14)
    .setFontWeight('bold');
  sheet.getRange(2, 1, 1, 6)
    .setBackground('#e0f2fe')
    .setFontColor('#0f172a')
    .setWrap(true);
  sheet.getRange(4, 1, 1, headersLength)
    .setBackground('#1f2937')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setWrap(true);

  if (rowsLength) {
    sheet.getRange(5, 1, rowsLength, headersLength)
      .setBorder(true, true, true, true, true, true)
      .setWrap(true);
    sheet.getRange(5, 8, rowsLength, 4).setNumberFormat('#,##0.00');

    for (let index = 0; index < rowsLength; index += 1) {
      const confidence = sheet.getRange(5 + index, 5).getValue();
      if (confidence === 'Низкая') {
        sheet.getRange(5 + index, 1, 1, headersLength).setBackground('#fee2e2');
      } else if (confidence === 'Средняя') {
        sheet.getRange(5 + index, 1, 1, headersLength).setBackground('#fef9c3');
      }
    }
  }

  sheet.autoResizeColumns(1, headersLength);
  sheet.setColumnWidth(1, 260);
  sheet.setColumnWidth(3, 260);
  sheet.setColumnWidth(4, 260);
  sheet.setColumnWidth(6, 360);
  sheet.setColumnWidth(12, 420);
  sheet.setColumnWidth(14, 420);
}

function cashBuildMoneyReconciliationRows(facts) {
  const registry = {};

  facts.forEach(function cashGroupReconciliationFact(fact) {
    const key = [
      fact.monthKey,
      fact.schoolYear,
      fact.direction,
      fact.cfo,
      fact.articleParent,
      fact.article,
      fact.topLevel,
      fact.cashFlowSection,
      fact.cashFlowType,
    ].join('||');

    if (!registry[key]) {
      registry[key] = {
        monthLabel: fact.monthYearLabel,
        schoolYear: fact.schoolYear,
        direction: fact.direction,
        cfo: fact.cfo,
        articleParent: fact.articleParent,
        article: fact.article,
        topLevel: fact.topLevel,
        cashFlowSection: fact.cashFlowSection,
        cashFlowType: fact.cashFlowType,
        count: 0,
        amount: 0,
        inflow: 0,
        outflow: 0,
        sortKey: fact.monthKey,
      };
    }

    registry[key].count += 1;
    registry[key].amount += Number(fact.amount || 0);
    registry[key].inflow += Number(fact.inflow || 0);
    registry[key].outflow += Number(fact.outflow || 0);
  });

  return Object.keys(registry).map(function cashMapReconciliationRow(key) {
    const row = registry[key];

    return [
      row.monthLabel,
      row.schoolYear,
      row.direction,
      row.cfo,
      row.articleParent,
      row.article,
      row.topLevel,
      row.cashFlowSection,
      row.cashFlowType,
      row.count,
      cashRound(row.amount),
      cashRound(row.inflow),
      cashRound(row.outflow),
    ];
  }).sort(function cashSortReconciliationRows(a, b) {
    return String(a[0]).localeCompare(String(b[0]), 'ru')
      || String(a[3]).localeCompare(String(b[3]), 'ru')
      || String(a[4]).localeCompare(String(b[4]), 'ru')
      || String(a[5]).localeCompare(String(b[5]), 'ru');
  });
}

function cashReadSourceRows(request) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw cashError('SPREADSHEET_NOT_FOUND', 'Не удалось получить активную Google-таблицу.');
  }

  const sheet = spreadsheet.getSheetByName(cashConfig.sheetName);
  if (!sheet) {
    throw cashError('SHEET_NOT_FOUND', 'Лист "' + cashConfig.sheetName + '" не найден.');
  }

  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) {
    return [];
  }

  const limit = cashNormalizeLimit(request && request.limit);
  const rowsToRead = Math.min(lastRow, limit + 1);
  const values = sheet.getRange(1, 1, rowsToRead, lastColumn).getValues();
  const displayValues = sheet.getRange(1, 1, rowsToRead, lastColumn).getDisplayValues();
  const headerMap = cashBuildHeaderMap(displayValues[0]);

  return values.slice(1).map(function cashMapSourceRow(row, index) {
    return cashCreateSourceRow(row, displayValues[index + 1], headerMap, index + 2);
  }).filter(function cashKeepNonEmptyRow(row) {
    return Object.keys(row.raw).some(function cashHasValue(key) {
      return row.raw[key] !== '' && row.raw[key] !== null && row.raw[key] !== undefined;
    });
  });
}

function cashBuildHeaderMap(headers) {
  const normalizedHeaders = headers.map(function cashNormalizeHeader(header) {
    return cashNormalizeText(header).toLowerCase();
  });
  const headerMap = {};

  Object.keys(cashConfig.headerAliases).forEach(function cashFindHeader(field) {
    const aliases = cashConfig.headerAliases[field];
    headerMap[field] = normalizedHeaders.findIndex(function cashMatchHeader(header) {
      return aliases.some(function cashMatchAlias(alias) {
        return header === alias || header.indexOf(alias) !== -1;
      });
    });
  });

  cashValidateHeaders(headerMap);
  return headerMap;
}

function cashValidateHeaders(headerMap) {
  const required = ['direction', 'cfo', 'article', 'articleParent', 'topLevel', 'registrar', 'amount'];
  const missing = required.filter(function cashMissingHeader(field) {
    return headerMap[field] < 0;
  });

  if (missing.length) {
    throw cashError('HEADERS_NOT_FOUND', 'Не найдены обязательные колонки листа «Деньги».', { missing: missing });
  }
}

function cashCreateSourceRow(row, displayRow, headerMap, rowNumber) {
  const source = { rowNumber: rowNumber, raw: {}, display: {} };

  Object.keys(headerMap).forEach(function cashAssignField(field) {
    const index = headerMap[field];
    source.raw[field] = index >= 0 ? row[index] : '';
    source.display[field] = index >= 0 ? displayRow[index] : '';
  });

  return source;
}

function cashBuildModel(rows) {
  const counters = {
    emptyDirection: 0,
    emptyCfo: 0,
    internalExcluded: 0,
    internalNetAmount: 0,
  };
  const facts = [];

  rows.forEach(function cashTransformSource(source) {
    const fact = cashTransformFact(source, counters);
    if (fact.isInternal) {
      counters.internalExcluded += 1;
      counters.internalNetAmount = cashRound(counters.internalNetAmount + fact.amount);
      return;
    }
    facts.push(fact);
  });

  facts.sort(function cashSortFacts(a, b) {
    return a.operationDateValue - b.operationDateValue;
  });

  const months = cashBuildMonths(facts);
  const balances = cashBuildBalances(facts, months);

  return {
    config: {
      startBalance: cashConfig.startBalance,
      startDate: cashFormatDate(cashConfig.startDate, 'yyyy-MM-dd'),
    },
    facts: cashSerializeFacts(facts),
    directories: cashBuildDirectories(facts),
    months: months,
    balances: balances,
    metrics: cashBuildMetrics(facts, balances),
    validation: cashBuildValidation(rows, facts, counters, balances),
  };
}

function cashTransformFact(source, counters) {
  const registrar = cashNormalizeText(source.raw.registrar || source.display.registrar);
  const operationDate = cashExtractDateFromRegistrar(registrar);
  const date = operationDate || cashFallbackDate(source);
  const amount = cashNormalizeNumber(source.raw.amount);
  const directionRaw = cashNormalizeText(source.raw.direction || source.display.direction);
  const cfoRaw = cashNormalizeText(source.raw.cfo || source.display.cfo);
  const article = cashNormalizeText(source.raw.article || source.display.article) || cashConfig.articleFallback;
  let articleParent = cashNormalizeText(source.raw.articleParent || source.display.articleParent) || cashConfig.articleFallback;
  const topLevel = cashNormalizeText(source.raw.topLevel || source.display.topLevel);
  const topLevelKey = topLevel.toLowerCase();
  const isUnclear = topLevelKey === 'выяснить';

  if (isUnclear) {
    articleParent = amount < 0 ? 'Выяснить' : 'Прочие доходы';
  }

  const isInternal = cashIsInternalOperation(article, articleParent, topLevel);
  const direction = directionRaw || cashConfig.directionFallback;
  const cfo = cashNormalizeCfo(cfoRaw) || cashConfig.cfoFallback;
  const oddds = cashClassifyOddds(article, articleParent, topLevel, amount);

  if (!directionRaw) counters.emptyDirection += 1;
  if (!cfoRaw) counters.emptyCfo += 1;

  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const schoolYear = cashGetSchoolYear(year, month);
  const schoolMonthNumber = cashGetSchoolMonthNumber(month);
  const monthStart = new Date(year, month - 1, 1);
  const inflow = topLevelKey === cashConfig.incomeLevel || (isUnclear && amount >= 0) ? amount : 0;
  const outflow = topLevelKey === cashConfig.expenseLevel || (isUnclear && amount < 0) ? -amount : 0;
  const odddsValue = oddds.type === cashConfig.odddsTypes.receipt || oddds.type === cashConfig.odddsTypes.payment
    ? amount
    : 0;

  return {
    id: registrar || 'row-' + source.rowNumber,
    rowNumber: source.rowNumber,
    registrar: registrar,
    operationDate: date,
    operationDateValue: date.getTime(),
    period: cashFormatDate(date, 'yyyy-MM-dd'),
    monthKey: cashFormatDate(monthStart, 'yyyy-MM-dd'),
    monthLabel: cashConfig.monthNames[month - 1],
    monthYearLabel: cashConfig.monthNames[month - 1] + ' ' + year,
    calendarYear: year,
    schoolYear: schoolYear,
    schoolMonthNumber: schoolMonthNumber,
    direction: direction,
    cfo: cfo,
    cfoKey: cashCreateKey(cfo),
    articleParent: articleParent,
    article: article,
    topLevel: topLevel,
    cashFlowSectionKey: oddds.sectionKey,
    cashFlowSection: oddds.section,
    cashFlowType: oddds.type,
    cashFlowLine: oddds.line,
    cashFlowValue: cashRound(odddsValue),
    amount: amount,
    inflow: inflow,
    outflow: outflow,
    ncf: cashRound(odddsValue),
    isInternal: isInternal,
    isUnclear: isUnclear,
    comment: cashNormalizeText(source.raw.comment || source.display.comment),
  };
}

function cashFallbackDate(source) {
  const monthInfo = cashResolveMonth(source.raw.reportMonth || source.display.reportMonth);
  const year = cashNormalizeNumber(source.raw.reportYear || source.display.reportYear) || new Date().getFullYear();
  return new Date(year, monthInfo.number - 1, 1);
}

function cashBuildMonths(facts) {
  const registry = {};

  facts.forEach(function cashCollectMonth(fact) {
    if (!registry[fact.monthKey]) {
      registry[fact.monthKey] = {
        key: fact.monthKey,
        label: fact.monthYearLabel,
        monthLabel: fact.monthLabel,
        schoolYear: fact.schoolYear,
        schoolMonthNumber: fact.schoolMonthNumber,
        dateValue: fact.monthKey,
      };
    }
  });

  return Object.keys(registry).map(function cashMapMonth(key) {
    return registry[key];
  }).sort(function cashSortMonths(a, b) {
    if (a.schoolYear === b.schoolYear) {
      return a.schoolMonthNumber - b.schoolMonthNumber;
    }
    return a.key.localeCompare(b.key);
  });
}

function cashBuildBalances(facts, months) {
  const allTurnoverByMonth = {};
  const fotExpenseByMonth = {};

  facts.forEach(function cashCollectBalanceAmounts(fact) {
    allTurnoverByMonth[fact.monthKey] = (allTurnoverByMonth[fact.monthKey] || 0) + fact.cashFlowValue;
    if (fact.cashFlowType === cashConfig.odddsTypes.payment && cashIncludesAny(fact.articleParent + ' ' + fact.article, ['фот'])) {
      fotExpenseByMonth[fact.monthKey] = (fotExpenseByMonth[fact.monthKey] || 0) - fact.cashFlowValue;
    }
  });

  let cumulative = 0;
  const balances = months.map(function cashMapBalance(month) {
    const opening = cashRound(cashConfig.startBalance + cumulative);
    const turnover = cashRound(allTurnoverByMonth[month.key] || 0);
    const fotExpenses = cashRound(fotExpenseByMonth[month.key] || 0);
    cumulative = cashRound(cumulative + turnover);

    return {
      monthKey: month.key,
      label: month.label,
      openingBalance: opening,
      turnover: turnover,
      closingBalance: cashRound(opening + turnover),
      fotExpenses: fotExpenses,
    };
  });

  const averageExpense = balances.length
    ? cashRound(balances.reduce(function cashSumExpenses(sum, item) { return sum + item.fotExpenses; }, 0) / balances.length)
    : 0;

  return balances.map(function cashAttachBenchmark(item) {
    item.expenseBenchmark = averageExpense;
    return item;
  });
}

function cashBuildMetrics(facts, balances) {
  const inflows = cashRound(facts.reduce(function cashSumInflows(sum, fact) { return sum + fact.inflow; }, 0));
  const outflows = cashRound(facts.reduce(function cashSumOutflows(sum, fact) { return sum + fact.outflow; }, 0));
  const ncf = cashRound(inflows - outflows);
  const currentBuffer = cashCalculateCashBuffer(facts, balances);

  return {
    inflows: inflows,
    outflows: outflows,
    ncf: ncf,
    cashBufferDays: currentBuffer.cashBufferDays,
    cashBufferMonth: currentBuffer.monthLabel,
    transactions: facts.length,
  };
}

function cashCalculateCashBuffer(facts, balances) {
  if (!balances.length) {
    return { cashBufferDays: 0, monthLabel: '' };
  }

  const currentMonth = balances[balances.length - 1];
  const currentMonthDate = cashParseIsoDate(currentMonth.monthKey);
  const windowStart = new Date(currentMonthDate.getTime());
  windowStart.setDate(windowStart.getDate() - 30);

  const expenses = facts.reduce(function cashSumPreviousExpenses(sum, fact) {
    if (fact.cashFlowSectionKey !== 'operating' || fact.cashFlowType !== cashConfig.odddsTypes.payment) return sum;
    if (fact.operationDate >= windowStart && fact.operationDate < currentMonthDate) {
      return sum - fact.cashFlowValue;
    }
    return sum;
  }, 0);
  const averageDailyExpense = expenses / 30;

  return {
    cashBufferDays: averageDailyExpense > 0 ? cashRound(currentMonth.openingBalance / averageDailyExpense) : 0,
    monthLabel: currentMonth.label,
  };
}

function cashBuildDirectories(facts) {
  const directions = {};
  const cfo = {};
  const articleParents = {};
  const articles = {};
  const schoolYears = {};

  cashConfig.requiredDirections.forEach(function cashAddRequiredDirection(direction) {
    directions[direction] = { value: direction, label: direction };
  });

  facts.forEach(function cashCollectDirectory(fact) {
    directions[fact.direction] = { value: fact.direction, label: fact.direction };
    cfo[fact.cfoKey] = { key: fact.cfoKey, name: fact.cfo, direction: fact.direction };
    articleParents[fact.articleParent] = { value: fact.articleParent, label: fact.articleParent };
    articles[cashCreateKey(fact.article)] = { value: fact.article, label: fact.article, articleParent: fact.articleParent };
    schoolYears[fact.schoolYear] = { value: fact.schoolYear, label: fact.schoolYear };
  });

  return {
    directions: cashSortDirectory(directions),
    cfo: Object.keys(cfo).map(function cashMapCfo(key) { return cfo[key]; }).sort(function cashSortCfo(a, b) { return a.name.localeCompare(b.name, 'ru'); }),
    articleParents: cashSortDirectory(articleParents),
    articles: Object.keys(articles).map(function cashMapArticle(key) { return articles[key]; }).sort(function cashSortArticles(a, b) { return a.label.localeCompare(b.label, 'ru'); }),
    schoolYears: Object.keys(schoolYears).map(function cashMapYear(key) { return schoolYears[key]; }).sort(function cashSortYears(a, b) { return b.value.localeCompare(a.value); }),
  };
}

function cashGetMoneyDrilldown(request) {
  return cashSafeRun('cashGetMoneyDrilldown', function () {
    const safeRequest = request || {};
    const rows = cashReadSourceRows({ limit: cashConfig.maxRows });
    const model = cashBuildModel(rows);
    const facts = cashApplyServerFilters(model.facts, safeRequest.filters || {});
    const filtered = facts.filter(function cashFilterDrillFactV2(fact) {
      const factParent = fact.normalizedArticleParent || fact.articleParent;
      const articleParentOk = !safeRequest.articleParent || factParent === safeRequest.articleParent;
      const articleOk = !safeRequest.article || fact.article === safeRequest.article;
      const monthOk = !safeRequest.monthKey || fact.monthKey === safeRequest.monthKey;
      const levelOk = !safeRequest.topLevel || fact.topLevel === safeRequest.topLevel;
      const sectionOk = !safeRequest.cashFlowSectionKey || fact.cashFlowSectionKey === safeRequest.cashFlowSectionKey;
      const typeOk = !safeRequest.cashFlowType || fact.cashFlowType === safeRequest.cashFlowType;
      return articleParentOk && articleOk && monthOk && levelOk && sectionOk && typeOk;
    });

    return cashSuccess({
      rows: filtered.map(function cashMapDrillFactV2(fact) {
        return {
          registrar: fact.registrar,
          amount: fact.amount,
          amountLabel: cashFormatCurrency(fact.amount),
          cfo: fact.cfo,
          comment: fact.comment,
          dateLabel: fact.operationDateLabel || fact.operationDate,
          articleParent: fact.normalizedArticleParent || fact.articleParent,
          originalArticleParent: fact.originalArticleParent || fact.articleParent,
          article: fact.article,
        };
      }),
    });
  });
}

function cashSortDirectory(registry) {
  return Object.keys(registry).map(function cashMapRegistry(key) {
    return registry[key];
  }).sort(function cashSortRegistry(a, b) {
    return a.label.localeCompare(b.label, 'ru');
  });
}

function cashBuildValidation(sourceRows, facts, counters, balances) {
  const balanceChecks = balances.map(function cashMapBalanceCheck(item, index) {
    const next = balances[index + 1];
    if (!next) {
      return null;
    }
    const expected = cashRound(item.openingBalance + item.turnover);
    const difference = cashRound(expected - next.openingBalance);
    return {
      monthKey: item.monthKey,
      expectedNextOpening: expected,
      actualNextOpening: next.openingBalance,
      difference: difference,
      isPassed: Math.abs(difference) < 0.01,
    };
  }).filter(function cashKeepCheck(item) {
    return item !== null;
  });
  const failedBalanceChecks = balanceChecks.filter(function cashFailedCheck(item) {
    return !item.isPassed;
  });
  const sourceNetAmount = cashRound(sourceRows.reduce(function cashReduceSourceNetAmount(sum, row) {
    return cashMoneyIsInternalSourceRow(row) ? sum : sum + cashNormalizeNumber(row.raw.amount);
  }, 0));
  const odddsNetAmount = cashRound(facts.reduce(function cashReduceOdddsNetAmount(sum, fact) {
    return sum + Number(fact.cashFlowValue || 0);
  }, 0));
  const sourceDifference = cashRound(sourceNetAmount - odddsNetAmount);

  return {
    emptyFields: {
      emptyDirectionRows: counters.emptyDirection,
      emptyCfoRows: counters.emptyCfo,
      message: 'Пустые направления заменены на «Администрация / Общее»: ' + counters.emptyDirection + '. Пустые ЦФО заменены на «Не распределено»: ' + counters.emptyCfo + '.',
    },
    internalFilter: {
      excludedRows: counters.internalExcluded,
      netAmount: cashRound(counters.internalNetAmount),
      hasMismatch: Math.abs(counters.internalNetAmount) >= 0.01,
      message: Math.abs(counters.internalNetAmount) < 0.01
        ? 'Из расчетов исключены внутренние перемещения: ' + counters.internalExcluded + '. Нетто-сумма сошлась в ноль.'
        : 'Из расчетов исключены внутренние перемещения: ' + counters.internalExcluded + '. Нетто-сумма не равна нулю: ' + cashRound(counters.internalNetAmount) + '.',
    },
    balance: {
      isPassed: failedBalanceChecks.length === 0,
      failedCount: failedBalanceChecks.length,
      checks: balanceChecks,
      message: failedBalanceChecks.length === 0
        ? 'Баланс сходится: входящий остаток + оборот месяца = входящий остаток следующего месяца.'
        : 'Есть расхождения в балансе: ' + failedBalanceChecks.length + '.',
    },
    sourceReconciliation: {
      isPassed: Math.abs(sourceDifference) < 0.01,
      sourceNetAmount: sourceNetAmount,
      odddsNetAmount: odddsNetAmount,
      difference: sourceDifference,
      message: Math.abs(sourceDifference) < 0.01
        ? 'Итоговое сальдо листа «Деньги» совпадает с итогом ОДДС.'
        : 'Итоговое сальдо листа «Деньги» не совпадает с итогом ОДДС. Расхождение: ' + sourceDifference + '.',
    },
    sourceRows: sourceRows.length,
    factRows: facts.length,
  };
}

function cashMoneyIsInternalSourceRow(row) {
  const article = cashNormalizeText(row.raw.article || row.display.article);
  const articleParent = cashNormalizeText(row.raw.articleParent || row.display.articleParent);
  const topLevel = cashNormalizeText(row.raw.topLevel || row.display.topLevel);
  return cashIsInternalOperation(article, articleParent, topLevel);
}

function cashApplyServerFilters(facts, filters) {
  const safeFilters = filters || {};
  const dateFrom = safeFilters.dateFrom ? cashParseIsoDate(safeFilters.dateFrom) : null;
  const dateTo = safeFilters.dateTo ? cashParseIsoDate(safeFilters.dateTo) : null;

  return facts.filter(function cashFilterServerFact(fact) {
    const operationDate = fact.operationDate instanceof Date ? fact.operationDate : cashParseIsoDate(fact.operationDate);
    const directionOk = !safeFilters.direction || safeFilters.direction === 'all' || fact.direction === safeFilters.direction;
    const cfoOk = !safeFilters.cfo || safeFilters.cfo === 'all' || fact.cfoKey === safeFilters.cfo;
    const parentOk = !safeFilters.articleParent || safeFilters.articleParent === 'all' || fact.articleParent === safeFilters.articleParent;
    const articleOk = !safeFilters.article || safeFilters.article === 'all' || fact.article === safeFilters.article;
    const dateFromOk = !dateFrom || operationDate >= dateFrom;
    const dateToOk = !dateTo || operationDate <= dateTo;
    return directionOk && cfoOk && parentOk && articleOk && dateFromOk && dateToOk;
  });
}

function cashSerializeFacts(facts) {
  return facts.map(function cashSerializeFact(fact) {
    return {
      id: fact.id,
      registrar: fact.registrar,
      operationDate: cashFormatDate(fact.operationDate, 'yyyy-MM-dd'),
      operationDateLabel: cashFormatDate(fact.operationDate, 'dd.MM.yyyy'),
      period: fact.period,
      monthKey: fact.monthKey,
      monthLabel: fact.monthLabel,
      monthYearLabel: fact.monthYearLabel,
      schoolYear: fact.schoolYear,
      schoolMonthNumber: fact.schoolMonthNumber,
      direction: fact.direction,
      cfo: fact.cfo,
      cfoKey: fact.cfoKey,
      articleParent: fact.articleParent,
      article: fact.article,
      topLevel: fact.topLevel,
      cashFlowSectionKey: fact.cashFlowSectionKey,
      cashFlowSection: fact.cashFlowSection,
      cashFlowType: fact.cashFlowType,
      cashFlowLine: fact.cashFlowLine,
      cashFlowValue: cashRound(fact.cashFlowValue),
      isUnclear: fact.isUnclear,
      amount: cashRound(fact.amount),
      inflow: cashRound(fact.inflow),
      outflow: cashRound(fact.outflow),
      ncf: cashRound(fact.ncf),
      comment: fact.comment,
    };
  });
}

function cashExtractDateFromRegistrar(value) {
  const text = cashNormalizeText(value);
  const match = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!match) {
    return null;
  }
  return new Date(
    Number(match[3]),
    Number(match[2]) - 1,
    Number(match[1]),
    Number(match[4] || 0),
    Number(match[5] || 0),
    Number(match[6] || 0)
  );
}

function cashResolveMonth(value) {
  const normalized = cashNormalizeText(value).toLowerCase();
  const monthMap = {
    январь: 1, января: 1,
    февраль: 2, февраля: 2,
    март: 3, марта: 3,
    апрель: 4, апреля: 4,
    май: 5, мая: 5,
    июнь: 6, июня: 6,
    июль: 7, июля: 7,
    август: 8, августа: 8,
    сентябрь: 9, сентября: 9,
    октябрь: 10, октября: 10,
    ноябрь: 11, ноября: 11,
    декабрь: 12, декабря: 12,
  };
  const number = monthMap[normalized] || Number(normalized) || 1;
  return { number: number, label: cashConfig.monthNames[number - 1] || 'Январь' };
}

function cashIsInternalOperation(article, articleParent, topLevel) {
  const text = [article, articleParent, topLevel].join(' ').toLowerCase();
  return cashConfig.internalPatterns.some(function cashMatchInternal(pattern) {
    return text.indexOf(pattern) !== -1;
  });
}

function cashClassifyOddds(article, articleParent, topLevel, amount) {
  const text = cashNormalizeText([articleParent, article, topLevel].join(' ')).toLowerCase();
  const topLevelKey = cashNormalizeText(topLevel).toLowerCase();

  if (topLevelKey === 'кредиты') {
    return Number(amount || 0) >= 0
      ? cashOdddsResult('financing', cashConfig.odddsTypes.receipt, articleParent || article || 'Получение кредита')
      : cashOdddsResult('financing', cashConfig.odddsTypes.payment, articleParent || article || 'Погашение кредита');
  }

  if (topLevelKey === 'выяснить') {
    return Number(amount || 0) >= 0
      ? cashOdddsResult('operating', cashConfig.odddsTypes.receipt, 'Прочие доходы')
      : cashOdddsResult('operating', cashConfig.odddsTypes.payment, 'Выяснить');
  }

  if (topLevelKey === 'подотчетные суммы' || topLevelKey === 'подотчётные суммы') {
    return Number(amount || 0) >= 0
      ? cashOdddsResult('operating', cashConfig.odddsTypes.receipt, 'Возврат подотчетных сумм')
      : cashOdddsResult('operating', cashConfig.odddsTypes.payment, 'Подотчетные суммы');
  }

  if (cashIncludesAny(text, cashConfig.investingPaymentPatterns)) {
    return cashOdddsResult('investing', cashConfig.odddsTypes.payment, articleParent || article);
  }

  if (cashIncludesAny(text, cashConfig.financingReceiptPatterns)) {
    return cashOdddsResult('financing', cashConfig.odddsTypes.receipt, articleParent || article);
  }

  if (cashIncludesAny(text, cashConfig.financingPaymentPatterns)) {
    return cashOdddsResult('financing', cashConfig.odddsTypes.payment, articleParent || article);
  }

  if (topLevelKey === cashConfig.incomeLevel) {
    return cashOdddsResult('operating', cashConfig.odddsTypes.receipt, articleParent || article);
  }

  if (topLevelKey === cashConfig.expenseLevel) {
    return cashOdddsResult('operating', cashConfig.odddsTypes.payment, articleParent || article);
  }

  if (cashIncludesAny(text, cashConfig.operatingReceiptPatterns)) {
    return cashOdddsResult('operating', cashConfig.odddsTypes.receipt, articleParent || article);
  }

  if (cashIncludesAny(text, cashConfig.operatingPaymentPatterns)) {
    return cashOdddsResult('operating', cashConfig.odddsTypes.payment, articleParent || article);
  }

  return cashOdddsResult('operating', '', articleParent || article || cashConfig.articleFallback);
}

function cashOdddsResult(sectionKey, type, line) {
  return {
    sectionKey: sectionKey,
    section: cashConfig.odddsSections[sectionKey],
    type: type,
    line: cashNormalizeText(line) || cashConfig.articleFallback,
  };
}

function cashIncludesAny(text, patterns) {
  const normalized = cashNormalizeText(text).toLowerCase().replace(/ё/g, 'е');
  return patterns.some(function cashMatchPattern(pattern) {
    return normalized.indexOf(cashNormalizeText(pattern).toLowerCase().replace(/ё/g, 'е')) !== -1;
  });
}

function cashGetSchoolYear(year, month) {
  return month >= 9 ? year + '-' + (year + 1) : (year - 1) + '-' + year;
}

function cashGetSchoolMonthNumber(month) {
  return month >= 9 ? month - 8 : month + 4;
}

function cashNormalizeCfo(value) {
  return cashNormalizeText(value).replace(/\s*-\s*/g, ' - ');
}

function cashNormalizeText(value) {
  return String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function cashNormalizeNumber(value) {
  if (typeof value === 'number') {
    return isFinite(value) ? value : 0;
  }
  const parsed = Number(String(value || '').replace(/\s/g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
  return isFinite(parsed) ? parsed : 0;
}

function cashNormalizeLimit(value) {
  const parsed = Number(value || cashConfig.maxRows);
  if (!isFinite(parsed) || parsed <= 0) {
    return cashConfig.maxRows;
  }
  return Math.min(Math.floor(parsed), cashConfig.maxRows);
}

function cashCreateKey(value) {
  return cashNormalizeText(value).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'empty';
}

function cashParseIsoDate(value) {
  const parts = String(value).split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function cashFormatDate(date, pattern) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return '';
  }
  return Utilities.formatDate(date, Session.getScriptTimeZone() || 'Europe/Moscow', pattern || 'yyyy-MM-dd');
}

function cashFormatCurrency(value) {
  return Number(value || 0).toLocaleString('ru-RU', { style: 'currency', currency: 'RUB' });
}

function cashRound(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function cashSafeRun(source, callback) {
  try {
    return callback();
  } catch (error) {
    console.error('[cash][' + source + ']', error);
    return cashFailure(error, source);
  }
}

function cashSuccess(data) {
  return {
    success: true,
    status: 'ok',
    data: data || {},
    error: null,
    meta: cashMeta(),
  };
}

function cashFailure(error, source) {
  const normalized = error && error.isCashError
    ? { code: error.code, message: error.message, details: error.details || {} }
    : { code: 'CASH_ERROR', message: error && error.message ? error.message : 'Ошибка модуля ДДС.', details: { source: source || 'cash' } };

  return {
    success: false,
    status: 'error',
    data: null,
    error: normalized,
    meta: cashMeta(),
  };
}

function cashError(code, message, details) {
  return {
    isCashError: true,
    code: code,
    message: message,
    details: details || {},
  };
}

function cashMeta() {
  return {
    module: 'cash',
    version: '2.1.0',
    timestamp: new Date().toISOString(),
    timezone: Session.getScriptTimeZone() || 'Europe/Moscow',
  };
}

function cashClassifyOddds(article, articleParent, topLevel, amount) {
  const normalizedAmount = Number(amount || 0);
  const lineText = cashNormalizeText(articleParent || article || cashConfig.articleFallback);
  const articleText = cashNormalizeText(article);
  const parentText = cashNormalizeText(articleParent);
  const topLevelText = cashNormalizeText(topLevel);
  const text = cashNormalizeText([parentText, articleText, topLevelText].join(' ')).toLowerCase().replace(/ё/g, 'е');
  const topLevelKey = topLevelText.toLowerCase().replace(/ё/g, 'е');

  if (cashIsCashCreditOperation(topLevelKey, text)) {
    return normalizedAmount >= 0
      ? cashOdddsResult('financing', cashConfig.odddsTypes.receipt, cashDetectCreditLine(lineText, articleText, 'Получение кредита'))
      : cashOdddsResult('financing', cashConfig.odddsTypes.payment, cashDetectCreditLine(lineText, articleText, 'Погашение кредита'));
  }

  if (cashIsCashDepositOperation(topLevelKey, text)) {
    return cashOdddsResult('operating', cashConfig.odddsTypes.receipt, 'Депозиты / авансы будущей выручки');
  }

  if (topLevelKey === 'выяснить') {
    return normalizedAmount >= 0
      ? cashOdddsResult('operating', cashConfig.odddsTypes.receipt, 'Прочие доходы / выяснить')
      : cashOdddsResult('operating', cashConfig.odddsTypes.payment, 'Выяснить');
  }

  if (topLevelKey === 'подотчетные суммы' || topLevelKey === 'подотчетные суммы') {
    return normalizedAmount >= 0
      ? cashOdddsResult('operating', cashConfig.odddsTypes.receipt, 'Возврат подотчетных сумм')
      : cashOdddsResult('operating', cashConfig.odddsTypes.payment, 'Подотчетные суммы');
  }

  if (cashTextHasAny(text, ['приобретение ос', 'основные средства', 'лизинг'])) {
    return cashOdddsResult('investing', cashConfig.odddsTypes.payment, lineText);
  }

  if (cashTextHasAny(text, ['взнос в ук', 'получение ссуды', 'получение кредита', 'кредит получен', 'ссуда получена'])) {
    return cashOdddsResult('financing', cashConfig.odddsTypes.receipt, lineText || 'Получение кредита');
  }

  if (cashTextHasAny(text, ['погашение ссуды', 'погашение кредита', 'дивиденды'])) {
    return cashOdddsResult('financing', cashConfig.odddsTypes.payment, lineText || 'Погашение кредита');
  }

  if (topLevelKey === 'выручка') {
    return cashOdddsResult('operating', cashConfig.odddsTypes.receipt, lineText);
  }

  if (topLevelKey === 'затраты/расходы') {
    return cashOdddsResult('operating', cashConfig.odddsTypes.payment, lineText);
  }

  if (cashTextHasAny(text, [
    'основное образование',
    'доп образование',
    'доп. образование',
    'дополнительное образование',
    'допобразование',
    'дополнительные доходы',
    'дополнительные доходы/расходы',
    'проекты',
    'лагерь',
    'мероприятия',
    'прочие доходы',
    'субсидия',
    'депозиты',
    'депозит',
  ])) {
    return cashOdddsResult('operating', cashConfig.odddsTypes.receipt, cashIsCashDepositOperation(topLevelKey, text) ? 'Депозиты / авансы будущей выручки' : lineText);
  }

  if (cashTextHasAny(text, [
    'аренда',
    'прочие расходы',
    'реклама',
    'поставщикам',
    'материалы',
    'коммунал',
    'электроэнерг',
    'налоги',
    'фот',
    'проценты по кредиту',
    'выдача в подотчет',
    'подотчет',
  ])) {
    return cashOdddsResult('operating', cashConfig.odddsTypes.payment, lineText);
  }

  return cashOdddsResult('operating', '', lineText || cashConfig.articleFallback);
}

function cashIsCashCreditOperation(topLevelKey, text) {
  if (cashTextHasAny(text, ['проценты по кредиту', 'процент по кредиту'])) {
    return false;
  }

  return topLevelKey === 'кредиты'
    || cashTextHasAny(text, [
      'получение кредита',
      'погашение кредита',
      'кредиты и займы',
      'кредит',
      'ссуда',
      'заем',
      'займ',
    ]);
}

function cashDetectCreditLine(parentText, articleText, fallback) {
  const text = cashNormalizeText([parentText, articleText].join(' ')).toLowerCase().replace(/ё/g, 'е');
  const fallbackText = cashNormalizeText(fallback).toLowerCase().replace(/ё/g, 'е');
  const isPaymentFallback = cashTextHasAny(fallbackText, ['погашение', 'возврат']);

  if (cashTextHasAny(text, ['ссуда', 'заем', 'займ'])) {
    return cashTextHasAny(text, ['погашение', 'возврат']) || isPaymentFallback
      ? 'Погашение ссуды'
      : 'Получение ссуды';
  }

  if (cashTextHasAny(text, ['кредит'])) {
    return cashTextHasAny(text, ['погашение', 'возврат']) || isPaymentFallback
      ? 'Погашение кредита'
      : 'Получение кредита';
  }

  return parentText || articleText || fallback;
}

function cashIsCashDepositOperation(topLevelKey, text) {
  return topLevelKey === 'депозиты'
    || topLevelKey === 'депозит'
    || cashTextHasAny(text, [
      'депозит',
      'депозиты',
      'аванс будущей выручки',
      'авансы будущей выручки',
    ]);
}

function cashTextHasAny(text, patterns) {
  const normalized = cashNormalizeText(text).toLowerCase().replace(/ё/g, 'е');
  return patterns.some(function cashMatchTextPattern(pattern) {
    return normalized.indexOf(cashNormalizeText(pattern).toLowerCase().replace(/ё/g, 'е')) !== -1;
  });
}

function cashBuildModel(rows) {
  const counters = {
    emptyDirection: 0,
    emptyCfo: 0,
    internalExcluded: 0,
    internalNetAmount: 0,
  };
  const mapping = cashReadOldArticleParentMapping();
  const facts = [];

  rows.forEach(function cashTransformSourceWithMapping(source) {
    const fact = cashTransformFact(source, counters);

    if (fact.isInternal) {
      counters.internalExcluded += 1;
      counters.internalNetAmount = cashRound(counters.internalNetAmount + fact.amount);
      return;
    }

    cashApplyNormalizedArticleParent(fact, mapping);
    facts.push(fact);
  });

  facts.sort(function cashSortFactsWithMapping(a, b) {
    return a.operationDateValue - b.operationDateValue;
  });

  const months = cashBuildMonths(facts);
  const balances = cashBuildBalances(facts, months);

  return {
    config: {
      startBalance: cashConfig.startBalance,
      startDate: cashFormatDate(cashConfig.startDate, 'yyyy-MM-dd'),
    },
    facts: cashSerializeFacts(facts),
    directories: cashBuildDirectories(facts),
    months: months,
    balances: balances,
    metrics: cashBuildMetrics(facts, balances),
    validation: cashBuildValidation(rows, facts, counters, balances),
    mapping: {
      oldArticleParentRows: Object.keys(mapping).length,
      cutoffDate: '2026-01-01',
    },
  };
}

function cashReadOldArticleParentMapping() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet ? spreadsheet.getSheetByName('Мэппинг старого справочника') : null;
  const mapping = {};

  if (!sheet || sheet.getLastRow() < 5) {
    return mapping;
  }

  const values = sheet.getRange(4, 1, sheet.getLastRow() - 3, Math.min(sheet.getLastColumn(), 14)).getValues();
  const headers = values[0].map(function cashMapMappingHeader(header) {
    return cashNormalizeText(header).toLowerCase();
  });
  const sourceIndex = cashFindMappingColumn(headers, ['исходная статья ддс.родитель', 'исходная']);
  const approvedIndex = cashFindMappingColumn(headers, ['утвержденная нормализованная статья', 'утверждённая нормализованная статья']);
  const suggestedIndex = cashFindMappingColumn(headers, ['предложенная нормализованная статья', 'предложенная']);

  if (sourceIndex < 0) {
    return mapping;
  }

  values.slice(1).forEach(function cashMapApprovedArticleParent(row) {
    const sourceParent = cashNormalizeText(row[sourceIndex]);
    const approvedParent = approvedIndex >= 0 ? cashNormalizeText(row[approvedIndex]) : '';
    const suggestedParent = suggestedIndex >= 0 ? cashNormalizeText(row[suggestedIndex]) : '';
    const normalizedParent = approvedParent || suggestedParent;

    if (sourceParent && normalizedParent) {
      mapping[cashNormalizeArticleParentName(sourceParent)] = normalizedParent;
    }
  });

  return mapping;
}

function cashFindMappingColumn(headers, aliases) {
  return headers.findIndex(function cashMatchMappingColumn(header) {
    return aliases.some(function cashMatchMappingAlias(alias) {
      const normalizedAlias = cashNormalizeText(alias).toLowerCase().replace(/ё/g, 'е');
      const normalizedHeader = cashNormalizeText(header).toLowerCase().replace(/ё/g, 'е');
      return normalizedHeader === normalizedAlias || normalizedHeader.indexOf(normalizedAlias) !== -1;
    });
  });
}

function cashApplyNormalizedArticleParent(fact, mapping) {
  const cutoffDate = new Date(2026, 0, 1);
  const operationDate = fact.operationDate instanceof Date ? fact.operationDate : cashParseIsoDate(fact.operationDate);
  const sourceParent = cashNormalizeText(fact.articleParent);
  const normalizedParent = operationDate < cutoffDate
    ? mapping[cashNormalizeArticleParentName(sourceParent)] || sourceParent
    : sourceParent;

  fact.originalArticleParent = sourceParent;
  fact.normalizedArticleParent = normalizedParent || sourceParent || cashConfig.articleFallback;
}

function cashSerializeFacts(facts) {
  return facts.map(function cashSerializeFactWithMapping(fact) {
    return {
      id: fact.id,
      registrar: fact.registrar,
      operationDate: cashFormatDate(fact.operationDate, 'yyyy-MM-dd'),
      operationDateLabel: cashFormatDate(fact.operationDate, 'dd.MM.yyyy'),
      period: fact.period,
      monthKey: fact.monthKey,
      monthLabel: fact.monthLabel,
      monthYearLabel: fact.monthYearLabel,
      calendarYear: fact.calendarYear,
      schoolYear: fact.schoolYear,
      schoolMonthNumber: fact.schoolMonthNumber,
      direction: fact.direction,
      cfo: fact.cfo,
      cfoKey: fact.cfoKey,
      articleParent: fact.articleParent,
      originalArticleParent: fact.originalArticleParent || fact.articleParent,
      normalizedArticleParent: fact.normalizedArticleParent || fact.articleParent,
      article: fact.article,
      topLevel: fact.topLevel,
      cashFlowSectionKey: fact.cashFlowSectionKey,
      cashFlowSection: fact.cashFlowSection,
      cashFlowType: fact.cashFlowType,
      cashFlowLine: fact.cashFlowLine,
      cashFlowValue: cashRound(fact.cashFlowValue),
      isUnclear: fact.isUnclear,
      amount: cashRound(fact.amount),
      inflow: cashRound(fact.inflow),
      outflow: cashRound(fact.outflow),
      ncf: cashRound(fact.ncf),
      comment: fact.comment,
    };
  });
}

function cashCreateNormalizedArticleParentCheckReport() {
  return cashSafeRun('cashCreateNormalizedArticleParentCheckReport', function () {
    const rows = cashReadSourceRows({ limit: cashConfig.maxRows });
    const model = cashBuildModel(rows);
    const registry = {};

    (model.facts || []).forEach(function cashGroupNormalizedArticleParent(fact) {
      const key = [
        fact.monthYearLabel,
        fact.topLevel,
        fact.normalizedArticleParent,
        fact.originalArticleParent,
      ].join('||');

      if (!registry[key]) {
        registry[key] = {
          month: fact.monthYearLabel,
          topLevel: fact.topLevel,
          normalizedArticleParent: fact.normalizedArticleParent,
          originalArticleParent: fact.originalArticleParent,
          rows: 0,
          amount: 0,
        };
      }

      registry[key].rows += 1;
      registry[key].amount = cashRound(registry[key].amount + Number(fact.cashFlowValue || 0));
    });

    const reportRows = Object.keys(registry).map(function cashMapNormalizedArticleParentRow(key) {
      const row = registry[key];
      return [
        row.month,
        row.topLevel,
        row.normalizedArticleParent,
        row.originalArticleParent,
        row.rows,
        row.amount,
      ];
    }).sort(function cashSortNormalizedArticleParentRows(a, b) {
      return String(a[0]).localeCompare(String(b[0]), 'ru')
        || String(a[2]).localeCompare(String(b[2]), 'ru')
        || Math.abs(Number(b[5] || 0)) - Math.abs(Number(a[5] || 0));
    });

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheetName = 'Проверка нормализации ДДС';
    let sheet = spreadsheet.getSheetByName(sheetName);

    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
    }

    sheet.clear();
    sheet.getRange(1, 1, 1, 6).merge().setValue('Проверка нормализации родительских статей ДДС');
    sheet.getRange(2, 1, 1, 6).merge().setValue('Сверка показывает, как исходные старые статьи свернулись в нормализованные статьи. Дашборд пока не переключён автоматически.');
    sheet.getRange(4, 1, 1, 6).setValues([[
      'Месяц',
      'Верхний уровень',
      'Нормализованная статья ДДС.Родитель',
      'Исходная статья ДДС.Родитель',
      'Кол-во строк',
      'Сумма ОДДС',
    ]]);

    if (reportRows.length) {
      sheet.getRange(5, 1, reportRows.length, 6).setValues(reportRows);
    }

    sheet.setFrozenRows(4);
    sheet.getRange(1, 1, 1, 6).setBackground('#0f172a').setFontColor('#ffffff').setFontSize(14).setFontWeight('bold');
    sheet.getRange(2, 1, 1, 6).setBackground('#e0f2fe').setFontColor('#0f172a').setWrap(true);
    sheet.getRange(4, 1, 1, 6).setBackground('#1f2937').setFontColor('#ffffff').setFontWeight('bold').setWrap(true);

    if (reportRows.length) {
      sheet.getRange(5, 1, reportRows.length, 6).setBorder(true, true, true, true, true, true).setWrap(true);
      sheet.getRange(5, 6, reportRows.length, 1).setNumberFormat('#,##0.00');
    }

    sheet.autoResizeColumns(1, 6);
    sheet.setColumnWidth(3, 280);
    sheet.setColumnWidth(4, 280);

    return cashSuccess({
      sheetName: sheetName,
      rows: reportRows.length,
      message: 'Проверочный лист создан: ' + sheetName + '.',
    });
  });
}

function cashReadOldArticleParentMapping() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet ? spreadsheet.getSheetByName('Мэппинг старого справочника') : null;
  const mapping = {
    exact: {},
    byParent: {},
    count: 0,
  };

  if (!sheet || sheet.getLastRow() < 5) {
    return mapping;
  }

  const values = sheet.getRange(4, 1, sheet.getLastRow() - 3, Math.min(sheet.getLastColumn(), 14)).getValues();
  const headers = values[0].map(function cashMapMappingHeaderV2(header) {
    return cashNormalizeText(header).toLowerCase();
  });
  const sourceIndex = cashFindMappingColumn(headers, ['исходная статья ддс.родитель', 'исходная']);
  const topLevelIndex = cashFindMappingColumn(headers, ['верхний уровень']);
  const approvedIndex = cashFindMappingColumn(headers, ['утвержденная нормализованная статья', 'утверждённая нормализованная статья']);
  const suggestedIndex = cashFindMappingColumn(headers, ['предложенная нормализованная статья', 'предложенная']);
  const parentVariants = {};

  if (sourceIndex < 0) {
    return mapping;
  }

  values.slice(1).forEach(function cashMapApprovedArticleParentV2(row) {
    const sourceParent = cashNormalizeText(row[sourceIndex]);
    const topLevel = topLevelIndex >= 0 ? cashNormalizeText(row[topLevelIndex]) : '';
    const approvedParent = approvedIndex >= 0 ? cashNormalizeText(row[approvedIndex]) : '';
    const suggestedParent = suggestedIndex >= 0 ? cashNormalizeText(row[suggestedIndex]) : '';
    const normalizedParent = approvedParent || suggestedParent;

    if (!sourceParent || !normalizedParent) {
      return;
    }

    const parentKey = cashNormalizeArticleParentName(sourceParent);
    const exactKey = cashCreateArticleMappingKey(sourceParent, topLevel);
    mapping.exact[exactKey] = normalizedParent;
    mapping.count += 1;

    if (!parentVariants[parentKey]) {
      parentVariants[parentKey] = {};
    }
    parentVariants[parentKey][normalizedParent] = true;
  });

  Object.keys(parentVariants).forEach(function cashBuildSingleParentMapping(parentKey) {
    const variants = Object.keys(parentVariants[parentKey]);

    if (variants.length === 1) {
      mapping.byParent[parentKey] = variants[0];
    }
  });

  return mapping;
}

function cashApplyNormalizedArticleParent(fact, mapping) {
  const cutoffDate = new Date(2026, 0, 1);
  const operationDate = fact.operationDate instanceof Date ? fact.operationDate : cashParseIsoDate(fact.operationDate);
  const sourceParent = cashNormalizeText(fact.articleParent);
  const exactKey = cashCreateArticleMappingKey(sourceParent, fact.topLevel);
  const parentKey = cashNormalizeArticleParentName(sourceParent);
  const normalizedParent = operationDate < cutoffDate
    ? (mapping.exact && mapping.exact[exactKey]) || (mapping.byParent && mapping.byParent[parentKey]) || sourceParent
    : sourceParent;

  fact.originalArticleParent = sourceParent;
  fact.normalizedArticleParent = normalizedParent || sourceParent || cashConfig.articleFallback;
}

function cashCreateArticleMappingKey(articleParent, topLevel) {
  return [
    cashNormalizeArticleParentName(articleParent),
    cashNormalizeText(topLevel).toLowerCase().replace(/ё/g, 'е'),
  ].join('||');
}

function cashBuildDirectories(facts) {
  const directions = {};
  const cfo = {};
  const articleParents = {};
  const articles = {};
  const schoolYears = {};

  cashConfig.requiredDirections.forEach(function cashAddRequiredDirectionV2(direction) {
    directions[direction] = { value: direction, label: direction };
  });

  facts.forEach(function cashCollectDirectoryV2(fact) {
    const normalizedParent = fact.normalizedArticleParent || fact.articleParent;

    directions[fact.direction] = { value: fact.direction, label: fact.direction };
    cfo[fact.cfoKey] = { key: fact.cfoKey, name: fact.cfo, direction: fact.direction };
    articleParents[normalizedParent] = { value: normalizedParent, label: normalizedParent };
    articles[cashCreateKey(fact.article)] = {
      value: fact.article,
      label: fact.article,
      articleParent: normalizedParent,
      originalArticleParent: fact.articleParent,
    };
    schoolYears[fact.schoolYear] = { value: fact.schoolYear, label: fact.schoolYear };
  });

  return {
    directions: cashSortDirectory(directions),
    cfo: Object.keys(cfo).map(function cashMapCfoV2(key) { return cfo[key]; }).sort(function cashSortCfoV2(a, b) { return a.name.localeCompare(b.name, 'ru'); }),
    articleParents: cashSortDirectory(articleParents),
    articles: Object.keys(articles).map(function cashMapArticleV2(key) { return articles[key]; }).sort(function cashSortArticlesV2(a, b) { return a.label.localeCompare(b.label, 'ru'); }),
    schoolYears: Object.keys(schoolYears).map(function cashMapYearV2(key) { return schoolYears[key]; }).sort(function cashSortYearsV2(a, b) { return b.value.localeCompare(a.value); }),
  };
}

function cashIsInternalOperation(article, articleParent, topLevel) {
  const articleText = cashNormalizeText(article).toLowerCase().replace(/ё/g, 'е');
  const parentText = cashNormalizeText(articleParent).toLowerCase().replace(/ё/g, 'е');
  const topLevelText = cashNormalizeText(topLevel).toLowerCase().replace(/ё/g, 'е');
  const text = [articleText, parentText, topLevelText].join(' ');

  if (cashIsCashDepositOperation(topLevelText, text)) {
    return false;
  }

  return cashConfig.internalPatterns.some(function cashMatchInternal(pattern) {
    return text.indexOf(cashNormalizeText(pattern).toLowerCase().replace(/ё/g, 'е')) !== -1;
  });
}
function cashReadOldArticleParentMapping() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheetNames = [
    'Мэппинг старого справочника',
    'Мэппинг статей ДДС — черновик',
  ];
  let sheet = null;

  if (spreadsheet) {
    sheetNames.some(function cashFindMappingSheet(sheetName) {
      sheet = spreadsheet.getSheetByName(sheetName);
      return Boolean(sheet);
    });
  }

  const mapping = {
    exact: {},
    byParent: {},
    count: 0,
  };

  if (!sheet || sheet.getLastRow() < 5) {
    return mapping;
  }

  const values = sheet.getRange(4, 1, sheet.getLastRow() - 3, Math.min(sheet.getLastColumn(), 14)).getValues();
  const headers = values[0].map(function cashMapMappingHeaderFinal(header) {
    return cashNormalizeText(header).toLowerCase().replace(/ё/g, 'е');
  });
  const sourceIndex = cashFindMappingColumn(headers, ['исходная статья ддс.родитель', 'исходная']);
  const topLevelIndex = cashFindMappingColumn(headers, ['верхний уровень']);
  const approvedIndex = cashFindMappingColumn(headers, ['утвержденная нормализованная статья', 'утверждённая нормализованная статья', 'утвержденная группа', 'утверждённая группа']);
  const suggestedIndex = cashFindMappingColumn(headers, ['предложенная нормализованная статья', 'предложенная управленческая группа', 'предложенная']);
  const parentVariants = {};

  if (sourceIndex < 0) {
    return mapping;
  }

  values.slice(1).forEach(function cashMapApprovedArticleParentFinal(row) {
    const sourceParent = cashNormalizeText(row[sourceIndex]);
    const topLevel = topLevelIndex >= 0 ? cashNormalizeText(row[topLevelIndex]) : '';
    const approvedParent = approvedIndex >= 0 ? cashNormalizeText(row[approvedIndex]) : '';
    const suggestedParent = suggestedIndex >= 0 ? cashNormalizeText(row[suggestedIndex]) : '';
    const normalizedParent = approvedParent || suggestedParent;

    if (!sourceParent || !normalizedParent) {
      return;
    }

    const parentKey = cashNormalizeArticleParentName(sourceParent);
    const exactKey = cashCreateArticleMappingKey(sourceParent, topLevel);
    mapping.exact[exactKey] = normalizedParent;
    mapping.count += 1;

    if (!parentVariants[parentKey]) {
      parentVariants[parentKey] = {};
    }

    parentVariants[parentKey][normalizedParent] = true;
  });

  Object.keys(parentVariants).forEach(function cashBuildSingleParentMappingFinal(parentKey) {
    const variants = Object.keys(parentVariants[parentKey]);

    if (variants.length === 1) {
      mapping.byParent[parentKey] = variants[0];
    }
  });

  return mapping;
}

function cashReadOldArticleParentMapping() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheetNames = [
    'Мэппинг старого справочника',
    'Мэппинг статей ДДС — черновик',
  ];
  let sheet = null;

  if (spreadsheet) {
    sheetNames.some(function cashFindMappingSheet(sheetName) {
      sheet = spreadsheet.getSheetByName(sheetName);
      return Boolean(sheet);
    });
  }

  const mapping = {
    exact: {},
    byParent: {},
    count: 0,
  };

  if (!sheet || sheet.getLastRow() < 5) {
    return mapping;
  }

  const values = sheet.getRange(4, 1, sheet.getLastRow() - 3, Math.min(sheet.getLastColumn(), 14)).getValues();
  const headers = values[0].map(function cashMapMappingHeaderFinal(header) {
    return cashNormalizeText(header).toLowerCase().replace(/ё/g, 'е');
  });
  const sourceIndex = cashFindMappingColumn(headers, ['исходная статья ддс.родитель', 'исходная']);
  const topLevelIndex = cashFindMappingColumn(headers, ['верхний уровень']);
  const approvedIndex = cashFindMappingColumn(headers, ['утвержденная нормализованная статья', 'утверждённая нормализованная статья', 'утвержденная группа', 'утверждённая группа']);
  const suggestedIndex = cashFindMappingColumn(headers, ['предложенная нормализованная статья', 'предложенная управленческая группа', 'предложенная']);
  const parentVariants = {};

  if (sourceIndex < 0) {
    return mapping;
  }

  values.slice(1).forEach(function cashMapApprovedArticleParentFinal(row) {
    const sourceParent = cashNormalizeText(row[sourceIndex]);
    const topLevel = topLevelIndex >= 0 ? cashNormalizeText(row[topLevelIndex]) : '';
    const approvedParent = approvedIndex >= 0 ? cashNormalizeText(row[approvedIndex]) : '';
    const suggestedParent = suggestedIndex >= 0 ? cashNormalizeText(row[suggestedIndex]) : '';
    const normalizedParent = approvedParent || suggestedParent;

    if (!sourceParent || !normalizedParent) {
      return;
    }

    const parentKey = cashNormalizeArticleParentName(sourceParent);
    const exactKey = cashCreateArticleMappingKey(sourceParent, topLevel);
    mapping.exact[exactKey] = normalizedParent;
    mapping.count += 1;

    if (!parentVariants[parentKey]) {
      parentVariants[parentKey] = {};
    }

    parentVariants[parentKey][normalizedParent] = true;
  });

  Object.keys(parentVariants).forEach(function cashBuildSingleParentMappingFinal(parentKey) {
    const variants = Object.keys(parentVariants[parentKey]);

    if (variants.length === 1) {
      mapping.byParent[parentKey] = variants[0];
    }
  });

  return mapping;
}

function cashFindMappingColumn(headers, aliases) {
  return headers.findIndex(function cashMatchMappingColumnFinal(header) {
    return aliases.some(function cashMatchMappingAliasFinal(alias) {
      const normalizedAlias = cashNormalizeText(alias).toLowerCase().replace(/ё/g, 'е');
      const normalizedHeader = cashNormalizeText(header).toLowerCase().replace(/ё/g, 'е');
      return normalizedHeader === normalizedAlias || normalizedHeader.indexOf(normalizedAlias) !== -1;
    });
  });
}

function cashCreateArticleMappingKey(articleParent, topLevel) {
  return [
    cashNormalizeArticleParentName(articleParent),
    cashNormalizeText(topLevel).toLowerCase().replace(/ё/g, 'е'),
  ].join('||');
}

function cashApplyNormalizedArticleParent(fact, mapping) {
  const cutoffDate = new Date(2026, 0, 1);
  const operationDate = fact.operationDate instanceof Date ? fact.operationDate : cashParseIsoDate(fact.operationDate);
  const sourceParent = cashNormalizeText(fact.articleParent);
  const exactKey = cashCreateArticleMappingKey(sourceParent, fact.topLevel);
  const parentKey = cashNormalizeArticleParentName(sourceParent);
  const normalizedParent = operationDate < cutoffDate
    ? (mapping.exact && mapping.exact[exactKey]) || (mapping.byParent && mapping.byParent[parentKey]) || sourceParent
    : sourceParent;

  fact.originalArticleParent = sourceParent;
  fact.normalizedArticleParent = normalizedParent || sourceParent || cashConfig.articleFallback;
}

function cashApplyServerFilters(facts, filters) {
  const safeFilters = filters || {};
  const dateFrom = safeFilters.dateFrom ? cashParseIsoDate(safeFilters.dateFrom) : null;
  const dateTo = safeFilters.dateTo ? cashParseIsoDate(safeFilters.dateTo) : null;

  return facts.filter(function cashFilterServerFactFinal(fact) {
    const operationDate = fact.operationDate instanceof Date ? fact.operationDate : cashParseIsoDate(fact.operationDate);
    const factParent = fact.normalizedArticleParent || fact.articleParent;
    const directionOk = !safeFilters.direction || safeFilters.direction === 'all' || fact.direction === safeFilters.direction;
    const cfoOk = !safeFilters.cfo || safeFilters.cfo === 'all' || fact.cfoKey === safeFilters.cfo;
    const parentOk = !safeFilters.articleParent || safeFilters.articleParent === 'all' || factParent === safeFilters.articleParent;
    const articleOk = !safeFilters.article || safeFilters.article === 'all' || fact.article === safeFilters.article;
    const dateFromOk = !dateFrom || operationDate >= dateFrom;
    const dateToOk = !dateTo || operationDate <= dateTo;
    return directionOk && cfoOk && parentOk && articleOk && dateFromOk && dateToOk;
  });
}

function cashGetMoneyDrilldown(request) {
  return cashSafeRun('cashGetMoneyDrilldown', function () {
    const safeRequest = request || {};
    const rows = cashReadSourceRows({ limit: cashConfig.maxRows });
    const model = cashBuildModel(rows);
    const facts = cashApplyServerFilters(model.facts, safeRequest.filters || {});
    const filtered = facts.filter(function cashFilterDrillFactFinal(fact) {
      const factParent = fact.normalizedArticleParent || fact.articleParent;
      const articleParentOk = !safeRequest.articleParent || factParent === safeRequest.articleParent;
      const articleOk = !safeRequest.article || fact.article === safeRequest.article;
      const monthOk = !safeRequest.monthKey || fact.monthKey === safeRequest.monthKey;
      const levelOk = !safeRequest.topLevel || fact.topLevel === safeRequest.topLevel;
      const sectionOk = !safeRequest.cashFlowSectionKey || fact.cashFlowSectionKey === safeRequest.cashFlowSectionKey;
      const typeOk = !safeRequest.cashFlowType || fact.cashFlowType === safeRequest.cashFlowType;
      return articleParentOk && articleOk && monthOk && levelOk && sectionOk && typeOk;
    });

    return cashSuccess({
      rows: filtered.map(function cashMapDrillFactFinal(fact) {
        return {
          registrar: fact.registrar,
          amount: fact.amount,
          amountLabel: cashFormatCurrency(fact.amount),
          cfo: fact.cfo,
          comment: fact.comment,
          dateLabel: fact.operationDateLabel || fact.operationDate,
          articleParent: fact.normalizedArticleParent || fact.articleParent,
          originalArticleParent: fact.originalArticleParent || fact.articleParent,
          article: fact.article,
        };
      }),
    });
  });
}

function cashBuildModel(rows) {
  const counters = {
    emptyDirection: 0,
    emptyCfo: 0,
    internalExcluded: 0,
    internalNetAmount: 0,
  };
  const mapping = cashReadOldArticleParentMapping();
  const facts = [];

  rows.forEach(function cashTransformSourceWithFinalMapping(source) {
    const fact = cashTransformFact(source, counters);

    if (fact.isInternal) {
      counters.internalExcluded += 1;
      counters.internalNetAmount = cashRound(counters.internalNetAmount + fact.amount);
      return;
    }

    cashApplyNormalizedArticleParent(fact, mapping);
    facts.push(fact);
  });

  facts.sort(function cashSortFactsWithFinalMapping(a, b) {
    return a.operationDateValue - b.operationDateValue;
  });

  const months = cashBuildMonths(facts);
  const balances = cashBuildBalances(facts, months);

  return {
    config: {
      startBalance: cashConfig.startBalance,
      startDate: cashFormatDate(cashConfig.startDate, 'yyyy-MM-dd'),
    },
    facts: cashSerializeFacts(facts),
    directories: cashBuildDirectories(facts),
    months: months,
    balances: balances,
    metrics: cashBuildMetrics(facts, balances),
    validation: cashBuildValidation(rows, facts, counters, balances),
    mapping: {
      oldArticleParentRows: Number(mapping.count || 0),
      cutoffDate: '2026-01-01',
    },
  };
}

function cashCreateOwnerAnalysisReport() {
  return cashSafeRun('cashCreateOwnerAnalysisReport', function () {
    const rows = cashReadSourceRows({ limit: cashConfig.maxRows });
    const model = cashBuildModel(rows);
    const facts = model.facts || [];
    const balances = model.balances || [];
    const validation = model.validation || {};
    const analysis = cashBuildOwnerAnalysis(facts, balances, validation);
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheetName = 'Заключение ДДС';
    let sheet = spreadsheet.getSheetByName(sheetName);

    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
    }

    sheet.clear();
    sheet.getRange(1, 1, 1, 4).merge().setValue('Управленческое заключение по ДДС');
    sheet.getRange(2, 1, 1, 4).merge().setValue('Автоматический анализ денежных потоков, ликвидности, качества учета и продуктовых поступлений. Используйте как черновик для отчета собственнику.');
    sheet.getRange(4, 1, 7, 2).setValues([
      ['Период анализа', analysis.periodLabel],
      ['Общий статус', analysis.status],
      ['Главный риск', analysis.mainRisk],
      ['Общий ЧДП периода', analysis.metrics.ncf],
      ['Cash Buffer', analysis.metrics.bufferDays + ' дн.'],
      ['Поступления', analysis.metrics.inflow],
      ['Выплаты', analysis.metrics.outflow],
    ]);

    let row = 13;
    row = cashWriteOwnerSection(sheet, row, 'Ключевые выводы', analysis.conclusions);
    row = cashWriteOwnerSection(sheet, row + 1, 'Что было хорошо', analysis.good);
    row = cashWriteOwnerSection(sheet, row + 1, 'Что требует внимания', analysis.attention);
    row = cashWriteOwnerSection(sheet, row + 1, 'Куда смотреть в деталях', analysis.whereToLook);
    row = cashWriteOwnerSection(sheet, row + 1, 'Действия на 7 дней', analysis.actions7);
    row = cashWriteOwnerSection(sheet, row + 1, 'Действия на 30 дней', analysis.actions30);

    sheet.getRange(row + 1, 1, 1, 6).setValues([[
      'Месяц',
      'Поступления',
      'Выплаты',
      'ЧДП',
      'Остаток на начало',
      'Остаток на конец',
    ]]);

    if (analysis.monthRows.length) {
      sheet.getRange(row + 2, 1, analysis.monthRows.length, 6).setValues(analysis.monthRows);
    }

    cashFormatOwnerAnalysisSheet(sheet, row + 1, analysis.monthRows.length);

    return cashSuccess({
      sheetName: sheetName,
      status: analysis.status,
      message: 'Заключение создано: ' + sheetName,
    });
  });
}

function cashBuildOwnerAnalysis(facts, balances, validation) {
  const inflow = cashRound(facts.reduce(function cashOwnerInflow(sum, fact) { return sum + Number(fact.inflow || 0); }, 0));
  const outflow = cashRound(facts.reduce(function cashOwnerOutflow(sum, fact) { return sum + Number(fact.outflow || 0); }, 0));
  const ncf = cashRound(facts.reduce(function cashOwnerNcf(sum, fact) { return sum + Number(fact.cashFlowValue || 0); }, 0));
  const months = cashBuildOwnerMonthRows(facts, balances);
  const currentBalance = balances.length ? balances[balances.length - 1] : null;
  const buffer = cashCalculateOwnerBuffer(facts, balances);
  const directionRows = cashBuildOwnerDirectionRows(facts);
  const cfoOutflows = cashBuildOwnerTopRows(facts.filter(function cashOwnerExpenseFact(fact) { return Number(fact.outflow || 0) > 0; }), 'cfo', 'outflow', 7);
  const productInflows = cashBuildOwnerTopRows(facts.filter(function cashOwnerIncomeFact(fact) { return Number(fact.inflow || 0) > 0; }), 'normalizedArticleParent', 'inflow', 7);
  const unclear = cashRound(facts.reduce(function cashOwnerUnclear(sum, fact) { return fact.isUnclear ? sum + Number(fact.cashFlowValue || 0) : sum; }, 0));
  const sourceDifference = validation.sourceReconciliation ? Number(validation.sourceReconciliation.difference || 0) : 0;
  const internalNet = validation.internalFilter ? Number(validation.internalFilter.netAmount || 0) : 0;
  const negativeMonths = months.filter(function cashOwnerNegativeMonth(row) { return Number(row[3] || 0) < 0; });
  const weakDirections = directionRows.filter(function cashOwnerWeakDirection(row) { return Number(row.ncf || 0) < 0; });
  const summerRisk = buffer.isSummer && buffer.days < 60;
  const hasCriticalQuality = Math.abs(sourceDifference) >= 0.01 || Math.abs(internalNet) >= 0.01 || Math.abs(unclear) >= 0.01;
  const status = cashResolveOwnerStatus(ncf, buffer, hasCriticalQuality, weakDirections.length, negativeMonths.length);
  const mainRisk = cashResolveOwnerMainRisk(buffer, sourceDifference, internalNet, unclear, weakDirections, negativeMonths);
  const periodLabel = months.length ? months[0][0] + ' — ' + months[months.length - 1][0] : 'Нет данных';

  return {
    periodLabel: periodLabel,
    status: status,
    mainRisk: mainRisk,
    metrics: {
      inflow: inflow,
      outflow: outflow,
      ncf: ncf,
      bufferDays: buffer.days,
    },
    monthRows: months,
    conclusions: cashOwnerConclusions(ncf, inflow, outflow, buffer, negativeMonths, directionRows, productInflows),
    good: cashOwnerGoodPoints(ncf, buffer, productInflows, directionRows),
    attention: cashOwnerAttentionPoints(buffer, sourceDifference, internalNet, unclear, weakDirections, negativeMonths, cfoOutflows),
    whereToLook: cashOwnerWhereToLook(cfoOutflows, productInflows, weakDirections),
    actions7: cashOwnerActions7(buffer, sourceDifference, internalNet, unclear, cfoOutflows),
    actions30: cashOwnerActions30(buffer, weakDirections, productInflows, currentBalance),
  };
}

function cashBuildOwnerMonthRows(facts, balances) {
  const registry = {};

  facts.forEach(function cashOwnerGroupMonth(fact) {
    if (!registry[fact.monthKey]) {
      registry[fact.monthKey] = {
        key: fact.monthKey,
        label: fact.monthYearLabel,
        inflow: 0,
        outflow: 0,
        ncf: 0,
      };
    }

    registry[fact.monthKey].inflow += Number(fact.inflow || 0);
    registry[fact.monthKey].outflow += Number(fact.outflow || 0);
    registry[fact.monthKey].ncf += Number(fact.cashFlowValue || 0);
  });

  const balanceMap = {};
  balances.forEach(function cashOwnerMapBalance(balance) {
    balanceMap[balance.monthKey] = balance;
  });

  return Object.keys(registry).map(function cashOwnerMapMonth(key) {
    const item = registry[key];
    const balance = balanceMap[key] || {};
    return [
      item.label,
      cashRound(item.inflow),
      cashRound(item.outflow),
      cashRound(item.ncf),
      cashRound(balance.openingBalance || 0),
      cashRound(balance.closingBalance || 0),
    ];
  }).sort(function cashOwnerSortMonth(a, b) {
    return String(a[0]).localeCompare(String(b[0]), 'ru');
  });
}

function cashCalculateOwnerBuffer(facts, balances) {
  if (!balances.length) return { days: 0, isSummer: false };
  const current = balances[balances.length - 1];
  const currentDate = cashParseIsoDate(current.monthKey);
  const startDate = new Date(currentDate.getTime());
  startDate.setDate(startDate.getDate() - 30);
  const month = currentDate.getMonth() + 1;
  const isSummer = month >= 6 && month <= 8;
  const expenses = facts.reduce(function cashOwnerBufferExpense(sum, fact) {
    const factDate = cashParseIsoDate(fact.operationDate);
    if (!(factDate >= startDate && factDate < currentDate)) return sum;
    if (!cashIsOwnerOperatingPayment(fact)) return sum;
    if (isSummer && !cashIsOwnerFixedPayment(fact)) return sum;
    return sum + Math.max(0, -Number(fact.cashFlowValue || 0));
  }, 0);
  const daily = expenses / 30;
  return {
    days: daily > 0 ? cashRound(current.openingBalance / daily) : 0,
    isSummer: isSummer,
  };
}

function cashBuildOwnerDirectionRows(facts) {
  const registry = {};
  facts.forEach(function cashOwnerDirectionFact(fact) {
    const key = fact.direction || 'Без направления';
    if (!registry[key]) registry[key] = { direction: key, inflow: 0, outflow: 0, ncf: 0 };
    registry[key].inflow += Number(fact.inflow || 0);
    registry[key].outflow += Number(fact.outflow || 0);
    registry[key].ncf += Number(fact.cashFlowValue || 0);
  });
  return Object.keys(registry).map(function cashOwnerDirectionMap(key) {
    const row = registry[key];
    row.inflow = cashRound(row.inflow);
    row.outflow = cashRound(row.outflow);
    row.ncf = cashRound(row.ncf);
    return row;
  }).sort(function cashOwnerDirectionSort(a, b) { return a.ncf - b.ncf; });
}

function cashBuildOwnerTopRows(facts, field, valueField, limit) {
  const registry = {};
  facts.forEach(function cashOwnerTopFact(fact) {
    const key = fact[field] || fact.articleParent || 'Не заполнено';
    registry[key] = (registry[key] || 0) + Number(fact[valueField] || 0);
  });
  return Object.keys(registry).map(function cashOwnerTopMap(key) {
    return { label: key, value: cashRound(registry[key]) };
  }).sort(function cashOwnerTopSort(a, b) { return Math.abs(b.value) - Math.abs(a.value); }).slice(0, limit || 5);
}

function cashResolveOwnerStatus(ncf, buffer, hasCriticalQuality, weakDirectionsCount, negativeMonthCount) {
  if (hasCriticalQuality || buffer.days < (buffer.isSummer ? 45 : 20) || ncf < 0) return 'Красный — требуется управленческое вмешательство';
  if (buffer.days < (buffer.isSummer ? 60 : 30) || weakDirectionsCount || negativeMonthCount) return 'Жёлтый — есть зоны риска';
  return 'Зелёный — денежный контур управляем';
}

function cashResolveOwnerMainRisk(buffer, sourceDifference, internalNet, unclear, weakDirections, negativeMonths) {
  if (Math.abs(sourceDifference) >= 0.01) return 'Расхождение листа «Деньги» и ОДДС: сначала проверить качество данных.';
  if (Math.abs(internalNet) >= 0.01) return 'Внутренние перемещения не сошлись: есть непарная операция.';
  if (Math.abs(unclear) >= 0.01) return 'Есть операции с верхним уровнем «Выяснить»: требуется разбор.';
  if (buffer.days < (buffer.isSummer ? 60 : 30)) return 'Недостаточный Cash Buffer' + (buffer.isSummer ? ' для летнего сезона.' : '.');
  if (weakDirections.length) return 'Есть направления с отрицательным денежным потоком.';
  if (negativeMonths.length) return 'Есть месяцы с отрицательным ЧДП.';
  return 'Критичных рисков по текущему срезу не выявлено.';
}

function cashOwnerConclusions(ncf, inflow, outflow, buffer, negativeMonths, directionRows, productInflows) {
  return [
    'За период денежные поступления составили ' + cashFormatCurrency(inflow) + ', выплаты — ' + cashFormatCurrency(outflow) + ', общий ЧДП — ' + cashFormatCurrency(ncf) + '.',
    'Cash Buffer составляет ' + buffer.days + ' дней. ' + (buffer.isSummer ? 'Для лета целевой уровень — не менее 60 дней.' : 'Для обычного периода целевой уровень — не менее 30 дней.'),
    negativeMonths.length ? 'Есть месяцы с отрицательным ЧДП: ' + negativeMonths.map(function cashMonthName(row) { return row[0]; }).join(', ') + '.' : 'Месячная динамика не показывает критической серии отрицательных месяцев.',
    productInflows.length ? 'Крупнейшая продуктовая линейка по поступлениям: ' + productInflows[0].label + ' — ' + cashFormatCurrency(productInflows[0].value) + '.' : 'Поступления по продуктовым линейкам не выявлены в выбранном срезе.',
  ];
}

function cashOwnerGoodPoints(ncf, buffer, productInflows, directionRows) {
  const positiveDirections = directionRows.filter(function cashPositiveDirection(row) { return row.ncf > 0; });
  return [
    ncf > 0 ? 'Бизнес за выбранный период генерирует положительный денежный поток.' : 'Даже при текущих рисках дашборд позволяет быстро локализовать источники минуса.',
    buffer.days >= (buffer.isSummer ? 60 : 30) ? 'Запас ликвидности соответствует нормативу периода.' : 'Запас ликвидности измерен и теперь контролируется в днях.',
    positiveDirections.length ? 'Есть направления, которые формируют положительный ЧДП: ' + positiveDirections.slice(-3).map(function cashDirectionName(row) { return row.direction; }).join(', ') + '.' : 'Появилась прозрачность по вкладу направлений.',
    productInflows.length ? 'Видны продуктовые линейки, которые первыми формируют денежный спрос.' : 'Подготовлена база для продуктовой аналитики поступлений.',
  ];
}

function cashOwnerAttentionPoints(buffer, sourceDifference, internalNet, unclear, weakDirections, negativeMonths, cfoOutflows) {
  const result = [];
  if (buffer.days < (buffer.isSummer ? 60 : 30)) result.push('Cash Buffer ниже норматива: требуется сценарий сохранения ликвидности.');
  if (Math.abs(sourceDifference) >= 0.01) result.push('Расхождение «Деньги» vs ОДДС: ' + cashFormatCurrency(sourceDifference) + '.');
  if (Math.abs(internalNet) >= 0.01) result.push('Непарные внутренние перемещения: ' + cashFormatCurrency(internalNet) + '.');
  if (Math.abs(unclear) >= 0.01) result.push('Операции «Выяснить»: ' + cashFormatCurrency(unclear) + '.');
  if (weakDirections.length) result.push('Направления с отрицательным ЧДП: ' + weakDirections.map(function cashWeakDirection(row) { return row.direction + ' (' + cashFormatCurrency(row.ncf) + ')'; }).join('; ') + '.');
  if (negativeMonths.length) result.push('Месяцы с отрицательным ЧДП: ' + negativeMonths.map(function cashNegativeMonth(row) { return row[0]; }).join(', ') + '.');
  if (cfoOutflows.length) result.push('Крупнейшие ЦФО по выплатам: ' + cfoOutflows.slice(0, 3).map(function cashTopCfo(row) { return row.label + ' — ' + cashFormatCurrency(row.value); }).join('; ') + '.');
  return result.length ? result : ['Существенных зон внимания по текущему срезу не выявлено.'];
}

function cashOwnerWhereToLook(cfoOutflows, productInflows, weakDirections) {
  return [
    cfoOutflows.length ? 'Проверить ТОП ЦФО по выплатам: ' + cfoOutflows.slice(0, 5).map(function cashCfoLook(row) { return row.label; }).join(', ') + '.' : 'ЦФО по выплатам без выраженных лидеров.',
    productInflows.length ? 'Оценить продуктовые линейки по денежному спросу: ' + productInflows.slice(0, 5).map(function cashProductLook(row) { return row.label; }).join(', ') + '.' : 'Нет выраженных продуктовых поступлений.',
    weakDirections.length ? 'Разобрать отрицательные направления до статей и ЦФО.' : 'По направлениям критичный минус не выделен.',
  ];
}

function cashOwnerActions7(buffer, sourceDifference, internalNet, unclear, cfoOutflows) {
  const actions = [];
  if (buffer.days < (buffer.isSummer ? 60 : 30)) actions.push('Согласовать недельный платежный календарь и заморозить необязательные платежи до восстановления норматива Cash Buffer.');
  if (Math.abs(sourceDifference) >= 0.01 || Math.abs(internalNet) >= 0.01 || Math.abs(unclear) >= 0.01) actions.push('Передать бухгалтерии контрольный список ошибок: внутренние перемещения, «Выяснить», расхождение Деньги/ОДДС.');
  if (cfoOutflows.length) actions.push('Проверить первичные документы по ТОП‑3 ЦФО выплат и подтвердить необходимость крупных расходов.');
  actions.push('Обновить прогноз поступлений по основным продуктовым линейкам на ближайшие 2 недели.');
  return actions;
}

function cashOwnerActions30(buffer, weakDirections, productInflows, currentBalance) {
  const actions = [];
  actions.push('Собрать сценарий движения денег на 30 дней: поступления, обязательные платежи, остаток после ФОТ и аренды.');
  if (buffer.isSummer || buffer.days < 60) actions.push('Для летнего сезона держать отдельный резерв постоянных расходов минимум на 60 дней.');
  if (weakDirections.length) actions.push('По направлениям с минусом провести разбор: поступления, локальные расходы, поддерживающие ЦФО, план выхода в плюс.');
  if (productInflows.length) actions.push('Усилить продажи и контроль оплат по продуктовым линейкам-лидерам, отдельно проверить зависимость от ТОП‑1/ТОП‑3 продуктов.');
  if (currentBalance) actions.push('Контролировать конечный остаток периода: текущий ориентир — ' + cashFormatCurrency(currentBalance.closingBalance || currentBalance.openingBalance || 0) + '.');
  return actions;
}

function cashIsOwnerOperatingPayment(fact) {
  return fact.cashFlowSectionKey === 'operating' && fact.cashFlowType === cashConfig.odddsTypes.payment;
}

function cashIsOwnerFixedPayment(fact) {
  const text = cashNormalizeText([
    fact.normalizedArticleParent,
    fact.originalArticleParent,
    fact.articleParent,
    fact.article,
  ].join(' ')).toLowerCase().replace(/ё/g, 'е');
  return ['фот', 'аренда', 'коммун', 'охрана', 'по/лиценз', 'лиценз', 'налог', 'взнос', 'комисси', 'обязательн'].some(function cashOwnerFixedPattern(pattern) {
    return text.indexOf(pattern) !== -1;
  });
}

function cashWriteOwnerSection(sheet, row, title, items) {
  sheet.getRange(row, 1, 1, 4).merge().setValue(title);
  sheet.getRange(row, 1).setBackground('#1f2937').setFontColor('#ffffff').setFontWeight('bold');
  const values = (items || []).map(function cashOwnerItem(item, index) {
    return [index + 1, item];
  });
  if (values.length) {
    sheet.getRange(row + 1, 1, values.length, 2).setValues(values);
  }
  return row + values.length + 1;
}

function cashFormatOwnerAnalysisSheet(sheet, monthHeaderRow, monthRowsLength) {
  sheet.getRange(1, 1, 1, 4).setBackground('#0f172a').setFontColor('#ffffff').setFontSize(14).setFontWeight('bold');
  sheet.getRange(2, 1, 1, 4).setBackground('#e0f2fe').setFontColor('#0f172a').setWrap(true);
  sheet.getRange(4, 1, 7, 2).setBorder(true, true, true, true, true, true).setWrap(true);
  sheet.getRange(4, 2, 7, 1).setFontWeight('bold');
  sheet.getRange(monthHeaderRow, 1, 1, 6).setBackground('#1f2937').setFontColor('#ffffff').setFontWeight('bold');
  if (monthRowsLength) {
    sheet.getRange(monthHeaderRow + 1, 1, monthRowsLength, 6).setBorder(true, true, true, true, true, true);
    sheet.getRange(monthHeaderRow + 1, 2, monthRowsLength, 5).setNumberFormat('#,##0.00');
  }
  sheet.autoResizeColumns(1, 6);
  sheet.setColumnWidth(2, 520);
  sheet.setFrozenRows(3);
}

function cashBuildOwnerAnalysis(facts, balances, validation) {
  const inflow = cashRound(facts.reduce(function cashOwnerInflowFinal(sum, fact) { return sum + Number(fact.inflow || 0); }, 0));
  const outflow = cashRound(facts.reduce(function cashOwnerOutflowFinal(sum, fact) { return sum + Number(fact.outflow || 0); }, 0));
  const ncf = cashRound(facts.reduce(function cashOwnerNcfFinal(sum, fact) { return sum + Number(fact.cashFlowValue || 0); }, 0));
  const months = cashBuildOwnerMonthRows(facts, balances);
  const currentBalance = balances.length ? balances[balances.length - 1] : null;
  const buffer = cashCalculateOwnerBuffer(facts, balances);
  const directionRows = cashBuildOwnerDirectionRows(facts);
  const cfoOutflows = cashBuildOwnerTopRows(facts.filter(function cashOwnerExpenseFactFinal(fact) { return Number(fact.outflow || 0) > 0; }), 'cfo', 'outflow', 7);
  const productInflows = cashBuildOwnerTopRows(facts.filter(function cashOwnerIncomeFactFinal(fact) { return Number(fact.inflow || 0) > 0; }), 'normalizedArticleParent', 'inflow', 7);
  const unclear = cashRound(facts.reduce(function cashOwnerUnclearFinal(sum, fact) { return fact.isUnclear ? sum + Number(fact.cashFlowValue || 0) : sum; }, 0));
  const sourceDifference = validation.sourceReconciliation ? Number(validation.sourceReconciliation.difference || 0) : 0;
  const internalNet = validation.internalFilter ? Number(validation.internalFilter.netAmount || 0) : 0;
  const negativeMonths = months.filter(function cashOwnerNegativeMonthFinal(row) { return Number(row[3] || 0) < 0; });
  const weakDirections = directionRows.filter(function cashOwnerWeakDirectionFinal(row) { return Number(row.ncf || 0) < 0; });
  const quality = cashResolveOwnerQuality(sourceDifference, internalNet, unclear, outflow);
  const status = cashResolveOwnerStatus(ncf, buffer, quality, weakDirections.length, negativeMonths.length);
  const mainRisk = cashResolveOwnerMainRisk(buffer, sourceDifference, internalNet, unclear, outflow, weakDirections, negativeMonths);
  const periodLabel = months.length ? months[0][0] + ' — ' + months[months.length - 1][0] : 'Нет данных';

  return {
    periodLabel: periodLabel,
    status: status,
    mainRisk: mainRisk,
    metrics: {
      inflow: inflow,
      outflow: outflow,
      ncf: ncf,
      bufferDays: buffer.days,
    },
    monthRows: months,
    conclusions: cashOwnerConclusions(ncf, inflow, outflow, buffer, negativeMonths, directionRows, productInflows),
    good: cashOwnerGoodPoints(ncf, buffer, productInflows, directionRows),
    attention: cashOwnerAttentionPoints(buffer, sourceDifference, internalNet, unclear, outflow, weakDirections, negativeMonths, cfoOutflows),
    whereToLook: cashOwnerWhereToLook(cfoOutflows, productInflows, weakDirections),
    actions7: cashOwnerActions7(buffer, sourceDifference, internalNet, unclear, outflow, cfoOutflows),
    actions30: cashOwnerActions30(buffer, weakDirections, productInflows, currentBalance),
  };
}

function cashBuildOwnerMonthRows(facts, balances) {
  const registry = {};

  facts.forEach(function cashOwnerGroupMonthFinal(fact) {
    if (!registry[fact.monthKey]) {
      registry[fact.monthKey] = {
        key: fact.monthKey,
        label: fact.monthYearLabel,
        inflow: 0,
        outflow: 0,
        ncf: 0,
      };
    }

    registry[fact.monthKey].inflow += Number(fact.inflow || 0);
    registry[fact.monthKey].outflow += Number(fact.outflow || 0);
    registry[fact.monthKey].ncf += Number(fact.cashFlowValue || 0);
  });

  const balanceMap = {};
  balances.forEach(function cashOwnerMapBalanceFinal(balance) {
    balanceMap[balance.monthKey] = balance;
  });

  return Object.keys(registry).map(function cashOwnerMapMonthFinal(key) {
    const item = registry[key];
    const balance = balanceMap[key] || {};
    return [
      item.label,
      cashRound(item.inflow),
      cashRound(item.outflow),
      cashRound(item.ncf),
      cashRound(balance.openingBalance || 0),
      cashRound(balance.closingBalance || 0),
      item.key,
    ];
  }).sort(function cashOwnerSortMonthFinal(a, b) {
    return String(a[6]).localeCompare(String(b[6]));
  }).map(function cashOwnerDropMonthKey(row) {
    return row.slice(0, 6);
  });
}

function cashResolveOwnerQuality(sourceDifference, internalNet, unclear, outflow) {
  const unclearAbs = Math.abs(Number(unclear || 0));
  const unclearShare = outflow ? unclearAbs / Math.abs(outflow) : 0;

  if (Math.abs(sourceDifference) >= 0.01 || Math.abs(internalNet) >= 0.01) {
    return 'red';
  }

  if (unclearAbs >= 100000 || unclearShare >= 0.01) {
    return 'yellow';
  }

  if (unclearAbs >= 0.01) {
    return 'info';
  }

  return 'ok';
}

function cashResolveOwnerStatus(ncf, buffer, quality, weakDirectionsCount, negativeMonthCount) {
  const bufferRed = buffer.days < (buffer.isSummer ? 45 : 20);
  const bufferYellow = buffer.days < (buffer.isSummer ? 60 : 30);

  if (quality === 'red' || bufferRed || ncf < 0) {
    return 'Красный — требуется управленческое вмешательство';
  }

  if (quality === 'yellow' || bufferYellow || weakDirectionsCount || negativeMonthCount) {
    return 'Жёлтый — есть зоны риска';
  }

  return 'Зелёный — денежный контур управляем';
}

function cashResolveOwnerMainRisk(buffer, sourceDifference, internalNet, unclear, outflow, weakDirections, negativeMonths) {
  const unclearAbs = Math.abs(Number(unclear || 0));
  const unclearShare = outflow ? unclearAbs / Math.abs(outflow) : 0;

  if (Math.abs(sourceDifference) >= 0.01) return 'Расхождение листа «Деньги» и ОДДС: сначала проверить качество данных.';
  if (Math.abs(internalNet) >= 0.01) return 'Внутренние перемещения не сошлись: есть непарная операция.';
  if (buffer.days < (buffer.isSummer ? 60 : 30)) return 'Недостаточный Cash Buffer' + (buffer.isSummer ? ' для летнего сезона.' : '.');
  if (weakDirections.length) return 'Есть направления с отрицательным денежным потоком.';
  if (negativeMonths.length) return 'Есть месяцы с отрицательным ЧДП.';
  if (unclearAbs >= 0.01) return 'Есть небольшие операции «Выяснить» (' + cashFormatCurrency(unclear) + ', ' + cashRound(unclearShare * 100) + '% выплат): требуется разбор, но это не ключевой риск периода.';
  return 'Критичных рисков по текущему срезу не выявлено.';
}

function cashOwnerAttentionPoints(buffer, sourceDifference, internalNet, unclear, outflow, weakDirections, negativeMonths, cfoOutflows) {
  const result = [];
  const unclearAbs = Math.abs(Number(unclear || 0));
  const unclearShare = outflow ? unclearAbs / Math.abs(outflow) : 0;

  if (buffer.days < (buffer.isSummer ? 60 : 30)) result.push('Cash Buffer ниже норматива: требуется сценарий сохранения ликвидности.');
  if (Math.abs(sourceDifference) >= 0.01) result.push('Расхождение «Деньги» vs ОДДС: ' + cashFormatCurrency(sourceDifference) + '.');
  if (Math.abs(internalNet) >= 0.01) result.push('Непарные внутренние перемещения: ' + cashFormatCurrency(internalNet) + '.');
  if (unclearAbs >= 100000 || unclearShare >= 0.01) {
    result.push('Операции «Выяснить» существенны: ' + cashFormatCurrency(unclear) + '.');
  } else if (unclearAbs >= 0.01) {
    result.push('Операции «Выяснить» есть, но сумма несущественная для периода: ' + cashFormatCurrency(unclear) + '. Разобрать в рабочем порядке.');
  }
  if (weakDirections.length) result.push('Направления с отрицательным ЧДП: ' + weakDirections.map(function cashWeakDirectionFinal(row) { return row.direction + ' (' + cashFormatCurrency(row.ncf) + ')'; }).join('; ') + '.');
  if (negativeMonths.length) result.push('Месяцы с отрицательным ЧДП: ' + negativeMonths.map(function cashNegativeMonthFinal(row) { return row[0]; }).join(', ') + '.');
  if (cfoOutflows.length) result.push('Крупнейшие ЦФО по выплатам: ' + cfoOutflows.slice(0, 3).map(function cashTopCfoFinal(row) { return row.label + ' — ' + cashFormatCurrency(row.value); }).join('; ') + '.');
  return result.length ? result : ['Существенных зон внимания по текущему срезу не выявлено.'];
}

function cashOwnerActions7(buffer, sourceDifference, internalNet, unclear, outflow, cfoOutflows) {
  const actions = [];
  const unclearAbs = Math.abs(Number(unclear || 0));
  const unclearShare = outflow ? unclearAbs / Math.abs(outflow) : 0;

  if (buffer.days < (buffer.isSummer ? 60 : 30)) actions.push('Согласовать недельный платежный календарь и заморозить необязательные платежи до восстановления норматива Cash Buffer.');
  if (Math.abs(sourceDifference) >= 0.01 || Math.abs(internalNet) >= 0.01) actions.push('Передать бухгалтерии контрольный список ошибок: внутренние перемещения и расхождение Деньги/ОДДС.');
  if (unclearAbs >= 100000 || unclearShare >= 0.01) actions.push('Разобрать операции «Выяснить» как существенный риск качества учета.');
  if (cfoOutflows.length) actions.push('Проверить первичные документы по ТОП‑3 ЦФО выплат и подтвердить необходимость крупных расходов.');
  actions.push('Обновить прогноз поступлений по основным продуктовым линейкам на ближайшие 2 недели.');
  return actions;
}

function cashCreateOwnerAnalysisReport() {
  return cashSafeRun('cashCreateOwnerAnalysisReport', function () {
    const rows = cashReadSourceRows({ limit: cashConfig.maxRows });
    const model = cashBuildModel(rows);
    const facts = model.facts || [];
    const balances = model.balances || [];
    const validation = model.validation || {};
    const analysis = cashBuildOwnerAnalysis(facts, balances, validation);
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheetName = 'Заключение ДДС';
    let sheet = spreadsheet.getSheetByName(sheetName);
    const generatedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Europe/Moscow', 'dd.MM.yyyy HH:mm');

    if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
    sheet.clear();

    sheet.getRange(1, 1, 1, 4).merge().setValue('Управленческое заключение по ДДС · сформировано ' + generatedAt);
    sheet.getRange(2, 1, 1, 4).merge().setValue('Автоматический анализ денежных потоков, ликвидности, качества учета и продуктовых поступлений. Используйте как черновик для отчета собственнику.');

    sheet.getRange(4, 1, 1, 2).setValues([['Период анализа', analysis.periodLabel]]);
    sheet.getRange(5, 1, 1, 2).setValues([['Общий статус', analysis.status]]);
    sheet.getRange(6, 1, 1, 2).setValues([['Главный риск', analysis.mainRisk]]);
    sheet.getRange(7, 1, 1, 2).setValues([['Общий ЧДП периода', analysis.metrics.ncf]]);
    sheet.getRange(8, 1, 1, 2).setValues([['Cash Buffer', analysis.metrics.bufferDays + ' дн.']]);
    sheet.getRange(9, 1, 1, 2).setValues([['Поступления', analysis.metrics.inflow]]);
    sheet.getRange(10, 1, 1, 2).setValues([['Выплаты', analysis.metrics.outflow]]);

    let currentRow = 13;
    currentRow = cashWriteOwnerSection(sheet, currentRow, 'Ключевые выводы', analysis.conclusions);
    currentRow += 1;
    currentRow = cashWriteOwnerSection(sheet, currentRow, 'Что было хорошо', analysis.good);
    currentRow += 1;
    currentRow = cashWriteOwnerSection(sheet, currentRow, 'Что требует внимания', analysis.attention);
    currentRow += 1;
    currentRow = cashWriteOwnerSection(sheet, currentRow, 'Куда смотреть в деталях', analysis.whereToLook);
    currentRow += 1;
    currentRow = cashWriteOwnerSection(sheet, currentRow, 'Действия на 7 дней', analysis.actions7);
    currentRow += 1;
    currentRow = cashWriteOwnerSection(sheet, currentRow, 'Действия на 30 дней', analysis.actions30);
    currentRow += 2;

    const monthHeaderRow = currentRow;
    sheet.getRange(monthHeaderRow, 1, 1, 6).setValues([['Месяц', 'Поступления', 'Выплаты', 'ЧДП', 'Остаток на начало', 'Остаток на конец']]);
    if (analysis.monthRows.length) {
      sheet.getRange(monthHeaderRow + 1, 1, analysis.monthRows.length, 6).setValues(analysis.monthRows);
    }

    cashFormatOwnerAnalysisSheet(sheet, monthHeaderRow, analysis.monthRows.length);
    return {
      sheetName: sheetName,
      generatedAt: generatedAt,
      status: analysis.status,
      message: 'Управленческое заключение сформировано.',
    };
  });
}

function cashBuildOwnerDirectionRows(facts) {
  const registry = {};
  facts.forEach(function cashOwnerDirectionFactFinalMargin(fact) {
    const key = fact.direction || 'Без направления';
    if (!registry[key]) registry[key] = { direction: key, inflow: 0, outflow: 0, ncf: 0, margin: null };
    registry[key].inflow += Number(fact.inflow || 0);
    registry[key].outflow += Number(fact.outflow || 0);
    registry[key].ncf += Number(fact.cashFlowValue || 0);
  });

  return Object.keys(registry).map(function cashOwnerDirectionMapFinalMargin(key) {
    const row = registry[key];
    row.inflow = cashRound(row.inflow);
    row.outflow = cashRound(row.outflow);
    row.ncf = cashRound(row.ncf);
    row.margin = row.inflow > 0 ? cashRound(row.ncf / row.inflow * 100) : null;
    row.marginStatus = cashGetOwnerMarginStatus(row.margin);
    return row;
  }).sort(function cashOwnerDirectionSortFinalMargin(a, b) {
    return b.ncf - a.ncf;
  });
}

function cashGetOwnerMarginStatus(margin) {
  if (margin === null) return 'нет поступлений';
  if (margin >= 30) return 'высокая эффективность';
  if (margin >= 15) return 'здоровая зона';
  return 'операционный риск';
}

function cashOwnerGoodPoints(ncf, buffer, productInflows, directionRows) {
  const positiveDirections = directionRows.filter(function cashPositiveDirectionFinalMargin(row) { return row.ncf > 0; });
  const highMarginDirections = directionRows.filter(function cashHighMarginDirectionFinal(row) { return row.margin !== null && row.margin >= 30; });

  return [
    ncf > 0 ? 'Бизнес за выбранный период генерирует положительный денежный поток.' : 'Даже при текущих рисках дашборд позволяет быстро локализовать источники минуса.',
    buffer.days >= (buffer.isSummer ? 60 : 30) ? 'Запас ликвидности соответствует нормативу периода.' : 'Запас ликвидности измерен и теперь контролируется в днях.',
    highMarginDirections.length ? 'Высокоэффективные направления по маржинальности ДП (>30%): ' + highMarginDirections.slice(0, 3).map(function cashDirectionHighMarginName(row) { return row.direction + ' (' + row.margin + '%)'; }).join(', ') + '.' : positiveDirections.length ? 'Есть направления, которые формируют положительный ЧДП: ' + positiveDirections.slice(0, 3).map(function cashDirectionNameFinalMargin(row) { return row.direction; }).join(', ') + '.' : 'Появилась прозрачность по вкладу направлений.',
    productInflows.length ? 'Видны продуктовые линейки, которые первыми формируют денежный спрос.' : 'Подготовлена база для продуктовой аналитики поступлений.',
  ];
}

function cashOwnerAttentionPoints(buffer, sourceDifference, internalNet, unclear, outflow, weakDirections, negativeMonths, cfoOutflows) {
  const result = [];
  const unclearAbs = Math.abs(Number(unclear || 0));
  const unclearShare = outflow ? unclearAbs / Math.abs(outflow) : 0;
  const lowMarginDirections = weakDirections.filter(function cashLowMarginDirectionFinal(row) {
    return row.margin !== null && row.margin < 15;
  });

  if (buffer.days < (buffer.isSummer ? 60 : 30)) result.push('Cash Buffer ниже норматива: требуется сценарий сохранения ликвидности.');
  if (Math.abs(sourceDifference) >= 0.01) result.push('Расхождение «Деньги» vs ОДДС: ' + cashFormatCurrency(sourceDifference) + '.');
  if (Math.abs(internalNet) >= 0.01) result.push('Непарные внутренние перемещения: ' + cashFormatCurrency(internalNet) + '.');
  if (unclearAbs >= 100000 || unclearShare >= 0.01) {
    result.push('Операции «Выяснить» существенны: ' + cashFormatCurrency(unclear) + '.');
  } else if (unclearAbs >= 0.01) {
    result.push('Операции «Выяснить» есть, но сумма несущественная для периода: ' + cashFormatCurrency(unclear) + '. Разобрать в рабочем порядке.');
  }
  if (lowMarginDirections.length) {
    result.push('Направления в зоне операционного риска по маржинальности ДП (<15%): ' + lowMarginDirections.map(function cashLowMarginDirectionText(row) { return row.direction + ' (' + row.margin + '%; ЧДП ' + cashFormatCurrency(row.ncf) + ')'; }).join('; ') + '.');
  } else if (weakDirections.length) {
    result.push('Направления с отрицательным ЧДП: ' + weakDirections.map(function cashWeakDirectionFinalMargin(row) { return row.direction + ' (' + cashFormatCurrency(row.ncf) + ')'; }).join('; ') + '.');
  }
  if (negativeMonths.length) result.push('Месяцы с отрицательным ЧДП: ' + negativeMonths.map(function cashNegativeMonthFinalMargin(row) { return row[0]; }).join(', ') + '.');
  if (cfoOutflows.length) result.push('Крупнейшие ЦФО по выплатам: ' + cfoOutflows.slice(0, 3).map(function cashTopCfoFinalMargin(row) { return row.label + ' — ' + cashFormatCurrency(row.value); }).join('; ') + '.');
  return result.length ? result : ['Существенных зон внимания по текущему срезу не выявлено.'];
}

function cashOwnerWhereToLook(cfoOutflows, productInflows, weakDirections) {
  const lowMarginDirections = weakDirections.filter(function cashWhereLowMarginDirection(row) {
    return row.margin !== null && row.margin < 15;
  });

  return [
    cfoOutflows.length ? 'Проверить ТОП ЦФО по выплатам: ' + cfoOutflows.slice(0, 5).map(function cashCfoLookFinalMargin(row) { return row.label; }).join(', ') + '.' : 'ЦФО по выплатам без выраженных лидеров.',
    productInflows.length ? 'Оценить продуктовые линейки по денежному спросу: ' + productInflows.slice(0, 5).map(function cashProductLookFinalMargin(row) { return row.label; }).join(', ') + '.' : 'Нет выраженных продуктовых поступлений.',
    lowMarginDirections.length ? 'Разобрать направления с маржинальностью ДП ниже 15%: поступления, локальные расходы, ФОТ, аренда, поддерживающие ЦФО.' : weakDirections.length ? 'Разобрать отрицательные направления до статей и ЦФО.' : 'По направлениям критичный минус не выделен.',
  ];
}

function cashBuildOwnerAnalysis(facts, balances, validation) {
  const inflow = cashRound(facts.reduce(function cashOwnerInflowFinalMargin(sum, fact) { return sum + Number(fact.inflow || 0); }, 0));
  const outflow = cashRound(facts.reduce(function cashOwnerOutflowFinalMargin(sum, fact) { return sum + Number(fact.outflow || 0); }, 0));
  const ncf = cashRound(facts.reduce(function cashOwnerNcfFinalMargin(sum, fact) { return sum + Number(fact.cashFlowValue || 0); }, 0));
  const months = cashBuildOwnerMonthRows(facts, balances);
  const currentBalance = balances.length ? balances[balances.length - 1] : null;
  const buffer = cashCalculateOwnerBuffer(facts, balances);
  const directionRows = cashBuildOwnerDirectionRows(facts);
  const cfoOutflows = cashBuildOwnerTopRows(facts.filter(function cashOwnerExpenseFactFinalMargin(fact) { return Number(fact.outflow || 0) > 0; }), 'cfo', 'outflow', 7);
  const productInflows = cashBuildOwnerTopRows(facts.filter(function cashOwnerIncomeFactFinalMargin(fact) { return Number(fact.inflow || 0) > 0; }), 'normalizedArticleParent', 'inflow', 7);
  const unclear = cashRound(facts.reduce(function cashOwnerUnclearFinalMargin(sum, fact) { return fact.isUnclear ? sum + Number(fact.cashFlowValue || 0) : sum; }, 0));
  const sourceDifference = validation.sourceReconciliation ? Number(validation.sourceReconciliation.difference || 0) : 0;
  const internalNet = validation.internalFilter ? Number(validation.internalFilter.netAmount || 0) : 0;
  const negativeMonths = months.filter(function cashOwnerNegativeMonthFinalMargin(row) { return Number(row[3] || 0) < 0; });
  const weakDirections = directionRows.filter(function cashOwnerWeakDirectionFinalMargin(row) {
    return Number(row.ncf || 0) < 0 || (row.margin !== null && row.margin < 15);
  });
  const quality = cashResolveOwnerQuality(sourceDifference, internalNet, unclear, outflow);
  const status = cashResolveOwnerStatus(ncf, buffer, quality, weakDirections.length, negativeMonths.length);
  const mainRisk = cashResolveOwnerMainRisk(buffer, sourceDifference, internalNet, unclear, outflow, weakDirections, negativeMonths);
  const periodLabel = months.length ? months[0][0] + ' — ' + months[months.length - 1][0] : 'Нет данных';

  return {
    periodLabel: periodLabel,
    status: status,
    mainRisk: mainRisk,
    metrics: {
      inflow: inflow,
      outflow: outflow,
      ncf: ncf,
      bufferDays: buffer.days,
    },
    monthRows: months,
    conclusions: cashOwnerConclusions(ncf, inflow, outflow, buffer, negativeMonths, directionRows, productInflows),
    good: cashOwnerGoodPoints(ncf, buffer, productInflows, directionRows),
    attention: cashOwnerAttentionPoints(buffer, sourceDifference, internalNet, unclear, outflow, weakDirections, negativeMonths, cfoOutflows),
    whereToLook: cashOwnerWhereToLook(cfoOutflows, productInflows, weakDirections),
    actions7: cashOwnerActions7(buffer, sourceDifference, internalNet, unclear, outflow, cfoOutflows),
    actions30: cashOwnerActions30(buffer, weakDirections, productInflows, currentBalance),
  };
}

function cashResolveOwnerMainRisk(buffer, sourceDifference, internalNet, unclear, outflow, weakDirections, negativeMonths) {
  const unclearAbs = Math.abs(Number(unclear || 0));
  const unclearShare = outflow ? unclearAbs / Math.abs(outflow) : 0;
  const lowMarginDirections = weakDirections.filter(function cashMainRiskLowMarginDirection(row) {
    return row.margin !== null && row.margin < 15;
  });
  const negativeDirections = weakDirections.filter(function cashMainRiskNegativeDirection(row) {
    return Number(row.ncf || 0) < 0;
  });

  if (Math.abs(sourceDifference) >= 0.01) return 'Расхождение листа «Деньги» и ОДДС: сначала проверить качество данных.';
  if (Math.abs(internalNet) >= 0.01) return 'Внутренние перемещения не сошлись: есть непарная операция.';
  if (buffer.days < (buffer.isSummer ? 60 : 30)) return 'Недостаточный Cash Buffer' + (buffer.isSummer ? ' для летнего сезона.' : '.');
  if (lowMarginDirections.length) return 'Есть направления с маржинальностью ДП ниже 15%: это зона операционного риска.';
  if (negativeDirections.length) return 'Есть направления с отрицательным денежным потоком.';
  if (negativeMonths.length) return 'Есть месяцы с отрицательным ЧДП.';
  if (unclearAbs >= 0.01) return 'Есть небольшие операции «Выяснить» (' + cashFormatCurrency(unclear) + ', ' + cashRound(unclearShare * 100) + '% выплат): требуется разбор, но это не ключевой риск периода.';
  return 'Критичных рисков по текущему срезу не выявлено.';
}

function cashOwnerActions30(buffer, weakDirections, productInflows, currentBalance) {
  const actions = [];
  const lowMarginDirections = weakDirections.filter(function cashActionLowMarginDirection(row) {
    return row.margin !== null && row.margin < 15;
  });
  const negativeDirections = weakDirections.filter(function cashActionNegativeDirection(row) {
    return Number(row.ncf || 0) < 0;
  });

  actions.push('Собрать сценарий движения денег на 30 дней: поступления, обязательные платежи, остаток после ФОТ и аренды.');
  if (buffer.isSummer || buffer.days < 60) actions.push('Для летнего сезона держать отдельный резерв постоянных расходов минимум на 60 дней.');
  if (lowMarginDirections.length) actions.push('По направлениям с маржинальностью ДП ниже 15% провести аудит: поступления, локальные расходы, ФОТ, аренда, поддерживающие ЦФО.');
  else if (negativeDirections.length) actions.push('По направлениям с минусом провести разбор: поступления, локальные расходы, поддерживающие ЦФО, план выхода в плюс.');
  if (productInflows.length) actions.push('Усилить продажи и контроль оплат по продуктовым линейкам-лидерам, отдельно проверить зависимость от ТОП‑1/ТОП‑3 продуктов.');
  if (currentBalance) actions.push('Контролировать конечный остаток периода: текущий ориентир — ' + cashFormatCurrency(currentBalance.closingBalance || currentBalance.openingBalance || 0) + '.');
  return actions;
}
