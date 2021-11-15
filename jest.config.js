module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test', '<rootDir>/lambda/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  }
};
