(function(proxy) {

    var fs = require('fs'),
        path = require('path'),
        JSLINT = require('jslint'),
        _ = require('underscore'),
        async = require('async'),
        request = require('request'),
        jQuery = require('jQuery'),
        jsdom = require('jsdom'),
        url = require('url');

    var iframelyMeta = require('./iframely-meta');

    function findBestMedia(m1, m2) {

        if (!m1 && !m2) {
            return false;
        }

        if (m1 && !m2) {
            return true;
        }

        if (!m1 && m2) {
            return false;
        }

        if (m1["aspect-ratio"]) {
            return true;
        }

        if (m2["aspect-ratio"]) {
            return false;
        }

        if (!m2.width || !m2.height) {
            return false
        }

        if (!m1.width || !m1.height) {
            return false
        }

        return m1.width > m2.width || m1.height > m2.height;
    }


    proxy.getRawLinks = function(uri, options, cb) {

        if (typeof options === "function") {
            cb = options;
            options = {};
        }

        options = options || {};

        var counter = 0;

        async.waterfall([

            function(cb) {
                getAllDataFromPlugins(uri, {
                    forceOembed: options.debug,
                    forceMeta: options.debug
                }, cb);
            },

            function(data, cb) {

                var links = [];

                // Get img links.
                data.forEach(function(level) {
                    level.data.forEach(function(r) {
                        if (r.data && r.method.name in {"getLink": 1, "getLinks": 1}) {
                            var l = r.data;
                            if (!(l instanceof Array)) {
                                l = [l];
                            }
                            l.forEach(function(link) {
                                if (typeof link.href === "string") {
                                    if (PREPARE_LINK_HANDLERS['get image'].test(link)) {
                                        links.push(link);
                                    }
                                }
                            });
                        }
                    });
                });

                async.each(links, function(link, cb) {
                    PREPARE_LINK_HANDLERS['get image'].handle(uri, link, cb);
                }, function(error) {
                    cb(error, data);
                });
            },

            function(data, cb) {

                // Log debug.
                if (CONFIG.DEBUG)
                    data.forEach(function(level, i) {

                        console.log('== Level', i);
                        console.log("");

                        console.log("- Context:");
                        console.log("   - ", _.keys(level.context));
                        console.log("");

                        logResult(level.data);
                    });

                var links = [];
                var meta = {};
                var linksHrefDict = {};
                var linksProtocolDict = {};
                var title = data[0].context.title;

                data.forEach(function(level) {
                    level.data.forEach(function(r) {

                        if (!r.data) {
                            return;
                        }

                        if (r.method.name === "getMeta") {
                            for(var key in r.data) {
                                var v = r.data[key];
                                if (typeof v !== "undefined" && v !== null) {
                                    meta[key] = v;
                                }
                            }
                        }

                        if (r.data && r.method.name in {"getLink": 1, "getLinks": 1}) {

                            var l = r.data;
                            if (!(l instanceof Array)) {
                                l = [l];
                            }

                            l.forEach(function(originalLink) {

                                if (originalLink.error) {
                                    // Skip errors.
                                    return;
                                }

                                if (originalLink.href) {

                                    var link = _.extend({}, originalLink);

                                    // Fill title.
                                    if (!link.title && title) {
                                        link.title = title;
                                    }

                                    // Ensure rel array.
                                    link.rel = link.rel || [];
                                    if (typeof link.rel === "string") {
                                        link.rel = [link.rel];
                                    }
                                    link.rel = _.uniq(link.rel).filter(function(v) {return v;});

                                    if (link.rel.indexOf('player') > -1) {
                                        link.href = link.href.replace(/(auto_play)=true/i, '$1=false');
                                        link.href = link.href.replace(/(auto)=true/i, '$1=false');
                                        link.href = link.href.replace(/autoplay=1/, '');
                                        link.href = link.href.replace(/(autoPlay)=1/i, '$1=0');
                                        link.href = link.href.replace(/(autoStart)=true/i, '$1=false');
                                        link.href = link.href.replace(/(autoStart)=1/i, '$1=0');
                                    }

                                    moveMediaAttrs(link);

                                    if (options.debug) {
                                        // Bind source data and result link.
                                        link.sourceId = counter;
                                        originalLink.sourceId = counter;
                                    }

                                    counter++;


                                    // Filter non string hrefs.
                                    // TODO: move to post process link middleware.
                                    if (typeof link.href !== "string") {
                                        // TODO: fix error.
                                        link.error = "Non string href.";
                                        return;
                                    }

                                    // Resolve relative path.
                                    // TODO: move to post process link middleware.
                                    link.href = url.resolve(uri, link.href);

                                    if (link.href in linksHrefDict) {
                                        // Filter unique hrefs.
                                        // TODO: move to post process link middleware.
                                        var addedLinkRecord = linksHrefDict[link.href];

                                        var addedLink = links[addedLinkRecord.idx];
                                        var addedLinkOriginal = addedLinkRecord.originalLink;

                                        var badLinkOriginal = originalLink;

                                        if (findBestMedia(link.media, addedLink.media)) {
                                            badLinkOriginal = addedLinkOriginal;
                                            addedLink = link;
                                            links[addedLinkRecord.idx] = link;
                                        }

                                        badLinkOriginal.error = "Duplicate href with sourceId=" + addedLink.sourceId;
                                        addedLink.rel = _.union(addedLink.rel || [], link.rel || []);
                                        return;
                                    }

                                    // Collapse http:// and https:// to //
                                    // TODO: move to post process link middleware.
                                    var linkNoProtocol = link.href.replace(/^https?:/i, "");
                                    if (linkNoProtocol in linksProtocolDict) {
                                        var sourceLink = linksProtocolDict[linkNoProtocol];
                                        originalLink.error = "Removed http/https duplication with sourceId=" + sourceLink.sourceId;
                                        sourceLink.href = linkNoProtocol;
                                        link.rel = _.union(link.rel || [], originalLink.rel || []);
                                        return;
                                    } else {
                                        linksProtocolDict[linkNoProtocol] = link;
                                    }

                                    linksHrefDict[link.href] = {
                                        idx: links.length,
                                        originalLink: originalLink
                                    };

                                    links.push(link);
                                }
                            });
                        }
                    });
                });

                // Log links.
                if (CONFIG.DEBUG) {
                    console.log("Links:");
                    links.forEach(function(l) {
                        var data = _.extend({}, l);
                        for(var k in data) {
                            var v = data[k];
                            if (typeof v === "string" && v.length > 200) {
                                data[k] = v.substring(0, 200);
                            }
                        }
                        console.log(JSON.stringify(data, null, 4));
                    });
                }

                // TODO: always debug data - not good.
                cb(null, {
                    meta: meta,
                    links: links,
                    debug: data,
                    plugins: plugins
                });
            }

        ], function(error, data) {

            if (error && error.error == 'invalid-content-type') {

                var link = {
                    href: error.url,
                    type: error.headers['content-type'],
                    rel: CONFIG.R.thumbnail
                };

                data = {
                    meta: {},
                    links: [link],
                    debug: [],
                    plugins: plugins
                };

                if (PREPARE_LINK_HANDLERS['get image'].test(link)) {
                    return PREPARE_LINK_HANDLERS['get image'].handle(uri, link, function(error) {
                        moveMediaAttrs(link);

                        cb(null, data);
                    });
                }

                error = null;
            }

            cb(error, data);
        });
    };

    /*
    * Private
    * */

    /*
    * Links preparing.
    * */

    var PREPARE_LINK_HANDLERS = {
        'render html': {
            test: function(link) {
                return link.type == 'text/html' && (link.template_context || link.template);
            },
            handle: function(link, cb) {
                // TODO: render.
            }
        },
        'render script': {
            test: function(link) {
                return link.type == 'application/javascript' && (link.template_context || link.template);
            },
            handle: function(link, cb) {
                // TODO: render.
            }
        },
        'get image': {
            test: function(link) {
                return (link.type == "image" || /^image\//.test(link.type))
                    && (!link.width || !link.height);
            },
            handle: function(baseUri, link, cb) {
                var uri = url.resolve(baseUri, link.href);
                iframelyMeta.getImageMetadata(uri, function(error, data) {
                    if (error) {
                        link._imageMeta = {
                            error: "Load image error: " + error.toString()
                        };
                    } else if (data.error) {
                        if (data.error == 404) {
                            link.error = data.error;
                        } else {
                            link._imageMeta = {
                                error: "Load image error: " + data.error
                            };
                        }
                    } else {
                        link._imageMeta = {
                            type: data.format,
                            width: data.width,
                            height: data.height
                        };
                    }
                    cb();
                });
            }
        }
    };

    /*
    * Plugins handling
    * */

    function getAllDataFromPlugins(uri, options, cb) {
        /*
         * 1) Find plugin by domain.
         * 2) Find plugin by regexp in domain.
         *
         * Case 1 - domain plugin (found non RE domain plugin or RE domain plugin).
         *
         * Case 2 - generic plugin.
         *
         * 1) Gather requirements from suitable plugins.
         * 2) load requirements
         * 3) launch selected getData, getLink, getLinks.
         * 4) from getData - create new available requirements.
         * 5) find new getData, getLink, getLinks to use new requirements.
         * 6) recursive 3)
         * 7) got links array.
         * 8) render if template used of plugin-id == template-id
         *
         * */

        if (typeof options === "function") {
            cb = options;
            options = {};
        }

        options = options || {};

        // TODO: handle uri and cb exception.
        // TODO: workaround with canonicals. Optimizes meta loads.

        var domain = uri.split('/')[2].replace(/^www\./i, "").toLowerCase();

        var domainPlugins = pluginsList.filter(function(plugin) {
            if (plugin.domain) {
                // Positive match on plugin.domain="domain.com", domain="sub.domain.com"
                // Positive match on plugin.domain="domain.com", domain="domain.com"
                var idx = domain.indexOf(plugin.domain);

                if (idx == -1 || ((idx > 0) && domain.charAt(idx - 1) != '.')) {
                    // Break if not found, or not dot separation.
                    return false;
                }

                return (idx + plugin.domain.length) == domain.length;
            } else {
                return false;
            }
        });

        var initialPlugins = [];
        var secondaryPlugins = [];
        var urlMatch;
        var pluginDomain;
        var initialContext;
        var usedMethods = {};
        var contexts = [];
        var resultLevels = [];

        if (domainPlugins.length) {

            // Add permanent plugins (favicon).
            pluginsList.forEach(function(plugin) {
                if (!plugin.domain && plugin.module.useAlways) {
                    initialPlugins.push(plugin);
                }
            });

            pluginDomain = domainPlugins[0].domain;
            // Case 1 - domain plugin (found non RE domain plugin or RE domain plugin).

            domainPlugins.filter(function(plugin) {
                var match;
                plugin.re.forEach(function(re) {
                    if (!match) {
                        match = uri.match(re);
                    }
                });
                if (match) {
                    urlMatch = match;
                    initialPlugins.push(plugin);
                }
            });

            if (!urlMatch) {
                // No domain RE found.
                domainPlugins.forEach(function(plugin) {
                    if (plugin.re.length == 0) {
                        initialPlugins.push(plugin);
                    }
                });
            }
        }

        // If not domain or no domain plugins - fill with generic.
        if (initialPlugins.length == 0) {
            // Case 2 - generic plugin.
            pluginsList.forEach(function(plugin) {
                if (!plugin.domain && !plugin.custom) {
                    initialPlugins.push(plugin);
                }
            });
        }

        pluginsList.forEach(function(p) {
            if (!p.domain || p.domain == pluginDomain) {
                secondaryPlugins.push(p);
            }
        });

        if (CONFIG.DEBUG) {
            // Log
            console.log("URI:", uri);
            if (urlMatch) {
                console.log(' - urlMatch:', urlMatch);
            }
            if (pluginDomain) {
                console.log(' - domain:', pluginDomain);
            }
            initialPlugins.forEach(function(p) {
                console.log("       - plugin:", p.id);
            });
            // end log
        }

        var initialRequirements = {};

        async.waterfall([

            function(cb) {

                var iframelyProvides = [
                    "meta",
                    "oembed",
                    "html",
                    "$selector"
                ];

                // Load initial requirements.

                // Find requirements.
                var methodsData = findSuitableMethods(initialPlugins, DEFAULT_REQUIREMENTS);
                if (options.forceMeta) {
                    methodsData._allRequirements = _.union(methodsData._allRequirements, ["meta"]);
                }
                if (options.forceOembed) {
                    methodsData._allRequirements = _.union(methodsData._allRequirements, ["oembed"]);
                }
                methodsData._allRequirements.forEach(function(req) {
                    initialRequirements[req] = true;
                });

                if (_.intersection(iframelyProvides, methodsData._allRequirements).length > 0) {
                    
                    var opts = {
                        oembed: 'oembed' in initialRequirements,
                        fullResponse: 'html' in initialRequirements || '$selector' in initialRequirements
                    };

                    iframelyMeta.getPageData(uri, opts, cb);
                } else {
                    cb(null, null);
                }
            },

            function(data, cb) {

                if (CONFIG.DEBUG) {
                    console.log("loaded data", data && _.keys(data));
                }

                // TODO: urlMatch.
                // TODO: ! cached request.

                var context = {
                    url: uri,
                    request: request,
                    cb: true
                };

                if ('urlMatch' in initialRequirements) {
                    if (urlMatch) {
                        context.urlMatch = urlMatch;
                    } else {
                        // TODO: validation only for domain cases.
                    }
                }

                if (!data) {
                    return cb(null, context);
                }

                if ('meta' in initialRequirements) {
                    if (data.meta) {
                        context.meta = data.meta;
                    } else {
                        // TODO: validation only for domain cases.
                        // TODO: ? validation error - no required meta.
                    }
                }

                if ('oembed' in initialRequirements) {
                    if (data.oembed) {
                        context.oembed = data.oembed;
                    } else {
                        // TODO: ? validation error - no required oembed.
                    }
                }

                if ('html' in initialRequirements) {
                    if (data.fullResponse) {
                        context.html = data.fullResponse;
                    } else {
                        // TODO: ? validation error - no required html.
                    }
                }

                if ('$selector' in initialRequirements) {
                    if (data.fullResponse) {
                        jsdom.env({
                            html: data.fullResponse
                        }, function(err, window) {

                            // TODO: validate error?

                            context.$selector = jQuery.create(window);

                            cb(null, context);
                        });
                    } else {
                        // TODO: ? validation error - no required html.
                        cb(null, context);
                    }
                } else {
                    cb(null, context);
                }
            },

            function(_initialContext, cb) {

                initialContext = _initialContext;

                contexts.push(initialContext);
                var currentPlugins = initialPlugins;

                async.doWhilst(function(cb) {

                    async.waterfall([

                        function(cb) {
                            runPlugins(currentPlugins, contexts, usedMethods, cb);
                        },

                        function(data, cb) {

                            var result = _.flatten(data);

                            resultLevels.push({
                                data: result
                            });

                            var nextContext = extractCustomData(initialContext, result);

                            if (_.keys(nextContext).length > 0) {
                                contexts.push(nextContext);
                                currentPlugins = secondaryPlugins;
                            } else {
                                currentPlugins = null;
                            }

                            cb();
                        }

                    ], cb);

                }, function() {

                    return !!currentPlugins;

                }, cb);
            },

            function(cb) {

                for(var i = 0; i < resultLevels.length; i++) {
                    resultLevels[i].context = contexts[i];
                }

                cb(null, resultLevels);
            }

        ], cb);
    }

    function getVariableFromContexts(contexts, param) {

        var i = 0;
        while (!(param in contexts[i])) {
            i++;
        }

        return contexts[i][param];
    }

    function extractCustomData(initialContext, data) {

        var nextContext = {};

        data.forEach(function(r) {
            if (r.data && r.data.title) {
                // Store title.
                initialContext.title = r.data.title
            }
            if (r.method.name === 'getData' && r.data) {
                var newKeys = _.difference(_.keys(r.data), DEFAULT_LINK_ATTRS);
                newKeys.forEach(function(key) {
                    if (!(key in nextContext)) {
                        var value = r.data[key];
                        if (value != null && typeof value !== 'undefined') {
                            nextContext[key] = value;
                        }
                    }
                });
            }
        });

        return nextContext;
    }

    function logResult(result) {

        console.log('- Result:');
        result.forEach(function(r) {
            var parents = "";
            if (r.method.parents) {
                parents = "(mixin from: "+ r.method.parents +")";
            }
            var plugin = plugins[r.method.pluginId];
            console.log('   - method:', r.method.pluginId + "." + r.method.name, parents, "params:", plugin.methods[r.method.name]);

            if (r.error) {
                console.log('       - error:', r.error);
            } else {
                var data = _.extend({}, r.data);
                for(var k in data) {
                    var v = data[k];
                    if (typeof v === "string" && v.length > 200) {
                        data[k] = v.substring(0, 200);
                    }
                }
                console.log('       - data:', data);
                console.log('');
            }
        });
    }

    function runMethods(methods, contexts, cb) {

        async.map(methods, function(method, cb) {

            var plugin = plugins[method.pluginId];

            var params = plugin.methods[method.name];

            var args = [];

            var callback = function(error, data) {

                if (data) {
                    for(var key in data) {
                        var v = data[key];
                        if (v == null || (typeof v === 'undefined')) {
                            delete data[key];
                        }
                    }
                }

                if (error) {
                    console.error("Plugin error", plugin.id, method.name, error);
                }

                cb(null, {
                    method: method,
                    data: data,
                    error: error && error.toString()
                });
            };

            var cbUsed = false;

            params.forEach(function(param) {

                if (param === 'cb') {
                    cbUsed = true;
                    args.push(callback);
                    return;
                }

                args.push(getVariableFromContexts(contexts, param));
            });

            try {
                var result = method.handle.apply(plugin.module, args);
            } catch(ex) {
                // TODO: catch error.
                if (!cbUsed) {
                    callback(ex);
                    cbUsed = true;
                }
            }

            if (!cbUsed) {
                callback(null, result);
            }
        }, cb);
    }

    function runPlugins(availablePlugins, contexts, usedMethods, cb) {

        var availableRequirements = _.flatten(contexts.map(_.keys), true);
        var mandatoryRequirements = false;

        if (contexts.length > 1) {
            mandatoryRequirements = _.keys(contexts[contexts.length - 1]);
        }

        var methodsData = findSuitableMethods(availablePlugins, availableRequirements, mandatoryRequirements);

        var methods = [];

        for(var pluginId in methodsData) {
            var data = methodsData[pluginId];
            data.methods && data.methods.forEach(function(method) {

                var mId = pluginId + "." + method;

                if (mId in usedMethods) {
                    return;
                } else {
                    usedMethods[mId] = true;
                }

                var plugin = plugins[pluginId];
                methods.push({
                    pluginId: pluginId,
                    name: method,
                    handle: plugin.module[method],
                    parents: data.parents
                });
            });
        }

        runMethods(methods, contexts, cb);
    }

    /*
    * Default requirements.
    * */

    var DEFAULT_REQUIREMENTS = [
        "urlMatch",
        "url",
        "request",
        "meta",
        "oembed",
        "html",
        "$selector",
        "cb"
    ];

    var DEFAULT_LINK_ATTRS = [
        "title",
        "href",
        "type",
        "html",
        "template_context",
        "dependencies",
        "width",
        "height",
        "min-width",
        "min-height",
        "aspect-ratio",
        "rel"
    ];

    var MEDIA_ATTRS = [
        "width",
        "min-width",
        "max-width",
        "height",
        "min-height",
        "max-height",
        "aspect-ratio"
    ];

    var plugins = {};
    var pluginsList;
    var templates = {};

    var SIGN_TYPE_DICT = {
        "getLink": Function,
        "getLinks": Function,
        "getData": Function,
        "mixins": Array
    };

    var PLUGIN_METHODS = [
        "getLink",
        "getLinks",
        "getData",
        "getMeta"
    ];

    var PLUGINS_SIGNS = PLUGIN_METHODS.concat([
        "mixins"
    ]);

    function moveMediaAttrs(link) {
        if (!link.media) {
            var m = {};
            MEDIA_ATTRS.forEach(function(attr) {
                if (attr in link) {
                    var v = link[attr];

                    if (!v) {
                        return;
                    }

                    if (typeof v === 'number') {
                        v = Math.round(v * 100) / 100;
                    }

                    m[attr] = v;
                    delete link[attr];
                }
            });
            if (link._imageMeta && !link._imageMeta.error) {
                m.width = link._imageMeta.width;
                m.height = link._imageMeta.height;
                link.type = "image/" + link._imageMeta.type.toLowerCase()
            }

            delete link._imageMeta;
            if (!_.isEmpty(m)) {
                link.media = m;
            }
        }
    }

    function methodAvailable(params, availableRequirements) {
        return _.difference(params, availableRequirements).length == 0;
    }

    function _findSuitablePluginMethods(plugin, availableRequirements, mandatoryRequirements, result, parents) {

        if (plugin.id in result) {
            return;
        }

        // Register result array.
        result[plugin.id] = {
            methods: [],
            parents: parents
        };

        PLUGIN_METHODS.forEach(function(method) {
            if (method in plugin.methods) {
                var params = plugin.methods[method];
                if (methodAvailable(params, availableRequirements)) {

                    if (mandatoryRequirements) {
                        if (_.intersection(params, mandatoryRequirements).length == 0) {
                            return;
                        }
                    }

                    // Store all suitable methods by available requirements.
                    result[plugin.id].methods.push(method);
                    // Store required params.
                    result._allRequirements = _.union(result._allRequirements, params);
                }
            }
        });

        var newParents = (parents || []).concat(plugin.id);

        plugin.module.mixins && plugin.module.mixins.forEach(function(mixin) {
            _findSuitablePluginMethods(plugins[mixin], availableRequirements, mandatoryRequirements, result, newParents);
        });
    }

    function findSuitableMethods(pluginsList, availableRequirements, mandatoryRequirements) {
        var result = {
            _allRequirements: []
        };
        pluginsList.forEach(function(plugin) {
            _findSuitablePluginMethods(plugin, availableRequirements, mandatoryRequirements, result);
        });
        return result;
    }


    /*
    * ===================
    * Loading plugins
    * ===================
    * */


    // TODO: extract to another module.

    function validateMixins() {
        for(var id in plugins) {

            var plugin = plugins[id];

            plugin.module.mixins && plugin.module.mixins.forEach(function(mixin) {
                if (!(mixin in plugins)) {
                    console.log('Unexisting mixin "' + mixin + '" in plugin "' + id + '"');
                    delete plugins[id];
                }
            });
        }
    }

    function getFileName(filenameWithExt) {
        return filenameWithExt.replace(/\.js$/i, "");
    }

    function getPluginMethods(pluginPath) {

        var methods = {};

        var file = fs.readFileSync(pluginPath, "utf8");
        JSLINT(file, {node: true});
        var data = JSLINT.data();

        data.functions.filter(function(func) {
            func._name = func.name.replace(/'(.+)'/, "$1");
            return PLUGIN_METHODS.indexOf(func._name) > -1;
        }).forEach(function(func) {
                var params = methods[func._name] = [];
                func.params.forEach(function(param) {
                    params.push(param.string);
                });
            });

        return methods;
    }

    function loadPluginFile(pluginPath) {

        /*
         * Need:
         * 1) + domain or NO domain
         * 2) - re or [re]
         * 3) - mixins
         * 4) + id -> filename.toLowerCase()
         * 5) + Array: methods + requirements
         * 6) ??? validate available requirements for domain plugins:
         *       - urlMatch,
         *       - url,
         *       - request (cache wrapped),
         *       - meta,
         *       - oembed,
         *       - html,
         *       - $selector
         * 7) ? detect non standart requirements
         * 8) + validate mixins
         * 9) normalize re
         *
         * For templates:
         * 1) id -> filename
         *
         * For scripts:
         * ????????????
         * */

        var bits = pluginPath.split(path.sep);

        //console.log('');
        //console.log('-- loaded', bits.slice(-2).join('/'));

        if (pluginPath.match(/\.js$/i)) {

            var plugin;
            var pluginDeclaration = {};

            // Load plugin.
            try {
                plugin = require(pluginPath);
            } catch(ex) {
                console.error("Error loading plugin", pluginPath, ex);
                return;
            }

            if ("notPlugin" in plugin) {
                // Skip utils modules.
                return;
            }

            // Check if have required method.
            var hasSign = _.some(PLUGINS_SIGNS, function(sign) {
                return sign in plugin;
            });
            if (!hasSign) {
                console.warn("No plugin methods in " + pluginPath + ". Insert exports.notPlugin = true; to skip this warning.");
                return;
            }

            // Check methods type.
            var error = false;
            PLUGINS_SIGNS.forEach(function(sign) {
                if (sign in plugin && sign in SIGN_TYPE_DICT) {
                    if (!(plugin[sign] instanceof SIGN_TYPE_DICT[sign])) {
                        console.error('Type error: "' + sign + '" must by instanceof "' + SIGN_TYPE_DICT[sign] + '" in', pluginPath);
                        error = true;
                    }
                }
            });
            if (error) {
                return;
            }

            // ID.
            pluginDeclaration.id = getFileName(bits[bits.length - 1]).toLowerCase();
            if (pluginDeclaration.id in plugins) {
                console.error("Duplicate plugin id (filename)", pluginPath);
                return;
            }

            // Normalize RE.
            if (plugin.re) {
                if (plugin.re instanceof RegExp) {
                    pluginDeclaration.re = [plugin.re];
                } else if (plugin.re instanceof Array) {

                    if (!_.every(plugin.re, function(re) { return re instanceof RegExp; })) {
                        console.error('Not RegExp in re of', pluginPath);
                        return;
                    }

                    pluginDeclaration.re = plugin.re;
                } else {
                    console.error('Not RegExp or Array in re of', pluginPath);
                    return;
                }
            } else {
                pluginDeclaration.re = [];
            }

            // Find domain.
            var domainBitIdx = bits.indexOf('domains');
            if (domainBitIdx > -1) {
                // Domain plugin.
                var domain = bits[domainBitIdx + 1].replace(/^www\./i, "");
                // Remove .js extension if not folder.
                pluginDeclaration.domain = getFileName(domain);
            } else {
                if (plugin.re) {
                    console.warn("re in generic plugin (will never work)", pluginPath)
                }
            }

            // Find plugin methods params.
            pluginDeclaration.methods = getPluginMethods(pluginPath);
            for(var method in pluginDeclaration.methods) {
                if (!(method in plugin)) {
                    delete pluginDeclaration.methods[method];
                }
            }

            pluginDeclaration.module = plugin;

            pluginDeclaration.custom = bits.indexOf('custom') > -1;

            // Store plugin.
            plugins[pluginDeclaration.id] = pluginDeclaration;

            //console.log(JSON.stringify(pluginDeclaration.methods, null, 4));

        } else if (pluginPath.match(/\.ejs$/i)) {

            var id = getFileName(bits[bits.length - 1]).toLowerCase();

            if (id in templates) {
                console.error("Duplicate template id (filename)", pluginPath);
                return;
            }

            templates[id] = pluginPath;

            //console.log('== template', id);
        }
    }

    function loadPluginDir(pluginPath) {

        // Scan plugin dir.
        var plugins = fs.readdirSync(pluginPath);

        plugins.forEach(function(plugin_name) {
            var plugin = path.resolve(pluginPath, plugin_name);
            var stats = fs.statSync(plugin);

            if (stats.isFile()) {
                loadPluginFile(plugin);
            }
        });
    }

    function scanAllPluginsDir(modulePluginsPath) {

        // Scan mudule plugins.
        var plugins = fs.readdirSync(modulePluginsPath);

        plugins.forEach(function(plugin_name) {
            var plugin = path.resolve(modulePluginsPath, plugin_name);
            var stats = fs.statSync(plugin);

            if (stats.isFile()) {
                loadPluginFile(plugin);
            } if (stats.isDirectory()) {
                loadPluginDir(plugin);
            }
        });
    }

    function scanModulesForPlugins() {

        // Scan node_modules dir.
        var modulesRootPath = path.resolve('node_modules');
        var modules_listing = fs.readdirSync(modulesRootPath).map(function(module_name) { return path.resolve(modulesRootPath, module_name); });

        modules_listing.push(path.resolve('.'));

        modules_listing.forEach(function(modulePath) {

            var modulePackagePath = path.resolve(modulePath, 'package.json');

            if (fs.existsSync(modulePackagePath)) {

                // Scan plugins.

                var moduleInfo = require(modulePackagePath);
                if (!moduleInfo["iframely-proxy-plugins"]) {
                    return;
                }

                var modulePluginsPath = path.resolve(modulePath, 'plugins', 'domains');
                if (fs.existsSync(modulePluginsPath)) {
                    scanAllPluginsDir(modulePluginsPath);
                }

                var modulePluginsPath = path.resolve(modulePath, 'plugins', 'generic');
                if (fs.existsSync(modulePluginsPath)) {
                    scanAllPluginsDir(modulePluginsPath);
                }

                var modulePluginsPath = path.resolve(modulePath, 'plugins', 'custom');
                if (fs.existsSync(modulePluginsPath)) {
                    scanAllPluginsDir(modulePluginsPath);
                }

                // Scan template plugins (just one more dir for organisation).
                var moduleTemplatePluginsPath = path.resolve(modulePath, 'plugins', 'templates');
                if (fs.existsSync(moduleTemplatePluginsPath)) {
                    scanAllPluginsDir(moduleTemplatePluginsPath);
                }
            }
        });

        validateMixins();

        pluginsList = _.values(plugins);

        // Low priority - goes first, second plugin will override values.
        pluginsList.sort(function(p1, p2) {

            function getV(p) {
                if (p.module.lowestPriority) {
                    return 0;
                }
                if (p.module.highestPriority) {
                    return 2;
                }
                return 1;
            }

            return getV(p1) - getV(p2);
        });
    }

    scanModulesForPlugins();

})(exports);