module.exports = {

    provides: "schemaFileObject",

    re: [
        /https:\/\/(?:docs|drive)\.google\.com\/(forms|document|presentation|file)\/d\//i
    ],

    mixins: [
        "favicon",
        "og-title",
        "og-image",
        "og-description",
        "twitter-player-responsive"
    ],

    getMeta: function (schemaFileObject) {

        return {
            title: schemaFileObject.name,
            site: "Google Docs"

            // Silence canonical to bypass the validation and allow player.href=canonical
            // Especially for video files and presentations:

            // canonical: schemaFileObject.url
        };

    },

    getLink: function(urlMatch, schemaFileObject) {

        if (schemaFileObject.embedURL || schemaFileObject.embedUrl) {

            var file = {
                rel: [CONFIG.R.file],
                href: schemaFileObject.embedURL || schemaFileObject.embedUrl,
                type: CONFIG.T.maybe_text_html // let post-processing detect MIME type
            };            

            if (schemaFileObject.playerType) {
                // file.rel.push(CONFIG.R.player);
                // There is a problem with player as embedURL: x-frame-options is SAMEORIGIN
                return;
            } 

            if (urlMatch[1] === "forms" || urlMatch[1] === "document" ) {
                // As in PDF documents processed through Google Docs viewer
                file["aspect-ratio"] = 1 / Math.sqrt(2);
                file.rel.push (CONFIG.R.reader);

            } else {
                file["aspect-ratio"] = 4/3;
                file.rel.push (CONFIG.R.player);
            }

            return file;
        }

    },

    getData: function(cheerio) {

        var $scope = cheerio('[itemscope]');

        if ($scope.length) {

            var $aScope = cheerio($scope);

            var result = {};

            $aScope.find('[itemprop]').each(function() {
                var $el = cheerio(this);

                var scope = $el.attr('itemscope');
                if (typeof scope !== 'undefined') {
                    return;
                }

                var key = $el.attr('itemprop');
                if (key) {
                    var value = $el.attr('content') || $el.attr('href');
                    result[key] = value;
                }
            });

            return {
                schemaFileObject: result
            };
        }
    }, 

    tests: [
        "https://docs.google.com/document/d/17jg1RRL3RI969cLwbKBIcoGDsPwqaEdBxafGNYGwiY4/preview?sle=true",
        "https://docs.google.com/document/d/1KHLQiZkTFvMvBHmYgntEQtNxXswOQISjkbpnRO3jLrk/edit",
        "https://docs.google.com/presentation/d/1fE0PW1FMlYU9Xhig_QIGF8Yk1ApVfQQvntEEi4GbCm8/edit#slide=id.p",
        "https://docs.google.com/presentation/d/1fE0PW1FMlYU9Xhig_QIGF8Yk1ApVfQQvntEEi4GbCm8/preview",
        "https://docs.google.com/forms/d/1mJcBz16JAfxomVXIohDJv8w-AJw8t-jhAd1HgIwTlF8/viewform?c=0&w=1",
        "https://docs.google.com/file/d/0BzufrRo-waV_NlpOTlI0ZnB4eVE/preview",
        "https://drive.google.com/file/d/0BwGT3x6igRtkTWNtLWlhV3paZjA/view",
        {
            skipMixins: [
                "og-image", "og-title", "og-description", "twitter-player-responsive"
            ],
            skipMethods: [
                "getLink",
                "getMeta",
                "getData"
            ]
        }

    ]

};