const path = require('path');

function getDevelopmentUserDataPath(environment, defaultUserDataPath) {
  const configuredPath = environment.ICAI_VERA_DEV_USER_DATA_DIR;
  if (!configuredPath) return null;

  if (environment.NODE_ENV !== 'development') {
    throw new Error('ICAI_VERA_DEV_USER_DATA_DIR is only supported when NODE_ENV=development.');
  }
  if (!path.isAbsolute(configuredPath)) {
    throw new Error('ICAI_VERA_DEV_USER_DATA_DIR must be an absolute path.');
  }

  const resolvedPath = path.resolve(configuredPath);
  if (path.relative(path.resolve(defaultUserDataPath), resolvedPath) === '') {
    throw new Error('ICAI_VERA_DEV_USER_DATA_DIR must differ from the default userData path.');
  }

  return resolvedPath;
}

module.exports = { getDevelopmentUserDataPath };
