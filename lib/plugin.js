'use strict';

// node built-ins
var fs         = require('fs');
var path       = require('path');
var vm         = require('vm');

// npm modules
var constants  = require('haraka-constants');
var config     = require('haraka-config');

// local modules
var stub       = require('./stub').stub;
var vm_harness = require('./vm_harness');
var logger     = require('./logger');

function Plugin (name) {
    if (false === (this instanceof Plugin)) {
        return new Plugin(name);
    }

    this.name = name;
    this.base = {};
    this.register_hook = stub();
    this.plugin_path = this._get_plugin_path(name);
    this.config = this._get_config();
    this.last_err = '';

    // Set in server.js; initialized to empty object
    // to prevent it from blowing up any unit tests.
    this.server = { notes: {} };

    constants.import(global);

    logger.add_log_methods(this, name);

    return this.load_plugin(name);
}

function dirExists (dir) {
    try {
        if (fs.statSync(dir).isDirectory()) return true;
    }
    catch (ignore) {}
    return false;
}

function fileExists (filePath) {
    try {
        if (fs.statSync(filePath).isFile()) return true;
    }
    catch (ignore) {
        // console.error(ignore);
    }
    return false;
}

Plugin.prototype._has_package_json = function (plugin_path) {
    if (/\/package\.json$/.test(plugin_path)) {
        this.hasPackageJson = true;
        return;
    }

    var enclosing_dir = path.dirname(plugin_path);
    if (fileExists(path.join(enclosing_dir, 'package.json'))) {
        this.hasPackageJson = true;
        return true;
    }
    return false;
};

Plugin.prototype._get_plugin_path = function (name) {
    var plugin = this;

    plugin.hasPackageJson = false;
    if (!name) name = plugin.name;

    var paths = [];
    if (path.basename(__dirname) === 'lib'
        && path.basename(path.dirname(__dirname)) === 'haraka-test-fixtures'
        && path.basename(path.dirname(path.dirname(__dirname))) === 'node_modules') {
        // __dirname ends with node_modules/haraka-text-fixtures/lib

        /*eslint no-global-assign: ["error", {"exceptions": ["__dirname"]}] */
        /*eslint no-native-reassign: ["error", {"exceptions": ["__dirname"]}] */
        __dirname = path.resolve(__dirname, '..', '..', '..');
    }

    if ('lib' === path.basename(__dirname)) {
        // for haraka-test-fixture tests
        paths.push(
            path.resolve(__dirname, '..', name + '.js'),
            path.resolve(__dirname, '..', name, 'package.json')
        );
    }
    else if ('plugins' == path.basename(__dirname)) {
        // for 'inherits' in Haraka/tests/plugins/*.js
        paths.push(
            path.resolve(__dirname, name + '.js'),
            path.resolve(__dirname, name, 'package.json')
        );
    }
    else {
        if (dirExists(path.join(__dirname, 'plugins'))) {
            // Haraka/plugins/*.js && Haraka/node_modules/*
            paths.push(
                path.resolve(__dirname, 'plugins', name + '.js'),
                path.resolve(__dirname, 'plugins', name, 'package.json'),
                path.resolve(__dirname, 'node_modules', name, 'package.json')
            );
        }
        else {
            // npm packaged plugins
            paths.push(
                // npm packaged plugin inheriting an npm packaged plugin
                path.resolve(__dirname, 'node_modules', name, 'package.json'),

                path.resolve(__dirname, name + '.js'),
                path.resolve(__dirname, 'package.json')
            );
        }
    }
    // console.log(paths);

    for (var i = 0; i < paths.length; i++) {
        try {
            fs.statSync(paths[i]);
            this._has_package_json(paths[i]);
            return paths[i];
        }
        catch (ignore) {
            // console.error(ignore.message);
        }
    }
};

Plugin.prototype._get_config = function () {
    if (this.hasPackageJson) {
        // It's a package/folder plugin - look in plugin folder for defaults,
        // haraka/config folder for overrides
        return config.module_config(
            path.dirname(this.plugin_path),
            process.env.HARAKA || __dirname
        );
    }

    // Plain .js file, git mode - just look in this folder
    return config.module_config(__dirname);
};

Plugin.prototype._get_code = function (pi_path) {
    var plugin = this;

    if (plugin.hasPackageJson) {
        var ppd = path.dirname(pi_path);

        // this isn't working for haraka-test-fixtures tests. Why?
        // return 'exports = require("' + ppd + '");';

        // workaround / ugly cheatin hack
        var js = fs.readFileSync(pi_path);
        return fs.readFileSync(path.join(ppd, (js.main || 'index.js')));
    }

    try {
        return '"use strict";' + fs.readFileSync(pi_path);
    }
    catch (err) {
        throw 'Loading plugin ' + this.name + ' failed: ' + err;
    }
}

Plugin.prototype.load_plugin = function (name, pp) {

    if (!this.name) {
        // don't change plugin name when called by inherits();
        this.name = name;
    }
    if (!pp) pp = this.plugin_path;
    if (!pp) throw 'could not find path to plugin';
    var code = this._get_code(pp);
    // console.log(code);

    var sandbox = {
        require: vm_harness.sandbox_require,
        __filename: pp,
        __dirname:  path.dirname(pp),
        exports: this,
        console: console,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        setInterval: setInterval,
        clearInterval: clearInterval,
        process: process,
        Buffer: Buffer,
        Math: Math,
        server: this.server,
        setImmediate: setImmediate
    };
    constants.import(sandbox);
    try {
        vm.runInNewContext(code, sandbox, name);
    }
    catch (err) {
        throw err;
    }

    return this;
};

Plugin.prototype.inherits = function (parent_name) {
    var parent_path = this._get_plugin_path(parent_name);
    var parent_plugin = this.load_plugin(parent_name, parent_path);
    for (var method in parent_plugin) {
        if (!this[method]) {
            this[method] = parent_plugin[method];
        }
    }
    this.base[parent_name] = parent_plugin;
};

module.exports = Plugin;
