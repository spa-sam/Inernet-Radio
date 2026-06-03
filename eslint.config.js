// ESLint flat config for the dependency-free vanilla-JS frontend.
// Lints the ES modules under src/js/ only; the bundled vendor file and the
// Rust backend are ignored. Browser globals are enabled, plus the Hls global
// provided by the vendored hls.js <script>.

import js from '@eslint/js';
import globals from 'globals';

export default [
    {
        ignores: ['src/vendor/**', 'src-tauri/**', 'node_modules/**', 'dist/**']
    },
    js.configs.recommended,
    {
        files: ['src/js/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                Hls: 'readonly'
            }
        },
        rules: {
            // Allow intentionally-unused args/catch bindings prefixed with _.
            'no-unused-vars': [
                'warn',
                { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
            ],
            // Empty catch blocks are used deliberately (e.g. localStorage probes).
            'no-empty': ['warn', { allowEmptyCatch: true }]
        }
    },
    {
        // AudioWorklet runs in a separate global scope with its own globals.
        files: ['src/worklets/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                AudioWorkletProcessor: 'readonly',
                registerProcessor: 'readonly',
                sampleRate: 'readonly',
                currentTime: 'readonly',
                currentFrame: 'readonly'
            }
        },
        rules: {
            'no-empty': ['warn', { allowEmptyCatch: true }]
        }
    }
];
