import path from 'path';
import fs from 'fs/promises';
import { constants } from 'fs';
import glob from 'glob';
import PathState from './path-state.js';
import FairuResult from './fairu-result.js';

/**
 * @callback FairuPathCallback
 * @param {path} p - The path utility for constructing file-system paths.
 * @returns {String}
 */

/**
 * @callback FairuConditionCallback
 * @param {PathState} state - The state of the path as discovered by Fairu.
 * @returns {Boolean}
 */

/**
 * @enum {String}
 */
const FairuFormat = {
    yaml: 'yaml',
    toml: 'toml',
    json: 'json'
};

/**
 * Fairu is a file-system reading & writing helper designed to simplify operations. It provides an asynchronous and
 * chained method interface to working with files that helps you focus less on file system operations, and more on
 * just getting things written and read reliably.
 */
class Fairu {
    constructor() {

        /**
         * The globbing options to apply to path discovery.
         * @see https://www.npmjs.com/package/glob
         * @type {glob.IOptions}
         */
        this.options = {
            absolute: true
        };

        /**
         * The metadata for the constructed Fairu operation.
         * @private
         */
        this.metadata = {
            with: [],
            without: [],
            when: null,
            throw: true,
            format: null,
            ensure: false,
            encoding: null
        };
    }

    /**
     * Specify the file-system paths (including glob patterns) you will be performing an operation on. You may
     * optionally provide a callback that returns a path to use- the callback will be passed the `path` module as an
     * argument.
     * 
     * Calling this resets the paths used in this Fairu operation, letting you daisy-chain multiple operations
     * together, each starting with the `with` specification.
     * 
     * This function is not cummulative, specified paths will overwrite those set by a previous call.
     * @throws Error when a specified path is not a string or callback function.
     * @param  {...String | FairuPathCallback} paths - The series of file-system paths or callback functions. 
     * @returns {Fairu}
     * @example
     * Daisy chaining multiple operations:
     * ```js
     * await Fairu
     *   .with('./file1.txt', p => p.join('/home/', 'file2.txt'))
     *   .write(content)
     *   .with('./file3.txt')
     *   .write(otherContent);
     * ```
     * 
     * @example
     * Using glob paths:
     * ```js
     * await Fairu
     *   .with('./**', './+(hello|greetings)?(world|mars|venus).txt')
     *   .read();
     * ```
     */
    static with(...paths) {
        return new Fairu().with(...paths);
    }

    /**
     * Specify the file-system paths (including glob patterns) you will be performing an operation on. You may
     * optionally provide a callback that returns a path to use- the callback will be passed the `path` module as an
     * argument.
     * 
     * Calling this resets the paths used in this Fairu operation, letting you daisy-chain multiple operations
     * together, each starting with the `with` specification.
     * 
     * This function is not cummulative, specified paths will overwrite those set by a previous call.
     * @throws Error when a specified path is not a string or callback function.
     * @param  {...String | FairuPathCallback} paths - The series of file-system paths or callback functions. 
     * @returns {Fairu}
     * @example
     * Daisy chaining multiple operations:
     * ```js
     * await Fairu
     *   .with('./file1.txt', p => p.join('/home/', 'file2.txt'))
     *   .write(content)
     *   .with('./file3.txt')
     *   .write(otherContent);
     * ```
     * 
     * @example
     * Using glob paths:
     * ```js
     * await Fairu
     *   .with('./**', './+(hello|greetings)?(world|mars|venus).txt')
     *   .read();
     * ```
     */
    with(...paths) {
        this.metadata.with = [];
        for (let p of paths) {
            let pathType = typeof p;
            if (pathType === 'function') {
                this.metadata.with.push(p(path));
            } else if (pathType === 'string') {
                this.metadata.with.push(p);
            } else if (pathType === 'undefined' || p === null) {
                continue;
            } else {
                throw new Error('The "paths" argument encountered a specified non-string/non-function path. Only callbacks and strings are allowed paths. If a null or undefined value is found it is skipped.');
            }
        }
        return this;
    }

    /**
     * Specify the file-system paths (including glob patterns) you *do not* want to perform an operation on. You may
     * optionally provide a callback that returns a path to use- the callback will be passed the `path` module as an
     * argument.
     * 
     * This function is not cummulative, specified paths will overwrite those set by a previous call.
     * @throws Error when a specified path is not a string or callback function.
     * @param  {...String | FairuPathCallback} paths - The series of file-system paths or callback functions. 
     * @returns {Fairu}
     * @example
     * Skipping over certain files, in this case finding all `.js` files without `.test.` in the file name:
     * ```js
     * Fairu.
     *   .with('./*.js')
     *   .without('./*.test.*')
     *   .discover();
     * ```
     */
    without(...paths) {
        this.metadata.without = [];
        for (let p of paths) {
            let pathType = typeof p;
            if (pathType === 'function') {
                this.metadata.without.push(p(path));
            } else if (pathType === 'string') {
                this.metadata.without.push(p);
            } else if (pathType === 'undefined' || p === null) {
                continue;
            } else {
                throw new Error('The "paths" argument encountered a specified non-string/non-function path. Only callbacks and strings are allowed paths. If a null or undefined value is found it is skipped.');
            }
        }
        return this;
    }

    /**
     * Sets the text file encoding to the specified value.
     * By default the encoding is not set.
     * 
     * Calling this function without an argument or `null` will reset it to it's default (not set).
     * @throws Error when the encoding value is specified and not a string.
     * @param {String} encoding - The file text encoding to use when reading and writing files.
     * @returns {Fairu}
     */
    encoding(encoding) {
        let encodingType = typeof encoding;
        if (encodingType !== 'undefined' && encoding !== null && encodingType !== 'string') {
            throw new Error('The "encoding" argument, when specified, must be a string.');
        }
        this.metadata.encoding = encoding || null;
        return this;
    }

    /**
     * Sets the flag to have Fairu throw an error if one is encountered (`true`), or simply halt the operation for 
     * that path (`false`). By default Fairu will throw an error (`true`).
     * When the flag is `false` and an error occurs:
     * - `read()` will return `null` value for the `data` property in the result.
     * - `write()` may or may not occur or may only partially write.
     * - `touch()` may or may not occur.
     * 
     * Calling this function without an argument will reset it to it's default (`true`).
     * @throws Error when the `throwErrors` argument is not a boolean value.
     * @param {Boolean} [throwErrors=true] - If `true` an error is thrown as soon as it is encountered, when `false`
     * no errors are thrown and the next path operation is attempted. 
     * @returns {Fairu}
     */
    throw(throwErrors) {
        if (typeof throwErrors === 'undefined') {
            throwErrors = true;
        } else if (typeof throwErrors !== 'boolean') {
            throw new Error('The "throwErrors" argument, when specified, must be a boolean.');
        }
        this.metadata.throw = !!throwErrors;
        return this;
    }

    /**
     * Sets the flag to create any directories not found in a Fairu operation's path(s). If this flag is not 
     * enabled (`false`) and the directory path does not exist, then the file operation will error.
     * 
     * Calling this function without a `ensure` parameter argument will set the flag to `true`.
     * @throws Error when the `ensure` argument is not a boolean value.
     * @param {Boolean} [ensure=false] - If true, the directory path will be created if missing.
     * @returns {Fairu}
     */
    ensure(ensure) {
        if (typeof ensure === 'undefined') {
            ensure = true;
        } else if (typeof ensure !== 'boolean') {
            throw new Error('The "ensure" argument must be a boolean.');
        }
        this.metadata.ensure = ensure || false;
        return this;
    }

    /**
     * Enables formatting of written or read objects or data to the specified format, either: "json", "toml", or
     * "yaml". You may also ensure raw bufferred reads or writes by passing a `null` argument to clear the setting.
     * By default the format is not set.
     * 
     * Calling this function without an argument or `null` will reset it to it's default (not set).
     * @throws Error when the specified `format` argument is not "json", "yaml", "toml".
     * @param {FairuFormat} format - The format (or `null`) to use for reading & writing. Can be: "json", "toml", or
     *   "yaml".
     * @returns {Fairu}
     */
    format(format) {
        let formatType = typeof format;
        if (formatType !== 'undefined' && format !== null && formatType !== 'string') {
            throw new Error('The "format" argument, when specified, must be a string.');
        } else if (
            formatType !== 'undefined'
            && format !== null
            && format !== FairuFormat.json
            && format !== FairuFormat.toml
            && format !== FairuFormat.yaml) {
            throw new Error(`The "format" argument, when specified, must be either "json", "toml", or "yaml. Instead "${format}" was specified.`);
        }
        this.metadata.format = format || null;
        return this;
    }

    /**
     * Sets the conditional flags for the operation. Each flag must appear to be true for the operation to proceed on
     * a given path. 
     * 
     * Calling this function without an argument or `null` will reset it to it's default (no conditions).
     * @throws Error when the specified conditions are not a callback function.
     * @param {FairuConditionCallback} conditions - Conditional flags indicating what states of the path must appear
     *  to be true before proceeding with the operation for a path.
     * @returns {Fairu}
     * @example
     * Setting the `FairuConditionFlags.readable & FairuConditionFlags.exists` means the 
     * path must exist and must be readable for the Fairu operation to proceed.
     */
    when(conditions) {
        let conditionsType = typeof conditions;
        if (conditionsType !== 'undefined' && conditions !== null) {
            if (conditionsType === 'function') {
                this.metadata.when = conditions;
            } else {
                throw new Error('The "conditions" argument must be a callback.');
            }
        } else {
            this.metadata.when = null;
        }
        return this;
    }

    /**
     * Asynchronously resolves a glob pattern.
     * @param {String} pattern - The glob pattern to resolve.
     * @param {String | Array.<String>} [ignore] - An ignore pattern to exclude results from the matching file paths.
     * @returns {Promise.<Array.<String>>}
     * @private
     */
    async _globFind(pattern, ignore) {
        return await new Promise((resolve, reject) => {
            glob(pattern, Object.assign({}, this.options, {
                ignore: ignore
            }), (err, matches) => {
                if (err) reject(err);
                if (matches.length === 0 && glob.hasMagic(pattern, this.options) === false && (!ignore || Array.isArray(ignore) && ignore.length === 0)) {
                    matches.push(path.resolve(pattern));
                }
                return resolve(matches);
            });
        });
    }

    /**
     * Expands globbed paths and discovers information about them, returning a record for each path (including invalid)
     * ones.
     * @throws Error when the `throw` flag is true and an error discovering paths is encountered.
     * @returns {Promise.<Array.<PathState>>}
     */
    async discover() {
        //de-glob
        let paths = [];
        for (let globPath of this.metadata.with) {
            let foundPaths = await this._globFind(globPath, this.metadata.without);
            //ensure the path only shows up once in the results.
            for (let fp of foundPaths) {
                if (paths.indexOf(fp) <= -1) {
                    paths.push(fp);
                }
            }
        }
        //iterate & discover.
        let results = [];
        for (let p of paths) {
            //build default state
            let state = new PathState(p);
            state.operation = 'discover';
            results.push(state);
            //gather dicey details
            state.stats = await fs.stat(p);
            //set success
            state.success = true;
        }
        return results;
    }

    /**
     * 
     * @returns {Promise.<Array.<FairuResult>>}
     */
    async read() {
        let x = await this.discover();
        return this;
    }

    async write(content) {
        return this;
    }

    async append(content) {

    }

    async touch() {
        return this;
    }

    async unlink() {
        return this;
    }

}

export default Fairu;