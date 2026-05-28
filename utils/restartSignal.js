"use strict";

/**
 * restartSignal — lightweight pub/sub for triggering an internal bot reconnect.
 *
 * Usage:
 *   index.js   → restartSignal.setCallback(fn)  registers the reconnect function
 *   restart.js → restartSignal.trigger()         fires it
 *
 * This replaces process.exit() in the -restart command so the bot can reconnect
 * without needing an external process manager (PM2, Railway, etc.).
 */

let _callback = null;

module.exports = {
  /** Called from index.js after each successful login. */
  setCallback(fn) {
    _callback = fn;
  },

  /** Called from the -restart command. Invokes the registered reconnect fn. */
  trigger() {
    if (typeof _callback === "function") {
      _callback();
    }
  },

  /** Returns true if a callback is registered (bot is online). */
  isReady() {
    return typeof _callback === "function";
  },
};
