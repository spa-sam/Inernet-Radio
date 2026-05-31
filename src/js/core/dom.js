// dom.js — cached references to DOM elements.
// Modules are loaded as deferred ES modules (script at end of body), so the
// DOM is parsed by the time this runs.

const byId = (id) => document.getElementById(id);

const playBtn = byId('play-btn');

export const dom = {
    // Player / transport
    audioPlayer: byId('audio-player'),
    playBtn,
    playIcon: playBtn.querySelector('.play-icon'),
    prevBtn: byId('prev-btn'),
    nextBtn: byId('next-btn'),
    volumeSlider: byId('volume'),
    volumeMuteBtn: byId('volume-mute'),
    volumeBar: document.querySelector('.volume-bar'),
    volumeValueLabel: byId('volume-value'),

    // Search
    searchInput: byId('search-input'),
    searchBtn: byId('search-btn'),
    stationsList: byId('stations-list'),

    // Now playing
    stationName: byId('station-name'),
    stationLogo: byId('station-logo'),
    nowPlayingTrack: byId('now-playing-track'),
    metaGenre: byId('meta-genre'),
    metaBitrate: byId('meta-bitrate'),
    metaCodec: byId('meta-codec'),
    metaCountry: byId('meta-country'),
    visualizerCanvas: byId('visualizer'),
    appContainer: byId('app-container'),
    playerSection: document.querySelector('.player-section'),
    radioLayout: document.querySelector('.radio-layout'),

    // Search filters panel
    filtersToggleBtn: byId('filters-toggle-btn'),
    filtersPanel: byId('filters-panel'),
    filterCountry: byId('filter-country'),
    filterTag: byId('filter-tag'),
    filterBitrate: byId('filter-bitrate'),
    filterCodec: byId('filter-codec'),
    filterLanguage: byId('filter-language'),
    filterOrder: byId('filter-order'),
    m3uBar: byId('m3u-bar'),
    m3uGenreSelect: byId('m3u-genre-select'),
    m3uRefreshBtn: byId('m3u-refresh-btn'),

    // Recently played
    recentlyPlayedSection: byId('recently-played-section'),
    recentlyPlayedList: byId('recently-played-list'),

    // Track history
    trackHistoryList: byId('track-history-list'),
    clearHistoryBtn: byId('clear-history-btn'),

    // Custom stations
    customNameInput: byId('custom-name'),
    customUrlInput: byId('custom-url'),
    customGenreInput: byId('custom-genre'),
    addCustomBtn: byId('add-custom-btn'),
    previewBtn: byId('preview-btn'),
    customStationsList: byId('custom-stations-list'),
    currentStationInfo: byId('current-station-info'),

    // Edit station modal
    editModal: byId('edit-modal'),
    closeModalBtn: byId('close-modal-btn'),
    saveEditBtn: byId('save-edit-btn'),
    editStationUuidInput: byId('edit-station-uuid'),
    editStationNameInput: byId('edit-station-name'),
    editStationUrlInput: byId('edit-station-url'),
    editStationGenreInput: byId('edit-station-genre'),

    // Export / import
    exportFavoritesBtn: byId('export-favorites-btn'),
    importBtn: byId('import-btn'),
    importFile: byId('import-file'),

    // Settings
    compactModeCheckbox: byId('compact-mode'),
    visualizerEnabledCheckbox: byId('visualizer-enabled'),
    visualizerStyleSelect: byId('visualizer-style'),
    visualizerSensitivityInput: byId('visualizer-sensitivity'),
    visualizerColorPicker: byId('visualizer-color'),
    eqEnabledCheckbox: byId('eq-enabled'),
    eqPresetSelect: byId('eq-preset'),
    eqBandsContainer: byId('eq-bands'),
    normalizeCheckbox: byId('normalize-enabled'),
    recordSplitCheckbox: byId('record-split'),
    recordBtn: byId('record-btn'),
    enterCompactBtn: byId('enter-compact-btn'),
    exitCompactBtn: byId('exit-compact-btn'),
    alwaysOnTopBtn: byId('always-on-top-btn'),
    updateActionBtn: byId('update-action-btn'),
    updateStatus: byId('update-status'),
    updateProgressWrap: byId('update-progress-wrap'),
    updateProgressBar: byId('update-progress-bar'),
    viewModeSelect: byId('view-mode-select'),
    sleepTimerSelect: byId('sleep-timer-select'),
    sleepTimerStatus: byId('sleep-timer-status'),
    sleepTimerRemaining: byId('sleep-timer-remaining'),
    alarmEnabledCheckbox: byId('alarm-enabled'),
    alarmTime: byId('alarm-time'),
    alarmStatus: byId('alarm-status'),
    alarmRemaining: byId('alarm-remaining'),
    aboutVersion: byId('about-version'),

    // Layout / header
    viewSwitch: byId('view-switch'),
    brandStatus: byId('brand-status'),
    stationSub: byId('station-sub'),
    stationsCount: byId('stations-count'),
    transportQuality: byId('transport-quality'),
    liveTimer: byId('live-timer'),
    recStatus: byId('rec-status'),
    recStatusText: byId('rec-status-text'),
    trackCard: byId('track-card'),
    trackCardThumb: byId('track-card-thumb'),
    trackCopyBtn: byId('track-copy-btn'),
    trackYoutubeBtn: byId('track-youtube-btn')
};
