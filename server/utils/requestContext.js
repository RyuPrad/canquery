const { AsyncLocalStorage } = require('node:async_hooks');
const context = new AsyncLocalStorage();
const requestSignal = () => context.getStore()?.signal;
const runWithRequestSignal = (signal, callback) => context.run({ signal }, callback);
module.exports = { requestSignal, runWithRequestSignal };
