'use strict';
/** Baut Datenbank, Router und HTTP-Server zusammen (auch für Tests nutzbar). */
const { Db } = require('./db');
const { Router } = require('./http/core');
const { createServer } = require('./http/server');

function createApp(config, log = console) {
  const db = new Db(config.dbFile);
  const router = new Router();
  require('./routes/auth')(router);
  require('./routes/master')(router);
  require('./routes/articles')(router);
  require('./routes/mode')(router);
  require('./routes/lists')(router);
  require('./routes/counts')(router);
  require('./routes/system')(router, { config, log });
  const server = createServer({ db, router, isSea: config.isSea, log });
  return { db, router, server };
}

module.exports = { createApp };
