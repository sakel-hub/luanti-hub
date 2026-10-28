export type LocaleId = 'en' | 'sk' | 'de' | 'fr' | 'es' | 'ru';

export interface LocaleMeta {
  id: LocaleId;
  label: string;
  nativeLabel: string;
}

export const SUPPORTED_LOCALES: LocaleMeta[] = [
  { id: 'en', label: 'English', nativeLabel: 'English' },
  { id: 'sk', label: 'Slovak', nativeLabel: 'Slovenčina' },
  { id: 'de', label: 'German', nativeLabel: 'Deutsch' },
  { id: 'fr', label: 'French', nativeLabel: 'Français' },
  { id: 'es', label: 'Spanish', nativeLabel: 'Español' },
  { id: 'ru', label: 'Russian', nativeLabel: 'Русский' }
];

export interface TranslationDictionary {
  header: {
    title: string;
    subtitle: string;
    searchPlaceholder: string;
    searchTooltip: string;
    filterAll: string;
    filterMods: string;
    filterGames: string;
    filterTxp: string;
    filterGit: string;
    installApp: string;
    installAppTooltip: string;
    inGameSetup: string;
    inGameSetupTooltip: string;
    submitRepo: string;
    submitRepoTooltip: string;
    favorites: string;
    favoritesTooltip: string;
    language: string;
    languageTooltip: string;
    checkForUpdates: string;
    clearCache: string;
  };
  hero: {
    featuredBadge: string;
    playInstall: string;
    viewGit: string;
    viewDetails: string;
    rating: string;
    downloads: string;
    categoryGame: string;
    categoryMod: string;
    categoryTxp: string;
    categoryGit: string;
    prevSlide: string;
    nextSlide: string;
    pauseAutoPlay: string;
    resumeAutoPlay: string;
  };
  carousel: {
    trending: string;
    freshGit: string;
    standaloneGames: string;
    automation: string;
    texturePacks: string;
    scrollLeft: string;
    scrollRight: string;
  };
  card: {
    downloads: string;
    rating: string;
    byAuthor: string;
    license: string;
    favoriteTooltip: string;
    unfavoriteTooltip: string;
    gitSourceTooltip: string;
    clickToOpen: string;
  };
  modal: {
    close: string;
    installInGame: string;
    viewGitRepo: string;
    sharePackage: string;
    shareTooltip: string;
    tabOverview: string;
    tabReviews: string;
    tabCompliance: string;
    author: string;
    category: string;
    source: string;
    licenseCode: string;
    licenseMedia: string;
    engineVersion: string;
    downloads: string;
    rating: string;
    noReviews: string;
    leaveReview: string;
    stars: string;
    spdxNotice: string;
    safeHarborNotice: string;
  };
  setup: {
    title: string;
    subtitle: string;
    step1Title: string;
    step1Desc: string;
    step2Title: string;
    step2Desc: string;
    step3Title: string;
    step3Desc: string;
    configKey: string;
    copyTooltip: string;
    copied: string;
    close: string;
  };
  submit: {
    title: string;
    subtitle: string;
    repoUrlLabel: string;
    repoUrlPlaceholder: string;
    providerLabel: string;
    branchLabel: string;
    validateBtn: string;
    submittingBtn: string;
    guidelinesTitle: string;
    guideline1: string;
    guideline2: string;
    guideline3: string;
    close: string;
  };
  pwa: {
    updateAvailable: string;
    updateDesc: string;
    reloadNow: string;
    dismiss: string;
    upToDate: string;
    checking: string;
    cacheCleared: string;
    installSuccess: string;
    clearCacheTitle: string;
    clearCacheDesc: string;
  };
  common: {
    loading: string;
    noResults: string;
    noResultsDesc: string;
    copiedToClipboard: string;
    resultsCount: string;
    skipToContent: string;
  };
  footer: {
    about: string;
    inGameSetup: string;
    upstreamMirror: string;
    engineSite: string;
    dmca: string;
    disclaimer: string;
  };
}

export type TranslationKey =
  | `header.${keyof TranslationDictionary['header']}`
  | `hero.${keyof TranslationDictionary['hero']}`
  | `carousel.${keyof TranslationDictionary['carousel']}`
  | `card.${keyof TranslationDictionary['card']}`
  | `modal.${keyof TranslationDictionary['modal']}`
  | `setup.${keyof TranslationDictionary['setup']}`
  | `submit.${keyof TranslationDictionary['submit']}`
  | `pwa.${keyof TranslationDictionary['pwa']}`
  | `common.${keyof TranslationDictionary['common']}`
  | `footer.${keyof TranslationDictionary['footer']}`;
