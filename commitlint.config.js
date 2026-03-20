'use strict';
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', [
      'feat', 'fix', 'docs', 'style', 'refactor', 'perf',
      'test', 'chore', 'ci', 'build', 'revert',
      'stage',
      'report',
    ]],
    'scope-empty': [1, 'never'],
    'subject-max-length': [2, 'always', 120],
    'body-max-line-length': [0, 'always'],
  }
};
