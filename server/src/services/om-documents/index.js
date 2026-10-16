'use strict';

const documentService = require('./documentService');
const DocumentStorageService = require('./DocumentStorageService');
const documentFilingService = require('./documentFilingService');
const documentId = require('./documentId');
const plansPaths = require('./plansPaths');
const secretScan = require('./secretScan');

module.exports = {
  documentService,
  DocumentStorageService,
  documentFilingService,
  documentId,
  plansPaths,
  secretScan,
};
