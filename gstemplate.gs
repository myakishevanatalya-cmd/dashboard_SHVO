const APP_CONFIG = {
  spreadsheetName: 'Дэшборд на скриптах v3 учебный',
  defaultPage: 'dashboard',
  pages: {
    dashboard: {
      file: 'dashboard',
      title: 'Финансовый дашборд',
      menuTitle: 'Дэшборд',
      description: 'Обзор ключевых финансовых показателей',
    },
    money: {
      file: 'money',
      title: 'Деньги',
      menuTitle: 'Деньги',
      description: 'Движение денежных средств и ликвидность',
    },
    capital: {
      file: 'capital',
      title: 'Капитал',
      menuTitle: 'Капитал',
      description: 'Собственный капитал и структура активов',
    },
    profit: {
      file: 'profit',
      title: 'Прибыль',
      menuTitle: 'Прибыль',
      description: 'Прибыльность и маржинальность бизнеса',
    },
  },
};

function doGet(e) {
  const pageKey = normalizePageKey_(e && e.parameter && e.parameter.page);
  const pageConfig = getPageConfig_(pageKey);
  const template = HtmlService.createTemplateFromFile('template');

  template.app = {
    currentPage: pageKey,
    pageTitle: pageConfig.title,
    pageDescription: pageConfig.description,
    menuItems: getMenuItems_(pageKey),
    content: include(pageConfig.file),
  };

  return template
    .evaluate()
    .setTitle(pageConfig.title)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getAppUrl() {
  return ScriptApp.getService().getUrl();
}

function getPageConfig_(pageKey) {
  return APP_CONFIG.pages[pageKey] || APP_CONFIG.pages[APP_CONFIG.defaultPage];
}

function normalizePageKey_(page) {
  const pageKey = String(page || APP_CONFIG.defaultPage).trim().toLowerCase();
  return APP_CONFIG.pages[pageKey] ? pageKey : APP_CONFIG.defaultPage;
}

function getMenuItems_(currentPage) {
  const appUrl = getAppUrl();

  return Object.keys(APP_CONFIG.pages).map(function (pageKey) {
    const pageConfig = APP_CONFIG.pages[pageKey];

    return {
      key: pageKey,
      title: pageConfig.menuTitle,
      url: appUrl + '?page=' + encodeURIComponent(pageKey),
      isActive: pageKey === currentPage,
    };
  });
}
