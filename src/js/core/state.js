// state.js — single shared mutable application state.
// Modules import this object and read/write its properties so that all parts
// of the app see the same live values (ES modules cannot reassign each other's
// `let` bindings, hence a single object).

export const state = {
    // Window / layout
    isAlwaysOnTop: false,

    // Timers
    liveTimerInterval: null,
    liveTimerSeconds: 0,
    sleepTimerInterval: null,
    sleepTimerEnd: 0,
    alarmInterval: null,
    alarmTarget: 0,

    // Playback
    currentStation: null,
    isPlaying: false,
    metadataInterval: null,
    wantPlayback: false,
    reconnectAttempts: 0,
    reconnectTimer: null,
    lastTrackTitle: '',

    // Collections
    favorites: [],
    customStations: [],
    blacklist: [],
    recentlyPlayed: [],
    trackHistory: [],
    lastStation: null,

    // List navigation
    currentStationsList: [],
    currentStationIndex: -1,

    // Infinite-scroll pagination state for the searchable station list. Only
    // active for searchStations() results; finite lists set active=false so
    // the scroll handler ignores them.
    searchPage: { active: false, query: '', tag: '', offset: 0, loading: false, exhausted: false },

    // Search-as-you-type debounce handle
    searchDebounce: null,

    // HLS playback (hls.js)
    hls: null,
    proxyHlsLoader: null,

    // Proxy port + access token (loaded from backend). The token authorizes
    // /stream requests so the local proxy is not an open relay.
    proxyPort: 0,
    proxyToken: '',

    // Web Audio graph
    audioContext: null,
    analyser: null,
    dataArray: null,
    animationId: null,
    sourceNode: null,
    eqFilters: [],
    compressorNode: null,
    masterGain: null,   // master output gain (drives volume on the PCM path)
    smoothedData: null,
    barPeaks: null, // peak bar positions
    peakHold: null, // hold time before peaks fall

    // PCM playback path (macOS/WebKit): Rust decodes the stream to PCM and it is
    // played through an AudioWorklet so the Web Audio graph (EQ/analyser) is fed.
    // On the <audio> path these stay null/false.
    workletNode: null,      // AudioWorkletNode ('pcm-player')
    workletReady: false,    // worklet module added to the context
    workletActive: false,   // true while the PCM path is the active source
    pcmAbort: null,         // AbortController for the in-flight /pcm fetch

    // Volume / fade
    lastVolumeBeforeMute: 70,
    fadeRAF: null,

    // Recording
    isRecording: false,

    // UI misc
    copyResetTimer: null,
    toastContainer: null,

    // Settings (persisted)
    settings: {
        compactMode: false,
        wideMode: false,
        visualizerEnabled: true,
        visualizerColor: '#ff5a36',
        visualizerStyle: 'bars',
        visualizerSensitivity: 1.0,
        eqEnabled: false,
        eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        normalizeEnabled: false,
        recordSplit: false,
        alarmEnabled: false,
        alarmTime: '07:00',
        m3uGenres: null,
        genrePresets: null,
        // Unified-search source toggles (M3U off by default — heavy to index)
        sources: { radioBrowser: true, somafm: true, m3u: false, custom: true },
        somaCache: null,   // { list, fetchedAt } — SomaFM channels for local search
        m3uIndex: null,    // { list, fetchedAt } — aggregated M3U stations for search
        radioMainWidth: null, // px width of the player column in wide view (resizable)
        favoritesOrder: [],
        customOrder: [],
        // Favicon URLs known to fail loading — skipped to avoid repeat fetches.
        faviconFailed: []
    }
};
