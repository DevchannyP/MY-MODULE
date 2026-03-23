'use strict';

function validationError(message) {
  return Object.assign(new Error(message), { code: 'VALIDATION_ERROR' });
}

function parsePositiveInteger(rawValue, {
  field,
  defaultValue,
  max,
}) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return defaultValue;
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 1) {
    throw validationError(`${field} must be a positive integer`);
  }
  if (max !== undefined && value > max) {
    throw validationError(`${field} must be less than or equal to ${max}`);
  }
  return value;
}

function parseOptionalFiniteNumber(rawValue, field) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return undefined;
  }

  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    throw validationError(`${field} must be a finite number`);
  }
  return value;
}

function parsePagination(query = {}, {
  pageField = 'page',
  pageSizeField = 'page_size',
  defaultPage = 1,
  defaultPageSize = 20,
  maxPageSize = 100,
} = {}) {
  return {
    page: parsePositiveInteger(query[pageField], {
      field: pageField,
      defaultValue: defaultPage,
    }),
    pageSize: parsePositiveInteger(query[pageSizeField], {
      field: pageSizeField,
      defaultValue: defaultPageSize,
      max: maxPageSize,
    }),
  };
}

module.exports = {
  parsePagination,
  parseOptionalFiniteNumber,
};
