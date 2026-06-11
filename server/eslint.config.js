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
        files: ['__tests__/**'],
        languageOptions: {
            globals: { ...globals.node, ...globals.jest }
        }
    }
];
