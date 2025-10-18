'use strict';

const { createLegacyHandlers } = require('./handlers');

function createLegacyRouter(deps = {}) {
  const handlers = createLegacyHandlers(deps);

  return {
    async tryHandle(req, res, context = {}) {
      const { url, method } = context;
      if (!url || !method || method.toUpperCase() !== 'GET') {
        return false;
      }

      const pathname = url.pathname;
      if (pathname === '/api/legacy/itemDetails.php') {
        await handlers.handleItemDetails(req, res, context);
        return true;
      }

      if (pathname === '/api/legacy/dataBundle.php') {
        await handlers.handleDataBundle(req, res, context);
        return true;
      }

      return false;
    },
  };
}

module.exports = {
  createLegacyRouter,
};
