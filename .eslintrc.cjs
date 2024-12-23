module.exports = {
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  parser: '@typescript-eslint/parser',
  plugins: ['prettier', '@typescript-eslint'],
  rules: {
    quotes: ['error', 'backtick'],
    'no-unused-vars': 'off',
    '@typescript-eslint/triple-slash-reference': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      },
    ],
  },
  ignorePatterns: [
    '**/node_modules/**',
    '**/dist/**',
    'tsup.config.ts',
    'vitest.config.ts',
    '.eslintrc.cjs',
    'sst-env.d.ts',
  ],
}
