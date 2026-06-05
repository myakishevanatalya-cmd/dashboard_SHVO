/**
 * Core layer for the financial dashboard web-app.
 * Stores shared settings, normalizes API responses, validates requests,
 * and provides safe helpers for future modules.
 */

const GSCORE = {
  app: {
    name: 'Управление финансовым состоянием компании',
    version: '1.0.0',
    spreadsheetName: 'Дэшборд на скриптах v3 учебный',
    timezone: Session.getScriptTimeZone() || 'Europe/Moscow',
    locale: 'ru-RU',
    currency: 'RUB',
  },

  sheets: {
    money: 'Деньги',
    capital: 'Капитал',
    profit: 'Прибыль',
  },

  pages: {
    dashboard: 'Финансовый дашборд',
    money: 'Деньги',
    capital: 'Капитал',
    profit: 'Прибыль',
  },

  request: {
    maxRows: 5000,
    defaultLimit: 500,
    allowedActions: {
      ping: true,
      getAppState: true,
      getSheetPreview: true,
    },
  },

  response: {
    okStatus: 'ok',
    errorStatus: 'error',
  },

  cache: {
    enabled: true,
    ttlSeconds: 300,
    prefix: 'finance_dashboard_',
  },
};

function corePing() {
  return createCoreSuccess_({
    message: 'Core is ready',
    app: getCorePublicConfig_(),
  });
}

function coreRequest(action, payload) {
  return safeCoreExecute_('coreRequest', function () {
    const request = normalizeCoreRequest_(action, payload);

    if (!GSCORE.request.allowedActions[request.action]) {
      throw createCoreError_(
        'ACTION_NOT_ALLOWED',
        'Запрошенное действие не разрешено ядром приложения.',
        { action: request.action }
      );
    }

    switch (request.action) {
      case 'ping':
        return corePing();

      case 'getAppState':
        return getCoreAppState(request.payload);

      case 'getSheetPreview':
        return getCoreSheetPreview(request.payload);

      default:
        throw createCoreError_(
          'ACTION_NOT_IMPLEMENTED',
          'Для запрошенного действия пока нет обработчика.',
          { action: request.action }
        );
    }
  });
}

function getCoreAppState(payload) {
  return safeCoreExecute_('getCoreAppState', function () {
    const currentPage = normalizeCorePageKey_(payload && payload.page);

    return createCoreSuccess_({
      app: getCorePublicConfig_(),
      currentPage: currentPage,
      pageTitle: GSCORE.pages[currentPage],
      pages: Object.keys(GSCORE.pages).map(function (pageKey) {
        return {
          key: pageKey,
          title: GSCORE.pages[pageKey],
          isActive: pageKey === currentPage,
        };
      }),
      sheets: getCoreSheetRegistry_(),
    });
  });
}

function getCoreSheetPreview(payload) {
  return safeCoreExecute_('getCoreSheetPreview', function () {
    const safePayload = payload || {};
    const sheetKey = normalizeCoreSheetKey_(safePayload.sheetKey);
    const limit = normalizeCoreLimit_(safePayload.limit);
    const sheet = getCoreSheetByKey_(sheetKey);
    const values = readCoreSheetValues_(sheet, {
      limit: limit,
      includeHeaders: true,
    });

    return createCoreSuccess_({
      sheetKey: sheetKey,
      sheetName: GSCORE.sheets[sheetKey],
      rowCount: Math.max(values.length - 1, 0),
      values: values,
    });
  });
}

function getCoreSpreadsheet() {
  return safeCoreExecute_('getCoreSpreadsheet', function () {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

    if (!spreadsheet) {
      throw createCoreError_(
        'SPREADSHEET_NOT_FOUND',
        'Не удалось получить активную Google-таблицу. Проверьте, что web-app привязан к таблице.'
      );
    }

    return spreadsheet;
  });
}

function getCoreSheetByKey_(sheetKey) {
  const normalizedSheetKey = normalizeCoreSheetKey_(sheetKey);
  const sheetName = GSCORE.sheets[normalizedSheetKey];
  const spreadsheetResult = getCoreSpreadsheet();

  if (!spreadsheetResult.success) {
    throw createCoreError_(
      spreadsheetResult.error.code,
      spreadsheetResult.error.message,
      spreadsheetResult.error.details
    );
  }

  const sheet = spreadsheetResult.data.getSheetByName(sheetName);

  if (!sheet) {
    throw createCoreError_(
      'SHEET_NOT_FOUND',
      'Лист "' + sheetName + '" не найден в Google-таблице.',
      { sheetKey: normalizedSheetKey, sheetName: sheetName }
    );
  }

  return sheet;
}

function readCoreSheetValues_(sheet, options) {
  const safeOptions = options || {};
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow === 0 || lastColumn === 0) {
    return [];
  }

  const requestedLimit = normalizeCoreLimit_(safeOptions.limit);
  const rowsToRead = Math.min(lastRow, requestedLimit + (safeOptions.includeHeaders ? 1 : 0));

  return sheet.getRange(1, 1, rowsToRead, lastColumn).getDisplayValues();
}

function normalizeCoreRequest_(action, payload) {
  const normalizedAction = String(action || '').trim();

  if (!normalizedAction) {
    throw createCoreError_(
      'ACTION_REQUIRED',
      'Не передано имя действия для coreRequest.'
    );
  }

  return {
    action: normalizedAction,
    payload: payload || {},
  };
}

function normalizeCorePageKey_(pageKey) {
  const normalizedPageKey = String(pageKey || 'dashboard').trim().toLowerCase();
  return GSCORE.pages[normalizedPageKey] ? normalizedPageKey : 'dashboard';
}

function normalizeCoreSheetKey_(sheetKey) {
  const normalizedSheetKey = String(sheetKey || '').trim().toLowerCase();

  if (!GSCORE.sheets[normalizedSheetKey]) {
    throw createCoreError_(
      'SHEET_KEY_NOT_ALLOWED',
      'Передан неизвестный ключ листа.',
      {
        sheetKey: sheetKey,
        allowedSheetKeys: Object.keys(GSCORE.sheets),
      }
    );
  }

  return normalizedSheetKey;
}

function normalizeCoreLimit_(limit) {
  const parsedLimit = Number(limit || GSCORE.request.defaultLimit);

  if (!isFinite(parsedLimit) || parsedLimit <= 0) {
    return GSCORE.request.defaultLimit;
  }

  return Math.min(Math.floor(parsedLimit), GSCORE.request.maxRows);
}

function createCoreSuccess_(data, meta) {
  return {
    success: true,
    status: GSCORE.response.okStatus,
    data: data || {},
    error: null,
    meta: createCoreMeta_(meta),
  };
}

function createCoreFailure_(error, meta) {
  const normalizedError = normalizeCoreError_(error);

  return {
    success: false,
    status: GSCORE.response.errorStatus,
    data: null,
    error: normalizedError,
    meta: createCoreMeta_(meta),
  };
}

function createCoreMeta_(meta) {
  const safeMeta = meta || {};

  return {
    appVersion: GSCORE.app.version,
    timestamp: new Date().toISOString(),
    timezone: GSCORE.app.timezone,
    source: safeMeta.source || 'gscore',
  };
}

function createCoreError_(code, message, details) {
  return {
    isCoreError: true,
    code: code || 'CORE_ERROR',
    message: message || 'Произошла ошибка ядра приложения.',
    details: details || {},
  };
}

function normalizeCoreError_(error) {
  if (error && error.isCoreError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details || {},
    };
  }

  return {
    code: 'UNEXPECTED_ERROR',
    message: error && error.message ? error.message : 'Произошла непредвиденная ошибка.',
    details: {
      raw: String(error || ''),
    },
  };
}

function safeCoreExecute_(source, callback) {
  try {
    return callback();
  } catch (error) {
    console.error('[GSCORE][' + source + ']', error);
    return createCoreFailure_(error, { source: source });
  }
}

function getCorePublicConfig_() {
  return {
    name: GSCORE.app.name,
    version: GSCORE.app.version,
    spreadsheetName: GSCORE.app.spreadsheetName,
    timezone: GSCORE.app.timezone,
    locale: GSCORE.app.locale,
    currency: GSCORE.app.currency,
  };
}

function getCoreSheetRegistry_() {
  return Object.keys(GSCORE.sheets).map(function (sheetKey) {
    return {
      key: sheetKey,
      name: GSCORE.sheets[sheetKey],
    };
  });
}

function formatCoreCurrency(value) {
  const number = normalizeCoreNumber(value);

  return number.toLocaleString(GSCORE.app.locale, {
    style: 'currency',
    currency: GSCORE.app.currency,
    maximumFractionDigits: 0,
  });
}

function formatCorePercent(value) {
  const number = normalizeCoreNumber(value);

  return number.toLocaleString(GSCORE.app.locale, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function formatCoreDate(value, pattern) {
  if (!value) {
    return '';
  }

  const date = value instanceof Date ? value : new Date(value);

  if (isNaN(date.getTime())) {
    return '';
  }

  return Utilities.formatDate(date, GSCORE.app.timezone, pattern || 'dd.MM.yyyy');
}

function normalizeCoreNumber(value) {
  if (typeof value === 'number') {
    return isFinite(value) ? value : 0;
  }

  const normalizedValue = String(value || '')
    .replace(/\s/g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '');
  const parsedValue = Number(normalizedValue);

  return isFinite(parsedValue) ? parsedValue : 0;
}

function getCoreCached_(key) {
  if (!GSCORE.cache.enabled) {
    return null;
  }

  const cache = CacheService.getScriptCache();
  const rawValue = cache.get(GSCORE.cache.prefix + key);

  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue);
  } catch (error) {
    console.error('[GSCORE][getCoreCached_]', error);
    return null;
  }
}

function setCoreCached_(key, value, ttlSeconds) {
  if (!GSCORE.cache.enabled) {
    return;
  }

  const cache = CacheService.getScriptCache();
  cache.put(
    GSCORE.cache.prefix + key,
    JSON.stringify(value),
    ttlSeconds || GSCORE.cache.ttlSeconds
  );
}
