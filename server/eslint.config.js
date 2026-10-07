const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
    { ignores: ['node_modules/', 'coverage/'] },
    js.configs.recommended,
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'commonjs',
            globals: { ...globals.node }
        },
        rules: {
            'no-unused-vars': ['error', { argsIgnorePattern: '^next$|^_' }],
            'no-empty': ['error', { allowEmptyCatch: true }]
        }
    },
    {
        files: ['**/*.mjs', 'integration/**/*.cjs'],
        languageOptions: { globals: { ...globals.node } }
    },
    {
        files: ['__tests__/**'],
        languageOptions: {
            globals: { ...globals.node, ...globals.jest }
        }
    }
];
