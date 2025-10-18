'use strict';

const { workerData } = require('worker_threads');
const { createMockMongoClient } = require('../fixtures/aggregate-worker-mocks.js');

const MockMongoClient = createMockMongoClient(workerData?.shared);

require.cache[require.resolve('mongodb')] = {
  exports: { MongoClient: MockMongoClient },
};
