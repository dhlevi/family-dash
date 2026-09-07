import js from '@eslint/js'
import vueTsConfig from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'

export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  ...vueTsConfig(),
  {
    rules: {
      // Views and components are single-word by convention here
      // (Dashboard.vue, Calendar.vue), matching the route names.
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'vue/html-self-closing': ['error', { html: { void: 'any', normal: 'any', component: 'always' } }],

      // Prettier owns template formatting. Leaving these on means the two
      // tools fight each other and `npm run format` produces lint errors.
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/html-indent': 'off',
      'vue/attributes-order': 'off'
    }
  }
]
